import type { Response } from "express";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import { examPackages, packageExams, questions } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import {
  getPackageCatalogById,
  listPackagesWithExams,
  replacePackageExamAssignments,
  syncPackageQuestionCount,
} from "../services/examCatalogService.js";

type PackagePayload = {
  name?: unknown;
  description?: unknown;
  features?: unknown;
  price?: unknown;
  is_active?: unknown;
  isActive?: unknown;
  exam_ids?: unknown;
  examIds?: unknown;
};

const normalizeNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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

const normalizePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeExamIds = (
  value: unknown,
): { examIds: number[]; error?: string } => {
  if (value === undefined) {
    return { examIds: [] };
  }

  if (!Array.isArray(value)) {
    return { examIds: [], error: "exam_ids must be an array." };
  }

  const examIds: number[] = [];
  const seen = new Set<number>();

  for (const item of value) {
    const examId = normalizePositiveInteger(item);
    if (!examId) {
      return { examIds: [], error: "Each exam_id must be a positive integer." };
    }
    if (seen.has(examId)) {
      continue;
    }
    seen.add(examId);
    examIds.push(examId);
  }

  return { examIds };
};

const toPackageResponse = (item: Awaited<ReturnType<typeof getPackageCatalogById>>) => {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    features: item.features,
    price: item.price,
    question_count: item.questionCount,
    is_active: item.isActive,
    exam_count: item.examCount,
    exams: item.exams.map((exam) => ({
      id: exam.id,
      package_id: item.id,
      name: exam.name,
      description: exam.description,
      question_count: exam.questionCount,
      session_limit: exam.sessionLimit,
      sort_order: exam.sortOrder,
      is_active: exam.isActive,
    })),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
};

export const listAdminPackages = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    const rows = await listPackagesWithExams();
    res.status(200).json(
      rows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        features: item.features,
        price: item.price,
        question_count: item.questionCount,
        is_active: item.isActive,
        exam_count: item.examCount,
        exams: item.exams.map((exam) => ({
          id: exam.id,
          package_id: item.id,
          name: exam.name,
          description: exam.description,
          question_count: exam.questionCount,
          session_limit: exam.sessionLimit,
          sort_order: exam.sortOrder,
          is_active: exam.isActive,
        })),
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
    );
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
    const features =
      typeof body.features === "string" ? body.features.trim() : "";
    const price = normalizeNonNegativeInteger(body.price);
    const isActive = normalizeBoolean(body.is_active ?? body.isActive) ?? true;
    const normalizedExamIds = normalizeExamIds(body.exam_ids ?? body.examIds);

    if (!name || !description || !features || price === null) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name, description, features, price.",
      });
      return;
    }

    if (normalizedExamIds.error) {
      res.status(400).json({ message: normalizedExamIds.error });
      return;
    }

    const [created] = await db
      .insert(examPackages)
      .values({
        name,
        description,
        features,
        price,
        questionCount: 0,
        isActive,
      })
      .returning({ id: examPackages.id });

    await replacePackageExamAssignments(created.id, normalizedExamIds.examIds);

    const pkg = await getPackageCatalogById(created.id);
    res.status(201).json(toPackageResponse(pkg));
  } catch (error) {
    console.error("createAdminPackage error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error.";
    res.status(message === "Internal server error." ? 500 : 400).json({
      message,
    });
  }
};

export const updateAdminPackage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const packageId = Number(req.params.id);
    if (!Number.isInteger(packageId) || packageId <= 0) {
      res.status(400).json({ message: "Invalid package id." });
      return;
    }

    const [existingPackage] = await db
      .select({ id: examPackages.id })
      .from(examPackages)
      .where(eq(examPackages.id, packageId))
      .limit(1);

    if (!existingPackage) {
      res.status(404).json({ message: "Package not found." });
      return;
    }

    const body = req.body as PackagePayload;
    const updates: Partial<{
      name: string;
      description: string;
      features: string;
      price: number;
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
    if (body.is_active !== undefined || body.isActive !== undefined) {
      const isActive = normalizeBoolean(body.is_active ?? body.isActive);
      if (isActive === null) {
        res.status(400).json({ message: "Invalid is_active value." });
        return;
      }
      updates.isActive = isActive;
    }

    const examIdsProvided = body.exam_ids !== undefined || body.examIds !== undefined;
    const normalizedExamIds = examIdsProvided
      ? normalizeExamIds(body.exam_ids ?? body.examIds)
      : null;

    if (normalizedExamIds?.error) {
      res.status(400).json({ message: normalizedExamIds.error });
      return;
    }

    if (Object.keys(updates).length === 0 && !examIdsProvided) {
      res.status(400).json({ message: "No valid fields to update." });
      return;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db
        .update(examPackages)
        .set(updates)
        .where(eq(examPackages.id, packageId));
    }

    if (normalizedExamIds) {
      await replacePackageExamAssignments(packageId, normalizedExamIds.examIds);
    } else {
      await syncPackageQuestionCount(packageId);
    }

    const pkg = await getPackageCatalogById(packageId);
    res.status(200).json(toPackageResponse(pkg));
  } catch (error) {
    console.error("updateAdminPackage error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error.";
    res.status(message === "Internal server error." ? 500 : 400).json({
      message,
    });
  }
};

export const deleteAdminPackage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const packageId = Number(req.params.id);
    if (!Number.isInteger(packageId) || packageId <= 0) {
      res.status(400).json({ message: "Invalid package id." });
      return;
    }

    const [deleted] = await db
      .delete(examPackages)
      .where(eq(examPackages.id, packageId))
      .returning({
        id: examPackages.id,
        name: examPackages.name,
      });

    if (!deleted) {
      res.status(404).json({ message: "Package not found." });
      return;
    }

    await Promise.all([
      db
        .update(packageExams)
        .set({
          packageId: null,
          updatedAt: new Date(),
        })
        .where(eq(packageExams.packageId, packageId)),
      db
        .update(questions)
        .set({
          packageId: null,
          updatedAt: new Date(),
        })
        .where(eq(questions.packageId, packageId)),
    ]);

    res.status(200).json({
      message: "Package deleted.",
      package: deleted,
    });
  } catch (error) {
    console.error("deleteAdminPackage error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
