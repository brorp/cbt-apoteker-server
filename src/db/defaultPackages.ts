import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../config/db.js";
import { examPackages } from "./schema.js";

export interface DefaultExamPackage {
  name: string;
  description: string;
  price: number;
  features: string;
  questionCount: number;
}

export const DEFAULT_EXAM_PACKAGES: DefaultExamPackage[] = [
  {
    name: "Try Out Gratis (50 Soal)",
    description: "50 soal untuk coba sistem dan media promosi.",
    price: 0,
    features: "50 soal, akses gratis, cocok untuk perkenalan platform",
    questionCount: 50,
  },
  {
    name: "Mini Try Out CBT Klinis (50 Soal)",
    description: "Paket ringkas CBT klinis dengan 50 soal latihan.",
    price: 49000,
    features: "50 soal klinis, pembahasan lengkap, simulasi cepat",
    questionCount: 50,
  },
  {
    name: "Mini Try Out CBT Industri (50 Soal)",
    description: "Paket ringkas CBT industri dengan 50 soal latihan.",
    price: 49000,
    features: "50 soal industri, pembahasan lengkap, simulasi cepat",
    questionCount: 50,
  },
  {
    name: "Try Out CBT Klinis (100 Soal)",
    description: "Simulasi lengkap CBT klinis dengan 100 soal.",
    price: 99000,
    features: "100 soal klinis, pembahasan lengkap, analisis hasil",
    questionCount: 100,
  },
  {
    name: "Try Out CBT Industri (100 Soal)",
    description: "Simulasi lengkap CBT industri dengan 100 soal.",
    price: 99000,
    features: "100 soal industri, pembahasan lengkap, analisis hasil",
    questionCount: 100,
  },
];

export const syncDefaultExamPackages = async (): Promise<void> => {
  const now = new Date();
  const defaultNames = new Set(DEFAULT_EXAM_PACKAGES.map((item) => item.name));
  const existingRows = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
      description: examPackages.description,
      price: examPackages.price,
      features: examPackages.features,
      questionCount: examPackages.questionCount,
      isActive: examPackages.isActive,
    })
    .from(examPackages)
    .orderBy(asc(examPackages.id));

  const rowsByName = new Map<
    string,
    Array<{
      id: number;
      name: string;
      description: string;
      price: number;
      features: string;
      questionCount: number;
      isActive: boolean;
    }>
  >();
  for (const row of existingRows) {
    const matches = rowsByName.get(row.name) ?? [];
    matches.push(row);
    rowsByName.set(row.name, matches);
  }

  const rowsToDeactivate = existingRows
    .filter((row) => !defaultNames.has(row.name) && row.isActive)
    .map((row) => row.id);

  if (rowsToDeactivate.length > 0) {
    await db
      .update(examPackages)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(inArray(examPackages.id, rowsToDeactivate));
  }

  for (const defaultPackage of DEFAULT_EXAM_PACKAGES) {
    const matches = rowsByName.get(defaultPackage.name) ?? [];
    const [primary, ...duplicates] = matches;

    if (primary) {
      const hasChanged =
        primary.description !== defaultPackage.description ||
        primary.price !== defaultPackage.price ||
        primary.features !== defaultPackage.features ||
        primary.questionCount !== defaultPackage.questionCount ||
        primary.isActive !== true;

      if (hasChanged) {
        await db
          .update(examPackages)
          .set({
            description: defaultPackage.description,
            price: defaultPackage.price,
            features: defaultPackage.features,
            questionCount: defaultPackage.questionCount,
            isActive: true,
            updatedAt: now,
          })
          .where(eq(examPackages.id, primary.id));
      }

      const duplicateIdsToDeactivate = duplicates
        .filter((item) => item.isActive)
        .map((item) => item.id);
      if (duplicateIdsToDeactivate.length > 0) {
        await db
          .update(examPackages)
          .set({
            isActive: false,
            updatedAt: now,
          })
          .where(inArray(examPackages.id, duplicateIdsToDeactivate));
      }

      continue;
    }

    await db.insert(examPackages).values({
      name: defaultPackage.name,
      description: defaultPackage.description,
      price: defaultPackage.price,
      features: defaultPackage.features,
      questionCount: defaultPackage.questionCount,
      isActive: true,
    });
  }
};
