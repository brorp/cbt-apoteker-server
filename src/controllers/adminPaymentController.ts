import type { Response } from "express";

import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import {
  PaymentServiceError,
  getTransactionDetailById,
  listAdminTransactions,
  syncTransactionStatusFromMidtrans,
} from "../services/paymentService.js";
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

const handleError = async (
  req: AuthenticatedRequest,
  res: Response,
  action: string,
  error: unknown,
) => {
  const status = error instanceof PaymentServiceError ? error.status : 500;
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

export const listAdminTransactionsController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const status =
      typeof req.query.status === "string" ? req.query.status.trim() : undefined;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : undefined;

    const rows = await listAdminTransactions({ status, search });
    res.status(200).json(rows);

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_TRANSACTIONS_LIST",
      entity: "TRANSACTION",
      status: "success",
      message: "Admin fetched transactions list.",
      metadata: {
        count: rows.length,
        status: status ?? null,
        search: search ?? null,
      },
    });
  } catch (error) {
    await handleError(req, res, "ADMIN_TRANSACTIONS_LIST", error);
  }
};

export const getAdminTransactionDetail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = normalizePositiveInteger(req.params.id);
    if (!id) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const detail = await getTransactionDetailById(id, "admin", true);
    if (!detail) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    res.status(200).json(detail);
  } catch (error) {
    await handleError(req, res, "ADMIN_TRANSACTION_DETAIL", error);
  }
};

export const recheckAdminTransaction = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = normalizePositiveInteger(req.params.id);
    if (!id) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const detail = await syncTransactionStatusFromMidtrans({
      transactionId: id,
      viewer: "admin",
      source: "admin_manual_check",
    });

    res.status(200).json(detail);
  } catch (error) {
    await handleError(req, res, "ADMIN_TRANSACTION_RECHECK", error);
  }
};
