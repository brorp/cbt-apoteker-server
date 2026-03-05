import type { Request, Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  activityLogs,
  examPackages,
  examSessions,
  questions,
  transactions,
  users,
  type OptionKey,
} from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";

type QuestionPayload = {
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  option_e?: string;
  correct_answer?: OptionKey;
  explanation?: string;
  is_active?: boolean;
};

const isValidOptionKey = (value: unknown): value is OptionKey =>
  value === "a" || value === "b" || value === "c" || value === "d" || value === "e";

const toQuestionResponse = (question: {
  id: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: OptionKey;
  explanation: string;
  isActive: boolean;
}) => ({
  id: question.id,
  question_text: question.questionText,
  option_a: question.optionA,
  option_b: question.optionB,
  option_c: question.optionC,
  option_d: question.optionD,
  option_e: question.optionE,
  correct_answer: question.correctAnswer,
  explanation: question.explanation,
  is_active: question.isActive,
});

export const dashboardStats = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const [allUsers, allTransactions, completedSessions] = await Promise.all([
      db.select({ id: users.id }).from(users),
      db.select({ id: transactions.id }).from(transactions),
      db
        .select({ id: examSessions.id })
        .from(examSessions)
        .where(eq(examSessions.status, "completed")),
    ]);

    res.status(200).json({
      users: allUsers.length,
      transactions: allTransactions.length,
      examCompleted: completedSessions.length,
    });

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_DASHBOARD_STATS",
      entity: "ADMIN",
      status: "success",
      message: "Admin dashboard stats viewed.",
    });
  } catch (error) {
    console.error("dashboardStats error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_DASHBOARD_STATS",
      entity: "ADMIN",
      status: "failed",
      message: "Failed to load admin dashboard stats.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listUsers = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: users.id,
        role: users.role,
        name: users.name,
        email: users.email,
        education: users.education,
        schoolOrigin: users.schoolOrigin,
        examPurpose: users.examPurpose,
        address: users.address,
        phone: users.phone,
        targetScore: users.targetScore,
        isPremium: users.isPremium,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    res.status(200).json(
      rows.map((row) => ({
        id: row.id,
        role: row.role,
        name: row.name,
        email: row.email,
        education: row.education,
        school_origin: row.schoolOrigin,
        exam_purpose: row.examPurpose,
        address: row.address,
        phone: row.phone,
        target_score: row.targetScore ?? 0,
        is_premium: row.isPremium,
        created_at: row.createdAt,
      })),
    );

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_USERS_LIST",
      entity: "USER",
      status: "success",
      message: "Admin fetched users list.",
      metadata: { count: rows.length },
    });
  } catch (error) {
    console.error("listUsers error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_USERS_LIST",
      entity: "USER",
      status: "failed",
      message: "Failed to fetch users list.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listTransactions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: transactions.id,
        userId: transactions.userId,
        packageId: transactions.packageId,
        packageName: examPackages.name,
        status: transactions.status,
        paymentGatewayUrl: transactions.paymentGatewayUrl,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(examPackages, eq(transactions.packageId, examPackages.id))
      .orderBy(desc(transactions.createdAt));

    res.status(200).json(
      rows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        package_id: row.packageId,
        package_name: row.packageName ?? "-",
        status: row.status,
        payment_gateway_url: row.paymentGatewayUrl,
        created_at: row.createdAt,
      })),
    );
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_TRANSACTIONS_LIST",
      entity: "TRANSACTION",
      status: "success",
      message: "Admin fetched transactions list.",
      metadata: { count: rows.length },
    });
  } catch (error) {
    console.error("listTransactions error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_TRANSACTIONS_LIST",
      entity: "TRANSACTION",
      status: "failed",
      message: "Failed to fetch transactions list.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listExamResults = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const rows = await db
      .select({
        sessionId: examSessions.id,
        userId: examSessions.userId,
        userName: users.name,
        status: examSessions.status,
        score: examSessions.score,
        startTime: examSessions.startTime,
        endTime: examSessions.endTime,
      })
      .from(examSessions)
      .leftJoin(users, eq(examSessions.userId, users.id))
      .orderBy(desc(examSessions.startTime));

    res.status(200).json(
      rows.map((row) => ({
        session_id: row.sessionId,
        user_id: row.userId,
        user_name: row.userName ?? "Unknown",
        status: row.status,
        score: row.score ?? 0,
        start_time: row.startTime,
        end_time: row.endTime,
      })),
    );
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_RESULTS_LIST",
      entity: "EXAM_SESSION",
      status: "success",
      message: "Admin fetched exam results.",
      metadata: { count: rows.length },
    });
  } catch (error) {
    console.error("listExamResults error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_RESULTS_LIST",
      entity: "EXAM_SESSION",
      status: "failed",
      message: "Failed to fetch exam results.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listQuestions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        isActive: questions.isActive,
      })
      .from(questions)
      .orderBy(desc(questions.id));

    res.status(200).json(rows.map(toQuestionResponse));
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTIONS_LIST",
      entity: "QUESTION",
      status: "success",
      message: "Admin fetched question bank.",
      metadata: { count: rows.length },
    });
  } catch (error) {
    console.error("listQuestions error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTIONS_LIST",
      entity: "QUESTION",
      status: "failed",
      message: "Failed to fetch question bank.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createQuestion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as QuestionPayload;

    if (
      !body.question_text ||
      !body.option_a ||
      !body.option_b ||
      !body.option_c ||
      !body.option_d ||
      !body.option_e ||
      !isValidOptionKey(body.correct_answer) ||
      !body.explanation
    ) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_CREATE",
        entity: "QUESTION",
        status: "failed",
        message: "Create question failed: invalid payload.",
      });
      res.status(400).json({
        message:
          "Invalid payload. Required fields: question_text, option_a-e, correct_answer, explanation.",
      });
      return;
    }

    const [created] = await db
      .insert(questions)
      .values({
        questionText: body.question_text.trim(),
        optionA: body.option_a.trim(),
        optionB: body.option_b.trim(),
        optionC: body.option_c.trim(),
        optionD: body.option_d.trim(),
        optionE: body.option_e.trim(),
        correctAnswer: body.correct_answer,
        explanation: body.explanation.trim(),
        isActive: Boolean(body.is_active),
      })
      .returning({
        id: questions.id,
        questionText: questions.questionText,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        isActive: questions.isActive,
      });

    res.status(201).json(toQuestionResponse(created));
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_CREATE",
      entity: "QUESTION",
      entityId: created.id,
      status: "success",
      message: "Question created.",
    });
  } catch (error) {
    console.error("createQuestion error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_CREATE",
      entity: "QUESTION",
      status: "failed",
      message: "Create question failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const updateQuestion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_UPDATE",
        entity: "QUESTION",
        status: "failed",
        message: "Update question failed: invalid question id.",
        metadata: { id },
      });
      res.status(400).json({ message: "Invalid question id." });
      return;
    }

    const body = req.body as QuestionPayload;
    const updates: Partial<{
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      optionE: string;
      correctAnswer: OptionKey;
      explanation: string;
      isActive: boolean;
      updatedAt: Date;
    }> = {};

    if (typeof body.question_text === "string") updates.questionText = body.question_text;
    if (typeof body.option_a === "string") updates.optionA = body.option_a;
    if (typeof body.option_b === "string") updates.optionB = body.option_b;
    if (typeof body.option_c === "string") updates.optionC = body.option_c;
    if (typeof body.option_d === "string") updates.optionD = body.option_d;
    if (typeof body.option_e === "string") updates.optionE = body.option_e;
    if (isValidOptionKey(body.correct_answer)) updates.correctAnswer = body.correct_answer;
    if (typeof body.explanation === "string") updates.explanation = body.explanation;
    if (typeof body.is_active === "boolean") updates.isActive = body.is_active;
    updates.updatedAt = new Date();

    const isOnlyUpdatedAt = Object.keys(updates).length === 1;
    if (isOnlyUpdatedAt) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_UPDATE",
        entity: "QUESTION",
        entityId: id,
        status: "failed",
        message: "Update question failed: no valid fields.",
      });
      res.status(400).json({ message: "No valid fields to update." });
      return;
    }

    const [updated] = await db
      .update(questions)
      .set(updates)
      .where(eq(questions.id, id))
      .returning({
        id: questions.id,
        questionText: questions.questionText,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        isActive: questions.isActive,
      });

    if (!updated) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_UPDATE",
        entity: "QUESTION",
        entityId: id,
        status: "failed",
        message: "Update question failed: not found.",
      });
      res.status(404).json({ message: "Question not found." });
      return;
    }

    res.status(200).json(toQuestionResponse(updated));
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_UPDATE",
      entity: "QUESTION",
      entityId: updated.id,
      status: "success",
      message: "Question updated.",
    });
  } catch (error) {
    console.error("updateQuestion error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_UPDATE",
      entity: "QUESTION",
      status: "failed",
      message: "Update question failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const deleteQuestion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_DELETE",
        entity: "QUESTION",
        status: "failed",
        message: "Delete question failed: invalid question id.",
        metadata: { id },
      });
      res.status(400).json({ message: "Invalid question id." });
      return;
    }

    const [deleted] = await db
      .delete(questions)
      .where(eq(questions.id, id))
      .returning({ id: questions.id });

    if (!deleted) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_DELETE",
        entity: "QUESTION",
        entityId: id,
        status: "failed",
        message: "Delete question failed: not found.",
      });
      res.status(404).json({ message: "Question not found." });
      return;
    }

    res.status(200).json({ message: "Question deleted.", id: deleted.id });
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_DELETE",
      entity: "QUESTION",
      entityId: deleted.id,
      status: "success",
      message: "Question deleted.",
    });
  } catch (error) {
    console.error("deleteQuestion error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_DELETE",
      entity: "QUESTION",
      status: "failed",
      message: "Delete question failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const importQuestions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  // Multipart XLSX parser is not configured in this build yet.
  // Endpoint is kept to avoid 404 on frontend integration.
  res.status(501).json({
    message:
      "XLSX import is not configured on this server yet. Install file parser middleware to enable this endpoint.",
  });
  await logActivity({
    actorUserId: req.user?.userId ?? null,
    actorRole: req.user?.role ?? null,
    action: "ADMIN_QUESTION_IMPORT",
    entity: "QUESTION",
    status: "failed",
    message: "Question import requested but not configured.",
  });
};

export const selectBatch = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as { question_ids?: number[]; questionIds?: number[] };
    const idsRaw = body.question_ids ?? body.questionIds ?? [];
    const ids = idsRaw
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (ids.length === 0) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_SELECT_BATCH",
        entity: "QUESTION",
        status: "failed",
        message: "Select batch failed: empty question ids.",
      });
      res.status(400).json({ message: "question_ids cannot be empty." });
      return;
    }

    await db.update(questions).set({ isActive: false, updatedAt: new Date() });
    await db
      .update(questions)
      .set({ isActive: true, updatedAt: new Date() })
      .where(inArray(questions.id, ids));

    res.status(200).json({
      message: "Question batch selection updated.",
      selectedCount: ids.length,
    });
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_SELECT_BATCH",
      entity: "QUESTION",
      status: "success",
      message: "Question batch selection updated.",
      metadata: { selectedCount: ids.length },
    });
  } catch (error) {
    console.error("selectBatch error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_SELECT_BATCH",
      entity: "QUESTION",
      status: "failed",
      message: "Select batch failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listActivityLogs = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const limitQuery = Number(req.query.limit ?? 100);
    const limit = Number.isInteger(limitQuery)
      ? Math.min(Math.max(limitQuery, 1), 500)
      : 100;

    const rows = await db
      .select({
        id: activityLogs.id,
        actorUserId: activityLogs.actorUserId,
        actorRole: activityLogs.actorRole,
        action: activityLogs.action,
        entity: activityLogs.entity,
        entityId: activityLogs.entityId,
        status: activityLogs.status,
        message: activityLogs.message,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);

    res.status(200).json(
      rows.map((row) => ({
        id: row.id,
        actor_user_id: row.actorUserId,
        actor_role: row.actorRole,
        action: row.action,
        entity: row.entity,
        entity_id: row.entityId,
        status: row.status,
        message: row.message,
        metadata: row.metadata,
        created_at: row.createdAt,
      })),
    );

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_ACTIVITY_LOGS_LIST",
      entity: "ACTIVITY_LOG",
      status: "success",
      message: "Admin fetched activity logs.",
      metadata: { count: rows.length, limit },
    });
  } catch (error) {
    console.error("listActivityLogs error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_ACTIVITY_LOGS_LIST",
      entity: "ACTIVITY_LOG",
      status: "failed",
      message: "Failed to fetch activity logs.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};
