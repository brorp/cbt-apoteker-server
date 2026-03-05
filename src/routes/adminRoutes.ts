import { Router } from "express";

import {
  createQuestion,
  dashboardStats,
  deleteQuestion,
  importQuestions,
  listActivityLogs,
  listExamResults,
  listQuestions,
  listTransactions,
  listUsers,
  selectBatch,
  updateQuestion,
} from "../controllers/adminController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";

export const adminRoutes = Router();

adminRoutes.use(authMiddleware, requireRole(["admin"]));

adminRoutes.get("/dashboard-stats", dashboardStats);
adminRoutes.get("/users", listUsers);
adminRoutes.get("/transactions", listTransactions);
adminRoutes.get("/exam-results", listExamResults);
adminRoutes.get("/activity-logs", listActivityLogs);

adminRoutes.get("/questions", listQuestions);
adminRoutes.post("/questions", createQuestion);
adminRoutes.put("/questions/:id", updateQuestion);
adminRoutes.delete("/questions/:id", deleteQuestion);

adminRoutes.post("/questions/import", importQuestions);
adminRoutes.post("/questions/select-batch", selectBatch);
