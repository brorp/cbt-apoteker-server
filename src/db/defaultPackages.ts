import { asc } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncPackageExamCatalog } from "../services/examCatalogService.js";
import { examPackages } from "./schema.js";

export interface DefaultExamPackage {
  name: string;
  description: string;
  price: number;
  features: string;
  questionCount: number;
  sessionLimit?: number | null;
  validityDays?: number | null;
}

export const DEFAULT_EXAM_PACKAGES: DefaultExamPackage[] = [
  {
    name: "Try Out Gratis (50 Soal)",
    description: "50 soal untuk coba sistem dan media promosi.",
    price: 0,
    features: "50 soal, akses gratis, cocok untuk perkenalan platform",
    questionCount: 50,
    sessionLimit: null,
    validityDays: null,
  },
  {
    name: "Mini Try Out CBT Klinis (50 Soal)",
    description: "Paket ringkas CBT klinis dengan 50 soal latihan.",
    price: 49000,
    features: "50 soal klinis, pembahasan lengkap, simulasi cepat",
    questionCount: 50,
    sessionLimit: null,
    validityDays: null,
  },
  {
    name: "Mini Try Out CBT Industri (50 Soal)",
    description: "Paket ringkas CBT industri dengan 50 soal latihan.",
    price: 49000,
    features: "50 soal industri, pembahasan lengkap, simulasi cepat",
    questionCount: 50,
    sessionLimit: null,
    validityDays: null,
  },
  {
    name: "Try Out CBT Klinis (100 Soal)",
    description: "Simulasi lengkap CBT klinis dengan 100 soal.",
    price: 99000,
    features: "100 soal klinis, pembahasan lengkap, analisis hasil",
    questionCount: 100,
    sessionLimit: null,
    validityDays: null,
  },
  {
    name: "Try Out CBT Industri (100 Soal)",
    description: "Simulasi lengkap CBT industri dengan 100 soal.",
    price: 99000,
    features: "100 soal industri, pembahasan lengkap, analisis hasil",
    questionCount: 100,
    sessionLimit: null,
    validityDays: null,
  },
];

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
    if (existingNames.has(defaultPackage.name)) {
      continue;
    }

    await db.insert(examPackages).values({
      name: defaultPackage.name,
      description: defaultPackage.description,
      price: defaultPackage.price,
      features: defaultPackage.features,
      questionCount: defaultPackage.questionCount,
      sessionLimit: defaultPackage.sessionLimit ?? null,
      validityDays: defaultPackage.validityDays ?? null,
      isActive: true,
    });
  }

  await syncPackageExamCatalog();
};
