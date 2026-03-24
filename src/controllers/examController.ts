import { randomInt } from "node:crypto";
import type { Response } from "express";
import { and, asc, count, desc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import {
  examAnswers,
  examPackages,
  packageExamAssignments,
  packageExams,
  examSessions,
  questions,
  users,
  type ExamPayloadMap,
  type ExamPayloadQuestion,
  type OptionKey,
} from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { getPackageAccessState } from "../services/packageAccess.js";
import { logActivity } from "../utils/activityLog.js";

const EXAM_GRACE_PERIOD_MINUTES = 1;
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

type StartExamBody = {
  exam_id?: unknown;
  examId?: unknown;
  package_id?: unknown;
  packageId?: unknown;
};

type QuestionRow = {
  id: number;
  questionText: string;
  imageUrl: string | null;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: OptionKey;
  explanation: string;
};

const shuffleArray = <T>(values: T[]): T[] => {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const buildQuestionPayload = (
  question: QuestionRow,
  order: number,
): ExamPayloadQuestion => {
  const originalOptions: Record<OptionKey, string> = {
    a: question.optionA,
    b: question.optionB,
    c: question.optionC,
    d: question.optionD,
    e: question.optionE,
  };

  // We shuffle the original option keys once, then map them into fixed display keys (a-e).
  // This keeps scoring accurate because we also store both forward/reverse maps in payloadMap.
  const shuffledOriginalKeys = shuffleArray(OPTION_KEYS);
  const displayedOptions = {} as Record<OptionKey, string>;
  const optionMapOriginalToDisplayed = {} as Record<OptionKey, OptionKey>;
  const optionMapDisplayedToOriginal = {} as Record<OptionKey, OptionKey>;

  OPTION_KEYS.forEach((displayKey, index) => {
    const originalKey = shuffledOriginalKeys[index];

    displayedOptions[displayKey] = originalOptions[originalKey];
    optionMapOriginalToDisplayed[originalKey] = displayKey;
    optionMapDisplayedToOriginal[displayKey] = originalKey;
  });

  return {
    questionId: question.id,
    order,
    questionText: question.questionText,
    imageUrl: question.imageUrl,
    displayedOptions,
    optionMapOriginalToDisplayed,
    optionMapDisplayedToOriginal,
    originalCorrectAnswer: question.correctAnswer,
    explanation: question.explanation,
  };
};

const toPublicQuestions = (payloadMap: ExamPayloadMap) =>
  [...payloadMap.questions]
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      questionId: item.questionId,
      order: item.order,
      questionText: item.questionText,
      imageUrl: item.imageUrl ?? null,
      options: item.displayedOptions,
    }));

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

const getExamDurationMinutes = (questionCount: number): number => questionCount;

const resolveSessionDurationMinutes = (
  payloadMap: ExamPayloadMap,
  storedDurationMinutes: number | null | undefined,
): number => {
  if (
    typeof storedDurationMinutes === "number" &&
    Number.isInteger(storedDurationMinutes) &&
    storedDurationMinutes > 0
  ) {
    return storedDurationMinutes;
  }

  if (
    typeof payloadMap.durationMinutes === "number" &&
    Number.isInteger(payloadMap.durationMinutes) &&
    payloadMap.durationMinutes > 0
  ) {
    return payloadMap.durationMinutes;
  }

  return getExamDurationMinutes(getSessionQuestions(payloadMap).length);
};

const getAccessDeniedMessage = (
  reason:
    | "package_not_found"
    | "not_purchased"
    | "expired"
    | "inactive"
    | "session_limit_reached"
    | "free_package"
    | "purchased",
  packageName: string | null,
  examName?: string | null,
): string => {
  if (reason === "expired") {
    return `Akses untuk paket ${packageName ?? "ini"} sudah expired.`;
  }

  if (reason === "inactive") {
    return `Akses untuk paket ${packageName ?? "ini"} sedang tidak aktif.`;
  }

  if (reason === "session_limit_reached") {
    return `Batas sesi untuk tipe ujian ${examName ?? "ini"} sudah tercapai.`;
  }

  if (reason === "not_purchased") {
    return "Paket ini belum aktif di akun Anda. Selesaikan pembayaran terlebih dahulu.";
  }

  return "Exam package not found.";
};

const getExamCatalogSummary = async (
  packageId: number | null,
  examId: number | null,
) => {
  if (!packageId && !examId) {
    return null;
  }

  const [summary] = await db
    .select({
      id: examPackages.id,
      name: examPackages.name,
      price: examPackages.price,
      questionCount: examPackages.questionCount,
      isActive: examPackages.isActive,
      examId: packageExams.id,
      examName: packageExams.name,
      examQuestionCount: packageExams.questionCount,
      examIsActive: packageExams.isActive,
    })
    .from(packageExamAssignments)
    .innerJoin(examPackages, eq(packageExamAssignments.packageId, examPackages.id))
    .innerJoin(packageExams, eq(packageExamAssignments.examId, packageExams.id))
    .where(
      packageId && examId
        ? and(
            eq(packageExamAssignments.packageId, packageId),
            eq(packageExamAssignments.examId, examId),
          )
        : examId
          ? eq(packageExamAssignments.examId, examId)
          : packageId
            ? eq(packageExamAssignments.packageId, packageId)
            : undefined,
    )
    .orderBy(asc(packageExamAssignments.sortOrder), asc(packageExams.id))
    .limit(1);

  return summary ?? null;
};

const resolveRequestedExam = async (input: {
  examId: number | null;
  packageId: number | null;
}) => {
  const [selectedExam] = await db
    .select({
      examId: packageExams.id,
      examName: packageExams.name,
      examDescription: packageExams.description,
      examQuestionCount: packageExams.questionCount,
      examIsActive: packageExams.isActive,
      packageId: examPackages.id,
      packageName: examPackages.name,
      packagePrice: examPackages.price,
      packageIsActive: examPackages.isActive,
    })
    .from(packageExamAssignments)
    .innerJoin(examPackages, eq(packageExamAssignments.packageId, examPackages.id))
    .innerJoin(packageExams, eq(packageExamAssignments.examId, packageExams.id))
    .where(
      input.packageId && input.examId
        ? and(
            eq(packageExamAssignments.packageId, input.packageId),
            eq(packageExamAssignments.examId, input.examId),
          )
        : input.examId
          ? eq(packageExamAssignments.examId, input.examId)
          : input.packageId
            ? eq(packageExamAssignments.packageId, input.packageId)
            : undefined,
    )
    .orderBy(asc(packageExamAssignments.sortOrder), asc(packageExams.id))
    .limit(1);

  return selectedExam ?? null;
};

export const getSubmitDeadline = (
  startTime: Date,
  durationMinutes: number,
): Date =>
  new Date(
    startTime.getTime() +
      (durationMinutes + EXAM_GRACE_PERIOD_MINUTES) * 60 * 1000,
  );

export const isSubmitWindowExpired = (
  startTime: Date,
  durationMinutes: number,
  now: Date = new Date(),
): boolean => now > getSubmitDeadline(startTime, durationMinutes);

export const startExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    await syncDefaultExamPackages();

    if (!req.user) {
      await logActivity({
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: unauthorized request.",
      });
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const userId = req.user.userId;
    const body = req.body as StartExamBody;
    const examId = normalizePositiveInteger(body.exam_id ?? body.examId);
    const packageId = normalizePositiveInteger(body.package_id ?? body.packageId);

    if (!examId && !packageId) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: invalid exam or package id.",
      });
      res.status(400).json({ message: "Invalid exam_id or package_id." });
      return;
    }

    const selectedExam = await resolveRequestedExam({ examId, packageId });
    if (!selectedExam || !selectedExam.packageIsActive || !selectedExam.examIsActive) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: exam not found.",
        metadata: { examId, packageId },
      });
      res.status(404).json({ message: "Exam not found." });
      return;
    }

    const [currentUser, accessState] = await Promise.all([
      db
        .select({
          id: users.id,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      getPackageAccessState({
        userId,
        packageId: selectedExam.packageId,
        examId: selectedExam.examId,
      }),
    ]);

    if (!currentUser) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: user not found.",
      });
      res.status(404).json({ message: "User not found." });
      return;
    }

    if (accessState.reason === "package_not_found" || !accessState.package) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: package not found.",
        metadata: { packageId: selectedExam.packageId, examId: selectedExam.examId },
      });
      res.status(404).json({ message: "Exam package not found." });
      return;
    }

    const selectedPackage = accessState.package;

    if (!accessState.allowed) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start blocked: package access denied.",
        metadata: {
          packageId: selectedExam.packageId,
          examId: selectedExam.examId,
          packageName: selectedPackage.name,
          accessReason: accessState.reason,
        },
      });
      res.status(403).json({
        message: getAccessDeniedMessage(
          accessState.reason,
          selectedPackage.name,
          selectedExam.examName,
        ),
      });
      return;
    }

    const [ongoingSession] = await db
      .select({
        id: examSessions.id,
        packageId: examSessions.packageId,
        examId: examSessions.examId,
        startTime: examSessions.startTime,
        durationMinutes: examSessions.durationMinutes,
        status: examSessions.status,
        payloadMap: examSessions.payloadMap,
      })
      .from(examSessions)
      .where(
        and(eq(examSessions.userId, userId), eq(examSessions.status, "ongoing")),
      )
      .orderBy(desc(examSessions.startTime))
      .limit(1);

    // Idempotent behavior: if an ongoing session exists, return same map unless expired.
    if (ongoingSession) {
      const payloadMap = ongoingSession.payloadMap as ExamPayloadMap;
      const durationMinutes = resolveSessionDurationMinutes(
        payloadMap,
        ongoingSession.durationMinutes,
      );

      if (
        isSubmitWindowExpired(
          ongoingSession.startTime,
          durationMinutes,
        )
      ) {
        await completeSession({
          sessionId: ongoingSession.id,
          userId: req.user.userId,
          startTime: ongoingSession.startTime,
          durationMinutes,
          payloadMap,
        });
      } else {
        if (
          ongoingSession.packageId !== null &&
          ongoingSession.packageId !== selectedPackage.id
        ) {
          res.status(409).json({
            message: "Another package exam session is still ongoing.",
            sessionId: ongoingSession.id,
            package_id: ongoingSession.packageId,
            exam_id: ongoingSession.examId,
          });
          return;
        }

        res.status(200).json({
          message: "Ongoing session found.",
          sessionId: ongoingSession.id,
          package_id: selectedPackage.id,
          package_name: selectedPackage.name,
          exam_id: ongoingSession.examId ?? selectedExam.examId,
          exam_name: selectedExam.examName,
          question_count: selectedExam.examQuestionCount,
          startTime: ongoingSession.startTime,
          durationMinutes,
          gracePeriodMinutes: payloadMap.gracePeriodMinutes,
          questions: toPublicQuestions(payloadMap),
        });

        await logActivity({
          actorUserId: userId,
          actorRole: req.user.role,
          action: "EXAM_START",
          entity: "EXAM_SESSION",
          entityId: ongoingSession.id,
          status: "success",
          message: "Ongoing exam session returned.",
          metadata: {
            packageId: selectedPackage.id,
            packageName: selectedPackage.name,
            examId: ongoingSession.examId ?? selectedExam.examId,
            examName: selectedExam.examName,
          },
        });
        return;
      }
    }

    const questionLimit = selectedExam.examQuestionCount;
    const activeQuestions = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        imageUrl: questions.imageUrl,
        optionA: questions.optionA,
        optionB: questions.optionB,
        optionC: questions.optionC,
        optionD: questions.optionD,
        optionE: questions.optionE,
        correctAnswer: questions.correctAnswer,
        explanation: questions.explanation,
      })
      .from(questions)
      .where(and(eq(questions.isActive, true), eq(questions.examId, selectedExam.examId)))
      .limit(questionLimit);

    if (activeQuestions.length < questionLimit) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: insufficient active questions.",
        metadata: {
          packageId: selectedPackage.id,
          packageName: selectedPackage.name,
          examId: selectedExam.examId,
          examName: selectedExam.examName,
          requiredQuestions: questionLimit,
          availableQuestions: activeQuestions.length,
        },
      });
      res.status(422).json({
        message: `Insufficient active questions for exam ${selectedExam.examName}. Required: ${questionLimit}, available: ${activeQuestions.length}.`,
      });
      return;
    }

    const shuffledQuestions = shuffleArray(activeQuestions);
    const durationMinutes = getExamDurationMinutes(questionLimit);
    const [attemptAggregate] = await db
      .select({ total: count() })
      .from(examSessions)
      .where(
        and(eq(examSessions.userId, userId), eq(examSessions.examId, selectedExam.examId)),
      );
    const attemptNumber = Number(attemptAggregate?.total ?? 0) + 1;
    const payloadMap: ExamPayloadMap = {
      generatedAt: new Date().toISOString(),
      durationMinutes,
      gracePeriodMinutes: EXAM_GRACE_PERIOD_MINUTES,
      questions: shuffledQuestions.map((question, index) =>
        buildQuestionPayload(question as QuestionRow, index + 1),
      ),
    };

    const [createdSession] = await db
      .insert(examSessions)
      .values({
        userId,
        packageId: selectedPackage.id,
        examId: selectedExam.examId,
        attemptNumber,
        startTime: new Date(),
        durationMinutes,
        status: "ongoing",
        payloadMap,
      })
      .returning({
        id: examSessions.id,
        packageId: examSessions.packageId,
        examId: examSessions.examId,
        attemptNumber: examSessions.attemptNumber,
        startTime: examSessions.startTime,
        durationMinutes: examSessions.durationMinutes,
      });

    res.status(201).json({
      message: "Exam started successfully.",
      sessionId: createdSession.id,
      package_id: createdSession.packageId,
      package_name: selectedPackage.name,
      exam_id: createdSession.examId,
      exam_name: selectedExam.examName,
      attempt_number: createdSession.attemptNumber,
      question_count: questionLimit,
      startTime: createdSession.startTime,
      durationMinutes: createdSession.durationMinutes ?? durationMinutes,
      gracePeriodMinutes: EXAM_GRACE_PERIOD_MINUTES,
      questions: toPublicQuestions(payloadMap),
    });

    await logActivity({
      actorUserId: userId,
      actorRole: req.user.role,
      action: "EXAM_START",
      entity: "EXAM_SESSION",
      entityId: createdSession.id,
      status: "success",
      message: "Exam session created.",
      metadata: {
        packageId: selectedPackage.id,
        packageName: selectedPackage.name,
        examId: selectedExam.examId,
        examName: selectedExam.examName,
        questionCount: questionLimit,
      },
    });
  } catch (error) {
    console.error("startExam error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "EXAM_START",
      entity: "EXAM_SESSION",
      status: "failed",
      message: "Exam start failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

type AnswerFlagStatus = "answered" | "doubtful" | "empty";

type CompleteSessionInput = {
  sessionId: number;
  userId: number;
  startTime: Date;
  durationMinutes: number;
  payloadMap: ExamPayloadMap;
};

const normalizeOptionKey = (value: unknown): OptionKey | null => {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (
    normalized === "a" ||
    normalized === "b" ||
    normalized === "c" ||
    normalized === "d" ||
    normalized === "e"
  ) {
    return normalized;
  }
  return null;
};

const normalizeFlagStatus = (value: unknown): AnswerFlagStatus | null => {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();

  if (normalized === "answered" || normalized === "menjawab") {
    return "answered";
  }
  if (normalized === "doubtful" || normalized === "ragu") {
    return "doubtful";
  }
  if (normalized === "empty" || normalized === "kosong") {
    return "empty";
  }
  return null;
};

const getSessionQuestions = (payloadMap: ExamPayloadMap): ExamPayloadQuestion[] =>
  Array.isArray(payloadMap.questions) ? payloadMap.questions : [];

const computeSessionResult = (
  payloadMap: ExamPayloadMap,
  answerRows: Array<{ questionId: number; selectedOption: OptionKey | null }>,
) => {
  const answerMap = new Map<number, OptionKey | null>(
    answerRows.map((item) => [item.questionId, item.selectedOption]),
  );

  const details = getSessionQuestions(payloadMap)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((question) => {
      const selectedOption = answerMap.get(question.questionId) ?? null;
      const originalSelectedOption =
        selectedOption !== null
          ? question.optionMapDisplayedToOriginal[selectedOption]
          : undefined;
      const displayedCorrectAnswer =
        question.optionMapOriginalToDisplayed[question.originalCorrectAnswer] ??
        question.originalCorrectAnswer;
      const isCorrect =
        selectedOption !== null &&
        originalSelectedOption === question.originalCorrectAnswer;

      return {
        questionId: question.questionId,
        order: question.order,
        questionText: question.questionText,
        imageUrl: question.imageUrl ?? null,
        options: question.displayedOptions,
        selectedOption,
        correctAnswer: displayedCorrectAnswer,
        explanation: question.explanation,
        isCorrect,
      };
    });

  const totalQuestions = details.length;
  const correctAnswers = details.filter((item) => item.isCorrect).length;
  const score =
    totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

  return { totalQuestions, correctAnswers, score, details };
};

const completeSession = async (session: CompleteSessionInput) => {
  const answerRows = await db
    .select({
      questionId: examAnswers.questionId,
      selectedOption: examAnswers.selectedOption,
    })
    .from(examAnswers)
    .where(eq(examAnswers.sessionId, session.sessionId));

  const computed = computeSessionResult(session.payloadMap, answerRows);
  const submittedAt = new Date();

  await db
    .update(examSessions)
    .set({
      status: "completed",
      score: computed.score,
      endTime: submittedAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(examSessions.id, session.sessionId),
        eq(examSessions.status, "ongoing"),
      ),
    );

  return {
    sessionId: session.sessionId,
    status: "completed" as const,
    score: computed.score,
    totalQuestions: computed.totalQuestions,
    correctAnswers: computed.correctAnswers,
    startedAt: session.startTime,
    durationMinutes: session.durationMinutes,
    submittedAt,
  };
};

const getOngoingSession = async (userId: number) => {
  const [session] = await db
    .select({
      id: examSessions.id,
      userId: examSessions.userId,
      packageId: examSessions.packageId,
      examId: examSessions.examId,
      attemptNumber: examSessions.attemptNumber,
      startTime: examSessions.startTime,
      durationMinutes: examSessions.durationMinutes,
      payloadMap: examSessions.payloadMap,
    })
    .from(examSessions)
    .where(and(eq(examSessions.userId, userId), eq(examSessions.status, "ongoing")))
    .orderBy(desc(examSessions.startTime))
    .limit(1);

  return session ?? null;
};

export const getCurrentExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const ongoingSession = await getOngoingSession(req.user.userId);
    if (!ongoingSession) {
      res.status(404).json({ message: "No ongoing exam session." });
      return;
    }

    const payloadMap = ongoingSession.payloadMap as ExamPayloadMap;
    const durationMinutes = resolveSessionDurationMinutes(
      payloadMap,
      ongoingSession.durationMinutes,
    );
    if (isSubmitWindowExpired(ongoingSession.startTime, durationMinutes)) {
      const summary = await completeSession({
        sessionId: ongoingSession.id,
        userId: ongoingSession.userId,
        startTime: ongoingSession.startTime,
        durationMinutes,
        payloadMap,
      });
      res.status(409).json({
        message: "Session exceeded exam duration and was auto-submitted.",
        result: summary,
      });
      return;
    }

    const answerRows = await db
      .select({
        questionId: examAnswers.questionId,
        selectedOption: examAnswers.selectedOption,
        flagStatus: examAnswers.flagStatus,
      })
      .from(examAnswers)
      .where(eq(examAnswers.sessionId, ongoingSession.id));

    const catalog = await getExamCatalogSummary(
      ongoingSession.packageId,
      ongoingSession.examId ?? null,
    );

    res.status(200).json({
      sessionId: ongoingSession.id,
      package_id: ongoingSession.packageId,
      package_name: catalog?.name ?? null,
      exam_id: ongoingSession.examId ?? catalog?.examId ?? null,
      exam_name: catalog?.examName ?? null,
      attempt_number: ongoingSession.attemptNumber,
      question_count:
        catalog?.examQuestionCount ?? getSessionQuestions(payloadMap).length,
      startTime: ongoingSession.startTime,
      durationMinutes,
      gracePeriodMinutes: payloadMap.gracePeriodMinutes,
      questions: toPublicQuestions(payloadMap),
      answers: answerRows.map((item) => ({
        question_id: item.questionId,
        mapped_selected_option: item.selectedOption,
        flag_status: item.flagStatus,
      })),
    });
  } catch (error) {
    console.error("getCurrentExam error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const saveExamAnswer = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const ongoingSession = await getOngoingSession(req.user.userId);
    if (!ongoingSession) {
      res.status(404).json({ message: "No ongoing exam session." });
      return;
    }

    const payloadMap = ongoingSession.payloadMap as ExamPayloadMap;
    const durationMinutes = resolveSessionDurationMinutes(
      payloadMap,
      ongoingSession.durationMinutes,
    );

    if (isSubmitWindowExpired(ongoingSession.startTime, durationMinutes)) {
      const summary = await completeSession({
        sessionId: ongoingSession.id,
        userId: ongoingSession.userId,
        startTime: ongoingSession.startTime,
        durationMinutes,
        payloadMap,
      });
      res.status(409).json({
        message: "Session exceeded exam duration and was auto-submitted.",
        result: summary,
      });
      return;
    }

    const body = req.body as {
      question_id?: number;
      mapped_selected_option?: unknown;
      flag_status?: unknown;
    };

    const questionId = Number(body.question_id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      res.status(400).json({ message: "Invalid question_id." });
      return;
    }

    const hasQuestion = getSessionQuestions(payloadMap).some(
      (item) => item.questionId === questionId,
    );
    if (!hasQuestion) {
      res.status(400).json({ message: "Question is not part of this session." });
      return;
    }

    const selectedOption = normalizeOptionKey(body.mapped_selected_option);
    if (
      body.mapped_selected_option !== null &&
      body.mapped_selected_option !== undefined &&
      selectedOption === null
    ) {
      res.status(400).json({ message: "Invalid mapped_selected_option." });
      return;
    }

    const flagStatus =
      normalizeFlagStatus(body.flag_status) ??
      (selectedOption ? "answered" : "empty");

    const [existing] = await db
      .select({ id: examAnswers.id })
      .from(examAnswers)
      .where(
        and(
          eq(examAnswers.sessionId, ongoingSession.id),
          eq(examAnswers.questionId, questionId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(examAnswers)
        .set({
          selectedOption,
          flagStatus,
          updatedAt: new Date(),
        })
        .where(eq(examAnswers.id, existing.id));
    } else {
      await db.insert(examAnswers).values({
        sessionId: ongoingSession.id,
        questionId,
        selectedOption,
        flagStatus,
      });
    }

    res.status(200).json({
      message: "Answer saved.",
      question_id: questionId,
      mapped_selected_option: selectedOption,
      flag_status: flagStatus,
    });
  } catch (error) {
    console.error("saveExamAnswer error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const submitExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const ongoingSession = await getOngoingSession(req.user.userId);

    if (!ongoingSession) {
      res.status(404).json({ message: "No ongoing exam session." });
      return;
    }

    const payloadMap = ongoingSession.payloadMap as ExamPayloadMap;
    const durationMinutes = resolveSessionDurationMinutes(
      payloadMap,
      ongoingSession.durationMinutes,
    );

    const summary = await completeSession({
      sessionId: ongoingSession.id,
      userId: ongoingSession.userId,
      startTime: ongoingSession.startTime,
      durationMinutes,
      payloadMap,
    });
    const catalog = await getExamCatalogSummary(
      ongoingSession.packageId,
      ongoingSession.examId ?? null,
    );

    res.status(200).json({
      sessionId: summary.sessionId,
      package_id: ongoingSession.packageId,
      package_name: catalog?.name ?? null,
      exam_id: ongoingSession.examId ?? catalog?.examId ?? null,
      exam_name: catalog?.examName ?? null,
      attempt_number: ongoingSession.attemptNumber,
      status: summary.status,
      score: summary.score,
      totalQuestions: summary.totalQuestions,
      correctAnswers: summary.correctAnswers,
      durationMinutes: summary.durationMinutes,
    });

    await logActivity({
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: "EXAM_SUBMIT",
      entity: "EXAM_SESSION",
      entityId: summary.sessionId,
      status: "success",
      message: "Exam submitted.",
      metadata: {
        packageId: ongoingSession.packageId,
        packageName: catalog?.name ?? null,
        examId: ongoingSession.examId ?? catalog?.examId ?? null,
        examName: catalog?.examName ?? null,
        score: summary.score,
        correctAnswers: summary.correctAnswers,
        totalQuestions: summary.totalQuestions,
      },
    });
  } catch (error) {
    console.error("submitExam error:", error);
    await logActivity({
      actorUserId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      action: "EXAM_SUBMIT",
      entity: "EXAM_SESSION",
      status: "failed",
      message: "Exam submit failed due to internal server error.",
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

export const getExamResult = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      res.status(400).json({ message: "Invalid sessionId." });
      return;
    }

    const filter =
      req.user.role === "admin"
        ? eq(examSessions.id, sessionId)
        : and(eq(examSessions.id, sessionId), eq(examSessions.userId, req.user.userId));

    const [session] = await db
      .select({
        id: examSessions.id,
        packageId: examSessions.packageId,
        packageName: examPackages.name,
        examId: examSessions.examId,
        examName: packageExams.name,
        attemptNumber: examSessions.attemptNumber,
        startTime: examSessions.startTime,
        durationMinutes: examSessions.durationMinutes,
        endTime: examSessions.endTime,
        status: examSessions.status,
        score: examSessions.score,
        payloadMap: examSessions.payloadMap,
      })
      .from(examSessions)
      .leftJoin(examPackages, eq(examSessions.packageId, examPackages.id))
      .leftJoin(packageExams, eq(examSessions.examId, packageExams.id))
      .where(filter)
      .limit(1);

    if (!session) {
      res.status(404).json({ message: "Exam session not found." });
      return;
    }

    if (session.status !== "completed") {
      res.status(403).json({
        message: "Exam result is available only after session is completed.",
      });
      return;
    }

    const answerRows = await db
      .select({
        questionId: examAnswers.questionId,
        selectedOption: examAnswers.selectedOption,
      })
      .from(examAnswers)
      .where(eq(examAnswers.sessionId, session.id));

    const computed = computeSessionResult(
      session.payloadMap as ExamPayloadMap,
      answerRows,
    );
    const durationMinutes = resolveSessionDurationMinutes(
      session.payloadMap as ExamPayloadMap,
      session.durationMinutes,
    );

    res.status(200).json({
      sessionId: session.id,
      package_id: session.packageId,
      package_name: session.packageName ?? null,
      exam_id: session.examId ?? null,
      exam_name: session.examName ?? null,
      attempt_number: session.attemptNumber ?? null,
      status: session.status,
      score: session.score ?? computed.score,
      totalQuestions: computed.totalQuestions,
      correctAnswers: computed.correctAnswers,
      startedAt: session.startTime,
      durationMinutes,
      submittedAt: session.endTime,
      questions: computed.details,
    });
  } catch (error) {
    console.error("getExamResult error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const listMyExamSessions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const rows = await db
      .select({
        id: examSessions.id,
        packageId: examSessions.packageId,
        packageName: examPackages.name,
        examId: examSessions.examId,
        examName: packageExams.name,
        attemptNumber: examSessions.attemptNumber,
        status: examSessions.status,
        score: examSessions.score,
        startTime: examSessions.startTime,
        durationMinutes: examSessions.durationMinutes,
        endTime: examSessions.endTime,
        payloadMap: examSessions.payloadMap,
      })
      .from(examSessions)
      .leftJoin(examPackages, eq(examSessions.packageId, examPackages.id))
      .leftJoin(packageExams, eq(examSessions.examId, packageExams.id))
      .where(eq(examSessions.userId, req.user.userId))
      .orderBy(desc(examSessions.startTime), desc(examSessions.id));

    res.status(200).json(
      rows.map((row) => {
        const payloadMap = row.payloadMap as ExamPayloadMap;
        const durationMinutes = resolveSessionDurationMinutes(
          payloadMap,
          row.durationMinutes,
        );
        return {
          session_id: row.id,
          package_id: row.packageId,
          package_name: row.packageName ?? null,
          exam_id: row.examId ?? null,
          exam_name: row.examName ?? null,
          attempt_number: row.attemptNumber,
          status: row.status,
          score: row.score ?? 0,
          total_questions: getSessionQuestions(payloadMap).length,
          duration_minutes: durationMinutes,
          start_time: row.startTime,
          end_time: row.endTime,
        };
      }),
    );
  } catch (error) {
    console.error("listMyExamSessions error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
