import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncPackageExamCatalog } from "../services/examCatalogService.js";
import { examPackages, packageExams } from "./schema.js";

export interface DefaultPackageExam {
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
  exams: DefaultPackageExam[];
}

export const DEFAULT_EXAM_PACKAGES: DefaultExamPackage[] = [
  {
    name: "PAKET TRY OUT A",
    description: "mendapatkan 4x Tipe Ujian",
    price: 49000,
    features:
      "4 tipe ujian: Soal Uji Klinis 2024, Soal Uji Industri 2024, Soal Uji Klinis 2025, Soal Uji Industri 2025",
    exams: [
      {
        name: "Soal Uji Klinis 2024",
        description: "Tipe ujian klinis 2024.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 1,
      },
      {
        name: "Soal Uji Industri 2024",
        description: "Tipe ujian industri 2024.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 2,
      },
      {
        name: "Soal Uji Klinis 2025",
        description: "Tipe ujian klinis 2025.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 3,
      },
      {
        name: "Soal Uji Industri 2025",
        description: "Tipe ujian industri 2025.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 4,
      },
    ],
  },
  {
    name: "PAKET TRY OUT B",
    description: "mendapatkan 6x Tipe Ujian",
    price: 99000,
    features:
      "6 tipe ujian: Soal Uji Klinis 2024, Soal Uji Industri 2024, Soal Uji Klinis 2025, Soal Uji Industri 2025, Simulasi UKKPT 2026 TERBARU, Prediksi UKAI 2026 TERBARU",
    exams: [
      {
        name: "Soal Uji Klinis 2024",
        description: "Tipe ujian klinis 2024.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 1,
      },
      {
        name: "Soal Uji Industri 2024",
        description: "Tipe ujian industri 2024.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 2,
      },
      {
        name: "Soal Uji Klinis 2025",
        description: "Tipe ujian klinis 2025.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 3,
      },
      {
        name: "Soal Uji Industri 2025",
        description: "Tipe ujian industri 2025.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 4,
      },
      {
        name: "Simulasi UKKPT 2026 TERBARU",
        description: "Tipe ujian simulasi UKKPT terbaru tahun 2026.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 5,
      },
      {
        name: "Prediksi UKAI 2026 TERBARU",
        description: "Tipe ujian prediksi UKAI terbaru tahun 2026.",
        questionCount: 50,
        sessionLimit: null,
        sortOrder: 6,
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
  const examRows = packageRows.length
    ? await db
        .select({
          id: packageExams.id,
          packageId: packageExams.packageId,
          name: packageExams.name,
        })
        .from(packageExams)
        .where(inArray(packageExams.packageId, packageRows.map((item) => item.id)))
        .orderBy(asc(packageExams.packageId), asc(packageExams.sortOrder), asc(packageExams.id))
    : [];

  const examNamesByPackage = new Map<number, Set<string>>();
  for (const exam of examRows) {
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
        sessionLimit: exam.sessionLimit ?? null,
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
