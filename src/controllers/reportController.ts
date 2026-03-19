import type { Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examAnswers,
  examPackages,
  packageExams,
  examSessions,
  questionReportReplies,
  questionReports,
  questions,
  users,
  type ExamPayloadMap,
  type ExamPayloadQuestion,
  type OptionKey,
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

const findSessionQuestion = (
  payloadMap: ExamPayloadMap | null | undefined,
  questionId: number,
): ExamPayloadQuestion | null => {
  if (!payloadMap || !Array.isArray(payloadMap.questions)) {
    return null;
  }

  return (
    payloadMap.questions.find((item) => item.questionId === questionId) ?? null
  );
};

const resolveRawQuestionOptions = (question: {
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  optionE: string | null;
}) => ({
  a: question.optionA,
  b: question.optionB,
  c: question.optionC,
  d: question.optionD,
  e: question.optionE,
});

const buildQuestionSnapshot = (input: {
  question: {
    id: number | null;
    questionText: string | null;
    imageUrl: string | null;
    optionA: string | null;
    optionB: string | null;
    optionC: string | null;
    optionD: string | null;
    optionE: string | null;
    correctAnswer: OptionKey | null;
    explanation: string | null;
  };
  sessionPayloadMap?: ExamPayloadMap | null;
  selectedOption?: OptionKey | null;
}) => {
  const sessionQuestion =
    input.question.id !== null
      ? findSessionQuestion(input.sessionPayloadMap, input.question.id)
      : null;

  if (sessionQuestion) {
    const displayedCorrectAnswer =
      sessionQuestion.optionMapOriginalToDisplayed[
        sessionQuestion.originalCorrectAnswer
      ] ?? sessionQuestion.originalCorrectAnswer;

    return {
      id: input.question.id,
      text: sessionQuestion.questionText,
      image_url: sessionQuestion.imageUrl ?? input.question.imageUrl ?? null,
      options: sessionQuestion.displayedOptions,
      correct_answer: displayedCorrectAnswer,
      correct_answer_text:
        sessionQuestion.displayedOptions[displayedCorrectAnswer] ?? null,
      selected_answer: input.selectedOption ?? null,
      selected_answer_text:
        input.selectedOption !== null && input.selectedOption !== undefined
          ? sessionQuestion.displayedOptions[input.selectedOption] ?? null
          : null,
      explanation: sessionQuestion.explanation ?? input.question.explanation ?? null,
    };
  }

  const rawOptions = resolveRawQuestionOptions(input.question);
  const correctAnswer = input.question.correctAnswer ?? null;

  return {
    id: input.question.id,
    text: input.question.questionText,
    image_url: input.question.imageUrl,
    options: rawOptions,
    correct_answer: correctAnswer,
    correct_answer_text: correctAnswer ? rawOptions[correctAnswer] ?? null : null,
    selected_answer: input.selectedOption ?? null,
    selected_answer_text:
      input.selectedOption !== null && input.selectedOption !== undefined
        ? rawOptions[input.selectedOption] ?? null
        : null,
    explanation: input.question.explanation,
  };
};

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
        examId: questions.examId,
      })
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (!questionRow) {
      res.status(404).json({ message: "Question not found." });
      return;
    }

    let packageId = questionRow.packageId ?? null;
    let examId = questionRow.examId ?? null;

    if (sessionId) {
      const [session] = await db
        .select({
          id: examSessions.id,
          packageId: examSessions.packageId,
          examId: examSessions.examId,
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
      examId = session.examId ?? examId;
    }

    const [report] = await db
      .insert(questionReports)
      .values({
        userId: req.user.userId,
        questionId,
        sessionId: sessionId ?? null,
        packageId,
        examId,
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
        examId: packageExams.id,
        examName: packageExams.name,
        sessionId: examSessions.id,
      })
      .from(questionReports)
      .leftJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .leftJoin(packageExams, eq(questionReports.examId, packageExams.id))
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
        exam_id: row.examId,
        exam_name: row.examName ?? null,
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
        questionImageUrl: questions.imageUrl,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        packageId: examPackages.id,
        packageName: examPackages.name,
        examId: packageExams.id,
        examName: packageExams.name,
        sessionId: examSessions.id,
        payloadMap: examSessions.payloadMap,
      })
      .from(questionReports)
      .leftJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .leftJoin(packageExams, eq(questionReports.examId, packageExams.id))
      .leftJoin(examSessions, eq(questionReports.sessionId, examSessions.id))
      .where(eq(questionReports.id, reportId))
      .limit(1);

    if (!report) {
      res.status(404).json({ message: "Report not found." });
      return;
    }

    const [selectedAnswerRow] =
      report.sessionId && report.questionId
        ? await db
            .select({
              selectedOption: examAnswers.selectedOption,
            })
            .from(examAnswers)
            .where(
              and(
                eq(examAnswers.sessionId, report.sessionId),
                eq(examAnswers.questionId, report.questionId),
              ),
            )
            .limit(1)
        : [];

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

    const questionSnapshot = buildQuestionSnapshot({
      question: {
        id: report.questionId,
        questionText: report.questionText,
        imageUrl: report.questionImageUrl,
        optionA: report.optionA,
        optionB: report.optionB,
        optionC: report.optionC,
        optionD: report.optionD,
        optionE: report.optionE,
        correctAnswer: report.correctAnswer,
        explanation: report.explanation,
      },
      sessionPayloadMap: (report.payloadMap as ExamPayloadMap | null) ?? null,
      selectedOption: selectedAnswerRow?.selectedOption ?? null,
    });

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
      question: questionSnapshot,
      package: {
        id: report.packageId,
        name: report.packageName ?? null,
      },
      exam: {
        id: report.examId,
        name: report.examName ?? null,
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
        userName: users.name,
        userEmail: users.email,
        questionId: questions.id,
        questionText: questions.questionText,
        questionImageUrl: questions.imageUrl,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        packageName: examPackages.name,
        examName: packageExams.name,
        sessionId: examSessions.id,
        payloadMap: examSessions.payloadMap,
      })
      .from(questionReports)
      .innerJoin(users, eq(questionReports.userId, users.id))
      .leftJoin(questions, eq(questionReports.questionId, questions.id))
      .leftJoin(examPackages, eq(questionReports.packageId, examPackages.id))
      .leftJoin(packageExams, eq(questionReports.examId, packageExams.id))
      .leftJoin(examSessions, eq(questionReports.sessionId, examSessions.id))
      .where(eq(questionReports.id, reportId))
      .limit(1);

    if (!report) {
      res.status(404).json({ message: "Report not found." });
      return;
    }

    const [selectedAnswerRow] =
      report.sessionId && report.questionId
        ? await db
            .select({
              selectedOption: examAnswers.selectedOption,
            })
            .from(examAnswers)
            .where(
              and(
                eq(examAnswers.sessionId, report.sessionId),
                eq(examAnswers.questionId, report.questionId),
              ),
            )
            .limit(1)
        : [];

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

    const questionSnapshot = buildQuestionSnapshot({
      question: {
        id: report.questionId,
        questionText: report.questionText,
        imageUrl: report.questionImageUrl,
        optionA: report.optionA,
        optionB: report.optionB,
        optionC: report.optionC,
        optionD: report.optionD,
        optionE: report.optionE,
        correctAnswer: report.correctAnswer,
        explanation: report.explanation,
      },
      sessionPayloadMap: (report.payloadMap as ExamPayloadMap | null) ?? null,
      selectedOption: selectedAnswerRow?.selectedOption ?? null,
    });

    const emailPayload = buildQuestionReportReplyEmail({
      userName: report.userName,
      packageName: report.packageName ?? null,
      examName: report.examName ?? null,
      questionText: questionSnapshot.text ?? null,
      questionImageUrl: questionSnapshot.image_url ?? null,
      options: questionSnapshot.options,
      correctAnswerLabel: questionSnapshot.correct_answer ?? null,
      correctAnswerText: questionSnapshot.correct_answer_text ?? null,
      selectedAnswerLabel: questionSnapshot.selected_answer ?? null,
      selectedAnswerText: questionSnapshot.selected_answer_text ?? null,
      explanation: questionSnapshot.explanation ?? null,
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
