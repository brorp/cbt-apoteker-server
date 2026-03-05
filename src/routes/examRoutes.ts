import { Router } from "express";

import {
  getCurrentExam,
  getExamResult,
  saveExamAnswer,
  startExam,
  submitExam,
} from "../controllers/examController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const examRoutes = Router();

examRoutes.use(authMiddleware);

examRoutes.post("/start", startExam);
examRoutes.get("/current", getCurrentExam);
examRoutes.put("/answer", saveExamAnswer);
examRoutes.post("/submit", submitExam);
examRoutes.get("/result/:sessionId", getExamResult);
