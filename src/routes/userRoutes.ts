import { Router } from "express";

import { profile } from "../controllers/userController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const userRoutes = Router();

userRoutes.get("/profile", authMiddleware, profile);
