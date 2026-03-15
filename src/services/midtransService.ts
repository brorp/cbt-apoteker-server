import { createHash } from "node:crypto";

import { getMidtransConfig } from "../config/midtrans.js";
import type { LocalTransactionStatus } from "../utils/transactionStatus.js";

type MidtransNotificationPayload = {
  order_id?: string;
  transaction_id?: string;
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  status_code?: string;
  status_message?: string;
  signature_key?: string;
  gross_amount?: string | number;
  currency?: string;
  expiry_time?: string;
};

type CreateSnapTransactionInput = {
  orderCode: string;
  grossAmount: number;
  paymentMethod?: string | null;
  item: {
    id: number;
    name: string;
    price: number;
    description?: string | null;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
  };
};

type MidtransFetchOptions = {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  useSnapBaseUrl?: boolean;
  overrideNotificationUrl?: string | null;
};

export class MidtransHttpError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "MidtransHttpError";
    this.status = status;
    this.payload = payload;
  }
}

const buildBasicAuthHeader = (serverKey: string): string =>
  `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;

const buildFinishUrl = (orderCode: string): string | null => {
  const { finishUrl } = getMidtransConfig();

  if (!finishUrl) {
    return null;
  }

  const url = new URL(finishUrl);
  url.searchParams.set("order_id", orderCode);
  return url.toString();
};

const midtransFetch = async <T>(
  options: MidtransFetchOptions,
): Promise<T> => {
  const config = getMidtransConfig();
  const baseUrl = options.useSnapBaseUrl ? config.snapBaseUrl : config.apiBaseUrl;
  const headers = new Headers({
    Accept: "application/json",
    Authorization: buildBasicAuthHeader(config.serverKey),
  });

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const overrideNotificationUrl =
    options.overrideNotificationUrl ?? config.notificationUrl;
  if (overrideNotificationUrl) {
    headers.set("X-Override-Notification", overrideNotificationUrl);
  }

  const response = await fetch(`${baseUrl}${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new MidtransHttpError(
      `Midtrans request failed with status ${response.status}.`,
      response.status,
      payload,
    );
  }

  return payload as T;
};

export const createMidtransSnapTransaction = async (
  input: CreateSnapTransactionInput,
): Promise<{
  token: string;
  redirectUrl: string;
  raw: Record<string, unknown>;
}> => {
  const enabledPayments = input.paymentMethod ? [input.paymentMethod] : undefined;
  const finishUrl = buildFinishUrl(input.orderCode);

  const raw = await midtransFetch<Record<string, unknown>>({
    method: "POST",
    path: "/snap/v1/transactions",
    useSnapBaseUrl: true,
    body: {
      transaction_details: {
        order_id: input.orderCode,
        gross_amount: input.grossAmount,
      },
      item_details: [
        {
          id: String(input.item.id),
          price: input.item.price,
          quantity: 1,
          name: input.item.name.slice(0, 50),
        },
      ],
      customer_details: {
        first_name: input.customer.name.slice(0, 100),
        email: input.customer.email,
        phone: input.customer.phone,
      },
      enabled_payments: enabledPayments,
      callbacks: finishUrl
        ? {
            finish: finishUrl,
          }
        : undefined,
      page_expiry: {
        duration: 24,
        unit: "hours",
      },
    },
  });

  const token = String(raw.token ?? "");
  const redirectUrl = String(raw.redirect_url ?? "");

  if (!token || !redirectUrl) {
    throw new Error("Midtrans Snap response did not contain token/redirect_url.");
  }

  return {
    token,
    redirectUrl,
    raw,
  };
};

export const getMidtransTransactionStatus = async (
  orderCode: string,
): Promise<Record<string, unknown>> =>
  midtransFetch<Record<string, unknown>>({
    path: `/v2/${encodeURIComponent(orderCode)}/status`,
  });

export const verifyMidtransNotificationSignature = (
  payload: MidtransNotificationPayload,
): boolean => {
  const { serverKey } = getMidtransConfig();
  const signatureKey = payload.signature_key?.trim();
  const orderId = payload.order_id?.trim();
  const statusCode = payload.status_code?.trim();
  const grossAmount = String(payload.gross_amount ?? "").trim();

  if (!signatureKey || !orderId || !statusCode || !grossAmount) {
    return false;
  }

  const generated = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");

  return generated === signatureKey;
};

export const mapMidtransStatusToTransactionStatus = (
  payload: MidtransNotificationPayload,
): LocalTransactionStatus => {
  const transactionStatus = payload.transaction_status?.trim().toLowerCase();
  const fraudStatus = payload.fraud_status?.trim().toLowerCase();

  if (transactionStatus === "capture") {
    return fraudStatus === "challenge" ? "challenge" : "paid";
  }

  if (transactionStatus === "settlement") {
    return "paid";
  }

  if (transactionStatus === "pending") {
    return "pending";
  }

  if (transactionStatus === "cancel") {
    return "cancelled";
  }

  if (transactionStatus === "expire") {
    return "expired";
  }

  if (
    transactionStatus === "deny" ||
    transactionStatus === "failure"
  ) {
    return "failed";
  }

  if (
    transactionStatus === "refund" ||
    transactionStatus === "partial_refund"
  ) {
    return "refunded";
  }

  return "pending";
};
