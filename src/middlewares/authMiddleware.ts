import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

export type UserRole = "admin" | "user";

export interface AuthUser {
  userId: number;
  role: UserRole;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: UserRole;
  email?: string;
}

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid Authorization header." });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ message: "JWT_SECRET is not configured." });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as AccessTokenPayload;
    const userId = Number(decoded.sub);

    if (!Number.isInteger(userId) || (decoded.role !== "admin" && decoded.role !== "user")) {
      res.status(401).json({ message: "Token payload is invalid." });
      return;
    }

    req.user = {
      userId,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch {
    res.status(401).json({ message: "Token is invalid or expired." });
  }
};
