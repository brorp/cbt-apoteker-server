import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";

import { getMidtransConfig } from "../config/midtrans.js";
import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import { examPackages } from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import {
  PaymentServiceError,
  applyMidtransNotification,
  createTransactionOrder,
  getTransactionDetailById,
  getTransactionDetailByOrderCode,
  syncTransactionStatusFromMidtrans,
} from "../services/paymentService.js";
import { listUserPurchaseHistory } from "../services/packageAccess.js";
import {
  verifyMidtransNotificationSignature,
} from "../services/midtransService.js";
import { logActivity } from "../utils/activityLog.js";

const normalizePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toErrorResponse = async (
  req: AuthenticatedRequest,
  res: Response,
  action: string,
  error: unknown,
) => {
  const status =
    error instanceof PaymentServiceError
      ? error.status
      : 500;
  const message =
    error instanceof Error ? error.message : "Internal server error.";

  console.error(`${action} error:`, error);
  await logActivity({
    actorUserId: req.user?.userId ?? null,
    actorRole: req.user?.role ?? null,
    action,
    entity: "TRANSACTION",
    status: "failed",
    message,
  });
  res.status(status).json({ message });
};

export const listPackages = async (_req: Request, res: Response): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    const rows = await db
      .select({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        price: examPackages.price,
        features: examPackages.features,
        questionCount: examPackages.questionCount,
        sessionLimit: examPackages.sessionLimit,
        validityDays: examPackages.validityDays,
      })
      .from(examPackages)
      .where(eq(examPackages.isActive, true))
      .orderBy(asc(examPackages.price), asc(examPackages.questionCount), asc(examPackages.id));

    res.status(200).json(
      rows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        features: item.features,
        question_count: item.questionCount,
        session_limit: item.sessionLimit,
        validity_days: item.validityDays,
      })),
    );
  } catch (error) {
    console.error("listPackages error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const getPaymentConfig = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const config = getMidtransConfig();

    res.status(200).json({
      provider: "midtrans",
      client_key: config.clientKey,
      is_production: config.isProduction,
      snap_script_url: config.snapScriptUrl,
    });
  } catch (error) {
    console.error("getPaymentConfig error:", error);
    res.status(500).json({ message: "Payment provider is not configured." });
  }
};

export const createTransaction = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const body = req.body as {
      package_id?: unknown;
      packageId?: unknown;
      payment_method?: unknown;
      paymentMethod?: unknown;
    };
    const packageId = normalizePositiveInteger(body.package_id ?? body.packageId);

    if (!packageId) {
      res.status(400).json({ message: "Invalid package_id." });
      return;
    }

    const transaction = await createTransactionOrder({
      userId: req.user.userId,
      packageId,
      paymentMethod: body.payment_method ?? body.paymentMethod,
    });

    res.status(201).json(transaction);
    await logActivity({
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: "TRANSACTION_CREATE",
      entity: "TRANSACTION",
      entityId: transaction.id,
      status: "success",
      message: "Transaction created.",
      metadata: {
        packageId,
        orderCode: transaction.order_code,
        status: transaction.status,
      },
    });
  } catch (error) {
    await toErrorResponse(req, res, "TRANSACTION_CREATE", error);
  }
};

export const getMyTransactionDetail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const transactionId = normalizePositiveInteger(req.params.id);
    if (!transactionId) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const detail = await getTransactionDetailById(
      transactionId,
      "user",
      false,
      req.user.userId,
    );

    if (!detail) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    res.status(200).json(detail);
  } catch (error) {
    await toErrorResponse(req, res, "TRANSACTION_DETAIL", error);
  }
};

export const getMyTransactionByOrderCode = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const orderCode = req.params.orderCode?.trim();
    if (!orderCode) {
      res.status(400).json({ message: "Invalid order code." });
      return;
    }

    const detail = await getTransactionDetailByOrderCode(
      orderCode,
      "user",
      false,
      req.user.userId,
    );

    if (!detail) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    res.status(200).json(detail);
  } catch (error) {
    await toErrorResponse(req, res, "TRANSACTION_DETAIL", error);
  }
};

export const syncMyTransactionStatus = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const transactionId = normalizePositiveInteger(req.params.id);
    if (!transactionId) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const detail = await syncTransactionStatusFromMidtrans({
      transactionId,
      requesterUserId: req.user.userId,
      viewer: "user",
      source: "manual_check",
    });

    res.status(200).json(detail);
  } catch (error) {
    await toErrorResponse(req, res, "TRANSACTION_SYNC", error);
  }
};

export const midtransWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const payload =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : null;

    if (!payload) {
      res.status(400).json({ message: "Invalid Midtrans payload." });
      return;
    }

    if (!verifyMidtransNotificationSignature(payload)) {
      console.error("midtransWebhook invalid signature", payload);
      res.status(403).json({ message: "Invalid signature." });
      return;
    }

    const updated = await applyMidtransNotification(payload, "callback");
    if (!updated) {
      console.error("midtransWebhook order not found", payload);
      res.status(200).json({ message: "Notification ignored." });
      return;
    }

    res.status(200).json({
      message: "Notification processed.",
      transaction_id: updated.id,
      status: updated.status,
      order_code: updated.order_code,
    });
  } catch (error) {
    console.error("midtransWebhook error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listMyTransactions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const rows = await listUserPurchaseHistory(req.user.userId);

    res.status(200).json(
      rows.map((item) => ({
        id: item.id,
        package_id: item.packageId,
        package_name: item.packageName,
        package_description: item.packageDescription,
        package_price: item.packagePrice,
        session_limit: item.sessionLimit,
        validity_days: item.validityDays,
        order_code: item.orderCode,
        transaction_status: item.transactionStatus,
        payment_type: item.paymentType,
        payment_method: item.paymentMethod,
        payment_status_detail: item.midtransTransactionStatus,
        midtrans_transaction_status: item.midtransTransactionStatus,
        payment_page_url: item.paymentGatewayUrl,
        access_status: item.accessStatus,
        payment_gateway_url: item.paymentGatewayUrl,
        snap_redirect_url: item.snapRedirectUrl,
        gross_amount: item.grossAmount,
        sessions_used: item.sessionsUsed,
        created_at: item.createdAt,
        paid_at: item.paidAt,
        granted_at: item.grantedAt,
        activated_at: item.activatedAt,
        expires_at: item.expiresAt,
      })),
    );
  } catch (error) {
    console.error("listMyTransactions error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
