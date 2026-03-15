import { createHash, randomInt } from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "../config/db.js";
import { emailOtps, users } from "../db/schema.js";
import {
  buildRegistrationOtpEmail,
  sendEmail,
} from "./emailService.js";

const OTP_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_OTP_PURPOSE = "registration" as const;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailOtpServiceError extends Error {
  status: number;
  metadata?: Record<string, unknown>;

  constructor(message: string, status = 400, metadata?: Record<string, unknown>) {
    super(message);
    this.name = "EmailOtpServiceError";
    this.status = status;
    this.metadata = metadata;
  }
}

const getOtpSecret = (): string => {
  const secret =
    process.env.EMAIL_OTP_SECRET?.trim() || process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new EmailOtpServiceError(
      "EMAIL_OTP_SECRET or JWT_SECRET is not configured.",
      500,
    );
  }

  return secret;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const hashOtpCode = (email: string, otpCode: string): string =>
  createHash("sha256")
    .update(`${getOtpSecret()}:${EMAIL_OTP_PURPOSE}:${email}:${otpCode}`)
    .digest("hex");

const generateOtpCode = (): string => String(randomInt(1000, 10000));

export const issueRegistrationEmailOtp = async (emailInput: string) => {
  const email = normalizeEmail(emailInput);

  if (!EMAIL_REGEX.test(email)) {
    throw new EmailOtpServiceError("Invalid email address.", 400);
  }

  const [existingUser, latestOtp] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: emailOtps.id,
        createdAt: emailOtps.createdAt,
      })
      .from(emailOtps)
      .where(
        and(
          eq(emailOtps.email, email),
          eq(emailOtps.purpose, EMAIL_OTP_PURPOSE),
          isNull(emailOtps.consumedAt),
          gt(emailOtps.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(emailOtps.createdAt), desc(emailOtps.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (existingUser) {
    throw new EmailOtpServiceError("Email is already registered.", 409);
  }

  if (latestOtp) {
    const elapsedSeconds = Math.floor(
      (Date.now() - latestOtp.createdAt.getTime()) / 1000,
    );

    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const retryAfterSeconds = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new EmailOtpServiceError(
        `OTP was sent recently. Try again in ${retryAfterSeconds} seconds.`,
        429,
        { retry_after_seconds: retryAfterSeconds },
      );
    }
  }

  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const consumedAt = new Date();

  await db
    .update(emailOtps)
    .set({
      consumedAt,
      updatedAt: consumedAt,
    })
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.purpose, EMAIL_OTP_PURPOSE),
        isNull(emailOtps.consumedAt),
      ),
    );

  const [createdOtp] = await db
    .insert(emailOtps)
    .values({
      email,
      purpose: EMAIL_OTP_PURPOSE,
      otpHash: hashOtpCode(email, otpCode),
      expiresAt,
    })
    .returning({
      id: emailOtps.id,
      expiresAt: emailOtps.expiresAt,
      createdAt: emailOtps.createdAt,
    });

  const emailPayload = buildRegistrationOtpEmail({ otpCode });
  const emailResult = await sendEmail({
    to: email,
    subject: emailPayload.subject,
    html: emailPayload.html,
    text: emailPayload.text,
  });

  if (!emailResult.delivered && emailResult.provider === "resend") {
    const failedAt = new Date();
    await db
      .update(emailOtps)
      .set({
        consumedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(emailOtps.id, createdOtp.id));

    throw new EmailOtpServiceError(
      emailResult.error || "Failed to send OTP email.",
      502,
    );
  }

  return {
    requestId: createdOtp.id,
    email,
    expiresAt: createdOtp.expiresAt,
    retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
    provider: emailResult.provider,
    delivered: emailResult.delivered,
    messageId: emailResult.messageId ?? null,
    warning: emailResult.delivered ? null : emailResult.error ?? null,
  };
};
