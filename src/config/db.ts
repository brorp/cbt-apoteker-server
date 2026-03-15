import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../db/schema.js";
import {
  getDatabaseConnectionInfo,
  resolveDatabaseUrl,
  resolveShouldUseSsl,
} from "./databaseUrl.js";

const databaseUrl = resolveDatabaseUrl();
const shouldUseSsl = resolveShouldUseSsl(databaseUrl);
export const databaseConnectionInfo = getDatabaseConnectionInfo();

export const queryClient = postgres(databaseUrl, {
  max: 20,
  connect_timeout: 10,
  idle_timeout: 20,
  ssl: shouldUseSsl ? "require" : false,
});

export const db = drizzle(queryClient, { schema });
