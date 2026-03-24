import type { Response } from "express";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import {
  activityLogs,
  examPackages,
  packageExams,
  examSessions,
  questions,
  transactions,
  users,
  type ExamPayloadMap,
  type OptionKey,
} from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import {
  formatExamPurposeLabel,
  mapStoredExamPurposeToClient,
} from "../utils/examPurpose.js";
import {
  DocxQuestionImportError,
  parseQuestionTemplateDocx,
} from "../utils/docxQuestionImport.js";
import {
  getUploadedBinaryFile,
  isUploadRequestError,
} from "../utils/requestUpload.js";
import {
  isMultipartFormError,
  parseMultipartForm,
} from "../utils/multipartForm.js";
import {
  deleteQuestionImage,
  QuestionImageError,
  saveQuestionImage,
} from "../services/questionImageService.js";
import { listPackageExamAssignments } from "../services/examCatalogService.js";

type QuestionPayload = {
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  option_e?: string;
  correct_answer?: OptionKey;
  explanation?: string;
  is_active?: unknown;
  exam_id?: unknown;
  examId?: unknown;
  package_id?: unknown;
  packageId?: unknown;
  remove_image?: unknown;
  removeImage?: unknown;
};

const isValidOptionKey = (value: unknown): value is OptionKey =>
  value === "a" || value === "b" || value === "c" || value === "d" || value === "e";

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return null;
};

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

const getQuestionExam = async (examId: number) => {
  const [questionExam] = await db
    .select({
      id: packageExams.id,
      name: packageExams.name,
      questionCount: packageExams.questionCount,
      isActive: packageExams.isActive,
    })
    .from(packageExams)
    .where(eq(packageExams.id, examId))
    .limit(1);

  if (!questionExam) {
    return null;
  }

  const assignments = await listPackageExamAssignments({ examIds: [examId] });
  return {
    ...questionExam,
    packageId: assignments[0]?.packageId ?? null,
    packageName:
      assignments.length > 0
        ? assignments.map((item) => item.packageName).join(", ")
        : null,
    packageQuestionCount: null as number | null,
  };
};

const resolveQuestionExamId = async (input: {
  examId: number | null;
  packageId: number | null;
}) => {
  if (input.examId) {
    return input.examId;
  }

  if (!input.packageId) {
    return null;
  }

  const [assignment] = await listPackageExamAssignments({
    packageIds: [input.packageId],
  });

  return assignment?.examId ?? null;
};

const getExamPackageMetadata = async (examIds: number[]) => {
  const uniqueExamIds = [...new Set(examIds.filter((item) => item > 0))];
  if (uniqueExamIds.length === 0) {
    return new Map<
      number,
      {
        packageId: number | null;
        packageName: string | null;
      }
    >();
  }

  const assignments = await listPackageExamAssignments({ examIds: uniqueExamIds });
  const assignmentsByExamId = new Map<number, typeof assignments>();

  for (const assignment of assignments) {
    const rows = assignmentsByExamId.get(assignment.examId) ?? [];
    rows.push(assignment);
    assignmentsByExamId.set(assignment.examId, rows);
  }

  return new Map(
    uniqueExamIds.map((examId) => {
      const rows = assignmentsByExamId.get(examId) ?? [];
      return [
        examId,
        {
          packageId: rows[0]?.packageId ?? null,
          packageName:
            rows.length > 0
              ? rows.map((row) => row.packageName).join(", ")
              : null,
        },
      ];
    }),
  );
};

const toQuestionResponse = (question: {
  id: number;
  examId: number | null;
  examName: string | null;
  packageId: number | null;
  packageName: string | null;
  packageQuestionCount: number | null;
  questionText: string;
  imageUrl: string | null;
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
  exam_id: question.examId,
  exam_name: question.examName,
  package_id: question.packageId,
  package_name: question.packageName,
  package_question_count: question.packageQuestionCount,
  question_text: question.questionText,
  image_url: question.imageUrl,
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
        accountStatus: users.accountStatus,
        statusNote: users.statusNote,
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
        exam_purpose: mapStoredExamPurposeToClient(row.examPurpose),
        exam_purpose_label: formatExamPurposeLabel(row.examPurpose),
        address: row.address,
        phone: row.phone,
        target_score: row.targetScore ?? 0,
        is_premium: row.isPremium,
        account_status: row.accountStatus,
        status_note: row.statusNote ?? null,
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
    await syncDefaultExamPackages();

    const rows = await db
      .select({
        sessionId: examSessions.id,
        userId: examSessions.userId,
        userName: users.name,
        packageId: examSessions.packageId,
        packageName: examPackages.name,
        examId: examSessions.examId,
        examName: packageExams.name,
        attemptNumber: examSessions.attemptNumber,
        status: examSessions.status,
        score: examSessions.score,
        durationMinutes: examSessions.durationMinutes,
        startTime: examSessions.startTime,
        endTime: examSessions.endTime,
        payloadMap: examSessions.payloadMap,
      })
      .from(examSessions)
      .leftJoin(users, eq(examSessions.userId, users.id))
      .leftJoin(examPackages, eq(examSessions.packageId, examPackages.id))
      .leftJoin(packageExams, eq(examSessions.examId, packageExams.id))
      .orderBy(desc(examSessions.startTime));

    res.status(200).json(
      rows.map((row) => {
        const payloadMap = row.payloadMap as ExamPayloadMap;
        const totalQuestions = Array.isArray(payloadMap?.questions)
          ? payloadMap.questions.length
          : 0;

        return {
          session_id: row.sessionId,
          user_id: row.userId,
          user_name: row.userName ?? "Unknown",
          package_id: row.packageId,
          package_name: row.packageName ?? null,
          exam_id: row.examId,
          exam_name: row.examName ?? null,
          attempt_number: row.attemptNumber,
          status: row.status,
          score: row.score ?? 0,
          total_questions: totalQuestions,
          duration_minutes: row.durationMinutes ?? totalQuestions,
          start_time: row.startTime,
          end_time: row.endTime,
        };
      }),
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
    await syncDefaultExamPackages();
    const examId = normalizePositiveInteger(req.query.exam_id ?? req.query.examId);
    const isActive =
      req.query.is_active !== undefined
        ? normalizeBoolean(req.query.is_active)
        : null;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (req.query.is_active !== undefined && isActive === null) {
      res.status(400).json({ message: "Invalid is_active filter." });
      return;
    }

    const conditions = [];
    if (examId) {
      conditions.push(eq(questions.examId, examId));
    }
    if (isActive !== null) {
      conditions.push(eq(questions.isActive, isActive));
    }
    if (search.length > 0) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(questions.questionText, pattern),
          ilike(questions.explanation, pattern),
          ilike(packageExams.name, pattern),
        ),
      );
    }

    const rows = await db
      .select({
        id: questions.id,
        examId: questions.examId,
        examName: packageExams.name,
        packageId: questions.packageId,
        packageName: packageExams.name,
        packageQuestionCount: packageExams.questionCount,
        questionText: questions.questionText,
        imageUrl: questions.imageUrl,
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
      .leftJoin(packageExams, eq(questions.examId, packageExams.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(questions.id));

    const packageMetadataByExamId = await getExamPackageMetadata(
      rows
        .map((item) => item.examId ?? 0)
        .filter((item): item is number => item > 0),
    );

    res.status(200).json(
      rows.map((item) =>
        toQuestionResponse({
          ...item,
          packageId:
            item.examId && packageMetadataByExamId.has(item.examId)
              ? packageMetadataByExamId.get(item.examId)?.packageId ?? null
              : null,
          packageName:
            item.examId && packageMetadataByExamId.has(item.examId)
              ? packageMetadataByExamId.get(item.examId)?.packageName ?? null
              : null,
          packageQuestionCount: null,
        }),
      ),
    );
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

export const updateUserStatus = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "Invalid user id." });
      return;
    }

    const body = req.body as {
      account_status?: unknown;
      accountStatus?: unknown;
      status_note?: unknown;
      statusNote?: unknown;
    };

    const accountStatusValue = body.account_status ?? body.accountStatus;
    if (accountStatusValue !== "active" && accountStatusValue !== "inactive") {
      res.status(400).json({ message: "Invalid account_status." });
      return;
    }

    const statusNoteRaw = body.status_note ?? body.statusNote;
    const statusNote =
      typeof statusNoteRaw === "string" && statusNoteRaw.trim().length > 0
        ? statusNoteRaw.trim()
        : null;

    const [updated] = await db
      .update(users)
      .set({
        accountStatus: accountStatusValue,
        statusNote,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
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
        accountStatus: users.accountStatus,
        statusNote: users.statusNote,
        createdAt: users.createdAt,
      });

    if (!updated) {
      res.status(404).json({ message: "User not found." });
      return;
    }

    res.status(200).json({
      id: updated.id,
      role: updated.role,
      name: updated.name,
      email: updated.email,
      education: updated.education,
      school_origin: updated.schoolOrigin,
      exam_purpose: mapStoredExamPurposeToClient(updated.examPurpose),
      exam_purpose_label: formatExamPurposeLabel(updated.examPurpose),
      address: updated.address,
      phone: updated.phone,
      target_score: updated.targetScore ?? 0,
      is_premium: updated.isPremium,
      account_status: updated.accountStatus,
      status_note: updated.statusNote ?? null,
      created_at: updated.createdAt,
    });
  } catch (error) {
    console.error("updateUserStatus error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createQuestion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let uploadedImageUrl: string | null = null;

  try {
    await syncDefaultExamPackages();

    const isMultipart =
      typeof req.headers["content-type"] === "string" &&
      req.headers["content-type"].includes("multipart/form-data");

    let body: QuestionPayload;
    let imageFile:
      | Awaited<ReturnType<typeof parseMultipartForm>>["files"][number]
      | null = null;

    if (isMultipart) {
      const form = await parseMultipartForm(req);
      body = form.fields as QuestionPayload;
      imageFile =
        form.files.find(
          (item) => item.fieldName === "image" || item.fieldName === "question_image",
        ) ?? null;
    } else {
      body = req.body as QuestionPayload;
    }

    const packageId = normalizePositiveInteger(body.package_id ?? body.packageId);
    const examId = await resolveQuestionExamId({
      examId: normalizePositiveInteger(body.exam_id ?? body.examId),
      packageId,
    });
    const isActive = normalizeBoolean(body.is_active) ?? false;

    if (
      !examId ||
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
          "Invalid payload. Required fields: exam_id, question_text, option_a-e, correct_answer, explanation.",
      });
      return;
    }

    const questionExam = await getQuestionExam(examId);
    if (!questionExam || !questionExam.isActive) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_CREATE",
        entity: "QUESTION",
        status: "failed",
        message: "Create question failed: invalid exam id.",
        metadata: { examId, packageId },
      });
      res.status(400).json({ message: "Invalid exam_id." });
      return;
    }

    if (imageFile) {
      uploadedImageUrl = await saveQuestionImage(imageFile);
    }

    const [created] = await db
      .insert(questions)
      .values({
        packageId: null,
        examId,
        questionText: body.question_text.trim(),
        imageUrl: uploadedImageUrl,
        optionA: body.option_a.trim(),
        optionB: body.option_b.trim(),
        optionC: body.option_c.trim(),
        optionD: body.option_d.trim(),
        optionE: body.option_e.trim(),
        correctAnswer: body.correct_answer,
        explanation: body.explanation.trim(),
        isActive,
      })
      .returning({
        id: questions.id,
        examId: questions.examId,
        packageId: questions.packageId,
        questionText: questions.questionText,
        imageUrl: questions.imageUrl,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        isActive: questions.isActive,
      });

    res.status(201).json(
      toQuestionResponse({
        ...created,
        examName: questionExam.name,
        packageName: questionExam.packageName,
        packageQuestionCount: questionExam.questionCount,
      }),
    );
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_CREATE",
      entity: "QUESTION",
      entityId: created.id,
      status: "success",
      message: "Question created.",
      metadata: {
        packageId: questionExam.packageId,
        packageName: questionExam.packageName,
        examId,
        examName: questionExam.name,
      },
    });
  } catch (error) {
    console.error("createQuestion error:", error);
    if (uploadedImageUrl) {
      await deleteQuestionImage(uploadedImageUrl);
    }
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_CREATE",
      entity: "QUESTION",
      status: "failed",
      message: "Create question failed due to internal server error.",
    });
    if (isMultipartFormError(error)) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    if (error instanceof QuestionImageError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: "Internal server error." });
  }
};

export const updateQuestion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let uploadedImageUrl: string | null = null;

  try {
    await syncDefaultExamPackages();

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

    const isMultipart =
      typeof req.headers["content-type"] === "string" &&
      req.headers["content-type"].includes("multipart/form-data");

    let body: QuestionPayload;
    let imageFile:
      | Awaited<ReturnType<typeof parseMultipartForm>>["files"][number]
      | null = null;

    if (isMultipart) {
      const form = await parseMultipartForm(req);
      body = form.fields as QuestionPayload;
      imageFile =
        form.files.find(
          (item) => item.fieldName === "image" || item.fieldName === "question_image",
        ) ?? null;
    } else {
      body = req.body as QuestionPayload;
    }

    const [existingQuestion] = await db
      .select({
        id: questions.id,
        examId: questions.examId,
        packageId: questions.packageId,
        imageUrl: questions.imageUrl,
      })
      .from(questions)
      .where(eq(questions.id, id))
      .limit(1);

    if (!existingQuestion) {
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

    const updates: Partial<{
      examId: number;
      packageId: number | null;
      questionText: string;
      imageUrl: string | null;
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
    let responseExam: Awaited<ReturnType<typeof getQuestionExam>> | null = null;

    const requestedPackageId = normalizePositiveInteger(
      body.package_id ?? body.packageId,
    );
    const requestedExamId = await resolveQuestionExamId({
      examId: normalizePositiveInteger(body.exam_id ?? body.examId),
      packageId: requestedPackageId,
    });

    if (body.exam_id !== undefined || body.examId !== undefined || requestedPackageId) {
      if (!requestedExamId) {
        await logActivity({
          actorUserId: req.user?.userId ?? null,
          actorRole: req.user?.role ?? null,
          action: "ADMIN_QUESTION_UPDATE",
          entity: "QUESTION",
          entityId: id,
          status: "failed",
          message: "Update question failed: invalid exam id.",
          metadata: { requestedExamId, requestedPackageId },
        });
        res.status(400).json({ message: "Invalid exam_id." });
        return;
      }

      responseExam = await getQuestionExam(requestedExamId);
      if (!responseExam || !responseExam.isActive) {
        await logActivity({
          actorUserId: req.user?.userId ?? null,
          actorRole: req.user?.role ?? null,
          action: "ADMIN_QUESTION_UPDATE",
          entity: "QUESTION",
          entityId: id,
          status: "failed",
          message: "Update question failed: exam not found.",
          metadata: { requestedExamId },
        });
        res.status(400).json({ message: "Invalid exam_id." });
        return;
      }

      updates.examId = requestedExamId;
      updates.packageId = null;
    }

    if (typeof body.question_text === "string") updates.questionText = body.question_text;
    if (typeof body.option_a === "string") updates.optionA = body.option_a;
    if (typeof body.option_b === "string") updates.optionB = body.option_b;
    if (typeof body.option_c === "string") updates.optionC = body.option_c;
    if (typeof body.option_d === "string") updates.optionD = body.option_d;
    if (typeof body.option_e === "string") updates.optionE = body.option_e;
    if (isValidOptionKey(body.correct_answer)) updates.correctAnswer = body.correct_answer;
    if (typeof body.explanation === "string") updates.explanation = body.explanation;
    if (body.is_active !== undefined) {
      const isActive = normalizeBoolean(body.is_active);
      if (isActive === null) {
        await logActivity({
          actorUserId: req.user?.userId ?? null,
          actorRole: req.user?.role ?? null,
          action: "ADMIN_QUESTION_UPDATE",
          entity: "QUESTION",
          entityId: id,
          status: "failed",
          message: "Update question failed: invalid is_active value.",
          metadata: { isActive: body.is_active },
        });
        res.status(400).json({ message: "Invalid is_active value." });
        return;
      }

      updates.isActive = isActive;
    }
    if (imageFile) {
      uploadedImageUrl = await saveQuestionImage(imageFile);
      updates.imageUrl = uploadedImageUrl;
    } else if (
      normalizeBoolean(body.remove_image ?? body.removeImage) === true
    ) {
      updates.imageUrl = null;
    }
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
        examId: questions.examId,
        packageId: questions.packageId,
        questionText: questions.questionText,
        imageUrl: questions.imageUrl,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
        isActive: questions.isActive,
      });

    if (!responseExam && updated.examId) {
      responseExam = await getQuestionExam(updated.examId);
    }

    if (uploadedImageUrl && existingQuestion.imageUrl && existingQuestion.imageUrl !== uploadedImageUrl) {
      await deleteQuestionImage(existingQuestion.imageUrl);
    } else if (updates.imageUrl === null && existingQuestion.imageUrl) {
      await deleteQuestionImage(existingQuestion.imageUrl);
    }

    res.status(200).json(
      toQuestionResponse({
        ...updated,
        examName: responseExam?.name ?? null,
        packageName: responseExam?.packageName ?? null,
        packageQuestionCount: responseExam?.questionCount ?? null,
      }),
    );
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_UPDATE",
      entity: "QUESTION",
      entityId: updated.id,
      status: "success",
      message: "Question updated.",
      metadata: {
        packageId: updated.packageId,
        packageName: responseExam?.packageName ?? null,
        examId: updated.examId,
        examName: responseExam?.name ?? null,
      },
    });
  } catch (error) {
    console.error("updateQuestion error:", error);
    if (uploadedImageUrl) {
      await deleteQuestionImage(uploadedImageUrl);
    }
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_UPDATE",
      entity: "QUESTION",
      status: "failed",
      message: "Update question failed due to internal server error.",
    });
    if (isMultipartFormError(error)) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    if (error instanceof QuestionImageError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
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
      .returning({ id: questions.id, imageUrl: questions.imageUrl });

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

    await deleteQuestionImage(deleted.imageUrl);
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
  try {
    await syncDefaultExamPackages();

    const uploadedFile = await getUploadedBinaryFile(req);
    const normalizedName = uploadedFile.originalName.toLowerCase();

    if (!normalizedName.endsWith(".docx")) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_IMPORT",
        entity: "QUESTION",
        status: "failed",
        message: "Question import failed: uploaded file is not a .docx file.",
        metadata: {
          fileName: uploadedFile.originalName,
          mimeType: uploadedFile.mimeType,
        },
      });
      res.status(400).json({
        message: "File harus berformat .docx sesuai template bank soal.",
      });
      return;
    }

    const parsedQuestions = parseQuestionTemplateDocx(uploadedFile.buffer);
    if (parsedQuestions.length === 0) {
      res.status(400).json({
        message: "Template .docx tidak mengandung soal yang bisa diimpor.",
      });
      return;
    }

    const packageId = normalizePositiveInteger(
      req.query.package_id ??
        req.query.packageId ??
        uploadedFile.fields.package_id ??
        uploadedFile.fields.packageId,
    );
    const examId = await resolveQuestionExamId({
      examId: normalizePositiveInteger(
        req.query.exam_id ??
          req.query.examId ??
          uploadedFile.fields.exam_id ??
          uploadedFile.fields.examId,
      ),
      packageId,
    });
    if (!examId) {
      res.status(400).json({ message: "exam_id is required." });
      return;
    }

    const questionExam = await getQuestionExam(examId);
    if (!questionExam || !questionExam.isActive) {
      res.status(400).json({ message: "Invalid exam_id." });
      return;
    }

    const isActive =
      normalizeBoolean(
        req.query.is_active ??
          uploadedFile.fields.is_active ??
          uploadedFile.fields.isActive,
      ) ?? false;

    const importedRows = await db.transaction(async (tx) =>
      tx
        .insert(questions)
        .values(
          parsedQuestions.map((item) => ({
            packageId: null,
            examId,
            questionText: item.questionText,
            optionA: item.optionA,
            optionB: item.optionB,
            optionC: item.optionC,
            optionD: item.optionD,
            optionE: item.optionE,
            correctAnswer: item.correctAnswer,
            explanation: item.explanation,
            isActive,
          })),
        )
        .returning({ id: questions.id }),
    );

    res.status(201).json({
      message: "Question bank imported successfully.",
      imported_count: importedRows.length,
      package_id: questionExam.packageId,
      package_name: questionExam.packageName,
      exam_id: examId,
      exam_name: questionExam.name,
      is_active: isActive,
      file_name: uploadedFile.originalName,
      question_ids: importedRows.map((item) => item.id),
    });

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_IMPORT",
      entity: "QUESTION",
      status: "success",
      message: "Question bank imported from .docx template.",
      metadata: {
        fileName: uploadedFile.originalName,
        importedCount: importedRows.length,
        isActive,
        packageId: questionExam.packageId,
        packageName: questionExam.packageName,
        examId,
        examName: questionExam.name,
      },
    });
  } catch (error) {
    console.error("importQuestions error:", error);

    if (isUploadRequestError(error)) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_IMPORT",
        entity: "QUESTION",
        status: "failed",
        message: error.message,
      });
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    if (error instanceof DocxQuestionImportError) {
      await logActivity({
        actorUserId: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        action: "ADMIN_QUESTION_IMPORT",
        entity: "QUESTION",
        status: "failed",
        message: error.message,
      });
      res.status(400).json({ message: error.message });
      return;
    }

    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "ADMIN_QUESTION_IMPORT",
      entity: "QUESTION",
      status: "failed",
      message: "Question import failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
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
