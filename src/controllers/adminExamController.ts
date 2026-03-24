import type { Response } from "express";
import { eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import { packageExams, questions } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import {
  getExamCatalogById,
  listExamsWithPackages,
  listPackageExamAssignments,
  syncPackageQuestionCount,
} from "../services/examCatalogService.js";

type ExamPayload = {
  name?: unknown;
  description?: unknown;
  question_count?: unknown;
  questionCount?: unknown;
  session_limit?: unknown;
  sessionLimit?: unknown;
  sort_order?: unknown;
  sortOrder?: unknown;
  is_active?: unknown;
  isActive?: unknown;
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

const normalizeNullablePositiveInteger = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizePositiveInteger(value);
};

const toExamResponse = (
  item: Awaited<ReturnType<typeof getExamCatalogById>>,
) => {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    question_count: item.questionCount,
    session_limit: item.sessionLimit,
    sort_order: item.sortOrder,
    is_active: item.isActive,
    package_count: item.packages.length,
    packages: item.packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      is_active: pkg.isActive,
      sort_order: pkg.sortOrder,
    })),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
};

export const listAdminExams = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    const rows = await listExamsWithPackages();
    res.status(200).json(
      rows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        question_count: item.questionCount,
        session_limit: item.sessionLimit,
        sort_order: item.sortOrder,
        is_active: item.isActive,
        package_count: item.packages.length,
        packages: item.packages.map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          is_active: pkg.isActive,
          sort_order: pkg.sortOrder,
        })),
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
    );
  } catch (error) {
    console.error("listAdminExams error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createAdminExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as ExamPayload;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const questionCount = normalizePositiveInteger(
      body.question_count ?? body.questionCount,
    );
    const rawSessionLimit = body.session_limit ?? body.sessionLimit;
    const sessionLimit = normalizeNullablePositiveInteger(rawSessionLimit);
    const sortOrder =
      normalizePositiveInteger(body.sort_order ?? body.sortOrder) ?? 1;
    const isActive = normalizeBoolean(body.is_active ?? body.isActive) ?? true;

    if (!name || !questionCount) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name and question_count.",
      });
      return;
    }

    if (
      sessionLimit === null &&
      rawSessionLimit !== undefined &&
      rawSessionLimit !== null &&
      rawSessionLimit !== ""
    ) {
      res.status(400).json({ message: "Invalid session_limit." });
      return;
    }

    const [created] = await db
      .insert(packageExams)
      .values({
        packageId: null,
        name,
        description,
        questionCount,
        sessionLimit,
        sortOrder,
        isActive,
      })
      .returning({ id: packageExams.id });

    const exam = await getExamCatalogById(created.id);
    res.status(201).json(toExamResponse(exam));
  } catch (error) {
    console.error("createAdminExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const updateAdminExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      res.status(400).json({ message: "Invalid exam id." });
      return;
    }

    const [existingExam] = await db
      .select({ id: packageExams.id })
      .from(packageExams)
      .where(eq(packageExams.id, examId))
      .limit(1);

    if (!existingExam) {
      res.status(404).json({ message: "Exam not found." });
      return;
    }

    const body = req.body as ExamPayload;
    const updates: Partial<{
      name: string;
      description: string;
      questionCount: number;
      sessionLimit: number | null;
      sortOrder: number;
      isActive: boolean;
      updatedAt: Date;
    }> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.description === "string") {
      updates.description = body.description.trim();
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
    if (body.session_limit !== undefined || body.sessionLimit !== undefined) {
      const rawSessionLimit = body.session_limit ?? body.sessionLimit;
      const sessionLimit = normalizeNullablePositiveInteger(rawSessionLimit);
      if (
        sessionLimit === null &&
        rawSessionLimit !== undefined &&
        rawSessionLimit !== null &&
        rawSessionLimit !== ""
      ) {
        res.status(400).json({ message: "Invalid session_limit." });
        return;
      }
      updates.sessionLimit = sessionLimit;
    }
    if (body.sort_order !== undefined || body.sortOrder !== undefined) {
      const sortOrder = normalizePositiveInteger(
        body.sort_order ?? body.sortOrder,
      );
      if (!sortOrder) {
        res.status(400).json({ message: "Invalid sort_order." });
        return;
      }
      updates.sortOrder = sortOrder;
    }
    if (body.is_active !== undefined || body.isActive !== undefined) {
      const isActive = normalizeBoolean(body.is_active ?? body.isActive);
      if (isActive === null) {
        res.status(400).json({ message: "Invalid is_active value." });
        return;
      }
      updates.isActive = isActive;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No valid fields to update." });
      return;
    }

    updates.updatedAt = new Date();

    await db
      .update(packageExams)
      .set(updates)
      .where(eq(packageExams.id, examId));

    const assignments = await listPackageExamAssignments({ examIds: [examId] });
    for (const item of assignments) {
      await syncPackageQuestionCount(item.packageId);
    }

    const exam = await getExamCatalogById(examId);
    res.status(200).json(toExamResponse(exam));
  } catch (error) {
    console.error("updateAdminExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const deleteAdminExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      res.status(400).json({ message: "Invalid exam id." });
      return;
    }

    const [existingExam] = await db
      .select({
        id: packageExams.id,
        name: packageExams.name,
      })
      .from(packageExams)
      .where(eq(packageExams.id, examId))
      .limit(1);

    if (!existingExam) {
      res.status(404).json({ message: "Exam not found." });
      return;
    }

    const assignments = await listPackageExamAssignments({ examIds: [examId] });

    await db.transaction(async (tx) => {
      await tx
        .update(questions)
        .set({
          examId: null,
          packageId: null,
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(questions.examId, examId));

      await tx.delete(packageExams).where(eq(packageExams.id, examId));
    });

    for (const item of assignments) {
      await syncPackageQuestionCount(item.packageId);
    }

    res.status(200).json({
      message: "Exam deleted.",
      exam: existingExam,
    });
  } catch (error) {
    console.error("deleteAdminExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
