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
  "persiapan_ukai",
  "persiapan_masuk_apoteker",
  "lainnya",
  "ukai",
  "cpns",
  "pppk",
  "other",
]);
export const userAccountStatusEnum = pgEnum("user_account_status", [
  "active",
  "inactive",
]);
export const optionKeyEnum = pgEnum("option_key", ["a", "b", "c", "d", "e"]);
export const examSessionStatusEnum = pgEnum("exam_session_status", [
  "ongoing",
  "completed",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "created",
  "pending",
  "paid",
  "success",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "challenge",
]);
export const examAnswerFlagStatusEnum = pgEnum("exam_answer_flag_status", [
  "answered",
  "doubtful",
  "empty",
]);
export const packageAccessStatusEnum = pgEnum("package_access_status", [
  "active",
  "inactive",
  "expired",
]);
export const questionReportStatusEnum = pgEnum("question_report_status", [
  "open",
  "replied",
  "closed",
]);
export const questionReportAuthorRoleEnum = pgEnum(
  "question_report_author_role",
  ["user", "admin"],
);
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
  accountStatus: userAccountStatusEnum("account_status").notNull().default("active"),
  statusNote: text("status_note"),
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
  sessionLimit: integer("session_limit"),
  validityDays: integer("validity_days"),
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
  orderCode: varchar("order_code", { length: 64 }),
  provider: varchar("provider", { length: 32 }).notNull().default("manual"),
  status: transactionStatusEnum("status").notNull().default("created"),
  grossAmount: integer("gross_amount").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default("IDR"),
  paymentMethod: varchar("payment_method", { length: 64 }),
  paymentType: varchar("payment_type", { length: 64 }),
  midtransTransactionId: varchar("midtrans_transaction_id", { length: 128 }),
  midtransOrderId: varchar("midtrans_order_id", { length: 128 }),
  midtransTransactionStatus: varchar("midtrans_transaction_status", { length: 64 }),
  fraudStatus: varchar("fraud_status", { length: 64 }),
  statusCode: varchar("status_code", { length: 16 }),
  statusMessage: text("status_message"),
  snapToken: text("snap_token"),
  snapRedirectUrl: text("snap_redirect_url"),
  paymentGatewayUrl: text("payment_gateway_url").notNull().default(""),
  rawResponse: jsonb("raw_response")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastStatusAt: timestamp("last_status_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
},
  (table) => ({
    orderCodeUnique: uniqueIndex("transactions_order_code_idx").on(table.orderCode),
    midtransOrderIdUnique: uniqueIndex("transactions_midtrans_order_id_idx").on(
      table.midtransOrderId,
    ),
  }),
);

export const paymentEventLogs = pgTable("payment_event_logs", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 32 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("midtrans"),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: jsonb("payload")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userPackageAccesses = pgTable(
  "user_package_accesses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: integer("package_id")
      .notNull()
      .references(() => examPackages.id, { onDelete: "restrict" }),
    transactionId: integer("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    status: packageAccessStatusEnum("status").notNull().default("active"),
    source: varchar("source", { length: 64 }).notNull().default("transaction"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userPackageUnique: uniqueIndex("user_package_accesses_user_package_idx").on(
      table.userId,
      table.packageId,
    ),
  }),
);

export const examSessions = pgTable("exam_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  packageId: integer("package_id").references(() => examPackages.id, {
    onDelete: "set null",
  }),
  attemptNumber: integer("attempt_number").notNull().default(1),
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

export const questionReports = pgTable("question_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  sessionId: integer("session_id").references(() => examSessions.id, {
    onDelete: "set null",
  }),
  packageId: integer("package_id").references(() => examPackages.id, {
    onDelete: "set null",
  }),
  status: questionReportStatusEnum("status").notNull().default("open"),
  reportText: text("report_text").notNull(),
  lastAdminReplyAt: timestamp("last_admin_reply_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const questionReportReplies = pgTable("question_report_replies", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => questionReports.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  authorRole: questionReportAuthorRoleEnum("author_role").notNull(),
  messageText: text("message_text").notNull(),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
