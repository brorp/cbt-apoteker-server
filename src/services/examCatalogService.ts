import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examPackages,
  examSessions,
  packageExams,
  questionReports,
  questions,
} from "../db/schema.js";

type PackageRow = {
  id: number;
  name: string;
  description: string;
  questionCount: number;
  isActive: boolean;
};

type ExamRow = {
  id: number;
  packageId: number;
  name: string;
  description: string;
  questionCount: number;
  sessionLimit: number | null;
  sortOrder: number;
  isActive: boolean;
};

const getDefaultExamName = (pkg: PackageRow): string => pkg.name;

export const syncPackageExamCatalog = async (): Promise<void> => {
  const packages = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
      description: examPackages.description,
      questionCount: examPackages.questionCount,
      isActive: examPackages.isActive,
    })
    .from(examPackages)
    .orderBy(asc(examPackages.id));

  if (packages.length === 0) {
    return;
  }

  let exams = await db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
      description: packageExams.description,
      questionCount: packageExams.questionCount,
      sessionLimit: packageExams.sessionLimit,
      sortOrder: packageExams.sortOrder,
      isActive: packageExams.isActive,
    })
    .from(packageExams)
    .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id));

  const examIdsByPackage = new Map<number, ExamRow[]>();
  for (const exam of exams) {
    const current = examIdsByPackage.get(exam.packageId) ?? [];
    current.push(exam);
    examIdsByPackage.set(exam.packageId, current);
  }

  for (const pkg of packages) {
    if ((examIdsByPackage.get(pkg.id) ?? []).length > 0) {
      continue;
    }

    if (pkg.questionCount <= 0) {
      continue;
    }

    const [created] = await db
      .insert(packageExams)
      .values({
        packageId: pkg.id,
        name: getDefaultExamName(pkg),
        description: pkg.description,
        questionCount: pkg.questionCount > 0 ? pkg.questionCount : 50,
        sessionLimit: null,
        sortOrder: 1,
        isActive: pkg.isActive,
      })
      .returning({
        id: packageExams.id,
        packageId: packageExams.packageId,
        name: packageExams.name,
        description: packageExams.description,
        questionCount: packageExams.questionCount,
        sessionLimit: packageExams.sessionLimit,
        sortOrder: packageExams.sortOrder,
        isActive: packageExams.isActive,
      });

    examIdsByPackage.set(pkg.id, [created]);
  }

  exams = await db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
      description: packageExams.description,
      questionCount: packageExams.questionCount,
      sessionLimit: packageExams.sessionLimit,
      sortOrder: packageExams.sortOrder,
      isActive: packageExams.isActive,
    })
    .from(packageExams)
    .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id));

  const defaultExamByPackage = new Map<number, ExamRow>();
  for (const exam of exams) {
    if (!defaultExamByPackage.has(exam.packageId)) {
      defaultExamByPackage.set(exam.packageId, exam);
    }
  }

  for (const [packageId, exam] of defaultExamByPackage) {
    await Promise.all([
      db
        .update(questions)
        .set({
          examId: exam.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(questions.packageId, packageId),
            isNull(questions.examId),
          ),
        ),
      db
        .update(examSessions)
        .set({
          examId: exam.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(examSessions.packageId, packageId),
            isNull(examSessions.examId),
          ),
        ),
      db
        .update(questionReports)
        .set({
          examId: exam.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(questionReports.packageId, packageId),
            isNull(questionReports.examId),
          ),
        ),
    ]);
  }
};

export const listPackageExams = async (
  packageId?: number,
  onlyActive = false,
) => {
  return db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
      description: packageExams.description,
      questionCount: packageExams.questionCount,
      sessionLimit: packageExams.sessionLimit,
      sortOrder: packageExams.sortOrder,
      isActive: packageExams.isActive,
      createdAt: packageExams.createdAt,
      updatedAt: packageExams.updatedAt,
    })
    .from(packageExams)
    .where(
      packageId
        ? onlyActive
          ? and(eq(packageExams.packageId, packageId), eq(packageExams.isActive, true))
          : eq(packageExams.packageId, packageId)
        : onlyActive
          ? eq(packageExams.isActive, true)
          : undefined,
    )
    .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id));
};

export const getPackageExamById = async (examId: number) => {
  const [exam] = await db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
      description: packageExams.description,
      questionCount: packageExams.questionCount,
      sortOrder: packageExams.sortOrder,
      isActive: packageExams.isActive,
    })
    .from(packageExams)
    .where(eq(packageExams.id, examId))
    .limit(1);

  return exam ?? null;
};

export const getPackageExamOptions = async (packageId: number) => {
  const rows = await listPackageExams(packageId, false);
  return rows.map((row) => ({
    id: row.id,
    package_id: row.packageId,
    name: row.name,
    description: row.description,
    question_count: row.questionCount,
    session_limit: row.sessionLimit,
    sort_order: row.sortOrder,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
};
