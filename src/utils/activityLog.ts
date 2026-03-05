import { db } from "../config/db.js";
import { activityLogs } from "../db/schema.js";
import type { UserRole } from "../middlewares/authMiddleware.js";

interface LogActivityPayload {
  actorUserId?: number | null;
  actorRole?: UserRole | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  status?: "success" | "failed";
  message?: string;
  metadata?: Record<string, unknown>;
}

export const logActivity = async (payload: LogActivityPayload): Promise<void> => {
  const statusIcon = payload.status === "failed" ? "❌" : "✅";
  console.log(`[ACTIVITY] ${statusIcon} ${payload.action} | ${payload.message || "-"}`);

  try {
    await db.insert(activityLogs).values({
      actorUserId: payload.actorUserId ?? null,
      actorRole: payload.actorRole ?? null,
      action: payload.action,
      entity: payload.entity,
      entityId:
        payload.entityId === undefined || payload.entityId === null
          ? null
          : String(payload.entityId),
      status: payload.status ?? "success",
      message: payload.message ?? null,
      metadata: payload.metadata ?? {},
    });
  } catch (error) {
    // We intentionally do not block request flow if activity logging fails.
    console.error("logActivity Database Error:", (error as Error).message);
  }
};
