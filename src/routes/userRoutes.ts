import { Router } from "express";

import { profile, updateProfile } from "../controllers/userController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

export const userRoutes = Router();

userRoutes.get("/profile", authMiddleware, profile);
userRoutes.put("/profile", authMiddleware, updateProfile);
