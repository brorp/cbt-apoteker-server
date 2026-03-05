import { randomInt } from "node:crypto";
import type { Response } from "express";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../config/db.js";
import {
  examAnswers,
  examSessions,
  questions,
  users,
  type ExamPayloadMap,
  type ExamPayloadQuestion,
  type OptionKey,
} from "../db/schema.js";
import type { AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";

const EXAM_QUESTION_LIMIT = 200;
const EXAM_DURATION_MINUTES = 200;
const EXAM_GRACE_PERIOD_MINUTES = 1;
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

type QuestionRow = {
  id: number;
  questionText: string;
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
      options: item.displayedOptions,
    }));

export const getSubmitDeadline = (startTime: Date): Date =>
  new Date(
    startTime.getTime() +
      (EXAM_DURATION_MINUTES + EXAM_GRACE_PERIOD_MINUTES) * 60 * 1000,
  );

export const isSubmitWindowExpired = (
  startTime: Date,
  now: Date = new Date(),
): boolean => now > getSubmitDeadline(startTime);

export const startExam = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
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

    const [currentUser] = await db
      .select({
        id: users.id,
        isPremium: users.isPremium,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

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

    if (!currentUser.isPremium) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start blocked: non-premium user.",
      });
      res.status(403).json({
        message: "Premium account required. Complete payment before starting exam.",
      });
      return;
    }

    const [ongoingSession] = await db
      .select({
        id: examSessions.id,
        startTime: examSessions.startTime,
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

      if (isSubmitWindowExpired(ongoingSession.startTime)) {
        await completeSession({
          sessionId: ongoingSession.id,
          userId: req.user.userId,
          startTime: ongoingSession.startTime,
          payloadMap,
        });
      } else {
        res.status(200).json({
          message: "Ongoing session found.",
          sessionId: ongoingSession.id,
          startTime: ongoingSession.startTime,
          durationMinutes: payloadMap.durationMinutes,
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
        });
        return;
      }
    }

    const activeQuestions = await db
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
      })
      .from(questions)
      .where(eq(questions.isActive, true))
      .limit(EXAM_QUESTION_LIMIT);

    if (activeQuestions.length < EXAM_QUESTION_LIMIT) {
      await logActivity({
        actorUserId: userId,
        actorRole: req.user.role,
        action: "EXAM_START",
        entity: "EXAM_SESSION",
        status: "failed",
        message: "Exam start failed: insufficient active questions.",
        metadata: { availableQuestions: activeQuestions.length },
      });
      res.status(422).json({
        message: `Insufficient active questions. Required: ${EXAM_QUESTION_LIMIT}, available: ${activeQuestions.length}.`,
      });
      return;
    }

    const shuffledQuestions = shuffleArray(activeQuestions);
    const payloadMap: ExamPayloadMap = {
      generatedAt: new Date().toISOString(),
      durationMinutes: EXAM_DURATION_MINUTES,
      gracePeriodMinutes: EXAM_GRACE_PERIOD_MINUTES,
      questions: shuffledQuestions.map((question, index) =>
        buildQuestionPayload(question as QuestionRow, index + 1),
      ),
    };

    const [createdSession] = await db
      .insert(examSessions)
      .values({
        userId,
        startTime: new Date(),
        status: "ongoing",
        payloadMap,
      })
      .returning({
        id: examSessions.id,
        startTime: examSessions.startTime,
      });

    res.status(201).json({
      message: "Exam started successfully.",
      sessionId: createdSession.id,
      startTime: createdSession.startTime,
      durationMinutes: EXAM_DURATION_MINUTES,
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
    submittedAt,
  };
};

const getOngoingSession = async (userId: number) => {
  const [session] = await db
    .select({
      id: examSessions.id,
      userId: examSessions.userId,
      startTime: examSessions.startTime,
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

    if (isSubmitWindowExpired(ongoingSession.startTime)) {
      const summary = await completeSession({
        sessionId: ongoingSession.id,
        userId: ongoingSession.userId,
        startTime: ongoingSession.startTime,
        payloadMap: ongoingSession.payloadMap as ExamPayloadMap,
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

    const payloadMap = ongoingSession.payloadMap as ExamPayloadMap;

    res.status(200).json({
      sessionId: ongoingSession.id,
      startTime: ongoingSession.startTime,
      durationMinutes: payloadMap.durationMinutes,
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

    if (isSubmitWindowExpired(ongoingSession.startTime)) {
      const summary = await completeSession({
        sessionId: ongoingSession.id,
        userId: ongoingSession.userId,
        startTime: ongoingSession.startTime,
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
      const [latestCompleted] = await db
        .select({
          id: examSessions.id,
          score: examSessions.score,
        })
        .from(examSessions)
        .where(
          and(
            eq(examSessions.userId, req.user.userId),
            eq(examSessions.status, "completed"),
          ),
        )
        .orderBy(desc(examSessions.endTime), desc(examSessions.id))
        .limit(1);

      if (!latestCompleted) {
        res.status(404).json({ message: "No ongoing exam session." });
        return;
      }

      const [sessionForTotal] = await db
        .select({ payloadMap: examSessions.payloadMap })
        .from(examSessions)
        .where(eq(examSessions.id, latestCompleted.id))
        .limit(1);

      const totalQuestions = sessionForTotal
        ? getSessionQuestions(sessionForTotal.payloadMap as ExamPayloadMap).length
        : 0;
      const estimatedCorrectAnswers =
        totalQuestions > 0 && latestCompleted.score !== null
          ? Math.round((latestCompleted.score / 100) * totalQuestions)
          : 0;

      res.status(200).json({
        sessionId: latestCompleted.id,
        status: "completed",
        score: latestCompleted.score ?? 0,
        totalQuestions,
        correctAnswers: estimatedCorrectAnswers,
      });
      return;
    }

    const summary = await completeSession({
      sessionId: ongoingSession.id,
      userId: ongoingSession.userId,
      startTime: ongoingSession.startTime,
      payloadMap: ongoingSession.payloadMap as ExamPayloadMap,
    });

    res.status(200).json({
      sessionId: summary.sessionId,
      status: summary.status,
      score: summary.score,
      totalQuestions: summary.totalQuestions,
      correctAnswers: summary.correctAnswers,
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
        startTime: examSessions.startTime,
        endTime: examSessions.endTime,
        status: examSessions.status,
        score: examSessions.score,
        payloadMap: examSessions.payloadMap,
      })
      .from(examSessions)
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

    res.status(200).json({
      sessionId: session.id,
      status: session.status,
      score: session.score ?? computed.score,
      totalQuestions: computed.totalQuestions,
      correctAnswers: computed.correctAnswers,
      startedAt: session.startTime,
      submittedAt: session.endTime,
      questions: computed.details,
    });
  } catch (error) {
    console.error("getExamResult error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
