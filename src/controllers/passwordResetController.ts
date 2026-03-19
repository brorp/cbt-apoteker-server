import type { Request, Response } from "express";

import {
  PasswordResetServiceError,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyPasswordResetToken,
} from "../services/passwordResetService.js";
import { logActivity } from "../utils/activityLog.js";

type ForgotPasswordBody = {
  email?: unknown;
};

type ResetPasswordBody = {
  token?: unknown;
  password?: unknown;
};

export const forgotPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as ForgotPasswordBody;
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!email) {
      res.status(400).json({ message: "Email is required." });
      return;
    }

    const result = await requestPasswordReset(email);

    res.status(200).json({
      message: "Password reset link sent successfully.",
      request_id: result.requestId,
      expires_at: result.expiresAt,
      retry_after_seconds: result.retryAfterSeconds,
      provider: result.provider,
      delivered: result.delivered,
      warning: result.warning,
    });

    await logActivity({
      action: "FORGOT_PASSWORD_REQUEST",
      entity: "AUTH",
      status: "success",
      message: "Password reset link sent.",
      metadata: { email: result.email },
    });
  } catch (error) {
    const status =
      error instanceof PasswordResetServiceError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal server error.";

    await logActivity({
      action: "FORGOT_PASSWORD_REQUEST",
      entity: "AUTH",
      status: "failed",
      message,
    });

    res.status(status).json({ message });
  }
};

export const verifyResetPasswordToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const token =
      typeof req.body?.token === "string"
        ? req.body.token.trim()
        : typeof req.query.token === "string"
          ? req.query.token.trim()
          : "";

    if (!token) {
      res.status(400).json({ message: "Reset token is required." });
      return;
    }

    const result = await verifyPasswordResetToken(token);
    res.status(200).json({
      message: "Reset token is valid.",
      email: result.email,
      expires_at: result.expiresAt,
    });
  } catch (error) {
    const status =
      error instanceof PasswordResetServiceError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal server error.";

    res.status(status).json({ message });
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as ResetPasswordBody;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password =
      typeof body.password === "string" ? body.password.trim() : "";

    if (!token || !password) {
      res.status(400).json({ message: "token and password are required." });
      return;
    }

    const result = await resetPasswordWithToken(token, password);
    res.status(200).json({
      message: "Password updated successfully.",
      email: result.email,
      updated_at: result.updatedAt,
    });

    await logActivity({
      action: "FORGOT_PASSWORD_RESET",
      entity: "AUTH",
      status: "success",
      message: "Password reset completed successfully.",
      metadata: { email: result.email },
    });
  } catch (error) {
    const status =
      error instanceof PasswordResetServiceError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Internal server error.";

    await logActivity({
      action: "FORGOT_PASSWORD_RESET",
      entity: "AUTH",
      status: "failed",
      message,
    });

    res.status(status).json({ message });
  }
};
