import { and, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examPackages,
  examSessions,
  transactions,
  userPackageAccesses,
  users,
} from "../db/schema.js";
import {
  isPaidTransactionStatus,
  toClientTransactionStatus,
} from "../utils/transactionStatus.js";

const addDays = (baseDate: Date, days: number): Date =>
  new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

const expireAccessIfNeeded = async (input: {
  id: number;
  status: "active" | "inactive" | "expired";
  expiresAt: Date | null;
}) => {
  if (
    input.status === "active" &&
    input.expiresAt !== null &&
    input.expiresAt.getTime() <= Date.now()
  ) {
    await db
      .update(userPackageAccesses)
      .set({
        status: "expired",
        updatedAt: new Date(),
      })
      .where(eq(userPackageAccesses.id, input.id));

    return "expired" as const;
  }

  return input.status;
};

export const syncLegacyPremiumAccess = async (userId: number): Promise<void> => {
  const [user] = await db
    .select({
      id: users.id,
      isPremium: users.isPremium,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.isPremium) {
    return;
  }

  const [existingAccess] = await db
    .select({ id: userPackageAccesses.id })
    .from(userPackageAccesses)
    .where(eq(userPackageAccesses.userId, userId))
    .limit(1);

  if (existingAccess) {
    return;
  }

  const paidPackages = await db
    .select({ id: examPackages.id })
    .from(examPackages)
    .where(and(eq(examPackages.isActive, true), gt(examPackages.price, 0)));

  if (paidPackages.length === 0) {
    return;
  }

  await db.insert(userPackageAccesses).values(
    paidPackages.map((item) => ({
      userId,
      packageId: item.id,
      status: "active" as const,
      source: "legacy_premium_backfill",
      grantedAt: new Date(),
      activatedAt: new Date(),
    })),
  );
};

export const grantPackageAccessForTransaction = async (
  transactionId: number,
): Promise<void> => {
  const [transactionRow] = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      packageId: transactions.packageId,
      status: transactions.status,
      paidAt: transactions.paidAt,
      packagePrice: examPackages.price,
      validityDays: examPackages.validityDays,
    })
    .from(transactions)
    .innerJoin(examPackages, eq(transactions.packageId, examPackages.id))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!transactionRow || !isPaidTransactionStatus(transactionRow.status)) {
    return;
  }

  const now = new Date();
  const expiresAt =
    typeof transactionRow.validityDays === "number" && transactionRow.validityDays > 0
      ? addDays(now, transactionRow.validityDays)
      : null;

  await db
    .insert(userPackageAccesses)
    .values({
      userId: transactionRow.userId,
      packageId: transactionRow.packageId,
      transactionId: transactionRow.id,
      status: "active",
      source: transactionRow.packagePrice === 0 ? "free_package" : "transaction",
      grantedAt: now,
      activatedAt: transactionRow.paidAt ?? now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [userPackageAccesses.userId, userPackageAccesses.packageId],
      set: {
        transactionId: transactionRow.id,
        status: "active",
        source: transactionRow.packagePrice === 0 ? "free_package" : "transaction",
        grantedAt: now,
        activatedAt: transactionRow.paidAt ?? now,
        expiresAt,
        updatedAt: now,
      },
    });
};

export const deactivatePackageAccessForTransaction = async (
  transactionId: number,
): Promise<void> => {
  await db
    .update(userPackageAccesses)
    .set({
      status: "inactive",
      updatedAt: new Date(),
    })
    .where(eq(userPackageAccesses.transactionId, transactionId));
};

export const getPackageAccessState = async (input: {
  userId: number;
  packageId: number;
}) => {
  await syncLegacyPremiumAccess(input.userId);

  const [questionPackage] = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
      price: examPackages.price,
      isActive: examPackages.isActive,
      questionCount: examPackages.questionCount,
      sessionLimit: examPackages.sessionLimit,
      validityDays: examPackages.validityDays,
    })
    .from(examPackages)
    .where(eq(examPackages.id, input.packageId))
    .limit(1);

  if (!questionPackage || !questionPackage.isActive) {
    return {
      allowed: false,
      reason: "package_not_found" as const,
      package: questionPackage ?? null,
      access: null,
      sessionsUsed: 0,
    };
  }

  const [sessionAggregate] = await db
    .select({ total: count() })
    .from(examSessions)
    .where(
      and(
        eq(examSessions.userId, input.userId),
        eq(examSessions.packageId, questionPackage.id),
      ),
    );

  const sessionsUsed = Number(sessionAggregate?.total ?? 0);
  if (
    typeof questionPackage.sessionLimit === "number" &&
    questionPackage.sessionLimit > 0 &&
    sessionsUsed >= questionPackage.sessionLimit
  ) {
    return {
      allowed: false,
      reason: "session_limit_reached" as const,
      package: questionPackage,
      access: null,
      sessionsUsed,
    };
  }

  if (questionPackage.price === 0) {
    return {
      allowed: true,
      reason: "free_package" as const,
      package: questionPackage,
      access: null,
      sessionsUsed,
    };
  }

  const [accessRow] = await db
    .select({
      id: userPackageAccesses.id,
      transactionId: userPackageAccesses.transactionId,
      status: userPackageAccesses.status,
      source: userPackageAccesses.source,
      grantedAt: userPackageAccesses.grantedAt,
      activatedAt: userPackageAccesses.activatedAt,
      expiresAt: userPackageAccesses.expiresAt,
    })
    .from(userPackageAccesses)
    .where(
      and(
        eq(userPackageAccesses.userId, input.userId),
        eq(userPackageAccesses.packageId, questionPackage.id),
      ),
    )
    .limit(1);

  if (!accessRow) {
    return {
      allowed: false,
      reason: "not_purchased" as const,
      package: questionPackage,
      access: null,
      sessionsUsed,
    };
  }

  const normalizedStatus = await expireAccessIfNeeded({
    id: accessRow.id,
    status: accessRow.status,
    expiresAt: accessRow.expiresAt,
  });

  if (normalizedStatus !== "active") {
    return {
      allowed: false,
      reason: normalizedStatus === "expired" ? "expired" as const : "inactive" as const,
      package: questionPackage,
      access: { ...accessRow, status: normalizedStatus },
      sessionsUsed,
    };
  }

  return {
    allowed: true,
    reason: "purchased" as const,
    package: questionPackage,
    access: { ...accessRow, status: normalizedStatus },
    sessionsUsed,
  };
};

export const listUserPurchaseHistory = async (userId: number) => {
  await syncLegacyPremiumAccess(userId);

  const transactionRows = await db
    .select({
      id: transactions.id,
      packageId: transactions.packageId,
      packageName: examPackages.name,
      packageDescription: examPackages.description,
      packagePrice: examPackages.price,
      sessionLimit: examPackages.sessionLimit,
      validityDays: examPackages.validityDays,
      orderCode: transactions.orderCode,
      transactionStatus: transactions.status,
      paymentMethod: transactions.paymentMethod,
      paymentType: transactions.paymentType,
      midtransTransactionStatus: transactions.midtransTransactionStatus,
      grossAmount: transactions.grossAmount,
      snapRedirectUrl: transactions.snapRedirectUrl,
      paymentGatewayUrl: transactions.paymentGatewayUrl,
      createdAt: transactions.createdAt,
      paidAt: transactions.paidAt,
    })
    .from(transactions)
    .leftJoin(examPackages, eq(transactions.packageId, examPackages.id))
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt), desc(transactions.id));

  const accessRows = await db
    .select({
      id: userPackageAccesses.id,
      packageId: userPackageAccesses.packageId,
      status: userPackageAccesses.status,
      grantedAt: userPackageAccesses.grantedAt,
      activatedAt: userPackageAccesses.activatedAt,
      expiresAt: userPackageAccesses.expiresAt,
      packageName: examPackages.name,
      packageDescription: examPackages.description,
      packagePrice: examPackages.price,
      sessionLimit: examPackages.sessionLimit,
      validityDays: examPackages.validityDays,
    })
    .from(userPackageAccesses)
    .leftJoin(examPackages, eq(userPackageAccesses.packageId, examPackages.id))
    .where(eq(userPackageAccesses.userId, userId));

  const packageIds = [
    ...new Set([
      ...transactionRows.map((item) => item.packageId),
      ...accessRows.map((item) => item.packageId),
    ]),
  ];

  const sessionRows =
    packageIds.length > 0
      ? await db
          .select({
            packageId: examSessions.packageId,
          })
          .from(examSessions)
          .where(
            and(
              eq(examSessions.userId, userId),
              inArray(examSessions.packageId, packageIds),
            ),
          )
      : [];

  const accessByPackageId = new Map(accessRows.map((item) => [item.packageId, item]));
  const sessionsByPackageId = new Map<number, number>();
  for (const row of sessionRows) {
    if (!row.packageId) {
      continue;
    }
    sessionsByPackageId.set(
      row.packageId,
      (sessionsByPackageId.get(row.packageId) ?? 0) + 1,
    );
  }

  const transactionHistory = transactionRows.map((item) => {
    const access = accessByPackageId.get(item.packageId) ?? null;
    const accessStatus =
      access?.status === "active" && access.expiresAt && access.expiresAt.getTime() <= Date.now()
        ? "expired"
        : access?.status ?? (isPaidTransactionStatus(item.transactionStatus) ? "active" : "inactive");

    return {
      id: item.id,
      packageId: item.packageId,
      packageName: item.packageName ?? "-",
      packageDescription: item.packageDescription ?? "",
      packagePrice: item.packagePrice ?? 0,
      sessionLimit: item.sessionLimit,
      validityDays: item.validityDays,
      orderCode: item.orderCode,
      transactionStatus: toClientTransactionStatus(item.transactionStatus),
      paymentMethod: item.paymentMethod,
      paymentType: item.paymentType,
      midtransTransactionStatus: item.midtransTransactionStatus,
      grossAmount: item.grossAmount,
      snapRedirectUrl: item.snapRedirectUrl,
      accessStatus,
      paymentGatewayUrl: item.paymentGatewayUrl,
      createdAt: item.createdAt,
      paidAt: item.paidAt,
      grantedAt: access?.grantedAt ?? null,
      activatedAt: access?.activatedAt ?? null,
      expiresAt: access?.expiresAt ?? null,
      sessionsUsed: sessionsByPackageId.get(item.packageId) ?? 0,
    };
  });

  const accessOnlyHistory = accessRows
    .filter((item) => !transactionRows.some((transaction) => transaction.packageId === item.packageId))
    .map((item) => ({
      id: -item.id,
      packageId: item.packageId,
      packageName: item.packageName ?? "-",
      packageDescription: item.packageDescription ?? "",
      packagePrice: item.packagePrice ?? 0,
      sessionLimit: item.sessionLimit,
      validityDays: item.validityDays,
      orderCode: null,
      transactionStatus: "paid" as const,
      paymentMethod: null,
      paymentType: null,
      midtransTransactionStatus: null,
      grossAmount: item.packagePrice ?? 0,
      snapRedirectUrl: "",
      accessStatus:
        item.status === "active" && item.expiresAt && item.expiresAt.getTime() <= Date.now()
          ? "expired"
          : item.status,
      paymentGatewayUrl: "",
      createdAt: item.grantedAt,
      paidAt: item.activatedAt,
      grantedAt: item.grantedAt,
      activatedAt: item.activatedAt,
      expiresAt: item.expiresAt,
      sessionsUsed: sessionsByPackageId.get(item.packageId) ?? 0,
    }));

  return [...transactionHistory, ...accessOnlyHistory].sort(
    (left, right) =>
      new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime(),
  );
};
