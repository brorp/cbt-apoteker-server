import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export const examPurposeEnum = pgEnum("exam_purpose", [
  "ukai",
  "cpns",
  "pppk",
  "other",
]);
export const optionKeyEnum = pgEnum("option_key", ["a", "b", "c", "d", "e"]);
export const examSessionStatusEnum = pgEnum("exam_session_status", [
  "ongoing",
  "completed",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "success",
  "failed",
]);
export const examAnswerFlagStatusEnum = pgEnum("exam_answer_flag_status", [
  "answered",
  "doubtful",
  "empty",
]);
export const activityStatusEnum = pgEnum("activity_status", [
  "success",
  "failed",
]);

export type OptionKey = "a" | "b" | "c" | "d" | "e";

export interface ExamPayloadQuestion {
  questionId: number;
  order: number;
  questionText: string;
  displayedOptions: Record<OptionKey, string>;
  optionMapOriginalToDisplayed: Record<OptionKey, OptionKey>;
  optionMapDisplayedToOriginal: Record<OptionKey, OptionKey>;
  originalCorrectAnswer: OptionKey;
  explanation: string;
}

export interface ExamPayloadMap {
  generatedAt: string;
  durationMinutes: number;
  gracePeriodMinutes: number;
  questions: ExamPayloadQuestion[];
}

export interface ActivityMeta {
  [key: string]: unknown;
}

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  role: userRoleEnum("role").notNull().default("user"),
  name: varchar("name", { length: 150 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  education: varchar("education", { length: 150 }).notNull(),
  schoolOrigin: varchar("school_origin", { length: 255 }).notNull(),
  examPurpose: examPurposeEnum("exam_purpose").notNull(),
  address: text("address").notNull(),
  phone: varchar("phone", { length: 25 }).notNull(),
  targetScore: integer("target_score"),
  isPremium: boolean("is_premium").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  actorRole: userRoleEnum("actor_role"),
  action: varchar("action", { length: 120 }).notNull(),
  entity: varchar("entity", { length: 120 }).notNull(),
  entityId: varchar("entity_id", { length: 120 }),
  status: activityStatusEnum("status").notNull().default("success"),
  message: text("message"),
  metadata: jsonb("metadata").$type<ActivityMeta>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const examPackages = pgTable("exam_packages", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  features: text("features").notNull(),
  questionCount: integer("question_count").notNull().default(50),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").references(() => examPackages.id, {
    onDelete: "set null",
  }),
  questionText: text("question_text").notNull(),
  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  optionD: text("option_d").notNull(),
  optionE: text("option_e").notNull(),
  correctAnswer: optionKeyEnum("correct_answer").notNull(),
  explanation: text("explanation").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  packageId: integer("package_id")
    .notNull()
    .references(() => examPackages.id, { onDelete: "restrict" }),
  status: transactionStatusEnum("status").notNull().default("pending"),
  paymentGatewayUrl: text("payment_gateway_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const examSessions = pgTable("exam_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  packageId: integer("package_id").references(() => examPackages.id, {
    onDelete: "set null",
  }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  status: examSessionStatusEnum("status").notNull().default("ongoing"),
  score: integer("score"),
  payloadMap: jsonb("payload_map").$type<ExamPayloadMap>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const examAnswers = pgTable(
  "exam_answers",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    selectedOption: optionKeyEnum("selected_option"),
    flagStatus: examAnswerFlagStatusEnum("flag_status").notNull().default("empty"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionQuestionUnique: uniqueIndex("exam_answers_session_question_idx").on(
      table.sessionId,
      table.questionId,
    ),
  }),
);
