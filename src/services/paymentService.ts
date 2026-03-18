import { randomInt } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
} from "drizzle-orm";

import { db } from "../config/db.js";
import { syncDefaultExamPackages } from "../db/defaultPackages.js";
import {
  examPackages,
  examSessions,
  paymentEventLogs,
  transactions,
  userPackageAccesses,
  users,
} from "../db/schema.js";
import {
  MidtransHttpError,
  createMidtransSnapTransaction,
  getMidtransTransactionStatus,
  mapMidtransStatusToTransactionStatus,
} from "./midtransService.js";
import {
  PaymentHubHttpError,
  buildSyntheticMidtransPayloadFromPaymentHub,
  createPaymentHubTransaction,
  getPaymentHubTransactionStatus,
  isPaymentHubMode,
} from "./paymentHubService.js";
import {
  deactivatePackageAccessForTransaction,
  grantPackageAccessForTransaction,
} from "./packageAccess.js";
import {
  isPaidTransactionStatus,
  resolveTransactionStatusTransition,
  toClientTransactionStatus,
  type LocalTransactionStatus,
} from "../utils/transactionStatus.js";

const DEFAULT_PAYMENT_METHOD = "gopay";

const PAYMENT_METHODS = new Set([
  "gopay",
  "bank_transfer",
]);

type TransactionViewer = "user" | "admin";

type TransactionSummaryRow = {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  packageId: number;
  packageName: string;
  packageDescription: string;
  packagePrice: number;
  sessionLimit: number | null;
  validityDays: number | null;
  orderCode: string | null;
  provider: string;
  status: string;
  grossAmount: number;
  currency: string;
  paymentMethod: string | null;
  paymentType: string | null;
  midtransTransactionId: string | null;
  midtransOrderId: string | null;
  midtransTransactionStatus: string | null;
  fraudStatus: string | null;
  statusCode: string | null;
  statusMessage: string | null;
  snapToken: string | null;
  snapRedirectUrl: string | null;
  paymentGatewayUrl: string;
  rawResponse: Record<string, unknown>;
  expiresAt: Date | null;
  lastStatusAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PaymentEventRow = {
  id: number;
  source: string;
  provider: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export class PaymentServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaymentServiceError";
    this.status = status;
  }
}

const nowPlusHours = (hours: number): Date =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

const generateOrderCode = (userId: number, packageId: number): string =>
  `CBT-${userId}-${packageId}-${Date.now()}-${randomInt(1000, 9999)}`;

const normalizePaymentMethod = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_PAYMENT_METHOD;
  }

  return PAYMENT_METHODS.has(normalized) ? normalized : null;
};

const parseMaybeDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const recordPaymentEvent = async (input: {
  transactionId: number;
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
}) => {
  await db.insert(paymentEventLogs).values({
    transactionId: input.transactionId,
    source: input.source,
    provider: "midtrans",
    eventType: input.eventType,
    payload: input.payload,
  });
};

const findReusablePendingTransaction = async (input: {
  userId: number;
  packageId: number;
  paymentMethod: string;
}) => {
  const rows = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      expiresAt: transactions.expiresAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, input.userId),
        eq(transactions.packageId, input.packageId),
        eq(transactions.provider, "midtrans"),
        eq(transactions.paymentMethod, input.paymentMethod),
        inArray(transactions.status, ["created", "pending", "challenge"]),
        or(isNull(transactions.expiresAt), gt(transactions.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(1);

  return rows[0] ?? null;
};

const findActivePackageAccess = async (input: {
  userId: number;
  packageId: number;
}) => {
  const rows = await db
    .select({
      id: userPackageAccesses.id,
      status: userPackageAccesses.status,
      expiresAt: userPackageAccesses.expiresAt,
    })
    .from(userPackageAccesses)
    .where(
      and(
        eq(userPackageAccesses.userId, input.userId),
        eq(userPackageAccesses.packageId, input.packageId),
        eq(userPackageAccesses.status, "active"),
        or(
          isNull(userPackageAccesses.expiresAt),
          gt(userPackageAccesses.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

const getTransactionSummaryById = async (
  transactionId: number,
): Promise<TransactionSummaryRow | null> => {
  const rows = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      userName: users.name,
      userEmail: users.email,
      packageId: transactions.packageId,
      packageName: examPackages.name,
      packageDescription: examPackages.description,
      packagePrice: examPackages.price,
      sessionLimit: examPackages.sessionLimit,
      validityDays: examPackages.validityDays,
      orderCode: transactions.orderCode,
      provider: transactions.provider,
      status: transactions.status,
      grossAmount: transactions.grossAmount,
      currency: transactions.currency,
      paymentMethod: transactions.paymentMethod,
      paymentType: transactions.paymentType,
      midtransTransactionId: transactions.midtransTransactionId,
      midtransOrderId: transactions.midtransOrderId,
      midtransTransactionStatus: transactions.midtransTransactionStatus,
      fraudStatus: transactions.fraudStatus,
      statusCode: transactions.statusCode,
      statusMessage: transactions.statusMessage,
      snapToken: transactions.snapToken,
      snapRedirectUrl: transactions.snapRedirectUrl,
      paymentGatewayUrl: transactions.paymentGatewayUrl,
      rawResponse: transactions.rawResponse,
      expiresAt: transactions.expiresAt,
      lastStatusAt: transactions.lastStatusAt,
      paidAt: transactions.paidAt,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .innerJoin(examPackages, eq(transactions.packageId, examPackages.id))
    .innerJoin(users, eq(transactions.userId, users.id))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  return rows[0] ?? null;
};

const getTransactionSummaryByOrderCode = async (
  orderCode: string,
): Promise<TransactionSummaryRow | null> => {
  const rows = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      userName: users.name,
      userEmail: users.email,
      packageId: transactions.packageId,
      packageName: examPackages.name,
      packageDescription: examPackages.description,
      packagePrice: examPackages.price,
      sessionLimit: examPackages.sessionLimit,
      validityDays: examPackages.validityDays,
      orderCode: transactions.orderCode,
      provider: transactions.provider,
      status: transactions.status,
      grossAmount: transactions.grossAmount,
      currency: transactions.currency,
      paymentMethod: transactions.paymentMethod,
      paymentType: transactions.paymentType,
      midtransTransactionId: transactions.midtransTransactionId,
      midtransOrderId: transactions.midtransOrderId,
      midtransTransactionStatus: transactions.midtransTransactionStatus,
      fraudStatus: transactions.fraudStatus,
      statusCode: transactions.statusCode,
      statusMessage: transactions.statusMessage,
      snapToken: transactions.snapToken,
      snapRedirectUrl: transactions.snapRedirectUrl,
      paymentGatewayUrl: transactions.paymentGatewayUrl,
      rawResponse: transactions.rawResponse,
      expiresAt: transactions.expiresAt,
      lastStatusAt: transactions.lastStatusAt,
      paidAt: transactions.paidAt,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .innerJoin(examPackages, eq(transactions.packageId, examPackages.id))
    .innerJoin(users, eq(transactions.userId, users.id))
    .where(eq(transactions.orderCode, orderCode))
    .limit(1);

  return rows[0] ?? null;
};

const getPaymentEvents = async (
  transactionId: number,
): Promise<PaymentEventRow[]> =>
  db
    .select({
      id: paymentEventLogs.id,
      source: paymentEventLogs.source,
      provider: paymentEventLogs.provider,
      eventType: paymentEventLogs.eventType,
      payload: paymentEventLogs.payload,
      createdAt: paymentEventLogs.createdAt,
    })
    .from(paymentEventLogs)
    .where(eq(paymentEventLogs.transactionId, transactionId))
    .orderBy(asc(paymentEventLogs.createdAt), asc(paymentEventLogs.id));

const getSessionsUsed = async (userId: number, packageId: number): Promise<number> => {
  const [aggregate] = await db
    .select({ total: count() })
    .from(examSessions)
    .where(
      and(
        eq(examSessions.userId, userId),
        eq(examSessions.packageId, packageId),
      ),
    );

  return Number(aggregate?.total ?? 0);
};

const getAccessSummary = async (userId: number, packageId: number) => {
  const rows = await db
    .select({
      id: userPackageAccesses.id,
      status: userPackageAccesses.status,
      grantedAt: userPackageAccesses.grantedAt,
      activatedAt: userPackageAccesses.activatedAt,
      expiresAt: userPackageAccesses.expiresAt,
    })
    .from(userPackageAccesses)
    .where(
      and(
        eq(userPackageAccesses.userId, userId),
        eq(userPackageAccesses.packageId, packageId),
      ),
    )
    .limit(1);

  const access = rows[0] ?? null;
  if (!access) {
    return null;
  }

  if (
    access.status === "active" &&
    access.expiresAt &&
    access.expiresAt.getTime() <= Date.now()
  ) {
    return { ...access, status: "expired" as const };
  }

  return access;
};

const serializeTransaction = async (
  row: TransactionSummaryRow,
  options: {
    viewer: TransactionViewer;
    includeEvents?: boolean;
  },
) => {
  const [access, sessionsUsed, events] = await Promise.all([
    getAccessSummary(row.userId, row.packageId),
    getSessionsUsed(row.userId, row.packageId),
    options.includeEvents ? getPaymentEvents(row.id) : Promise.resolve([]),
  ]);

  return {
    id: row.id,
    user_id: row.userId,
    user_name: row.userName,
    user_email: row.userEmail,
    package_id: row.packageId,
    package_name: row.packageName,
    package_description: row.packageDescription,
    package_price: row.packagePrice,
    session_limit: row.sessionLimit,
    validity_days: row.validityDays,
    order_code: row.orderCode,
    provider: row.provider,
    status: toClientTransactionStatus(row.status),
    gross_amount: row.grossAmount,
    currency: row.currency,
    payment_method: row.paymentMethod,
    payment_type: row.paymentType,
    payment_status_detail: row.midtransTransactionStatus,
    payment_page_url: row.paymentGatewayUrl,
    midtrans_transaction_id: row.midtransTransactionId,
    midtrans_order_id: row.midtransOrderId,
    midtrans_transaction_status: row.midtransTransactionStatus,
    fraud_status: row.fraudStatus,
    status_code: row.statusCode,
    status_message: row.statusMessage,
    payment_gateway_url: row.paymentGatewayUrl,
    snap_redirect_url: row.snapRedirectUrl,
    snap_token: options.viewer === "admin" ? row.snapToken : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    paid_at: row.paidAt,
    expires_at: row.expiresAt,
    last_status_at: row.lastStatusAt,
    access_status: access?.status ?? "inactive",
    granted_at: access?.grantedAt ?? null,
    activated_at: access?.activatedAt ?? null,
    access_expires_at: access?.expiresAt ?? null,
    sessions_used: sessionsUsed,
    events: events.map((event) => ({
      id: event.id,
      source: event.source,
      provider: event.provider,
      event_type: event.eventType,
      payload: event.payload,
      created_at: event.createdAt,
    })),
  };
};

const updateTransactionFromMidtransPayload = async (input: {
  transactionId: number;
  payload: Record<string, unknown>;
  source: string;
}): Promise<ReturnType<typeof getTransactionDetailById>> => {
  const current = await getTransactionSummaryById(input.transactionId);
  if (!current) {
    return null;
  }

  const nextStatus = mapMidtransStatusToTransactionStatus(input.payload);
  const resolvedStatus = resolveTransactionStatusTransition(
    current.status,
    nextStatus,
  );
  const now = new Date();
  const expiresAt =
    parseMaybeDate(input.payload.expiry_time) ?? current.expiresAt;
  const paidAt = isPaidTransactionStatus(resolvedStatus)
    ? current.paidAt ?? now
    : current.paidAt;

  await db
    .update(transactions)
    .set({
      status: resolvedStatus,
      paymentType:
        typeof input.payload.payment_type === "string"
          ? input.payload.payment_type
          : current.paymentType,
      midtransTransactionId:
        typeof input.payload.transaction_id === "string"
          ? input.payload.transaction_id
          : current.midtransTransactionId,
      midtransOrderId:
        typeof input.payload.order_id === "string"
          ? input.payload.order_id
          : current.midtransOrderId ?? current.orderCode,
      midtransTransactionStatus:
        typeof input.payload.transaction_status === "string"
          ? input.payload.transaction_status
          : current.midtransTransactionStatus,
      fraudStatus:
        typeof input.payload.fraud_status === "string"
          ? input.payload.fraud_status
          : current.fraudStatus,
      statusCode:
        typeof input.payload.status_code === "string"
          ? input.payload.status_code
          : current.statusCode,
      statusMessage:
        typeof input.payload.status_message === "string"
          ? input.payload.status_message
          : current.statusMessage,
      rawResponse: input.payload,
      expiresAt,
      lastStatusAt: now,
      paidAt,
      updatedAt: now,
    })
    .where(eq(transactions.id, input.transactionId));

  await recordPaymentEvent({
    transactionId: input.transactionId,
    source: input.source,
    eventType: "status_update",
    payload: input.payload,
  });

  if (isPaidTransactionStatus(resolvedStatus)) {
    await grantPackageAccessForTransaction(input.transactionId);
  }

  if (resolvedStatus === "refunded") {
    await deactivatePackageAccessForTransaction(input.transactionId);
  }

  return getTransactionDetailById(input.transactionId, "admin", true);
};

export const createTransactionOrder = async (input: {
  userId: number;
  packageId: number;
  paymentMethod?: unknown;
}) => {
  await syncDefaultExamPackages();

  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  if (input.paymentMethod !== undefined && paymentMethod === null) {
    throw new PaymentServiceError(
      "Unsupported payment_method. Allowed values: gopay, bank_transfer.",
      400,
    );
  }

  const [user, selectedPackage] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: examPackages.id,
        name: examPackages.name,
        description: examPackages.description,
        price: examPackages.price,
        isActive: examPackages.isActive,
      })
      .from(examPackages)
      .where(eq(examPackages.id, input.packageId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!user) {
    throw new PaymentServiceError("User not found.", 404);
  }

  if (!selectedPackage || !selectedPackage.isActive) {
    throw new PaymentServiceError("Exam package not found.", 404);
  }

  const [activeAccess, reusablePending] = await Promise.all([
    selectedPackage.price > 0
      ? findActivePackageAccess({
          userId: input.userId,
          packageId: input.packageId,
        })
      : Promise.resolve(null),
    selectedPackage.price > 0
      ? findReusablePendingTransaction({
          userId: input.userId,
          packageId: input.packageId,
          paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
        })
      : Promise.resolve(null),
  ]);

  if (activeAccess && selectedPackage.price > 0) {
    throw new PaymentServiceError(
      "Paket ini sudah aktif di akun Anda.",
      409,
    );
  }

  if (reusablePending) {
    const detail = await getTransactionDetailById(
      reusablePending.id,
      "user",
      false,
      input.userId,
    );
    if (detail) {
      return detail;
    }
  }

  if (selectedPackage.price === 0) {
    const [created] = await db
      .insert(transactions)
      .values({
        userId: input.userId,
        packageId: input.packageId,
        provider: "manual",
        status: "paid",
        grossAmount: 0,
        currency: "IDR",
        orderCode: generateOrderCode(input.userId, input.packageId),
        statusMessage: "Free package activated automatically.",
        paidAt: new Date(),
        lastStatusAt: new Date(),
      })
      .returning({ id: transactions.id });

    await grantPackageAccessForTransaction(created.id);
    await recordPaymentEvent({
      transactionId: created.id,
      source: "create",
      eventType: "free_package_activation",
      payload: {
        package_id: input.packageId,
        package_name: selectedPackage.name,
      },
    });

    const detail = await getTransactionDetailById(
      created.id,
      "user",
      false,
      input.userId,
    );
    if (!detail) {
      throw new PaymentServiceError("Failed to load created transaction.", 500);
    }
    return detail;
  }

  const orderCode = generateOrderCode(input.userId, input.packageId);
  const expiresAt = nowPlusHours(24);

  const [created] = await db
    .insert(transactions)
    .values({
      userId: input.userId,
      packageId: input.packageId,
      orderCode,
      provider: "midtrans",
      status: "created",
      grossAmount: selectedPackage.price,
      currency: "IDR",
      paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
      paymentGatewayUrl: "",
      expiresAt,
      lastStatusAt: new Date(),
      rawResponse: {
        package_name: selectedPackage.name,
        package_price: selectedPackage.price,
      },
    })
    .returning({ id: transactions.id });

  const isHubMode = isPaymentHubMode();

  try {
    if (isHubMode) {
      const hub = await createPaymentHubTransaction({
        transactionId: created.id,
        orderCode,
        grossAmount: selectedPackage.price,
        paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
        item: {
          id: selectedPackage.id,
          name: selectedPackage.name,
          price: selectedPackage.price,
          description: selectedPackage.description,
        },
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
      });

      const syntheticPayload = buildSyntheticMidtransPayloadFromPaymentHub(
        {
          external_reference: orderCode,
          transaction_status: hub.transactionStatus,
          provider_transaction_status: hub.providerTransactionStatus,
          payment_type: hub.paymentType,
          fraud_status: hub.fraudStatus,
          midtrans_transaction_id: hub.midtransTransactionId,
          gross_amount: hub.grossAmount,
          provider_status_code: hub.providerStatusCode,
          provider_status_message: hub.providerStatusMessage,
          expired_at: hub.expiredAt,
        },
        orderCode,
      );

      await db
        .update(transactions)
        .set({
          provider: "midtrans",
          status: mapMidtransStatusToTransactionStatus(syntheticPayload),
          paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
          paymentType: hub.paymentType ?? paymentMethod ?? DEFAULT_PAYMENT_METHOD,
          snapToken: hub.snapToken,
          snapRedirectUrl: hub.snapRedirectUrl,
          paymentGatewayUrl: hub.snapRedirectUrl ?? "",
          midtransTransactionId: hub.midtransTransactionId,
          midtransOrderId: hub.orderId,
          midtransTransactionStatus:
            typeof syntheticPayload.transaction_status === "string"
              ? syntheticPayload.transaction_status
              : null,
          fraudStatus: hub.fraudStatus,
          statusCode:
            typeof syntheticPayload.status_code === "string"
              ? syntheticPayload.status_code
              : null,
          statusMessage:
            hub.providerStatusMessage ?? "Payment created via payment hub.",
          rawResponse: hub.raw,
          expiresAt: parseMaybeDate(syntheticPayload.expiry_time) ?? expiresAt,
          lastStatusAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, created.id));

      await recordPaymentEvent({
        transactionId: created.id,
        source: "create",
        eventType: "payment_hub_transaction_created",
        payload: {
          order_code: orderCode,
          payment_method: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
          payment_hub: hub.raw,
        },
      });
    } else {
      const snap = await createMidtransSnapTransaction({
        orderCode,
        grossAmount: selectedPackage.price,
        paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
        item: {
          id: selectedPackage.id,
          name: selectedPackage.name,
          price: selectedPackage.price,
          description: selectedPackage.description,
        },
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
      });

      await db
        .update(transactions)
        .set({
          provider: "midtrans",
          status: "pending",
          paymentMethod: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
          snapToken: snap.token,
          snapRedirectUrl: snap.redirectUrl,
          paymentGatewayUrl: snap.redirectUrl,
          midtransOrderId: orderCode,
          rawResponse: snap.raw,
          expiresAt,
          lastStatusAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, created.id));

      await recordPaymentEvent({
        transactionId: created.id,
        source: "create",
        eventType: "snap_transaction_created",
        payload: {
          order_code: orderCode,
          payment_method: paymentMethod ?? DEFAULT_PAYMENT_METHOD,
          snap: snap.raw,
        },
      });
    }
  } catch (error) {
    const upstreamPayload =
      (error instanceof MidtransHttpError || error instanceof PaymentHubHttpError) &&
      error.payload &&
      typeof error.payload === "object"
        ? (error.payload as Record<string, unknown>)
        : null;
    const errorMessage =
      error instanceof Error
        ? error.message
        : isHubMode
          ? "Failed to create payment hub transaction."
          : "Failed to create Midtrans transaction.";

    await db
      .update(transactions)
      .set({
        status: "failed",
        statusMessage: errorMessage,
        rawResponse: upstreamPayload ?? {
          error: errorMessage,
        },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, created.id));

    await recordPaymentEvent({
      transactionId: created.id,
      source: "create",
      eventType: isHubMode
        ? "payment_hub_transaction_failed"
        : "snap_transaction_failed",
      payload: {
        error: errorMessage,
        detail: upstreamPayload,
      },
    });

    throw new PaymentServiceError(
      errorMessage,
      error instanceof MidtransHttpError || error instanceof PaymentHubHttpError
        ? 502
        : 500,
    );
  }

  const detail = await getTransactionDetailById(
    created.id,
    "user",
    false,
    input.userId,
  );
  if (!detail) {
    throw new PaymentServiceError("Failed to load created transaction.", 500);
  }

  return detail;
};

export const getTransactionDetailById = async (
  transactionId: number,
  viewer: TransactionViewer,
  includeEvents = false,
  ownerUserId?: number,
) => {
  const row = await getTransactionSummaryById(transactionId);
  if (!row) {
    return null;
  }

  if (viewer === "user" && row.userId !== ownerUserId) {
    return null;
  }

  return serializeTransaction(row, {
    viewer,
    includeEvents,
  });
};

export const getTransactionDetailByOrderCode = async (
  orderCode: string,
  viewer: TransactionViewer,
  includeEvents = false,
  ownerUserId?: number,
) => {
  const row = await getTransactionSummaryByOrderCode(orderCode);
  if (!row) {
    return null;
  }

  if (viewer === "user" && row.userId !== ownerUserId) {
    return null;
  }

  return serializeTransaction(row, {
    viewer,
    includeEvents,
  });
};

export const applyMidtransNotification = async (
  payload: Record<string, unknown>,
  source: string,
) => {
  const orderCode =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";

  if (!orderCode) {
    throw new PaymentServiceError("Missing order_id in Midtrans payload.", 400);
  }

  const current = await getTransactionSummaryByOrderCode(orderCode);
  if (!current) {
    return null;
  }

  return updateTransactionFromMidtransPayload({
    transactionId: current.id,
    payload,
    source,
  });
};

export const applyPaymentHubNotification = async (
  payload: Record<string, unknown>,
  source: string,
) => {
  const syntheticPayload = buildSyntheticMidtransPayloadFromPaymentHub(payload);

  return applyMidtransNotification(syntheticPayload, source);
};

export const syncTransactionStatusFromMidtrans = async (input: {
  transactionId: number;
  requesterUserId?: number;
  viewer: TransactionViewer;
  source: string;
}) => {
  const current = await getTransactionSummaryById(input.transactionId);
  if (!current) {
    throw new PaymentServiceError("Transaction not found.", 404);
  }

  if (input.viewer === "user" && current.userId !== input.requesterUserId) {
    throw new PaymentServiceError("Transaction not found.", 404);
  }

  if (current.provider !== "midtrans" || !current.orderCode) {
    const detail = await getTransactionDetailById(
      current.id,
      input.viewer,
      input.viewer === "admin",
      input.requesterUserId,
    );
    if (!detail) {
      throw new PaymentServiceError("Transaction not found.", 404);
    }
    return detail;
  }

  const hubMode = isPaymentHubMode();
  if (hubMode && !current.midtransOrderId) {
    throw new PaymentServiceError("Payment hub order reference is missing.", 404);
  }

  try {
    const payload = hubMode
      ? buildSyntheticMidtransPayloadFromPaymentHub(
          await getPaymentHubTransactionStatus(current.midtransOrderId as string, {
            refresh: true,
          }),
          current.orderCode,
        )
      : await getMidtransTransactionStatus(current.orderCode);

    return updateTransactionFromMidtransPayload({
      transactionId: current.id,
      payload,
      source: input.source,
    });
  } catch (error) {
    if (
      (error instanceof MidtransHttpError || error instanceof PaymentHubHttpError) &&
      error.status === 404
    ) {
      await recordPaymentEvent({
        transactionId: current.id,
        source: input.source,
        eventType: "status_check_not_found",
        payload: {
          order_code: current.orderCode,
          upstream_order_id: hubMode ? current.midtransOrderId : current.orderCode,
          message: hubMode
            ? "Payment hub status endpoint returned 404."
            : "Midtrans status endpoint returned 404. This can happen before a payment method is selected.",
        },
      });

      const detail = await getTransactionDetailById(
        current.id,
        input.viewer,
        input.viewer === "admin",
        input.requesterUserId,
      );
      if (!detail) {
        throw new PaymentServiceError("Transaction not found.", 404);
      }
      return detail;
    }

    throw new PaymentServiceError(
      error instanceof Error
        ? error.message
        : hubMode
          ? "Failed to sync transaction status from payment hub."
          : "Failed to sync transaction status.",
      error instanceof MidtransHttpError || error instanceof PaymentHubHttpError
        ? 502
        : 500,
    );
  }
};

export const listAdminTransactions = async (filters?: {
  status?: string;
  search?: string;
}) => {
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(transactions.status, filters.status as LocalTransactionStatus));
  }

  const rows = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      userName: users.name,
      packageId: transactions.packageId,
      packageName: examPackages.name,
      orderCode: transactions.orderCode,
      status: transactions.status,
      grossAmount: transactions.grossAmount,
      paymentMethod: transactions.paymentMethod,
      paymentType: transactions.paymentType,
      midtransTransactionStatus: transactions.midtransTransactionStatus,
      paymentGatewayUrl: transactions.paymentGatewayUrl,
      paidAt: transactions.paidAt,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .innerJoin(users, eq(transactions.userId, users.id))
    .innerJoin(examPackages, eq(transactions.packageId, examPackages.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.createdAt), desc(transactions.id));

  const normalizedSearch = filters?.search?.trim().toLowerCase();

  return rows
    .filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        String(row.id).includes(normalizedSearch) ||
        String(row.userId).includes(normalizedSearch) ||
        row.userName.toLowerCase().includes(normalizedSearch) ||
        row.packageName.toLowerCase().includes(normalizedSearch) ||
        String(row.orderCode ?? "").toLowerCase().includes(normalizedSearch)
      );
    })
    .map((row) => ({
      id: row.id,
      user_id: row.userId,
      user_name: row.userName,
      package_id: row.packageId,
      package_name: row.packageName,
      order_code: row.orderCode,
      status: toClientTransactionStatus(row.status),
      gross_amount: row.grossAmount,
      payment_method: row.paymentMethod,
      payment_type: row.paymentType,
      midtrans_transaction_status: row.midtransTransactionStatus,
      payment_gateway_url: row.paymentGatewayUrl,
      paid_at: row.paidAt,
      created_at: row.createdAt,
    }));
};
