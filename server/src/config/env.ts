import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// Deterministically locate the project root directory
// env.ts is in server/src/config -> root is ../../../
const dirName = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const candidateRoots = [
  path.resolve(dirName, "../../../"),
  path.resolve(process.cwd()),
  path.resolve(process.cwd(), ".."),
  path.resolve(dirName, "../../"),
];

let rootEnvLoaded = false;
let loadedEnvPath = "";

for (const dir of candidateRoots) {
  const envPath = path.join(dir, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    rootEnvLoaded = true;
    loadedEnvPath = envPath;
    break;
  }
}

// Fallback to default dotenv if candidate loops didn't find .env
if (!rootEnvLoaded) {
  dotenv.config();
}

export const ENV = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: process.env.NODE_ENV || "development",
  SESSION_SECRET: process.env.SESSION_SECRET || "trustgate_secret_session_key",
  AUTH_APP_URL: (process.env.AUTH_APP_URL?.trim() || "").replace(/\/+$/, ""),
  MERCHANT_API_KEY: process.env.MERCHANT_API_KEY?.trim() || "",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:4000",
  DATA_DIR: process.env.DATA_DIR || path.resolve(process.cwd(), "data"),
  OLLAMA_HOST: process.env.OLLAMA_HOST?.trim() || "http://localhost:11434",
  REFUND_MODEL: process.env.REFUND_MODEL?.trim() || "llama3.2:1b",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL?.trim().toLowerCase() || "shareeqshaikh194@gmail.com",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD?.trim() || "",
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "dryrun") as "dryrun" | "smtp" | "resend" | "gmail",
  EMAIL_FROM: process.env.EMAIL_FROM?.trim() || "noreply@trustgate.ai",
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME?.trim() || "TrustGate AI",
  SMTP_HOST: process.env.SMTP_HOST?.trim() || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER?.trim() || "",
  SMTP_PASS: process.env.SMTP_PASS?.trim() || "",
  EMAIL_API_KEY: process.env.EMAIL_API_KEY?.trim() || "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim() || "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI?.trim() || "http://localhost:4000/api/email/oauth/callback",
  EMAIL_TOKEN_ENCRYPTION_KEY: process.env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim() || "",
  FRONTEND_URL: process.env.FRONTEND_URL?.trim() || "http://localhost:5173",
  GMAIL_DAILY_SEND_CAP: Number(process.env.GMAIL_DAILY_SEND_CAP) || 100,
  REMINDER_DAYS_BEFORE: Number(process.env.REMINDER_DAYS_BEFORE) || 7,
  EMAIL_DRY_RUN: process.env.EMAIL_DRY_RUN !== "false",
  UPI_MERCHANT_ID: process.env.UPI_MERCHANT_ID?.trim() || "shareeqshaikh194@oksbi",
  UPI_MERCHANT_NAME: process.env.UPI_MERCHANT_NAME?.trim() || "Shareeq Shaikh",
  PAYMENT_MODE: process.env.PAYMENT_MODE?.trim() || "manual",
  AUTO_REFUND_MAX_PAISE: Number(process.env.AUTO_REFUND_MAX_PAISE) || 500,
  REFUND_WINDOW_DAYS: Number(process.env.REFUND_WINDOW_DAYS) || 7,
  SUPABASE_URL: process.env.SUPABASE_URL?.trim() || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_KEY?.trim() || "",
  loadedEnvPath,
};

export function logStartupConfig(): void {
  const emailProviderName = ENV.EMAIL_PROVIDER.toUpperCase();
  const dryRunStatus = ENV.EMAIL_DRY_RUN ? "ENABLED (Safe Mode — no real emails)" : "OFF (Live sending)";
  const gmailOauthConfigured = !!(ENV.GOOGLE_CLIENT_ID && ENV.GOOGLE_CLIENT_SECRET);
  const tokenKeyConfigured = !!(ENV.EMAIL_TOKEN_ENCRYPTION_KEY && ENV.EMAIL_TOKEN_ENCRYPTION_KEY.length >= 32);

  console.log("\n======================================================");
  console.log("🛡️  TrustGate Gateway Initialized");
  console.log(`📁 Loaded .env from: ${ENV.loadedEnvPath || "default process environment"}`);
  console.log(`📡 URL:              http://localhost:${ENV.PORT}`);
  console.log(`💳 UPI Merchant:     ${ENV.UPI_MERCHANT_ID} (${ENV.UPI_MERCHANT_NAME}) [Mode: ${ENV.PAYMENT_MODE}]`);
  console.log(`💰 Auto-Refund Max:  ${ENV.AUTO_REFUND_MAX_PAISE} paise (₹${(ENV.AUTO_REFUND_MAX_PAISE / 100).toFixed(2)}) [Window: ${ENV.REFUND_WINDOW_DAYS} days]`);
  console.log(`🤖 Refund AI Model:  ${ENV.REFUND_MODEL} (${ENV.OLLAMA_HOST})`);
  console.log(`📧 Email Provider:   ${emailProviderName} [Dry-Run: ${dryRunStatus}]`);
  console.log(`📬 Gmail OAuth App:  ${gmailOauthConfigured ? "CONFIGURED" : "NOT CONFIGURED"}`);
  console.log(`🔐 Token Encryption: ${tokenKeyConfigured ? "CONFIGURED (AES-256-GCM)" : "NOT CONFIGURED / WEAK (<32 chars)"}`);
  console.log(`👑 Admin Email:      ${ENV.ADMIN_EMAIL}`);
  console.log("======================================================\n");
}
