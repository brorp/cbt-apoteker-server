import "dotenv/config";

const normalizeBoolean = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === "true";

export type MidtransConfig = {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
  apiBaseUrl: string;
  snapBaseUrl: string;
  snapScriptUrl: string;
  notificationUrl: string | null;
  finishUrl: string | null;
  unfinishUrl: string | null;
  errorUrl: string | null;
};

export const getMidtransConfig = (): MidtransConfig => {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim();

  if (!serverKey) {
    throw new Error("MIDTRANS_SERVER_KEY is not configured.");
  }

  if (!clientKey) {
    throw new Error("MIDTRANS_CLIENT_KEY is not configured.");
  }

  const isProduction = normalizeBoolean(process.env.MIDTRANS_IS_PRODUCTION);

  return {
    serverKey,
    clientKey,
    isProduction,
    apiBaseUrl: isProduction
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com",
    snapBaseUrl: isProduction
      ? "https://app.midtrans.com"
      : "https://app.sandbox.midtrans.com",
    snapScriptUrl: isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",
    notificationUrl: process.env.MIDTRANS_NOTIFICATION_URL?.trim() || null,
    finishUrl: process.env.MIDTRANS_FINISH_URL?.trim() || null,
    unfinishUrl: process.env.MIDTRANS_UNFINISH_URL?.trim() || null,
    errorUrl: process.env.MIDTRANS_ERROR_URL?.trim() || null,
  };
};
