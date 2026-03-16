import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { users } from "../db/schema.js";
import { issueRegistrationFlowToken } from "../services/authFlowTokenService.js";
import {
  createAccessToken,
  sanitizeAuthUser,
} from "../services/authSessionService.js";
import {
  GoogleIdentityServiceError,
  verifyGoogleIdToken,
} from "../services/googleIdentityService.js";
import { logActivity } from "../utils/activityLog.js";

type GoogleContinueBody = {
  id_token?: unknown;
};

export const continueWithGoogle = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.body as GoogleContinueBody;
  const idToken =
    typeof body.id_token === "string" ? body.id_token.trim() : "";

  if (!idToken) {
    res.status(400).json({ message: "Google ID token is required." });
    return;
  }

  try {
    const googleProfile = await verifyGoogleIdToken(idToken);
    const [existingUser] = await db
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
        accountStatus: users.accountStatus,
        statusNote: users.statusNote,
      })
      .from(users)
      .where(eq(users.email, googleProfile.email))
      .limit(1);

    if (existingUser) {
      if (existingUser.accountStatus !== "active") {
        await logActivity({
          actorUserId: existingUser.id,
          actorRole: existingUser.role,
          action: "GOOGLE_CONTINUE",
          entity: "AUTH",
          entityId: existingUser.id,
          status: "failed",
          message: "Google sign-in blocked: inactive account.",
          metadata: { email: existingUser.email },
        });
        res.status(403).json({
          message:
            existingUser.statusNote?.trim() ||
            "Akun Anda saat ini nonaktif. Silakan hubungi admin.",
        });
        return;
      }

      const token = createAccessToken({
        userId: existingUser.id,
        role: existingUser.role,
        email: existingUser.email,
      });

      await logActivity({
        actorUserId: existingUser.id,
        actorRole: existingUser.role,
        action: "GOOGLE_CONTINUE",
        entity: "AUTH",
        entityId: existingUser.id,
        status: "success",
        message: "Google sign-in succeeded and existing user logged in.",
        metadata: {
          email: existingUser.email,
          google_user_id: googleProfile.googleUserId,
        },
      });

      res.status(200).json({
        message: "Google sign-in successful.",
        next_step: "login",
        token,
        user: sanitizeAuthUser(existingUser),
      });
      return;
    }

    const registrationFlow = issueRegistrationFlowToken({
      method: "google",
      email: googleProfile.email,
      name: googleProfile.name,
    });

    await logActivity({
      action: "GOOGLE_CONTINUE",
      entity: "AUTH",
      status: "success",
      message: "Google sign-in verified for new registration.",
      metadata: {
        email: googleProfile.email,
        google_user_id: googleProfile.googleUserId,
      },
    });

    res.status(200).json({
      message: "Google account verified. Complete your profile to finish registration.",
      next_step: "complete_profile",
      registration_token: registrationFlow.token,
      registration_token_expires_at: registrationFlow.expiresAt.toISOString(),
      registration: {
        email: googleProfile.email,
        name: googleProfile.name,
        picture_url: googleProfile.pictureUrl,
        auth_source: "google",
      },
    });
  } catch (error) {
    console.error("continueWithGoogle error:", error);

    await logActivity({
      action: "GOOGLE_CONTINUE",
      entity: "AUTH",
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "Google sign-in failed due to internal server error.",
    });

    const status =
      error instanceof GoogleIdentityServiceError ? error.status : 500;
    res.status(status).json({
      message:
        error instanceof Error ? error.message : "Internal server error.",
    });
  }
};
