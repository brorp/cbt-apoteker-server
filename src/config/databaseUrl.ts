import "dotenv/config";

type DatabaseConnectionInfo = {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
};

const getPostgresEnvValues = () => ({
  host: process.env.POSTGRES_HOST?.trim() || "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT?.trim() || "5432"),
  database: process.env.POSTGRES_DB?.trim() || "",
  user: process.env.POSTGRES_USER?.trim() || "",
  password: process.env.POSTGRES_PASSWORD?.trim() || "",
});

const normalizeBoolean = (value: string | undefined): boolean | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return null;
};

const buildUrlFromPostgresEnv = (): string | null => {
  const { host, port, database, user, password } = getPostgresEnvValues();

  if (!user || !password || !database) {
    return null;
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("POSTGRES_PORT must be a positive integer.");
  }

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(database);

  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${encodedDatabase}`;
};

export const resolveDatabaseUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  const constructed = buildUrlFromPostgresEnv();
  if (constructed) {
    return constructed;
  }

  throw new Error(
    "Database connection is not configured. Set DATABASE_URL or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB.",
  );
};

export const resolveShouldUseSsl = (databaseUrl: string): boolean => {
  const databaseSsl = normalizeBoolean(process.env.DATABASE_SSL);
  if (databaseSsl !== null) {
    return databaseSsl;
  }

  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "db"]);

  return !localHosts.has(hostname);
};

export const getDatabaseConnectionInfo = (): DatabaseConnectionInfo => {
  const databaseUrl = resolveDatabaseUrl();
  const parsed = new URL(databaseUrl);

  return {
    host: parsed.hostname,
    port: Number(parsed.port || "5432"),
    database: parsed.pathname.replace(/^\//, ""),
    user: decodeURIComponent(parsed.username),
    ssl: resolveShouldUseSsl(databaseUrl),
  };
};

export const getDatabaseConfigWarning = (): string | null => {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) {
    return null;
  }

  const postgresEnv = getPostgresEnvValues();
  if (!postgresEnv.user && !postgresEnv.password && !postgresEnv.database) {
    return null;
  }

  const parsed = new URL(rawDatabaseUrl);
  const mismatches: string[] = [];

  if (postgresEnv.host && parsed.hostname !== postgresEnv.host) {
    mismatches.push(`host DATABASE_URL=${parsed.hostname} POSTGRES_HOST=${postgresEnv.host}`);
  }
  if (postgresEnv.port && Number(parsed.port || "5432") !== postgresEnv.port) {
    mismatches.push(
      `port DATABASE_URL=${parsed.port || "5432"} POSTGRES_PORT=${postgresEnv.port}`,
    );
  }
  if (postgresEnv.database && parsed.pathname.replace(/^\//, "") !== postgresEnv.database) {
    mismatches.push(
      `database DATABASE_URL=${parsed.pathname.replace(/^\//, "")} POSTGRES_DB=${postgresEnv.database}`,
    );
  }
  if (postgresEnv.user && decodeURIComponent(parsed.username) !== postgresEnv.user) {
    mismatches.push(
      `user DATABASE_URL=${decodeURIComponent(parsed.username)} POSTGRES_USER=${postgresEnv.user}`,
    );
  }
  if (postgresEnv.password && decodeURIComponent(parsed.password) !== postgresEnv.password) {
    mismatches.push("password DATABASE_URL and POSTGRES_PASSWORD differ");
  }

  if (mismatches.length === 0) {
    return null;
  }

  return `DATABASE_URL and POSTGRES_* are inconsistent: ${mismatches.join("; ")}`;
};
