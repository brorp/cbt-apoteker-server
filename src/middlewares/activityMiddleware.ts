import type { NextFunction, Response } from "express";

import type { AuthenticatedRequest } from "./authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";

const toActionName = (method: string, path: string): string => {
  const normalizedPath = path
    .replace(/\?.*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();

  return `HTTP_${method.toUpperCase()}_${normalizedPath || "ROOT"}`;
};

export const activityMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const startedAt = Date.now();

  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api")) {
      return;
    }

    void logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: toActionName(req.method, req.path),
      entity: "HTTP_REQUEST",
      status: res.statusCode >= 400 ? "failed" : "success",
      message: `${req.method} ${req.originalUrl} -> ${res.statusCode}`,
      metadata: {
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
    });
  });

  next();
};
