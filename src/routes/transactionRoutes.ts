import { Router } from "express";

import {
  createTransaction,
  getMyTransactionByOrderCode,
  getMyTransactionDetail,
  getPaymentConfig,
  listMyTransactions,
  listPackages,
  midtransWebhook,
  syncMyTransactionStatus,
} from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const transactionRoutes = Router();

transactionRoutes.get("/packages", listPackages);
transactionRoutes.get("/payment-config", getPaymentConfig);
transactionRoutes.get("/transactions/mine", authMiddleware, listMyTransactions);
transactionRoutes.post("/transactions/create", authMiddleware, createTransaction);
transactionRoutes.get("/transactions/:id", authMiddleware, getMyTransactionDetail);
transactionRoutes.get(
  "/transactions/by-order/:orderCode",
  authMiddleware,
  getMyTransactionByOrderCode,
);
transactionRoutes.post(
  "/transactions/:id/sync",
  authMiddleware,
  syncMyTransactionStatus,
);
transactionRoutes.post("/transactions/midtrans/webhook", midtransWebhook);
