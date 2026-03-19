import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { users } from "../db/schema.js";
import {
  createAccessToken,
  sanitizeAuthUser,
} from "../services/authSessionService.js";
import {
  RegistrationFlowTokenError,
  verifyRegistrationFlowToken,
} from "../services/authFlowTokenService.js";
import { logActivity } from "../utils/activityLog.js";
import {
  normalizeExamPurposeInput,
  type ClientExamPurpose,
} from "../utils/examPurpose.js";

interface RegisterBody {
  registration_token?: string;
  name?: string;
  password?: string;
  education?: string;
  school_origin?: string;
  exam_purpose?: ClientExamPurpose;
  address?: string;
  phone?: string;
  target_score?: number;
}

interface LoginBody {
  email?: string;
  password?: string;
}

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as RegisterBody;
    const {
      registration_token,
      name,
      password,
      education,
      school_origin,
      exam_purpose,
      address,
      phone,
      target_score,
    } = body;
    if (!registration_token?.trim()) {
      res.status(400).json({
        message:
          "Registration token is required. Verify email OTP or continue with Google first.",
      });
      return;
    }

    const registrationFlow = verifyRegistrationFlowToken(
      registration_token.trim(),
    );
    const normalizedExamPurpose = normalizeExamPurposeInput(exam_purpose);

    if (
      !name ||
      !education ||
      !school_origin ||
      !address ||
      !phone ||
      !normalizedExamPurpose
    ) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: registration_token, name, education, school_origin, exam_purpose, address, phone.",
      });
      return;
    }

    const requiresPassword = registrationFlow.method !== "google";
    if (requiresPassword && !password?.trim()) {
      res.status(400).json({
        message: "Password is required for email registration.",
      });
      return;
    }

    const normalizedEmail = registrationFlow.email;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing) {
      await logActivity({
        action: "REGISTER",
        entity: "AUTH",
        status: "failed",
        message: "Register failed: email already exists.",
        metadata: { email: normalizedEmail },
      });
      res.status(409).json({ message: "Email is already registered." });
      return;
    }

    const [createdUser] = await db
      .insert(users)
      .values({
        role: "user",
        name: name.trim(),
        email: normalizedEmail,
        password: requiresPassword ? password?.trim() ?? null : null,
        authProvider: registrationFlow.method === "google" ? "google" : "email",
        googleUserId:
          registrationFlow.method === "google"
            ? registrationFlow.googleUserId ?? null
            : null,
        education: education.trim(),
        schoolOrigin: school_origin.trim(),
        examPurpose: normalizedExamPurpose,
        address: address.trim(),
        phone: phone.trim(),
        targetScore:
          typeof target_score === "number" && Number.isFinite(target_score)
            ? Math.round(target_score)
            : 0,
        isPremium: false,
      })
      .returning({
        id: users.id,
        role: users.role,
        name: users.name,
        email: users.email,
        education: users.education,
        schoolOrigin: users.schoolOrigin,
        examPurpose: users.examPurpose,
        address: users.address,
        phone: users.phone,
        targetScore: users.targetScore,
        isPremium: users.isPremium,
        authProvider: users.authProvider,
        accountStatus: users.accountStatus,
        statusNote: users.statusNote,
      });

    const token = createAccessToken({
      userId: createdUser.id,
      role: createdUser.role,
      email: createdUser.email,
    });

    res.status(201).json({
      message: "Registration successful.",
      token,
      user: sanitizeAuthUser(createdUser),
    });

    await logActivity({
      actorUserId: createdUser.id,
      actorRole: createdUser.role,
      action: "REGISTER",
      entity: "AUTH",
      entityId: createdUser.id,
      status: "success",
      message: "User registered successfully.",
      metadata: {
        email: createdUser.email,
        registration_method: registrationFlow.method,
        auth_provider: createdUser.authProvider,
      },
    });
  } catch (error) {
    console.error("register error:", error);
    await logActivity({
      action: "REGISTER",
      entity: "AUTH",
      status: "failed",
      message: "Register failed due to internal server error.",
    });
    res.status(
      error instanceof RegistrationFlowTokenError ? error.status : 500,
    ).json({
      message:
        error instanceof Error ? error.message : "Internal server error.",
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as LoginBody;
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      await logActivity({
        action: "LOGIN",
        entity: "AUTH",
        status: "failed",
        message: "Login failed: missing email or password.",
        metadata: { email: email ?? null },
      });
      res.status(400).json({ message: "Email and password are required." });
      return;
    }

    const [user] = await db
      .select({
        id: users.id,
        role: users.role,
        name: users.name,
        email: users.email,
        password: users.password,
        education: users.education,
        schoolOrigin: users.schoolOrigin,
        examPurpose: users.examPurpose,
        address: users.address,
        phone: users.phone,
        targetScore: users.targetScore,
        isPremium: users.isPremium,
        authProvider: users.authProvider,
        accountStatus: users.accountStatus,
        statusNote: users.statusNote,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      await logActivity({
        action: "LOGIN",
        entity: "AUTH",
        status: "failed",
        message: "Login failed: invalid credential.",
        metadata: { email },
      });
      res.status(401).json({ message: "Invalid email or password." });
      return;
    }

    if (!user.password) {
      await logActivity({
        actorUserId: user.id,
        actorRole: user.role,
        action: "LOGIN",
        entity: "AUTH",
        entityId: user.id,
        status: "failed",
        message: "Login blocked: account uses Google sign-in only.",
        metadata: { email },
      });
      res.status(403).json({
        message:
          "Akun ini terdaftar melalui Google. Silakan masuk dengan Google.",
      });
      return;
    }

    if (user.password !== password) {
      await logActivity({
        action: "LOGIN",
        entity: "AUTH",
        status: "failed",
        message: "Login failed: invalid credential.",
        metadata: { email },
      });
      res.status(401).json({ message: "Invalid email or password." });
      return;
    }

    if (user.accountStatus !== "active") {
      await logActivity({
        actorUserId: user.id,
        actorRole: user.role,
        action: "LOGIN",
        entity: "AUTH",
        entityId: user.id,
        status: "failed",
        message: "Login blocked: inactive account.",
      });
      res.status(403).json({
        message:
          user.statusNote?.trim() ||
          "Akun Anda saat ini nonaktif. Silakan hubungi admin.",
      });
      return;
    }

    const token = createAccessToken({
      userId: user.id,
      role: user.role,
      email: user.email,
    });

    res.status(200).json({
      message: "Login successful.",
      token,
      user: sanitizeAuthUser(user),
    });

    await logActivity({
      actorUserId: user.id,
      actorRole: user.role,
      action: "LOGIN",
      entity: "AUTH",
      entityId: user.id,
      status: "success",
      message: "User login successful.",
      metadata: { email: user.email },
    });
  } catch (error) {
    console.error("login error:", error);
    await logActivity({
      action: "LOGIN",
      entity: "AUTH",
      status: "failed",
      message: "Login failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};
