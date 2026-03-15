import type { Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examPackages,
  examSessions,
  questionReportReplies,
  questionReports,
  questions,
  users,
  type ExamPayloadMap,
} from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import {
  buildQuestionReportReplyEmail,
  sendEmail,
} from "../services/emailService.js";

const normalizePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getSessionQuestionIds = (payloadMap: ExamPayloadMap): number[] =>
  Array.isArray(payloadMap.questions)
    ? payloadMap.questions.map((item) => item.questionId)
    : [];

export const createQuestionReport = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const body = req.body as {
      question_id?: unknown;
      questionId?: unknown;
      session_id?: unknown;
      sessionId?: unknown;
      report_text?: unknown;
      reportText?: unknown;
    };

    const questionId = normalizePositiveInteger(body.question_id ?? body.questionId);
    const sessionId = normalizePositiveInteger(body.session_id ?? body.sessionId);
    const reportTextRaw = body.report_text ?? body.reportText;
    const reportText =
      typeof reportTextRaw === "string" ? reportTextRaw.trim() : "";

    if (!questionId || !reportText) {
      res.status(400).json({
        message: "Invalid payload. Required fields: question_id, report_text.",
      });
      return;
    }

    const [questionRow] = await db
      .select({
        id: questions.id,
        packageId: questions.packageId,
      })
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (!questionRow) {
      res.status(404).json({ message: "Question not found." });
      return;
    }

    let packageId = questionRow.packageId ?? null;

    if (sessionId) {
      const [session] = await db
        .select({
          id: examSessions.id,
          packageId: examSessions.packageId,
          payloadMap: examSessions.payloadMap,
        })
        .from(examSessions)
        .where(
          and(
            eq(examSessions.id, sessionId),
            eq(examSessions.userId, req.user.userId),
          ),
        )
        .limit(1);

      if (!session) {
        res.status(404).json({ message: "Exam session not found." });
        return;
      }

      const questionIds = getSessionQuestionIds(session.payloadMap as ExamPayloadMap);
      if (!questionIds.includes(questionId)) {
        res.status(400).json({
          message: "Question is not part of the specified session.",
        });
        return;
      }

      packageId = session.packageId ?? packageId;
    }

    const [report] = await db
      .insert(questionReports)
      .values({
        userId: req.user.userId,
        questionId,
        sessionId: sessionId ?? null,
        packageId,
        reportText,
        status: "open",
      })
      .returning({
        id: questionReports.id,
        status: questionReports.status,
        createdAt: questionReports.createdAt,
      });

    await db.insert(questionReportReplies).values({
      reportId: report.id,
      authorUserId: req.user.userId,
      authorRole: "user",
      messageText: reportText,
    });

    res.status(201).json({
      id: report.id,
      status: report.status,
      created_at: report.createdAt,
      message: "Question report submitted successfully.",
    });
  } catch (error) {
    console.error("createQuestionReport error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listQuestionReports = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const statusFilter =
      req.query.status === "open" ||
      req.query.status === "replied" ||
      req.query.status === "closed"
        ? req.query.status
        : null;

    const rows = await db
      .select({
        id: questionReports.id,
        status: questionReports.status,
        reportText: questionReports.reportText,
        createdAt: questionReports.createdAt,
        lastAdminReplyAt: questionReports.lastAdminReplyAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        questionId: questions.id,
        questionText: questions.questionText,
        packageId: examPackages.id,
        packageName: examPackages.name,
        sessionId: examSessions.id,
      })
      .from(questionReports)
      .leftJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .leftJoin(examSessions, eq(questionReports.sessionId, examSessions.id))
      .where(statusFilter ? eq(questionReports.status, statusFilter) : undefined)
      .orderBy(desc(questionReports.createdAt), desc(questionReports.id));

    res.status(200).json(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        report_text: row.reportText,
        created_at: row.createdAt,
        last_admin_reply_at: row.lastAdminReplyAt,
        user_id: row.userId,
        user_name: row.userName ?? "Unknown",
        user_email: row.userEmail ?? "-",
        question_id: row.questionId,
        question_text: row.questionText ?? null,
        package_id: row.packageId,
        package_name: row.packageName ?? null,
        session_id: row.sessionId,
      })),
    );
  } catch (error) {
    console.error("listQuestionReports error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const getQuestionReportDetail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      res.status(400).json({ message: "Invalid report id." });
      return;
    }

    const [report] = await db
      .select({
        id: questionReports.id,
        status: questionReports.status,
        reportText: questionReports.reportText,
        createdAt: questionReports.createdAt,
        lastAdminReplyAt: questionReports.lastAdminReplyAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        questionId: questions.id,
        questionText: questions.questionText,
        packageId: examPackages.id,
        packageName: examPackages.name,
        sessionId: examSessions.id,
      })
      .from(questionReports)
      .leftJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .leftJoin(examSessions, eq(questionReports.sessionId, examSessions.id))
      .where(eq(questionReports.id, reportId))
      .limit(1);

    if (!report) {
      res.status(404).json({ message: "Report not found." });
      return;
    }

    const replies = await db
      .select({
        id: questionReportReplies.id,
        authorUserId: questionReportReplies.authorUserId,
        authorRole: questionReportReplies.authorRole,
        messageText: questionReportReplies.messageText,
        emailedAt: questionReportReplies.emailedAt,
        createdAt: questionReportReplies.createdAt,
      })
      .from(questionReportReplies)
      .where(eq(questionReportReplies.reportId, reportId))
      .orderBy(asc(questionReportReplies.createdAt), asc(questionReportReplies.id));

    res.status(200).json({
      id: report.id,
      status: report.status,
      report_text: report.reportText,
      created_at: report.createdAt,
      last_admin_reply_at: report.lastAdminReplyAt,
      user: {
        id: report.userId,
        name: report.userName ?? "Unknown",
        email: report.userEmail ?? "-",
      },
      question: {
        id: report.questionId,
        text: report.questionText ?? null,
      },
      package: {
        id: report.packageId,
        name: report.packageName ?? null,
      },
      session_id: report.sessionId,
      replies: replies.map((item) => ({
        id: item.id,
        author_user_id: item.authorUserId,
        author_role: item.authorRole,
        message_text: item.messageText,
        emailed_at: item.emailedAt,
        created_at: item.createdAt,
      })),
    });
  } catch (error) {
    console.error("getQuestionReportDetail error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const replyQuestionReport = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      res.status(400).json({ message: "Invalid report id." });
      return;
    }

    const body = req.body as {
      message_text?: unknown;
      messageText?: unknown;
      status?: unknown;
    };
    const messageTextRaw = body.message_text ?? body.messageText;
    const messageText =
      typeof messageTextRaw === "string" ? messageTextRaw.trim() : "";
    const nextStatus =
      body.status === "open" || body.status === "replied" || body.status === "closed"
        ? body.status
        : "replied";

    if (!messageText) {
      res.status(400).json({ message: "message_text is required." });
      return;
    }

    const [report] = await db
      .select({
        id: questionReports.id,
        reportText: questionReports.reportText,
        userId: questionReports.userId,
        userName: users.name,
        userEmail: users.email,
        questionText: questions.questionText,
        packageName: examPackages.name,
      })
      .from(questionReports)
      .innerJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .where(eq(questionReports.id, reportId))
      .limit(1);

    if (!report) {
      res.status(404).json({ message: "Report not found." });
      return;
    }

    const [reply] = await db
      .insert(questionReportReplies)
      .values({
        reportId,
        authorUserId: req.user.userId,
        authorRole: "admin",
        messageText,
      })
      .returning({
        id: questionReportReplies.id,
        createdAt: questionReportReplies.createdAt,
      });

    await db
      .update(questionReports)
      .set({
        status: nextStatus,
        lastAdminReplyAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(questionReports.id, reportId));

    const emailPayload = buildQuestionReportReplyEmail({
      userName: report.userName,
      packageName: report.packageName ?? null,
      questionText: report.questionText ?? null,
      reportText: report.reportText,
      adminReply: messageText,
    });

    const emailResult = await sendEmail({
      to: report.userEmail,
      subject: emailPayload.subject,
      html: emailPayload.html,
      text: emailPayload.text,
    });

    if (emailResult.delivered) {
      await db
        .update(questionReportReplies)
        .set({
          emailedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(questionReportReplies.id, reply.id));
    }

    res.status(200).json({
      message: "Reply submitted successfully.",
      report_id: reportId,
      reply_id: reply.id,
      status: nextStatus,
      email_sent: emailResult.delivered,
      email_provider: emailResult.provider,
      email_error: emailResult.error ?? null,
      created_at: reply.createdAt,
    });
  } catch (error) {
    console.error("replyQuestionReport error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
