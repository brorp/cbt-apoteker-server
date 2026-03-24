import { asc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  replacePackageExamAssignments,
  syncAllPackageQuestionCounts,
  syncPackageExamCatalog,
} from "../services/examCatalogService.js";
import { examPackages, packageExams } from "./schema.js";

export interface DefaultExamDefinition {
  name: string;
  description: string;
  questionCount: number;
  sessionLimit?: number | null;
  sortOrder: number;
}

export interface DefaultExamPackage {
  name: string;
  description: string;
  price: number;
  features: string;
  examNames: string[];
}

export const DEFAULT_EXAMS: DefaultExamDefinition[] = [
  {
    name: "Soal Uji Klinis 2024",
    description: "Tipe ujian klinis tahun 2024.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 1,
  },
  {
    name: "Soal Uji Industri 2024",
    description: "Tipe ujian industri tahun 2024.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 2,
  },
  {
    name: "Soal Uji Klinis 2025",
    description: "Tipe ujian klinis tahun 2025.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 3,
  },
  {
    name: "Soal Uji Industri 2025",
    description: "Tipe ujian industri tahun 2025.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 4,
  },
  {
    name: "Simulasi UKKPT 2026 TERBARU",
    description: "Simulasi UKKPT terbaru tahun 2026.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 5,
  },
  {
    name: "Prediksi UKAI 2026 TERBARU",
    description: "Prediksi UKAI terbaru tahun 2026.",
    questionCount: 50,
    sessionLimit: null,
    sortOrder: 6,
  },
];

export const DEFAULT_EXAM_PACKAGES: DefaultExamPackage[] = [
  {
    name: "PAKET TRY OUT A",
    description: "mendapatkan 4x Tipe Ujian",
    price: 49000,
    features:
      "4 tipe ujian: Soal Uji Klinis 2024, Soal Uji Industri 2024, Soal Uji Klinis 2025, Soal Uji Industri 2025",
    examNames: [
      "Soal Uji Klinis 2024",
      "Soal Uji Industri 2024",
      "Soal Uji Klinis 2025",
      "Soal Uji Industri 2025",
    ],
  },
  {
    name: "PAKET TRY OUT B",
    description: "mendapatkan 6x Tipe Ujian",
    price: 99000,
    features:
      "6 tipe ujian: Soal Uji Klinis 2024, Soal Uji Industri 2024, Soal Uji Klinis 2025, Soal Uji Industri 2025, Simulasi UKKPT 2026 TERBARU, Prediksi UKAI 2026 TERBARU",
    examNames: [
      "Soal Uji Klinis 2024",
      "Soal Uji Industri 2024",
      "Soal Uji Klinis 2025",
      "Soal Uji Industri 2025",
      "Simulasi UKKPT 2026 TERBARU",
      "Prediksi UKAI 2026 TERBARU",
    ],
  },
];

export const syncDefaultExamPackages = async (): Promise<void> => {
  const existingExamRows = await db
    .select({
      id: packageExams.id,
      name: packageExams.name,
    })
    .from(packageExams)
    .orderBy(asc(packageExams.id));

  const examIdByName = new Map(existingExamRows.map((item) => [item.name, item.id]));

  for (const exam of DEFAULT_EXAMS) {
    if (examIdByName.has(exam.name)) {
      continue;
    }

    const [created] = await db
      .insert(packageExams)
      .values({
        packageId: null,
        name: exam.name,
        description: exam.description,
        questionCount: exam.questionCount,
        sessionLimit: exam.sessionLimit ?? null,
        sortOrder: exam.sortOrder,
        isActive: true,
      })
      .returning({
        id: packageExams.id,
        name: packageExams.name,
      });

    examIdByName.set(created.name, created.id);
  }

  const existingPackageRows = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
    })
    .from(examPackages)
    .orderBy(asc(examPackages.id));

  const packageIdByName = new Map(
    existingPackageRows.map((item) => [item.name, item.id]),
  );

  for (const pkg of DEFAULT_EXAM_PACKAGES) {
    if (packageIdByName.has(pkg.name)) {
      continue;
    }

    const [created] = await db
      .insert(examPackages)
      .values({
        name: pkg.name,
        description: pkg.description,
        price: pkg.price,
        features: pkg.features,
        questionCount: 0,
        isActive: true,
      })
      .returning({
        id: examPackages.id,
        name: examPackages.name,
      });

    packageIdByName.set(created.name, created.id);
  }

  for (const pkg of DEFAULT_EXAM_PACKAGES) {
    const packageId = packageIdByName.get(pkg.name);
    if (!packageId) {
      continue;
    }

    const examIds = pkg.examNames
      .map((examName) => examIdByName.get(examName) ?? null)
      .filter((value): value is number => value !== null);

    await replacePackageExamAssignments(packageId, examIds);

    await db
      .update(examPackages)
      .set({
        description: pkg.description,
        price: pkg.price,
        features: pkg.features,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(examPackages.id, packageId));
  }

  await syncPackageExamCatalog();
  await syncAllPackageQuestionCounts();
};
