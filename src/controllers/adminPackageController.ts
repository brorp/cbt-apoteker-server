import type { Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import { examPackages, packageExams } from "../db/schema.js";
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
  exams?: unknown;
};

type PackageExamPayload = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  question_count?: unknown;
  questionCount?: unknown;
  sort_order?: unknown;
  sortOrder?: unknown;
  is_active?: unknown;
  isActive?: unknown;
};

type NormalizedPackageExamInput = {
  id?: number;
  name: string;
  description: string;
  questionCount: number;
  sortOrder: number;
  isActive: boolean;
};

type PackageRow = {
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
};

type PackageExamRow = {
  id: number;
  packageId: number;
  name: string;
  description: string;
  questionCount: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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

const normalizeIdentifier = (value: unknown): number | null => {
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

const normalizeExamList = (
  value: unknown,
  requireAtLeastOne: boolean,
): {
  exams: NormalizedPackageExamInput[];
  error?: string;
} => {
  if (!Array.isArray(value)) {
    return {
      exams: [],
      error: "Invalid exams payload. Expected an array of exams.",
    };
  }

  if (requireAtLeastOne && value.length === 0) {
    return {
      exams: [],
      error: "A package must contain at least one exam.",
    };
  }

  const exams: NormalizedPackageExamInput[] = [];
  const seenIds = new Set<number>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      return {
        exams: [],
        error: `Invalid exam payload at position ${index + 1}.`,
      };
    }

    const payload = item as PackageExamPayload;
    const id = normalizeIdentifier(payload.id);
    if (id !== null) {
      if (seenIds.has(id)) {
        return {
          exams: [],
          error: `Duplicate exam id ${id} found in payload.`,
        };
      }
      seenIds.add(id);
    }

    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const description =
      typeof payload.description === "string" ? payload.description.trim() : "";
    const questionCount = normalizePositiveInteger(
      payload.question_count ?? payload.questionCount,
    );
    const sortOrder =
      normalizePositiveInteger(payload.sort_order ?? payload.sortOrder) ??
      index + 1;
    const isActive =
      normalizeBoolean(payload.is_active ?? payload.isActive) ?? true;

    if (!name) {
      return {
        exams: [],
        error: `Exam name is required at position ${index + 1}.`,
      };
    }

    if (!questionCount) {
      return {
        exams: [],
        error: `Invalid question_count for exam "${name}".`,
      };
    }

    exams.push({
      ...(id ? { id } : {}),
      name,
      description,
      questionCount,
      sortOrder,
      isActive,
    });
  }

  return { exams };
};

const toExamResponse = (row: PackageExamRow) => ({
  id: row.id,
  package_id: row.packageId,
  name: row.name,
  description: row.description,
  question_count: row.questionCount,
  sort_order: row.sortOrder,
  is_active: row.isActive,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const toPackageResponse = (row: PackageRow, exams: PackageExamRow[] = []) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  features: row.features,
  price: row.price,
  question_count:
    exams.reduce((total, exam) => total + exam.questionCount, 0) ||
    row.questionCount,
  session_limit: row.sessionLimit,
  validity_days: row.validityDays,
  is_active: row.isActive,
  exam_count: exams.length,
  exams: exams.map(toExamResponse),
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const getPackageRows = async (): Promise<PackageRow[]> =>
  db
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

const getExamRows = async (packageIds: number[]): Promise<PackageExamRow[]> => {
  if (packageIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
      description: packageExams.description,
      questionCount: packageExams.questionCount,
      sortOrder: packageExams.sortOrder,
      isActive: packageExams.isActive,
      createdAt: packageExams.createdAt,
      updatedAt: packageExams.updatedAt,
    })
    .from(packageExams)
    .where(inArray(packageExams.packageId, packageIds))
    .orderBy(
      asc(packageExams.packageId),
      asc(packageExams.sortOrder),
      asc(packageExams.id),
    );
};

const getPackageWithExamsById = async (packageId: number) => {
  const [pkg] = await db
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
    .where(eq(examPackages.id, packageId))
    .limit(1);

  if (!pkg) {
    return null;
  }

  const exams = await getExamRows([packageId]);
  return toPackageResponse(pkg, exams);
};

const syncPackageQuestionCount = async (packageId: number): Promise<void> => {
  const activeExams = await db
    .select({
      questionCount: packageExams.questionCount,
    })
    .from(packageExams)
    .where(
      and(eq(packageExams.packageId, packageId), eq(packageExams.isActive, true)),
    );

  const totalQuestionCount = activeExams.reduce(
    (total, exam) => total + exam.questionCount,
    0,
  );

  await db
    .update(examPackages)
    .set({
      questionCount: totalQuestionCount,
      updatedAt: new Date(),
    })
    .where(eq(examPackages.id, packageId));
};

const applyNestedPackageExams = async (
  packageId: number,
  exams: NormalizedPackageExamInput[],
): Promise<void> => {
  const existingExams = await db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
    })
    .from(packageExams)
    .where(eq(packageExams.packageId, packageId));

  const existingIds = new Set(existingExams.map((item) => item.id));
  const retainedIds = new Set<number>();

  for (const exam of exams) {
    if (exam.id) {
      if (!existingIds.has(exam.id)) {
        throw new Error(`Exam id ${exam.id} does not belong to package ${packageId}.`);
      }

      retainedIds.add(exam.id);
      await db
        .update(packageExams)
        .set({
          name: exam.name,
          description: exam.description,
          questionCount: exam.questionCount,
          sortOrder: exam.sortOrder,
          isActive: exam.isActive,
          updatedAt: new Date(),
        })
        .where(eq(packageExams.id, exam.id));
      continue;
    }

    const [created] = await db
      .insert(packageExams)
      .values({
        packageId,
        name: exam.name,
        description: exam.description,
        questionCount: exam.questionCount,
        sortOrder: exam.sortOrder,
        isActive: exam.isActive,
      })
      .returning({
        id: packageExams.id,
      });

    retainedIds.add(created.id);
  }

  const examIdsToArchive = existingExams
    .map((item) => item.id)
    .filter((examId) => !retainedIds.has(examId));

  if (examIdsToArchive.length > 0) {
    await db
      .update(packageExams)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(inArray(packageExams.id, examIdsToArchive));
  }

  await syncPackageQuestionCount(packageId);
};

export const listAdminPackages = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    const packages = await getPackageRows();
    const exams = await getExamRows(packages.map((item) => item.id));
    const examMap = new Map<number, PackageExamRow[]>();

    for (const exam of exams) {
      const rows = examMap.get(exam.packageId) ?? [];
      rows.push(exam);
      examMap.set(exam.packageId, rows);
    }

    res.status(200).json(
      packages.map((item) => toPackageResponse(item, examMap.get(item.id) ?? [])),
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
    const sessionLimit = normalizeNullablePositiveInteger(
      body.session_limit ?? body.sessionLimit,
    );
    const validityDays = normalizeNullablePositiveInteger(
      body.validity_days ?? body.validityDays,
    );
    const isActive = normalizeBoolean(body.is_active ?? body.isActive) ?? true;
    const normalizedExams = normalizeExamList(body.exams, true);

    if (!name || !description || !features || price === null) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name, description, features, price.",
      });
      return;
    }

    if (normalizedExams.error) {
      res.status(400).json({ message: normalizedExams.error });
      return;
    }

    const totalQuestionCount = normalizedExams.exams
      .filter((exam) => exam.isActive)
      .reduce((total, exam) => total + exam.questionCount, 0);

    const [created] = await db
      .insert(examPackages)
      .values({
        name,
        description,
        features,
        price,
        questionCount: totalQuestionCount,
        sessionLimit,
        validityDays,
        isActive,
      })
      .returning({
        id: examPackages.id,
      });

    await applyNestedPackageExams(created.id, normalizedExams.exams);

    const withExams = await getPackageWithExamsById(created.id);
    if (!withExams) {
      res.status(500).json({ message: "Failed to load created package." });
      return;
    }

    res.status(201).json(withExams);
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

    const [existingPackage] = await db
      .select({ id: examPackages.id })
      .from(examPackages)
      .where(eq(examPackages.id, id))
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

    const examsProvided = body.exams !== undefined;
    const normalizedExams = examsProvided
      ? normalizeExamList(body.exams, true)
      : null;

    if (normalizedExams?.error) {
      res.status(400).json({ message: normalizedExams.error });
      return;
    }

    if (Object.keys(updates).length === 0 && !examsProvided) {
      res.status(400).json({ message: "No valid fields to update." });
      return;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(examPackages).set(updates).where(eq(examPackages.id, id));
    }

    if (normalizedExams) {
      await applyNestedPackageExams(id, normalizedExams.exams);
    }

    const withExams = await getPackageWithExamsById(id);
    if (!withExams) {
      res.status(500).json({ message: "Failed to load updated package." });
      return;
    }

    res.status(200).json(withExams);
  } catch (error) {
    console.error("updateAdminPackage error:", error);
    const message =
      error instanceof Error &&
      error.message.startsWith("Exam id ")
        ? error.message
        : "Internal server error.";
    res.status(message === "Internal server error." ? 500 : 400).json({
      message,
    });
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
        questionCount: 0,
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

    await db
      .update(packageExams)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(packageExams.packageId, id));

    const withExams = await getPackageWithExamsById(updated.id);
    res.status(200).json({
      message: "Package archived.",
      package: withExams ?? toPackageResponse(updated, []),
    });
  } catch (error) {
    console.error("archiveAdminPackage error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createAdminPackageExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const packageId = Number(req.params.packageId);
    if (!Number.isInteger(packageId) || packageId <= 0) {
      res.status(400).json({ message: "Invalid package id." });
      return;
    }

    const [pkg] = await db
      .select({ id: examPackages.id })
      .from(examPackages)
      .where(eq(examPackages.id, packageId))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ message: "Package not found." });
      return;
    }

    const body = req.body as PackageExamPayload;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const questionCount = normalizePositiveInteger(
      body.question_count ?? body.questionCount,
    );
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

    const [created] = await db
      .insert(packageExams)
      .values({
        packageId,
        name,
        description,
        questionCount,
        sortOrder,
        isActive,
      })
      .returning({
        id: packageExams.id,
        packageId: packageExams.packageId,
        name: packageExams.name,
        description: packageExams.description,
        questionCount: packageExams.questionCount,
        sortOrder: packageExams.sortOrder,
        isActive: packageExams.isActive,
        createdAt: packageExams.createdAt,
        updatedAt: packageExams.updatedAt,
      });

    await syncPackageQuestionCount(packageId);

    res.status(201).json(toExamResponse(created));
  } catch (error) {
    console.error("createAdminPackageExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const updateAdminPackageExam = async (
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
        packageId: packageExams.packageId,
      })
      .from(packageExams)
      .where(eq(packageExams.id, examId))
      .limit(1);

    if (!existingExam) {
      res.status(404).json({ message: "Exam not found." });
      return;
    }

    const body = req.body as PackageExamPayload;
    const updates: Partial<{
      name: string;
      description: string;
      questionCount: number;
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
      .update(packageExams)
      .set(updates)
      .where(eq(packageExams.id, examId))
      .returning({
        id: packageExams.id,
        packageId: packageExams.packageId,
        name: packageExams.name,
        description: packageExams.description,
        questionCount: packageExams.questionCount,
        sortOrder: packageExams.sortOrder,
        isActive: packageExams.isActive,
        createdAt: packageExams.createdAt,
        updatedAt: packageExams.updatedAt,
      });

    await syncPackageQuestionCount(existingExam.packageId);

    res.status(200).json(toExamResponse(updated));
  } catch (error) {
    console.error("updateAdminPackageExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const archiveAdminPackageExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      res.status(400).json({ message: "Invalid exam id." });
      return;
    }

    const [updated] = await db
      .update(packageExams)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(packageExams.id, examId))
      .returning({
        id: packageExams.id,
        packageId: packageExams.packageId,
        name: packageExams.name,
        description: packageExams.description,
        questionCount: packageExams.questionCount,
        sortOrder: packageExams.sortOrder,
        isActive: packageExams.isActive,
        createdAt: packageExams.createdAt,
        updatedAt: packageExams.updatedAt,
      });

    if (!updated) {
      res.status(404).json({ message: "Exam not found." });
      return;
    }

    await syncPackageQuestionCount(updated.packageId);

    res.status(200).json({
      message: "Exam archived.",
      exam: toExamResponse(updated),
    });
  } catch (error) {
    console.error("archiveAdminPackageExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
