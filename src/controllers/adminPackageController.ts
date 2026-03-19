import type { Response } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";

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
};

type PackageExamPayload = {
  name?: unknown;
  description?: unknown;
  question_count?: unknown;
  questionCount?: unknown;
  sort_order?: unknown;
  sortOrder?: unknown;
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

const toPackageResponse = (
  row: PackageRow,
  exams: PackageExamRow[] = [],
) => ({
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
    .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id));
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
    const legacyQuestionCount =
      normalizePositiveInteger(body.question_count ?? body.questionCount) ?? 0;
    const sessionLimit = normalizeNullablePositiveInteger(
      body.session_limit ?? body.sessionLimit,
    );
    const validityDays = normalizeNullablePositiveInteger(
      body.validity_days ?? body.validityDays,
    );
    const isActive = normalizeBoolean(body.is_active ?? body.isActive) ?? true;

    if (!name || !description || !features || price === null) {
      res.status(400).json({
        message:
          "Invalid payload. Required fields: name, description, features, price.",
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
        questionCount: legacyQuestionCount,
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

    res.status(201).json(toPackageResponse(created, []));
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
      const questionCount = normalizeNonNegativeInteger(
        body.question_count ?? body.questionCount,
      );
      if (questionCount === null) {
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

    const withExams = await getPackageWithExamsById(updated.id);
    res.status(200).json(withExams ?? toPackageResponse(updated, []));
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

    if (!updated) {
      res.status(404).json({ message: "Exam not found." });
      return;
    }

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

    res.status(200).json({
      message: "Exam archived.",
      exam: toExamResponse(updated),
    });
  } catch (error) {
    console.error("archiveAdminPackageExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
