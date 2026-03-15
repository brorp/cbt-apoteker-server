export type LocalTransactionStatus =
  | "created"
  | "pending"
  | "paid"
  | "success"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "challenge";

export const normalizeTransactionStatus = (
  value: string | null | undefined,
): LocalTransactionStatus => {
  switch (value) {
    case "created":
    case "pending":
    case "paid":
    case "success":
    case "failed":
    case "cancelled":
    case "expired":
    case "refunded":
    case "challenge":
      return value;
    default:
      return "pending";
  }
};

export const toClientTransactionStatus = (
  status: string | null | undefined,
): Exclude<LocalTransactionStatus, "success"> => {
  const normalized = normalizeTransactionStatus(status);
  return normalized === "success" ? "paid" : normalized;
};

export const isPaidTransactionStatus = (
  status: string | null | undefined,
): boolean => {
  const normalized = normalizeTransactionStatus(status);
  return normalized === "paid" || normalized === "success";
};

export const isPendingLikeTransactionStatus = (
  status: string | null | undefined,
): boolean => {
  const normalized = normalizeTransactionStatus(status);
  return (
    normalized === "created" ||
    normalized === "pending" ||
    normalized === "challenge"
  );
};

export const resolveTransactionStatusTransition = (
  currentStatus: string | null | undefined,
  nextStatus: LocalTransactionStatus,
): LocalTransactionStatus => {
  const current = normalizeTransactionStatus(currentStatus);

  if (current === nextStatus) {
    return current;
  }

  if (current === "refunded") {
    return current;
  }

  if (nextStatus === "refunded") {
    return nextStatus;
  }

  if (isPaidTransactionStatus(nextStatus)) {
    return nextStatus === "success" ? "paid" : nextStatus;
  }

  if (isPaidTransactionStatus(current)) {
    return current === "success" ? "paid" : current;
  }

  if (
    (current === "failed" || current === "cancelled" || current === "expired") &&
    isPendingLikeTransactionStatus(nextStatus)
  ) {
    return current;
  }

  return nextStatus;
};
