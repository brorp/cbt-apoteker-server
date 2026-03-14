import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databaseSsl = process.env.DATABASE_SSL?.trim().toLowerCase();

const resolveShouldUseSsl = () => {
  if (databaseSsl === "true") {
    return true;
  }

  if (databaseSsl === "false") {
    return false;
  }

  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "db"]);

  return !localHosts.has(hostname);
};

const shouldUseSsl = resolveShouldUseSsl();

export const queryClient = postgres(databaseUrl, {
  max: 20,
  connect_timeout: 10,
  idle_timeout: 20,
  ssl: shouldUseSsl ? "require" : false,
});

export const db = drizzle(queryClient, { schema });
