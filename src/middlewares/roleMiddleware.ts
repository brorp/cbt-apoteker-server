import type { NextFunction, Response } from "express";

import type { AuthenticatedRequest, UserRole } from "./authMiddleware.js";

export const requireRole =
  (allowedRoles: UserRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: "Forbidden." });
      return;
    }

    next();
  };
