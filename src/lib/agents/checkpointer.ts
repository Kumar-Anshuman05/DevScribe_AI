import tls from "node:tls";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

/**
 * Official Supabase Root 2021 CA (prod-ca-2021.crt).
 * Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
 * SHA-256: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 */
export const SUPABASE_ROOT_2021_CA = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL",
  "BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l",
  "dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh",
  "c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow",
  "azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD",
  "YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug",
  "Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW",
  "QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q",
  "DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2",
  "GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi",
  "cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4",
  "O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt",
  "NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX",
  "uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt",
  "aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU",
  "tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b",
  "VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6",
  "jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx",
  "Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2",
  "CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P",
  "o/bKiIz+Fq8=",
  "-----END CERTIFICATE-----",
].join("\n");

let checkpointerPool: Pool | null = null;
let checkpointer: PostgresSaver | null = null;
let checkpointerInitPromise: Promise<PostgresSaver> | null = null;

function normalizePemCert(cert?: string): string | undefined {
  if (!cert) return undefined;
  const normalized = cert.trim().replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Removes sslmode and sslrootcert query parameters from the connection string so
 * pg-connection-string cannot overwrite the explicit ssl object passed to pg.Pool.
 */
export function sanitizeConnectionStringSslParams(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower === "sslmode" || lower === "sslrootcert") {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return connectionString
      .replace(/([?&])(sslmode|sslrootcert)=[^&]*(&?)/gi, (_, prefix, _k, suffix) =>
        prefix === "?" && suffix ? "?" : suffix ? prefix : ""
      )
      .replace(/[?&]$/, "");
  }
}

/**
 * Determines explicit SSL configuration for PostgreSQL connections.
 * - In production: strict TLS certificate validation is mandatory (rejectUnauthorized: true),
 *   preserving Node.js default root CAs while trusting Supabase Root 2021 CA and optional DATABASE_SSL_CERT.
 * - Disabling certificate verification in production ({ rejectUnauthorized: false }) is strictly forbidden.
 * - Normalizes escaped newlines in DATABASE_SSL_CERT for serverless environment compatibility.
 */
export function getPoolSslConfig(
  env: NodeJS.ProcessEnv = process.env
): boolean | { rejectUnauthorized: boolean; ca?: string | string[] } {
  const isProduction = env.NODE_ENV === "production";
  const normalizedCustomCa = normalizePemCert(env.DATABASE_SSL_CERT);

  if (isProduction) {
    const ca = normalizedCustomCa
      ? [...tls.rootCertificates, SUPABASE_ROOT_2021_CA, normalizedCustomCa]
      : [...tls.rootCertificates, SUPABASE_ROOT_2021_CA];

    return {
      rejectUnauthorized: true,
      ca,
    };
  }

  if (env.DATABASE_SSL === "true" || normalizedCustomCa) {
    return {
      rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(normalizedCustomCa ? { ca: [...tls.rootCertificates, normalizedCustomCa] } : {}),
    };
  }

  return false;
}

function getPool(): Pool {
  const rawConnectionString =
    process.env.CHECKPOINTER_DATABASE_URL ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL;

  if (!rawConnectionString) {
    throw new Error(
      "CHECKPOINTER_CONFIGURATION_ERROR: Durable PostgreSQL checkpointer connection string is missing. " +
      "Configure CHECKPOINTER_DATABASE_URL, DIRECT_URL, or DATABASE_URL in environment variables."
    );
  }

  if (!checkpointerPool) {
    const connectionString = sanitizeConnectionStringSslParams(rawConnectionString);
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
