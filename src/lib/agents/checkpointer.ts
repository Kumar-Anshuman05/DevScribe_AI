import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

let checkpointerPool: Pool | null = null;
let checkpointer: PostgresSaver | null = null;
let checkpointerInitPromise: Promise<PostgresSaver> | null = null;

/**
 * Determines explicit SSL configuration for PostgreSQL connections.
 * - In production: strict TLS certificate validation is mandatory (rejectUnauthorized: true).
 * - Disabling certificate verification in production ({ rejectUnauthorized: false }) is strictly forbidden.
 * - Supports custom CA certificate via DATABASE_SSL_CERT.
 */
export function getPoolSslConfig(
  env: NodeJS.ProcessEnv = process.env
): boolean | { rejectUnauthorized: boolean; ca?: string } {
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    return {
      rejectUnauthorized: true,
      ...(env.DATABASE_SSL_CERT ? { ca: env.DATABASE_SSL_CERT } : {}),
    };
  }

  if (env.DATABASE_SSL === "true" || env.DATABASE_SSL_CERT) {
    return {
      rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(env.DATABASE_SSL_CERT ? { ca: env.DATABASE_SSL_CERT } : {}),
    };
  }

  return false;
}

function getPool(): Pool {
  const connectionString =
    process.env.CHECKPOINTER_DATABASE_URL ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "CHECKPOINTER_CONFIGURATION_ERROR: Durable PostgreSQL checkpointer connection string is missing. " +
      "Configure CHECKPOINTER_DATABASE_URL, DIRECT_URL, or DATABASE_URL in environment variables."
    );
  }

  if (!checkpointerPool) {
    const sslConfig = getPoolSslConfig();

    checkpointerPool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: sslConfig,
    });
  }

  return checkpointerPool;
}

/**
 * Concurrency-safe singleton checkpointer initializer.
 * Requires a working PostgreSQL database connection and fails fast with
 * CHECKPOINTER_CONFIGURATION_ERROR if configuration or setup fails.
 * Silent fallback to in-memory checkpointer is strictly prohibited.
 */
export async function getSafeCheckpointer(): Promise<PostgresSaver> {
  const pool = getPool();

  if (checkpointer) {
    return checkpointer;
  }

  if (checkpointerInitPromise) {
    return checkpointerInitPromise;
  }

  checkpointerInitPromise = (async () => {
    try {
      const saver = new PostgresSaver(pool);
      await saver.setup();
      checkpointer = saver;
      return saver;
    } catch (err: any) {
      checkpointerInitPromise = null;
      throw new Error(
        `CHECKPOINTER_CONFIGURATION_ERROR: Failed to initialize durable PostgreSQL checkpointer: ${err.message}`
      );
    }
  })();

  return checkpointerInitPromise;
}
