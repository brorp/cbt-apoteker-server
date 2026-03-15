import type { Response } from "express";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import { examPackages } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";

type PackagePayload = {
  name?: unknown;
  description?: unknown;
  features?: unknown;
  price?: unknown;
  question_count?: unknown;
  questionCount?: unknown;
  session_limit?: unknown;
  sessionLimit?: unknown;
  validity_days?: unknown;
  validityDays?: unknown;
  is_active?: unknown;
  isActive?: unknown;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeNullablePositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return normalizePositiveInteger(value);
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return null;
};

const toPackageResponse = (row: {
  id: number;
  name: string;
  description: string;
  features: string;
  price: number;
  questionCount: number;
  sessionLimit: number | null;
  validityDays: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  features: row.features,
  price: row.price,
  question_count: row.questionCount,
  session_limit: row.sessionLimit,
  validity_days: row.validityDays,
  is_active: row.isActive,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const listAdminPackages = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    const rows = await db
      .select({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        features: examPackages.features,
        price: examPackages.price,
        questionCount: examPackages.questionCount,
        sessionLimit: examPackages.sessionLimit,
        validityDays: examPackages.validityDays,
        isActive: examPackages.isActive,
        createdAt: examPackages.createdAt,
        updatedAt: examPackages.updatedAt,
      })
      .from(examPackages)
      .orderBy(desc(examPackages.createdAt), asc(examPackages.id));

    res.status(200).json(rows.map(toPackageResponse));
  } catch (error) {
    console.error("listAdminPackages error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createAdminPackage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as PackagePayload;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const features = typeof body.features === "string" ? body.features.trim() : "";
    const price = normalizeNonNegativeInteger(body.price);
    const questionCount = normalizePositiveInteger(
      body.question_count ?? body.questionCount,
    );
    const sessionLimit = normalizeNullablePositiveInteger(
      body.session_limit ?? body.sessionLimit,
    );
    const validityDays = normalizeNullablePositiveInteger(
      body.validity_days ?? body.validityDays,
    );
    const isActive = normalizeBoolean(body.is_active ?? body.isActive) ?? true;

    if (!name || !description || !features || price === null || !questionCount) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name, description, features, price, question_count.",
      });
      return;
    }

    const [created] = await db
      .insert(examPackages)
      .values({
        name,
        description,
        features,
        price,
        questionCount,
        sessionLimit,
        validityDays,
        isActive,
      })
      .returning({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        features: examPackages.features,
        price: examPackages.price,
        questionCount: examPackages.questionCount,
        sessionLimit: examPackages.sessionLimit,
        validityDays: examPackages.validityDays,
        isActive: examPackages.isActive,
        createdAt: examPackages.createdAt,
        updatedAt: examPackages.updatedAt,
      });

    res.status(201).json(toPackageResponse(created));
  } catch (error) {
    console.error("createAdminPackage error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const updateAdminPackage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "Invalid package id." });
      return;
    }

    const body = req.body as PackagePayload;
    const updates: Partial<{
      name: string;
      description: string;
      features: string;
      price: number;
      questionCount: number;
      sessionLimit: number | null;
      validityDays: number | null;
      isActive: boolean;
      updatedAt: Date;
    }> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.description === "string" && body.description.trim()) {
      updates.description = body.description.trim();
    }
    if (typeof body.features === "string" && body.features.trim()) {
      updates.features = body.features.trim();
    }
    if (body.price !== undefined) {
      const price = normalizeNonNegativeInteger(body.price);
      if (price === null) {
        res.status(400).json({ message: "Invalid price." });
        return;
      }
      updates.price = price;
    }
    if (body.question_count !== undefined || body.questionCount !== undefined) {
      const questionCount = normalizePositiveInteger(
        body.question_count ?? body.questionCount,
      );
      if (!questionCount) {
        res.status(400).json({ message: "Invalid question_count." });
        return;
      }
      updates.questionCount = questionCount;
    }
    const rawSessionLimit = body.session_limit ?? body.sessionLimit;
    if (body.session_limit !== undefined || body.sessionLimit !== undefined) {
      const sessionLimit = normalizeNullablePositiveInteger(rawSessionLimit);
      if (
        sessionLimit === null &&
        rawSessionLimit !== null &&
        rawSessionLimit !== undefined &&
        rawSessionLimit !== ""
      ) {
        res.status(400).json({ message: "Invalid session_limit." });
        return;
      }
      updates.sessionLimit = sessionLimit;
    }
    const rawValidityDays = body.validity_days ?? body.validityDays;
    if (body.validity_days !== undefined || body.validityDays !== undefined) {
      const validityDays = normalizeNullablePositiveInteger(rawValidityDays);
      if (
        validityDays === null &&
        rawValidityDays !== null &&
        rawValidityDays !== undefined &&
        rawValidityDays !== ""
      ) {
        res.status(400).json({ message: "Invalid validity_days." });
        return;
      }
      updates.validityDays = validityDays;
    }
    if (body.is_active !== undefined || body.isActive !== undefined) {
      const isActive = normalizeBoolean(body.is_active ?? body.isActive);
      if (isActive === null) {
        res.status(400).json({ message: "Invalid is_active." });
        return;
      }
      updates.isActive = isActive;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No valid fields to update." });
      return;
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(examPackages)
      .set(updates)
      .where(eq(examPackages.id, id))
      .returning({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        features: examPackages.features,
        price: examPackages.price,
        questionCount: examPackages.questionCount,
        sessionLimit: examPackages.sessionLimit,
        validityDays: examPackages.validityDays,
        isActive: examPackages.isActive,
        createdAt: examPackages.createdAt,
        updatedAt: examPackages.updatedAt,
      });

    if (!updated) {
      res.status(404).json({ message: "Package not found." });
      return;
    }

    res.status(200).json(toPackageResponse(updated));
  } catch (error) {
    console.error("updateAdminPackage error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const archiveAdminPackage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "Invalid package id." });
      return;
    }

    const [updated] = await db
      .update(examPackages)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(examPackages.id, id))
      .returning({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        features: examPackages.features,
        price: examPackages.price,
        questionCount: examPackages.questionCount,
        sessionLimit: examPackages.sessionLimit,
        validityDays: examPackages.validityDays,
        isActive: examPackages.isActive,
        createdAt: examPackages.createdAt,
        updatedAt: examPackages.updatedAt,
      });

    if (!updated) {
      res.status(404).json({ message: "Package not found." });
      return;
    }

    res.status(200).json({
      message: "Package archived.",
      package: toPackageResponse(updated),
    });
  } catch (error) {
    console.error("archiveAdminPackage error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
