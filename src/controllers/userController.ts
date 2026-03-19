import type { Response } from "express";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { users } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import { mapStoredExamPurposeToClient } from "../utils/examPurpose.js";

export const profile = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      await logActivity({
        action: "PROFILE_READ",
        entity: "USER",
        status: "failed",
        message: "Profile read failed: unauthorized request.",
      });
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const [user] = await db
      .select({
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
      })
      .from(users)
      .where(eq(users.id, req.user.userId))
      .limit(1);

    if (!user) {
      await logActivity({
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        action: "PROFILE_READ",
        entity: "USER",
        entityId: req.user.userId,
        status: "failed",
        message: "Profile read failed: user not found.",
      });
      res.status(404).json({ message: "User not found." });
      return;
    }

    res.status(200).json({
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
      auth_provider: user.authProvider,
      account_status: user.accountStatus,
      status_note: user.statusNote ?? null,
    });

    await logActivity({
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: "PROFILE_READ",
      entity: "USER",
      entityId: user.id,
      status: "success",
      message: "Profile retrieved.",
    });
  } catch (error) {
    console.error("profile error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "PROFILE_READ",
      entity: "USER",
      status: "failed",
      message: "Profile read failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};
