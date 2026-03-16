import { Router } from "express";

import { login, register } from "../controllers/authController.js";
import {
  sendRegistrationEmailOtp,
  verifyEmailOtp,
} from "../controllers/emailOtpController.js";
import { continueWithGoogle } from "../controllers/googleAuthController.js";

export const authRoutes = Router();

authRoutes.post("/email-otp/send", sendRegistrationEmailOtp);
authRoutes.post("/email-otp/verify", verifyEmailOtp);
authRoutes.post("/google/continue", continueWithGoogle);
authRoutes.post("/register", register);
authRoutes.post("/login", login);
