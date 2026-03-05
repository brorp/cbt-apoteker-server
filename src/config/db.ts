import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const shouldUseSsl = !databaseUrl.includes("localhost");

export const queryClient = postgres(databaseUrl, {
  max: 20,
  connect_timeout: 10,
  idle_timeout: 20,
  ssl: shouldUseSsl ? "require" : false,
});

export const db = drizzle(queryClient, { schema });
