import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { examPackages, transactions, users } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";

const DEFAULT_PACKAGES: Array<{
  name: string;
  description: string;
  price: number;
  features: string;
}> = [
  {
    name: "Paket Premium Basic",
    description: "Akses 1x simulasi CBT + pembahasan hasil.",
    price: 149000,
    features: "1 simulasi, analisis skor, pembahasan lengkap",
  },
  {
    name: "Paket Premium Pro",
    description: "Akses 3x simulasi CBT + pembahasan hasil.",
    price: 249000,
    features: "3 simulasi, analisis skor detail, pembahasan lengkap",
  },
];

const ensurePackages = async (): Promise<void> => {
  const rows = await db
    .select({ id: examPackages.id })
    .from(examPackages)
    .limit(1);

  if (rows.length > 0) {
    return;
  }

  await db.insert(examPackages).values(DEFAULT_PACKAGES);
};

export const listPackages = async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensurePackages();

    const rows = await db
      .select({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        price: examPackages.price,
        features: examPackages.features,
      })
      .from(examPackages)
      .orderBy(asc(examPackages.price));

    res.status(200).json(
      rows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        features: item.features,
      })),
    );
  } catch (error) {
    console.error("listPackages error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createTransaction = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await ensurePackages();

    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const packageIdRaw = (req.body as { package_id?: number; packageId?: number })
      .package_id ?? (req.body as { packageId?: number }).packageId;
    const packageId = Number(packageIdRaw);

    if (!Number.isInteger(packageId) || packageId <= 0) {
      res.status(400).json({ message: "Invalid package_id." });
      return;
    }

    const [selectedPackage] = await db
      .select({ id: examPackages.id })
      .from(examPackages)
      .where(eq(examPackages.id, packageId))
      .limit(1);

    if (!selectedPackage) {
      res.status(404).json({ message: "Exam package not found." });
      return;
    }

    const paymentGatewayUrl = `https://dummy-payment.local/pay/${randomUUID()}`;

    const [created] = await db
      .insert(transactions)
      .values({
        userId: req.user.userId,
        packageId,
        status: "pending",
        paymentGatewayUrl,
      })
      .returning({
        id: transactions.id,
        userId: transactions.userId,
        packageId: transactions.packageId,
        status: transactions.status,
        paymentGatewayUrl: transactions.paymentGatewayUrl,
        createdAt: transactions.createdAt,
      });

    res.status(201).json({
      id: created.id,
      user_id: created.userId,
      package_id: created.packageId,
      status: created.status,
      payment_gateway_url: created.paymentGatewayUrl,
      created_at: created.createdAt,
    });

    await logActivity({
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: "TRANSACTION_CREATE",
      entity: "TRANSACTION",
      entityId: created.id,
      status: "success",
      message: "Transaction created.",
      metadata: { packageId },
    });
  } catch (error) {
    console.error("createTransaction error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "TRANSACTION_CREATE",
      entity: "TRANSACTION",
      status: "failed",
      message: "Create transaction failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

type TransactionWebhookStatus = "pending" | "success" | "failed";

const normalizeWebhookStatus = (
  value: unknown,
): TransactionWebhookStatus | null => {
  if (value === "pending" || value === "success" || value === "failed") {
    return value;
  }
  return null;
};

export const webhookTransaction = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as {
      transaction_id?: number;
      transactionId?: number;
      status?: TransactionWebhookStatus;
    };

    const transactionId = Number(body.transaction_id ?? body.transactionId);
    const status = normalizeWebhookStatus(body.status ?? "success");

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      res.status(400).json({ message: "Invalid transaction_id." });
      return;
    }

    if (!status) {
      res.status(400).json({ message: "Invalid status." });
      return;
    }

    const [targetTransaction] = await db
      .select({
        id: transactions.id,
        userId: transactions.userId,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!targetTransaction) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    await db
      .update(transactions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    if (status === "success") {
      await db
        .update(users)
        .set({
          isPremium: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetTransaction.userId));
    }

    res.status(200).json({
      message: "Webhook processed successfully.",
      transaction_id: transactionId,
      status,
    });

    await logActivity({
      actorUserId: targetTransaction.userId,
      actorRole: "user",
      action: "TRANSACTION_WEBHOOK",
      entity: "TRANSACTION",
      entityId: transactionId,
      status: "success",
      message: "Transaction webhook processed.",
      metadata: { status },
    });
  } catch (error) {
    console.error("webhookTransaction error:", error);
    await logActivity({
      action: "TRANSACTION_WEBHOOK",
      entity: "TRANSACTION",
      status: "failed",
      message: "Transaction webhook failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};
