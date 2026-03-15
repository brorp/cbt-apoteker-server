import { Router } from "express";

import { login, register } from "../controllers/authController.js";
import { sendRegistrationEmailOtp } from "../controllers/emailOtpController.js";

export const authRoutes = Router();

authRoutes.post("/email-otp/send", sendRegistrationEmailOtp);
authRoutes.post("/register", register);
authRoutes.post("/login", login);
