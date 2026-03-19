import { Router } from "express";

import {
  createQuestion,
  dashboardStats,
  deleteQuestion,
  importQuestions,
  listActivityLogs,
  listExamResults,
  listQuestions,
  listUsers,
  selectBatch,
  updateUserStatus,
  updateQuestion,
} from "../controllers/adminController.js";
import {
  getAdminTransactionDetail,
  listAdminTransactionsController,
  recheckAdminTransaction,
} from "../controllers/adminPaymentController.js";
import {
  archiveAdminPackage,
  archiveAdminPackageExam,
  createAdminPackage,
  createAdminPackageExam,
  listAdminPackages,
  updateAdminPackage,
  updateAdminPackageExam,
} from "../controllers/adminPackageController.js";
import {
  getQuestionReportDetail,
  listQuestionReports,
  replyQuestionReport,
} from "../controllers/reportController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { requireRole } from "../middlewares/roleMiddleware.js";

export const adminRoutes = Router();

adminRoutes.use(authMiddleware, requireRole(["admin"]));

adminRoutes.get("/dashboard-stats", dashboardStats);
adminRoutes.get("/users", listUsers);
adminRoutes.put("/users/:id/status", updateUserStatus);
adminRoutes.get("/transactions", listAdminTransactionsController);
adminRoutes.get("/transactions/:id", getAdminTransactionDetail);
adminRoutes.post("/transactions/:id/recheck", recheckAdminTransaction);
adminRoutes.get("/exam-results", listExamResults);
adminRoutes.get("/activity-logs", listActivityLogs);

adminRoutes.get("/packages", listAdminPackages);
adminRoutes.post("/packages", createAdminPackage);
adminRoutes.put("/packages/:id", updateAdminPackage);
adminRoutes.patch("/packages/:id/archive", archiveAdminPackage);
adminRoutes.post("/packages/:packageId/exams", createAdminPackageExam);
adminRoutes.put("/exams/:id", updateAdminPackageExam);
adminRoutes.patch("/exams/:id/archive", archiveAdminPackageExam);

adminRoutes.get("/questions", listQuestions);
adminRoutes.post("/questions", createQuestion);
adminRoutes.put("/questions/:id", updateQuestion);
adminRoutes.delete("/questions/:id", deleteQuestion);

adminRoutes.post("/questions/import", importQuestions);
adminRoutes.post("/questions/select-batch", selectBatch);

adminRoutes.get("/question-reports", listQuestionReports);
adminRoutes.get("/question-reports/:id", getQuestionReportDetail);
adminRoutes.post("/question-reports/:id/reply", replyQuestionReport);
