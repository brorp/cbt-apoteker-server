import type { Request, Response } from "express";

import { issueRegistrationEmailOtp, EmailOtpServiceError } from "../services/emailOtpService.js";
import { logActivity } from "../utils/activityLog.js";

type SendRegistrationEmailOtpBody = {
  email?: unknown;
};

export const sendRegistrationEmailOtp = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.body as SendRegistrationEmailOtpBody;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email) {
    res.status(400).json({ message: "Email is required." });
    return;
  }

  try {
    const result = await issueRegistrationEmailOtp(email);

    await logActivity({
      action: "SEND_EMAIL_OTP",
      entity: "AUTH",
      status: "success",
      message: "Registration email OTP sent.",
      metadata: {
        email: result.email,
        requestId: result.requestId,
        provider: result.provider,
        delivered: result.delivered,
      },
    });

    res.status(200).json({
      message: "OTP email sent successfully.",
      request_id: result.requestId,
      expires_at: result.expiresAt.toISOString(),
      retry_after_seconds: result.retryAfterSeconds,
      provider: result.provider,
      delivered: result.delivered,
      warning: result.warning,
    });
  } catch (error) {
    console.error("sendRegistrationEmailOtp error:", error);

    await logActivity({
      action: "SEND_EMAIL_OTP",
      entity: "AUTH",
      status: "failed",
      message:
        error instanceof Error ? error.message : "Failed to send registration email OTP.",
      metadata: { email },
    });

    const status = error instanceof EmailOtpServiceError ? error.status : 500;
    res.status(status).json({
      message:
        error instanceof Error ? error.message : "Internal server error.",
      ...(error instanceof EmailOtpServiceError && error.metadata
        ? error.metadata
        : {}),
    });
  }
};
