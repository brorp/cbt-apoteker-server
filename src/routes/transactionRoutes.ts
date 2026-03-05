import { Router } from "express";

import {
  createTransaction,
  listPackages,
  webhookTransaction,
} from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const transactionRoutes = Router();

transactionRoutes.get("/packages", listPackages);
transactionRoutes.post("/transactions/create", authMiddleware, createTransaction);
transactionRoutes.post("/transactions/webhook", webhookTransaction);
