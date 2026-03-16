import jwt from "jsonwebtoken";

import { mapStoredExamPurposeToClient } from "../utils/examPurpose.js";

export interface AuthUserRecord {
  id: number;
  role: "admin" | "user";
  name: string;
  email: string;
  education: string;
  schoolOrigin: string;
  examPurpose: string;
  address: string;
  phone: string;
  targetScore: number | null;
  isPremium: boolean;
  accountStatus?: "active" | "inactive";
  statusNote?: string | null;
}

export const sanitizeAuthUser = (user: AuthUserRecord) => ({
  id: user.id,
  role: user.role,
  name: user.name,
  email: user.email,
  education: user.education,
  school_origin: user.schoolOrigin,
  exam_purpose: mapStoredExamPurposeToClient(user.examPurpose),
  address: user.address,
  phone: user.phone,
  target_score: user.targetScore ?? 0,
  is_premium: user.isPremium,
  account_status: user.accountStatus ?? "active",
  status_note: user.statusNote ?? null,
});

export const createAccessToken = (payload: {
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
