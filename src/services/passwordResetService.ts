import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "../config/db.js";
import { passwordResetTokens, users } from "../db/schema.js";
import { buildForgotPasswordEmail, sendEmail } from "./emailService.js";

const PASSWORD_RESET_TTL_MINUTES = 15;
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PasswordResetServiceError extends Error {
  status: number;
  metadata?: Record<string, unknown>;

  constructor(
    message: string,
    status = 400,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PasswordResetServiceError";
    this.status = status;
    this.metadata = metadata;
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const getPasswordResetSecret = (): string => {
  const secret =
    process.env.PASSWORD_RESET_SECRET?.trim() ||
    process.env.AUTH_FLOW_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new PasswordResetServiceError(
      "PASSWORD_RESET_SECRET, AUTH_FLOW_SECRET, or JWT_SECRET is not configured.",
      500,
    );
  }

  return secret;
};

const hashResetToken = (token: string): string =>
  createHash("sha256")
    .update(`${getPasswordResetSecret()}:${token}`)
    .digest("hex");

const getFrontendBaseUrl = (): string =>
  (
    process.env.PASSWORD_RESET_FRONTEND_BASE_URL?.trim() ||
    process.env.KSUKAI_FRONTEND_BASE_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

const buildResetLink = (token: string): string => {
  const url = new URL(`${getFrontendBaseUrl()}/reset-password`);
  url.searchParams.set("token", token);
  return url.toString();
};

export const requestPasswordReset = async (emailInput: string) => {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_REGEX.test(email)) {
    throw new PasswordResetServiceError("Invalid email address.", 400);
  }

  const [user, latestToken] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        password: users.password,
        authProvider: users.authProvider,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: passwordResetTokens.id,
        createdAt: passwordResetTokens.createdAt,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.email, email),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(passwordResetTokens.createdAt), desc(passwordResetTokens.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!user) {
    throw new PasswordResetServiceError("Email is not registered.", 404);
  }

  if (!user.password || user.authProvider === "google") {
    throw new PasswordResetServiceError(
      "Akun ini masuk menggunakan Google dan tidak memiliki reset password email.",
      400,
    );
  }

  if (latestToken) {
    const elapsedSeconds = Math.floor(
      (Date.now() - latestToken.createdAt.getTime()) / 1000,
    );

    if (elapsedSeconds < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS) {
      const retryAfterSeconds =
        PASSWORD_RESET_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new PasswordResetServiceError(
        `Link reset sudah dikirim. Coba lagi dalam ${retryAfterSeconds} detik.`,
        429,
        { retry_after_seconds: retryAfterSeconds },
      );
    }
  }

  const now = new Date();
  await db
    .update(passwordResetTokens)
    .set({
      consumedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(passwordResetTokens.email, email),
        isNull(passwordResetTokens.consumedAt),
      ),
    );

  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  );

  const [created] = await db
    .insert(passwordResetTokens)
    .values({
      userId: user.id,
      email,
      tokenHash: hashResetToken(rawToken),
      expiresAt,
    })
    .returning({
      id: passwordResetTokens.id,
      expiresAt: passwordResetTokens.expiresAt,
    });

  const resetLink = buildResetLink(rawToken);
  const emailPayload = buildForgotPasswordEmail({
    userName: user.name,
    resetLink,
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });
  const emailResult = await sendEmail({
    to: email,
    subject: emailPayload.subject,
    html: emailPayload.html,
    text: emailPayload.text,
  });

  if (!emailResult.delivered && emailResult.provider === "resend") {
    const failedAt = new Date();
    await db
      .update(passwordResetTokens)
      .set({
        consumedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(passwordResetTokens.id, created.id));

    throw new PasswordResetServiceError(
      emailResult.error || "Failed to send password reset email.",
      502,
    );
  }

  return {
    requestId: created.id,
    email,
    expiresAt: created.expiresAt,
    retryAfterSeconds: PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
    provider: emailResult.provider,
    delivered: emailResult.delivered,
    warning: emailResult.delivered ? null : emailResult.error ?? null,
  };
};

const findActiveResetToken = async (token: string) => {
  const hashed = hashResetToken(token.trim());
  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      email: passwordResetTokens.email,
      expiresAt: passwordResetTokens.expiresAt,
      consumedAt: passwordResetTokens.consumedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashed))
    .orderBy(desc(passwordResetTokens.createdAt), desc(passwordResetTokens.id))
    .limit(1);

  return row ?? null;
};

export const verifyPasswordResetToken = async (tokenInput: string) => {
  const token = tokenInput.trim();
  if (!token) {
    throw new PasswordResetServiceError("Reset token is required.", 400);
  }

  const row = await findActiveResetToken(token);
  if (!row || row.consumedAt) {
    throw new PasswordResetServiceError(
      "Reset password link is invalid or already used.",
      410,
    );
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    const now = new Date();
    await db
      .update(passwordResetTokens)
      .set({
        consumedAt: now,
        updatedAt: now,
      })
      .where(eq(passwordResetTokens.id, row.id));

    throw new PasswordResetServiceError(
      "Reset password link has expired.",
      410,
    );
  }

  return {
    userId: row.userId,
    email: row.email,
    expiresAt: row.expiresAt,
  };
};

export const resetPasswordWithToken = async (
  tokenInput: string,
  newPasswordInput: string,
) => {
  const token = tokenInput.trim();
  const newPassword = newPasswordInput.trim();

  if (!newPassword || newPassword.length < 6) {
    throw new PasswordResetServiceError(
      "Password baru minimal 6 karakter.",
      400,
    );
  }

  const row = await findActiveResetToken(token);
  if (!row || row.consumedAt) {
    throw new PasswordResetServiceError(
      "Reset password link is invalid or already used.",
      410,
    );
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    const now = new Date();
    await db
      .update(passwordResetTokens)
      .set({
        consumedAt: now,
        updatedAt: now,
      })
      .where(eq(passwordResetTokens.id, row.id));

    throw new PasswordResetServiceError(
      "Reset password link has expired.",
      410,
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      googleUserId: users.googleUserId,
    })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!user) {
    throw new PasswordResetServiceError("User not found.", 404);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        password: newPassword,
        authProvider: user.googleUserId ? "both" : "email",
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await tx
      .update(passwordResetTokens)
      .set({
        consumedAt: now,
        updatedAt: now,
      })
      .where(eq(passwordResetTokens.id, row.id));
  });

  return {
    email: row.email,
    updatedAt: now,
  };
};
