import "dotenv/config";
import express from "express";

import cors from "cors";

import { adminRoutes } from "./routes/adminRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { databaseConnectionInfo, queryClient } from "./config/db.js";
import { getDatabaseConfigWarning } from "./config/databaseUrl.js";
import { examRoutes } from "./routes/examRoutes.js";
import { activityMiddleware } from "./middlewares/activityMiddleware.js";
import { transactionRoutes } from "./routes/transactionRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(activityMiddleware);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/exam", examRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", transactionRoutes);

const startServer = async () => {
  try {
    const configWarning = getDatabaseConfigWarning();
    if (configWarning) {
      console.warn(configWarning);
    }

    await queryClient`select 1`;
    console.log("Database connection established.", databaseConnectionInfo);

    app.listen(port, () => {
      console.log(`CBT API server listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to PostgreSQL.", {
      ...databaseConnectionInfo,
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
    process.exit(1);
  }
};

void startServer();
