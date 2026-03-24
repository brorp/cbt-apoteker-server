import { sql } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "./defaultPackages.js";

async function resetPackageCatalog() {
  console.log("Resetting package, exam, question, and exam session catalog...");

  try {
    await db.execute(sql`
      TRUNCATE TABLE
        payment_event_logs,
        question_report_replies,
        question_reports,
        exam_answers,
        exam_sessions,
        questions,
        user_package_accesses,
        transactions,
        package_exam_assignments,
        package_exams,
        exam_packages
      RESTART IDENTITY CASCADE
    `);

    await syncDefaultExamPackages({ force: true });

    console.log("Package catalog reset completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Package catalog reset failed:", error);
    process.exit(1);
  }
}

resetPackageCatalog();
