import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examPackages,
  packageExamAssignments,
  packageExams,
  questions,
} from "../db/schema.js";

type PackageRow = {
  id: number;
  name: string;
  description: string;
  features: string;
  price: number;
  questionCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ExamRow = {
  id: number;
  name: string;
  description: string;
  questionCount: number;
  assignedQuestionCount: number;
  sessionLimit: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  id: number;
  packageId: number;
  packageName: string;
  packageIsActive: boolean;
  examId: number;
  examName: string;
  examDescription: string;
  examQuestionCount: number;
  examSessionLimit: number | null;
  examSortOrder: number;
  examIsActive: boolean;
  assignmentSortOrder: number;
};

const selectPackageRow = {
  id: examPackages.id,
  name: examPackages.name,
  description: examPackages.description,
  features: examPackages.features,
  price: examPackages.price,
  questionCount: examPackages.questionCount,
  isActive: examPackages.isActive,
  createdAt: examPackages.createdAt,
  updatedAt: examPackages.updatedAt,
};

const selectExamRow = {
  id: packageExams.id,
  name: packageExams.name,
  description: packageExams.description,
  questionCount: packageExams.questionCount,
  sessionLimit: packageExams.sessionLimit,
  sortOrder: packageExams.sortOrder,
  isActive: packageExams.isActive,
  createdAt: packageExams.createdAt,
  updatedAt: packageExams.updatedAt,
};

const getAssignedQuestionCountsByExamId = async (
  examIds: number[],
): Promise<Map<number, number>> => {
  const uniqueExamIds = [...new Set(examIds.filter((item) => item > 0))];
  if (uniqueExamIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      examId: questions.examId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(questions)
    .where(inArray(questions.examId, uniqueExamIds))
    .groupBy(questions.examId);

  const normalizeInteger = (value: unknown): number | null => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.trunc(value) : null;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    return null;
  };

  return new Map(
    rows
      .filter(
        (row): row is { examId: number; count: number } =>
          typeof row.examId === "number" &&
          normalizeInteger(row.count) !== null,
      )
      .map((row) => [row.examId, normalizeInteger(row.count) ?? 0]),
  );
};

export const syncPackageExamCatalog = async (): Promise<void> => {
  const legacyAssignments = await db
    .select({
      examId: packageExams.id,
      packageId: packageExams.packageId,
      sortOrder: packageExams.sortOrder,
    })
    .from(packageExams)
    .where(sql`${packageExams.packageId} is not null`);

  for (const item of legacyAssignments) {
    if (!item.packageId) {
      continue;
    }

    const [existing] = await db
      .select({ id: packageExamAssignments.id })
      .from(packageExamAssignments)
      .where(
        and(
          eq(packageExamAssignments.packageId, item.packageId),
          eq(packageExamAssignments.examId, item.examId),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(packageExamAssignments).values({
        packageId: item.packageId,
        examId: item.examId,
        sortOrder: item.sortOrder,
      });
    }
  }

  await syncAllPackageQuestionCounts();
};

export const syncPackageQuestionCount = async (packageId: number): Promise<void> => {
  const rows = await db
    .select({
      questionCount: packageExams.questionCount,
    })
    .from(packageExamAssignments)
    .innerJoin(packageExams, eq(packageExamAssignments.examId, packageExams.id))
    .where(
      and(
        eq(packageExamAssignments.packageId, packageId),
        eq(packageExams.isActive, true),
      ),
    );

  const totalQuestionCount = rows.reduce(
    (total, row) => total + row.questionCount,
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

export const syncAllPackageQuestionCounts = async (): Promise<void> => {
  const packages = await db
    .select({ id: examPackages.id })
    .from(examPackages);

  for (const item of packages) {
    await syncPackageQuestionCount(item.id);
  }
};

export const listPackageExamAssignments = async (input?: {
  packageIds?: number[];
  examIds?: number[];
  onlyActivePackages?: boolean;
  onlyActiveExams?: boolean;
}) => {
  const conditions = [];

  if (input?.packageIds && input.packageIds.length > 0) {
    conditions.push(inArray(packageExamAssignments.packageId, input.packageIds));
  }
  if (input?.examIds && input.examIds.length > 0) {
    conditions.push(inArray(packageExamAssignments.examId, input.examIds));
  }
  if (input?.onlyActivePackages) {
    conditions.push(eq(examPackages.isActive, true));
  }
  if (input?.onlyActiveExams) {
    conditions.push(eq(packageExams.isActive, true));
  }

  return db
    .select({
      id: packageExamAssignments.id,
      packageId: examPackages.id,
      packageName: examPackages.name,
      packageIsActive: examPackages.isActive,
      examId: packageExams.id,
      examName: packageExams.name,
      examDescription: packageExams.description,
      examQuestionCount: packageExams.questionCount,
      examSessionLimit: packageExams.sessionLimit,
      examSortOrder: packageExams.sortOrder,
      examIsActive: packageExams.isActive,
      assignmentSortOrder: packageExamAssignments.sortOrder,
    })
    .from(packageExamAssignments)
    .innerJoin(examPackages, eq(packageExamAssignments.packageId, examPackages.id))
    .innerJoin(packageExams, eq(packageExamAssignments.examId, packageExams.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      asc(packageExamAssignments.packageId),
      asc(packageExamAssignments.sortOrder),
      asc(packageExams.id),
    );
};

export const listPackagesWithExams = async (input?: {
  onlyActivePackages?: boolean;
  onlyActiveExams?: boolean;
}) => {
  const packageRows = await db
    .select(selectPackageRow)
    .from(examPackages)
    .where(input?.onlyActivePackages ? eq(examPackages.isActive, true) : undefined)
    .orderBy(asc(examPackages.price), asc(examPackages.id));

  const assignmentRows =
    packageRows.length > 0
      ? await listPackageExamAssignments({
          packageIds: packageRows.map((item) => item.id),
          onlyActiveExams: input?.onlyActiveExams,
          onlyActivePackages: false,
        })
      : [];
  const assignedQuestionCounts = await getAssignedQuestionCountsByExamId(
    assignmentRows.map((item) => item.examId),
  );

  const assignmentsByPackageId = new Map<number, AssignmentRow[]>();
  for (const row of assignmentRows) {
    const current = assignmentsByPackageId.get(row.packageId) ?? [];
    current.push(row);
    assignmentsByPackageId.set(row.packageId, current);
  }

  return packageRows.map((item) => {
    const exams = (assignmentsByPackageId.get(item.id) ?? []).map((row) => ({
      id: row.examId,
      packageId: row.packageId,
      name: row.examName,
      description: row.examDescription,
      questionCount: row.examQuestionCount,
      assignedQuestionCount: assignedQuestionCounts.get(row.examId) ?? 0,
      sessionLimit: row.examSessionLimit,
      sortOrder: row.assignmentSortOrder,
      isActive: row.examIsActive,
    }));

    return {
      ...item,
      exams,
      examCount: exams.length,
      questionCount:
        exams.reduce((total, exam) => total + exam.questionCount, 0) ||
        item.questionCount,
    };
  });
};

export const listExamsWithPackages = async (input?: {
  onlyActiveExams?: boolean;
  onlyActivePackages?: boolean;
}) => {
  const examRows = await db
    .select(selectExamRow)
    .from(packageExams)
    .where(input?.onlyActiveExams ? eq(packageExams.isActive, true) : undefined)
    .orderBy(asc(packageExams.sortOrder), asc(packageExams.id));

  const assignmentRows =
    examRows.length > 0
      ? await listPackageExamAssignments({
          examIds: examRows.map((item) => item.id),
          onlyActivePackages: input?.onlyActivePackages,
          onlyActiveExams: false,
        })
      : [];
  const assignedQuestionCounts = await getAssignedQuestionCountsByExamId(
    examRows.map((item) => item.id),
  );

  const assignmentsByExamId = new Map<number, AssignmentRow[]>();
  for (const row of assignmentRows) {
    const current = assignmentsByExamId.get(row.examId) ?? [];
    current.push(row);
    assignmentsByExamId.set(row.examId, current);
  }

  return examRows.map((item) => ({
    ...item,
    assignedQuestionCount: assignedQuestionCounts.get(item.id) ?? 0,
    packages: (assignmentsByExamId.get(item.id) ?? []).map((row) => ({
      id: row.packageId,
      name: row.packageName,
      isActive: row.packageIsActive,
      sortOrder: row.assignmentSortOrder,
    })),
  }));
};

export const getExamCatalogById = async (examId: number) => {
  const [exam] = await db
    .select(selectExamRow)
    .from(packageExams)
    .where(eq(packageExams.id, examId))
    .limit(1);

  if (!exam) {
    return null;
  }

  const assignments = await listPackageExamAssignments({ examIds: [examId] });
  const assignedQuestionCounts = await getAssignedQuestionCountsByExamId([examId]);

  return {
    ...exam,
    assignedQuestionCount: assignedQuestionCounts.get(examId) ?? 0,
    packages: assignments.map((item) => ({
      id: item.packageId,
      name: item.packageName,
      isActive: item.packageIsActive,
      sortOrder: item.assignmentSortOrder,
    })),
  };
};

export const getPackageCatalogById = async (packageId: number) => {
  const [pkg] = await db
    .select(selectPackageRow)
    .from(examPackages)
    .where(eq(examPackages.id, packageId))
    .limit(1);

  if (!pkg) {
    return null;
  }

  const result = (await listPackagesWithExams()).find(
    (item) => item.id === packageId,
  );
  if (result) {
    return result;
  }

  const assignments = await listPackageExamAssignments({ packageIds: [packageId] });

  const exams = assignments.map((row) => ({
    id: row.examId,
    packageId: row.packageId,
    name: row.examName,
    description: row.examDescription,
    questionCount: row.examQuestionCount,
    sessionLimit: row.examSessionLimit,
    sortOrder: row.assignmentSortOrder,
    isActive: row.examIsActive,
  }));

  return {
    ...pkg,
    exams,
    examCount: exams.length,
    questionCount:
      exams.reduce((total, exam) => total + exam.questionCount, 0) ||
      pkg.questionCount,
  };
};

export const replacePackageExamAssignments = async (
  packageId: number,
  examIds: number[],
): Promise<void> => {
  const uniqueExamIds = [...new Set(examIds)];
  const existingExams =
    uniqueExamIds.length > 0
      ? await db
          .select({ id: packageExams.id })
          .from(packageExams)
          .where(inArray(packageExams.id, uniqueExamIds))
      : [];

  if (existingExams.length !== uniqueExamIds.length) {
    throw new Error("One or more selected exams were not found.");
  }

  const existingAssignments = await db
    .select({
      id: packageExamAssignments.id,
      examId: packageExamAssignments.examId,
    })
    .from(packageExamAssignments)
    .where(eq(packageExamAssignments.packageId, packageId));

  const existingAssignmentByExamId = new Map(
    existingAssignments.map((item) => [item.examId, item.id]),
  );

  const retainedAssignmentIds = new Set<number>();

  for (const [index, examId] of uniqueExamIds.entries()) {
    const sortOrder = index + 1;
    const assignmentId = existingAssignmentByExamId.get(examId);
    if (assignmentId) {
      retainedAssignmentIds.add(assignmentId);
      await db
        .update(packageExamAssignments)
        .set({
          sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(packageExamAssignments.id, assignmentId));
      continue;
    }

    const [created] = await db
      .insert(packageExamAssignments)
      .values({
        packageId,
        examId,
        sortOrder,
      })
      .returning({ id: packageExamAssignments.id });

    retainedAssignmentIds.add(created.id);
  }

  const assignmentIdsToDelete = existingAssignments
    .filter((item) => !retainedAssignmentIds.has(item.id))
    .map((item) => item.id);

  if (assignmentIdsToDelete.length > 0) {
    await db
      .delete(packageExamAssignments)
      .where(inArray(packageExamAssignments.id, assignmentIdsToDelete));
  }

  await syncPackageQuestionCount(packageId);
};

export const isExamAssignedToPackage = async (
  packageId: number,
  examId: number,
): Promise<boolean> => {
  const [row] = await db
    .select({ id: packageExamAssignments.id })
    .from(packageExamAssignments)
    .where(
      and(
        eq(packageExamAssignments.packageId, packageId),
        eq(packageExamAssignments.examId, examId),
      ),
    )
    .limit(1);

  return Boolean(row);
};
