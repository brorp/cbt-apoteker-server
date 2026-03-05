import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { users } from "../db/schema.js";
import { logActivity } from "../utils/activityLog.js";

type ExamPurpose = "ukai" | "cpns" | "pppk" | "other";

interface RegisterBody {
  name?: string;
  email?: string;
  password?: string;
  education?: string;
  school_origin?: string;
  exam_purpose?: ExamPurpose;
  address?: string;
  phone?: string;
  target_score?: number;
}

interface LoginBody {
  email?: string;
  password?: string;
}

const sanitizeUser = (user: {
  id: number;
  role: "admin" | "user";
  name: string;
  email: string;
  education: string;
  schoolOrigin: string;
  examPurpose: ExamPurpose;
  address: string;
  phone: string;
  targetScore: number | null;
  isPremium: boolean;
}) => ({
  id: user.id,
  role: user.role,
  name: user.name,
  email: user.email,
  education: user.education,
  school_origin: user.schoolOrigin,
  exam_purpose: user.examPurpose,
  address: user.address,
  phone: user.phone,
  target_score: user.targetScore ?? 0,
  is_premium: user.isPremium,
});

const createAccessToken = (payload: {
  userId: number;
  role: "admin" | "user";
  email: string;
}): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    {
      sub: String(payload.userId),
      role: payload.role,
      email: payload.email,
    },
    secret,
    { expiresIn: "7d" },
  );
};

const isValidExamPurpose = (value: unknown): value is ExamPurpose =>
  value === "ukai" || value === "cpns" || value === "pppk" || value === "other";

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as RegisterBody;
    const {
      name,
      email,
      password,
      education,
      school_origin,
      exam_purpose,
      address,
      phone,
      target_score,
    } = body;

    if (
      !name ||
      !email ||
      !password ||
      !education ||
      !school_origin ||
      !address ||
      !phone ||
      !isValidExamPurpose(exam_purpose)
    ) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name, email, password, education, school_origin, exam_purpose, address, phone.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
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
        password,
        education: education.trim(),
        schoolOrigin: school_origin.trim(),
        examPurpose: exam_purpose,
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
      });

    const token = createAccessToken({
      userId: createdUser.id,
      role: createdUser.role,
      email: createdUser.email,
    });

    res.status(201).json({
      message: "Registration successful.",
      token,
      user: sanitizeUser(createdUser),
    });

    await logActivity({
      actorUserId: createdUser.id,
      actorRole: createdUser.role,
      action: "REGISTER",
      entity: "AUTH",
      entityId: createdUser.id,
      status: "success",
      message: "User registered successfully.",
      metadata: { email: createdUser.email },
    });
  } catch (error) {
    console.error("register error:", error);
    await logActivity({
      action: "REGISTER",
      entity: "AUTH",
      status: "failed",
      message: "Register failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
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
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || user.password !== password) {
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

    const token = createAccessToken({
      userId: user.id,
      role: user.role,
      email: user.email,
    });

    res.status(200).json({
      message: "Login successful.",
      token,
      user: sanitizeUser(user),
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
