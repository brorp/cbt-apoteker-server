import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncPackageExamCatalog } from "../services/examCatalogService.js";
import { examPackages, packageExams } from "./schema.js";

export interface DefaultPackageExam {
  name: string;
  description: string;
  questionCount: number;
  sortOrder: number;
}

export interface DefaultExamPackage {
  name: string;
  description: string;
  price: number;
  features: string;
  sessionLimit?: number | null;
  validityDays?: number | null;
  exams: DefaultPackageExam[];
}

export const DEFAULT_EXAM_PACKAGES: DefaultExamPackage[] = [
  {
    name: "Try Out Gratis 2025-2026",
    description:
      "Paket gratis untuk mencoba alur platform dengan empat mini tryout pengenalan.",
    price: 0,
    features:
      "4 ujian demo, klinis dan industri, tahun 2025-2026, akses gratis",
    sessionLimit: null,
    validityDays: null,
    exams: [
      {
        name: "TRY OUT GRATIS KLINIS 2025 25 SOAL",
        description: "Sesi demo klinis 2025 dengan 25 soal.",
        questionCount: 25,
        sortOrder: 1,
      },
      {
        name: "TRY OUT GRATIS INDUSTRI 2025 25 SOAL",
        description: "Sesi demo industri 2025 dengan 25 soal.",
        questionCount: 25,
        sortOrder: 2,
      },
      {
        name: "TRY OUT GRATIS KLINIS 2026 25 SOAL",
        description: "Sesi demo klinis 2026 dengan 25 soal.",
        questionCount: 25,
        sortOrder: 3,
      },
      {
        name: "TRY OUT GRATIS INDUSTRI 2026 25 SOAL",
        description: "Sesi demo industri 2026 dengan 25 soal.",
        questionCount: 25,
        sortOrder: 4,
      },
    ],
  },
  {
    name: "Paket Mini Try Out 2025-2026",
    description:
      "Bundel mini tryout dengan fokus klinis dan industri untuk tahun 2025-2026.",
    price: 49000,
    features:
      "4 mini tryout, 50 soal per ujian, klinis dan industri, tahun 2025-2026",
    sessionLimit: null,
    validityDays: null,
    exams: [
      {
        name: "MINI TRYOUT KLINIS 2025 50 SOAL",
        description: "Mini tryout klinis tahun 2025 dengan 50 soal.",
        questionCount: 50,
        sortOrder: 1,
      },
      {
        name: "MINI TRYOUT INDUSTRI 2025 50 SOAL",
        description: "Mini tryout industri tahun 2025 dengan 50 soal.",
        questionCount: 50,
        sortOrder: 2,
      },
      {
        name: "MINI TRYOUT KLINIS 2026 50 SOAL",
        description: "Mini tryout klinis tahun 2026 dengan 50 soal.",
        questionCount: 50,
        sortOrder: 3,
      },
      {
        name: "MINI TRYOUT INDUSTRI 2026 50 SOAL",
        description: "Mini tryout industri tahun 2026 dengan 50 soal.",
        questionCount: 50,
        sortOrder: 4,
      },
    ],
  },
  {
    name: "Paket Try Out Reguler 2025-2026",
    description:
      "Bundel tryout reguler untuk simulasi klinis dan industri yang lebih lengkap.",
    price: 99000,
    features:
      "4 tryout reguler, 100 soal per ujian, klinis dan industri, tahun 2025-2026",
    sessionLimit: null,
    validityDays: null,
    exams: [
      {
        name: "TRYOUT KLINIS 2025 100 SOAL",
        description: "Tryout reguler klinis tahun 2025 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 1,
      },
      {
        name: "TRYOUT INDUSTRI 2025 100 SOAL",
        description: "Tryout reguler industri tahun 2025 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 2,
      },
      {
        name: "TRYOUT KLINIS 2026 100 SOAL",
        description: "Tryout reguler klinis tahun 2026 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 3,
      },
      {
        name: "TRYOUT INDUSTRI 2026 100 SOAL",
        description: "Tryout reguler industri tahun 2026 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 4,
      },
    ],
  },
  {
    name: "Paket Final Try Out 2025-2026",
    description:
      "Bundel final tryout untuk pemanasan akhir sebelum ujian utama klinis dan industri.",
    price: 129000,
    features:
      "4 final tryout, 100 soal per ujian, klinis dan industri, tahun 2025-2026",
    sessionLimit: null,
    validityDays: null,
    exams: [
      {
        name: "FINAL TRYOUT KLINIS 2025 100 SOAL",
        description: "Final tryout klinis tahun 2025 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 1,
      },
      {
        name: "FINAL TRYOUT INDUSTRI 2025 100 SOAL",
        description: "Final tryout industri tahun 2025 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 2,
      },
      {
        name: "FINAL TRYOUT KLINIS 2026 100 SOAL",
        description: "Final tryout klinis tahun 2026 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 3,
      },
      {
        name: "FINAL TRYOUT INDUSTRI 2026 100 SOAL",
        description: "Final tryout industri tahun 2026 dengan 100 soal.",
        questionCount: 100,
        sortOrder: 4,
      },
    ],
  },
];

const getPackageQuestionCount = (item: DefaultExamPackage): number =>
  item.exams.reduce((total, exam) => total + exam.questionCount, 0);

export const syncDefaultExamPackages = async (): Promise<void> => {
  const existingRows = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
    })
    .from(examPackages)
    .orderBy(asc(examPackages.id));

  const existingNames = new Set(existingRows.map((item) => item.name));

  for (const defaultPackage of DEFAULT_EXAM_PACKAGES) {
    if (!existingNames.has(defaultPackage.name)) {
      await db.insert(examPackages).values({
        name: defaultPackage.name,
        description: defaultPackage.description,
        price: defaultPackage.price,
        features: defaultPackage.features,
        questionCount: getPackageQuestionCount(defaultPackage),
        sessionLimit: defaultPackage.sessionLimit ?? null,
        validityDays: defaultPackage.validityDays ?? null,
        isActive: true,
      });
    }
  }

  const packageRows = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
    })
    .from(examPackages)
    .where(inArray(examPackages.name, DEFAULT_EXAM_PACKAGES.map((item) => item.name)));

  const packageIdByName = new Map(packageRows.map((item) => [item.name, item.id]));
  const exams = await db
    .select({
      id: packageExams.id,
      packageId: packageExams.packageId,
      name: packageExams.name,
    })
    .from(packageExams)
    .where(inArray(packageExams.packageId, packageRows.map((item) => item.id)))
    .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id));

  const examNamesByPackage = new Map<number, Set<string>>();
  for (const exam of exams) {
    const rows = examNamesByPackage.get(exam.packageId) ?? new Set<string>();
    rows.add(exam.name);
    examNamesByPackage.set(exam.packageId, rows);
  }

  for (const defaultPackage of DEFAULT_EXAM_PACKAGES) {
    const packageId = packageIdByName.get(defaultPackage.name);
    if (!packageId) {
      continue;
    }

    const existingExamNames = examNamesByPackage.get(packageId) ?? new Set<string>();
    for (const exam of defaultPackage.exams) {
      if (existingExamNames.has(exam.name)) {
        continue;
      }

      await db.insert(packageExams).values({
        packageId,
        name: exam.name,
        description: exam.description,
        questionCount: exam.questionCount,
        sortOrder: exam.sortOrder,
        isActive: true,
      });
    }

    await db
      .update(examPackages)
      .set({
        questionCount: getPackageQuestionCount(defaultPackage),
        updatedAt: new Date(),
      })
      .where(eq(examPackages.id, packageId));
  }

  await syncPackageExamCatalog();
};
