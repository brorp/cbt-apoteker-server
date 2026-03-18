import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const DEFAULT_SITE_CODE = "KSUKAI";

export class PaymentHubHttpError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "PaymentHubHttpError";
    this.status = status;
    this.payload = payload;
  }
}

type PaymentHubEnvelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type PaymentHubCreateData = {
  order_id?: string;
  snap_token?: string | null;
  snap_redirect_url?: string | null;
  payment?: Record<string, unknown>;
};

type PaymentHubDetailData = {
  order_id?: string;
  payment?: Record<string, unknown>;
};

type PaymentHubCreateInput = {
  transactionId: number;
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

type PaymentHubStatusSource = {
  external_reference?: unknown;
  externalReference?: unknown;
  transaction_status?: unknown;
  transactionStatus?: unknown;
  provider_transaction_status?: unknown;
  providerTransactionStatus?: unknown;
  payment_type?: unknown;
  paymentType?: unknown;
  fraud_status?: unknown;
  fraudStatus?: unknown;
  midtrans_transaction_id?: unknown;
  midtransTransactionId?: unknown;
  gross_amount?: unknown;
  grossAmount?: unknown;
  provider_status_code?: unknown;
  providerStatusCode?: unknown;
  provider_status_message?: unknown;
  providerStatusMessage?: unknown;
  status_code?: unknown;
  statusCode?: unknown;
  status_message?: unknown;
  statusMessage?: unknown;
  expired_at?: unknown;
  expiredAt?: unknown;
};

export type PaymentHubSnapshot = {
  orderId: string;
  externalReference: string | null;
  transactionStatus: string;
  providerTransactionStatus: string | null;
  paymentType: string | null;
  fraudStatus: string | null;
  midtransTransactionId: string | null;
  grossAmount: string;
  providerStatusCode: string | null;
  providerStatusMessage: string | null;
  snapToken: string | null;
  snapRedirectUrl: string | null;
  expiredAt: string | null;
  raw: Record<string, unknown>;
};

const normalizeMode = (): string =>
  String(process.env.PAYMENT_GATEWAY_MODE ?? "midtrans").trim().toLowerCase();

export const isPaymentHubMode = (): boolean => normalizeMode() === "payment_hub";

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PaymentHubHttpError(`${name} is not configured.`, 500, {
      env: name,
    });
  }

  return value;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, "");

const getPaymentHubBaseUrl = (): string =>
  normalizeBaseUrl(getRequiredEnv("PAYMENT_HUB_BASE_URL"));

const getSiteCode = (): string =>
  process.env.PAYMENT_HUB_SITE_CODE?.trim() || DEFAULT_SITE_CODE;

const getSiteKey = (): string => getRequiredEnv("PAYMENT_HUB_SITE_KEY");
const getCallbackSecret = (): string => getRequiredEnv("PAYMENT_HUB_CALLBACK_SECRET");
const getFrontendBaseUrl = (): string =>
  normalizeBaseUrl(getRequiredEnv("KSUKAI_FRONTEND_BASE_URL"));
const getApiBaseUrl = (): string =>
  normalizeBaseUrl(getRequiredEnv("KSUKAI_API_BASE_URL"));

const parseResponsePayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
};

const requestPaymentHub = async <T>(input: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<T> => {
  const response = await fetch(`${getPaymentHubBaseUrl()}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-payment-hub-site-key": getSiteKey(),
    },
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
  });

  const payload = await parseResponsePayload(response);
  const envelope = payload as PaymentHubEnvelope<T>;

  if (!response.ok || envelope?.success === false) {
    const message =
      (isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Payment hub request failed with status ${response.status}.`) ||
      `Payment hub request failed with status ${response.status}.`;

    throw new PaymentHubHttpError(message, response.status || 502, payload);
  }

  if (isRecord(payload) && "data" in payload) {
    return (envelope.data ?? (payload as T)) as T;
  }

  return payload as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const resolveProviderTransactionStatus = (
  transactionStatus: unknown,
  providerTransactionStatus: unknown,
): string => {
  const provider = toOptionalString(providerTransactionStatus)?.toLowerCase();
  if (provider) {
    return provider;
  }

  const normalized = toOptionalString(transactionStatus)?.toUpperCase();
  switch (normalized) {
    case "SETTLEMENT":
      return "settlement";
    case "CAPTURE":
      return "capture";
    case "EXPIRE":
      return "expire";
    case "CANCEL":
      return "cancel";
    case "DENY":
      return "deny";
    case "FAILURE":
      return "failure";
    case "REFUND":
      return "refund";
    case "PARTIAL_REFUND":
      return "partial_refund";
    case "CHALLENGE":
      return "challenge";
    case "PENDING":
    default:
      return "pending";
  }
};

const normalizeSnapshot = (
  payment: Record<string, unknown>,
  fallbacks?: {
    orderId?: string | null;
    snapToken?: string | null;
    snapRedirectUrl?: string | null;
  },
): PaymentHubSnapshot => ({
  orderId: toOptionalString(payment.order_id) ?? fallbacks?.orderId ?? "",
  externalReference: toOptionalString(payment.external_reference),
  transactionStatus:
    toOptionalString(payment.transaction_status) ?? "PENDING",
  providerTransactionStatus: toOptionalString(
    payment.provider_transaction_status,
  ),
  paymentType: toOptionalString(payment.payment_type),
  fraudStatus: toOptionalString(payment.fraud_status),
  midtransTransactionId: toOptionalString(payment.midtrans_transaction_id),
  grossAmount: String(payment.gross_amount ?? "0"),
  providerStatusCode:
    toOptionalString(payment.provider_status_code) ??
    toOptionalString(payment.status_code),
  providerStatusMessage:
    toOptionalString(payment.provider_status_message) ??
    toOptionalString(payment.status_message),
  snapToken: toOptionalString(payment.snap_token) ?? fallbacks?.snapToken ?? null,
  snapRedirectUrl:
    toOptionalString(payment.snap_redirect_url) ?? fallbacks?.snapRedirectUrl ?? null,
  expiredAt: toOptionalString(payment.expired_at),
  raw: payment,
});

const buildCheckoutReturnUrl = (transactionId: number, orderCode: string): string => {
  const url = new URL(`${getFrontendBaseUrl()}/apoteker/checkout`);
  url.searchParams.set("transactionId", String(transactionId));
  url.searchParams.set("clientOrderCode", orderCode);
  return url.toString();
};

const buildCallbackUrl = (): string =>
  `${getApiBaseUrl()}/api/transactions/payment-hub/callback`;

const getHeaderValue = (
  headers: IncomingHttpHeaders | Headers,
  key: string,
): string | null => {
  if (headers instanceof Headers) {
    return headers.get(key);
  }

  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
};

export const createPaymentHubTransaction = async (
  input: PaymentHubCreateInput,
): Promise<PaymentHubSnapshot> => {
  const redirectUrl = buildCheckoutReturnUrl(input.transactionId, input.orderCode);
  const response = await requestPaymentHub<PaymentHubCreateData>({
    path: "/api/payments/create",
    method: "POST",
    body: {
      site_code: getSiteCode(),
      amount: input.grossAmount,
      currency: "IDR",
      external_reference: input.orderCode,
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone,
      },
      items: [
        {
          id: `PACKAGE-${input.item.id}`,
          name: input.item.name,
          price: input.item.price,
          quantity: 1,
        },
      ],
      enabled_payments: input.paymentMethod ? [input.paymentMethod] : undefined,
      metadata: {
        local_transaction_id: input.transactionId,
        local_order_code: input.orderCode,
        package_id: input.item.id,
        package_name: input.item.name,
      },
      redirect_urls: {
        finish: redirectUrl,
        unfinish: redirectUrl,
        error: redirectUrl,
      },
      client_callback_url: buildCallbackUrl(),
    },
  });

  const payment =
    isRecord(response.payment)
      ? response.payment
      : {};

  return normalizeSnapshot(payment, {
    orderId: toOptionalString(response.order_id),
    snapToken: toOptionalString(response.snap_token),
    snapRedirectUrl: toOptionalString(response.snap_redirect_url),
  });
};

export const getPaymentHubTransactionStatus = async (
  hubOrderId: string,
  options?: {
    refresh?: boolean;
  },
): Promise<PaymentHubSnapshot> => {
  const response = await requestPaymentHub<PaymentHubDetailData>({
    path: options?.refresh
      ? `/api/payments/${encodeURIComponent(hubOrderId)}/refresh`
      : `/api/payments/${encodeURIComponent(hubOrderId)}`,
    method: options?.refresh ? "POST" : "GET",
  });

  const payment =
    isRecord(response.payment)
      ? response.payment
      : {};

  return normalizeSnapshot(payment, {
    orderId: toOptionalString(response.order_id),
  });
};

export const verifyPaymentHubCallbackSignature = (
  payload: Record<string, unknown>,
  headers: IncomingHttpHeaders | Headers,
): boolean => {
  const timestamp = getHeaderValue(headers, "x-payment-hub-timestamp");
  const signature = getHeaderValue(headers, "x-payment-hub-signature");

  if (!timestamp || !signature) {
    throw new PaymentHubHttpError("Missing payment hub signature headers.", 401, {
      missing: !timestamp ? "timestamp" : "signature",
    });
  }

  const rawBody = JSON.stringify(payload ?? {});
  const expected = createHmac("sha256", getCallbackSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (provided.length != computed.length || !timingSafeEqual(provided, computed)) {
    throw new PaymentHubHttpError("Invalid payment hub signature.", 403, {
      timestamp,
    });
  }

  return true;
};

export const buildSyntheticMidtransPayloadFromPaymentHub = (
  payload: PaymentHubStatusSource,
  localOrderCodeOverride?: string,
): Record<string, unknown> => {
  const localOrderCode =
    toOptionalString(localOrderCodeOverride) ??
    toOptionalString(payload.external_reference) ??
    toOptionalString(payload.externalReference);

  if (!localOrderCode) {
    throw new PaymentHubHttpError(
      "Missing external_reference in payment hub payload.",
      400,
      payload,
    );
  }

  return {
    order_id: localOrderCode,
    transaction_id:
      toOptionalString(
        payload.midtrans_transaction_id ?? payload.midtransTransactionId,
      ) ?? undefined,
    transaction_status: resolveProviderTransactionStatus(
      payload.transaction_status ?? payload.transactionStatus,
      payload.provider_transaction_status ?? payload.providerTransactionStatus,
    ),
    fraud_status:
      toOptionalString(payload.fraud_status ?? payload.fraudStatus) ?? undefined,
    payment_type:
      toOptionalString(payload.payment_type ?? payload.paymentType) ?? undefined,
    status_code:
      toOptionalString(
        payload.provider_status_code ?? payload.providerStatusCode,
      ) ??
      toOptionalString(payload.status_code ?? payload.statusCode) ??
      "200",
    status_message:
      toOptionalString(
        payload.provider_status_message ?? payload.providerStatusMessage,
      ) ??
      toOptionalString(payload.status_message ?? payload.statusMessage) ??
      undefined,
    gross_amount: String(payload.gross_amount ?? payload.grossAmount ?? "0"),
    expiry_time:
      toOptionalString(payload.expired_at ?? payload.expiredAt) ?? undefined,
  };
};
