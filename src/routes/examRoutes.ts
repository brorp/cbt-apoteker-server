import { Router } from "express";

import {
  getCurrentExam,
  getExamResult,
  listMyExamSessions,
  saveExamAnswer,
  startExam,
  submitExam,
} from "../controllers/examController.js";
import { createQuestionReport as createQuestionReportFromReportController } from "../controllers/reportController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const examRoutes = Router();

examRoutes.use(authMiddleware);

examRoutes.post("/start", startExam);
examRoutes.get("/current", getCurrentExam);
examRoutes.get("/sessions", listMyExamSessions);
examRoutes.put("/answer", saveExamAnswer);
examRoutes.post("/reports", createQuestionReportFromReportController);
examRoutes.post("/submit", submitExam);
examRoutes.get("/result/:sessionId", getExamResult);
