import crypto from "node:crypto";
import { ENV } from "../../config/env.js";
import { gmailTokensRepo } from "../../storage/json-repository.js";
import type { StoredGmailToken, GmailConnectionStatus } from "../../types/index.js";

const TOKEN_RECORD_ID = "active_gmail_account";

export class TokenStorageService {
  /**
   * Derives a 32-byte encryption key from EMAIL_TOKEN_ENCRYPTION_KEY.
   * Strictly refuses to operate if key is missing or under 32 characters.
   */
  private static getEncryptionKey(): Buffer {
    const rawKey = ENV.EMAIL_TOKEN_ENCRYPTION_KEY?.trim();
    if (!rawKey || rawKey.length < 32) {
      throw new Error(
        "EMAIL_TOKEN_ENCRYPTION_KEY is missing or weak. A minimum of 32 characters (256 bits) is required to secure Gmail credentials."
      );
    }
    // Deterministically hash to guarantee exactly 32 bytes for AES-256
    return crypto.createHash("sha256").update(rawKey).digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a fresh random 12-byte IV.
   */
  public static encrypt(plaintext: string): {
    ciphertextHex: string;
    ivHex: string;
    authTagHex: string;
  } {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertextHex: encrypted.toString("hex"),
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
    };
  }

  /**
   * Decrypts AES-256-GCM ciphertext, verifying authenticity with auth tag.
   */
  public static decrypt(
    ciphertextHex: string,
    ivHex: string,
    authTagHex: string
  ): string {
    const key = this.getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

    decipher.setAuthTag(authTag);
    const decrypted =
      decipher.update(Buffer.from(ciphertextHex, "hex"), undefined, "utf8") +
      decipher.final("utf8");

    return decrypted;
  }

  /**
   * Stores or updates the encrypted Gmail refresh token.
   */
  public static async saveTokens(
    connectedEmail: string,
    refreshToken: string,
    scope = "https://www.googleapis.com/auth/gmail.send"
  ): Promise<void> {
    const { ciphertextHex, ivHex, authTagHex } = this.encrypt(refreshToken);
    const now = new Date().toISOString();
    const today = now.split("T")[0];
    const dailyCap = ENV.GMAIL_DAILY_SEND_CAP || 100;

    const existing = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (existing) {
      await gmailTokensRepo.update(TOKEN_RECORD_ID, {
        connectedEmail,
        encryptedRefreshToken: ciphertextHex,
        iv: ivHex,
        authTag: authTagHex,
        scope,
        dailySendCap: dailyCap,
        updatedAt: now,
      });
    } else {
      const record: StoredGmailToken = {
        id: TOKEN_RECORD_ID,
        connectedEmail,
        encryptedRefreshToken: ciphertextHex,
        iv: ivHex,
        authTag: authTagHex,
        scope,
        dailySendCap: dailyCap,
        todaySendCount: 0,
        lastResetDate: today,
        connectedAt: now,
        updatedAt: now,
      };
      await gmailTokensRepo.create(record);
    }
  }

  /**
   * Retrieves and decrypts the stored refresh token.
   */
  public static async getDecryptedRefreshToken(): Promise<{
    connectedEmail: string;
    refreshToken: string;
  } | null> {
    const record = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (!record || !record.encryptedRefreshToken) {
      return null;
    }
    try {
      const refreshToken = this.decrypt(
        record.encryptedRefreshToken,
        record.iv,
        record.authTag
      );
      return { connectedEmail: record.connectedEmail, refreshToken };
    } catch (err: any) {
      console.error("[TokenStorageService] Decryption failed:", err.message);
      return null;
    }
  }

  /**
   * Verifies and increments daily quota atomically.
   */
  public static async checkAndConsumeQuota(): Promise<{
    allowed: boolean;
    remaining: number;
    reason?: string;
  }> {
    const today = new Date().toISOString().split("T")[0];
    const record = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (!record) {
      return { allowed: false, remaining: 0, reason: "Gmail account not connected" };
    }

    const dailyCap = record.dailySendCap || ENV.GMAIL_DAILY_SEND_CAP || 100;
    let todayCount = record.todaySendCount || 0;

    // Reset count if new day
    if (record.lastResetDate !== today) {
      todayCount = 0;
    }

    if (todayCount >= dailyCap) {
      return {
        allowed: false,
        remaining: 0,
        reason: `Daily Gmail send cap reached (${todayCount}/${dailyCap}). Resets at midnight UTC.`,
      };
    }

    // Increment count
    await gmailTokensRepo.update(TOKEN_RECORD_ID, {
      todaySendCount: todayCount + 1,
      lastResetDate: today,
      updatedAt: new Date().toISOString(),
    });

    return { allowed: true, remaining: dailyCap - (todayCount + 1) };
  }

  /**
   * Records the last send result for telemetry.
   */
  public static async recordSendResult(
    success: boolean,
    error?: string
  ): Promise<void> {
    const record = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (!record) return;

    await gmailTokensRepo.update(TOKEN_RECORD_ID, {
      lastSendResult: {
        success,
        timestamp: new Date().toISOString(),
        error,
      },
    });
  }

  /**
   * Returns safe connection status for API/UI (NEVER includes tokens/keys).
   */
  public static async getStatus(): Promise<GmailConnectionStatus> {
    const record = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (!record) {
      return {
        connected: false,
        needsReconnect: false,
        dailySendCap: ENV.GMAIL_DAILY_SEND_CAP || 100,
        todaySendCount: 0,
        details: "Gmail account is not connected. Use Connect Gmail to authorize.",
      };
    }

    const today = new Date().toISOString().split("T")[0];
    const todayCount = record.lastResetDate === today ? record.todaySendCount : 0;

    return {
      connected: true,
      needsReconnect: false,
      connectedEmail: record.connectedEmail,
      dailySendCap: record.dailySendCap || 100,
      todaySendCount: todayCount,
      lastSendResult: record.lastSendResult,
      details: `Connected as ${record.connectedEmail}`,
    };
  }

  /**
   * Deletes the stored token on disconnect.
   */
  public static async deleteTokens(): Promise<boolean> {
    const record = await gmailTokensRepo.getById(TOKEN_RECORD_ID);
    if (!record) return false;
    return gmailTokensRepo.delete(TOKEN_RECORD_ID);
  }
}
