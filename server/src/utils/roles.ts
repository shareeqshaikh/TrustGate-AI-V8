import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { ENV } from "../config/env.js";
import { usersRepo } from "../storage/json-repository.js";
import type { User, UserRole } from "../types/index.js";

/**
 * Determines user role based strictly on normalized email.
 * Returns "admin" only if email matches configured ADMIN_EMAIL (default: shareeqshaikh194@gmail.com).
 * All other emails receive "user".
 */
export function roleForEmail(email: string): UserRole {
  if (!email || typeof email !== "string") {
    return "user";
  }
  const normalized = email.trim().toLowerCase();
  const adminEmail = (
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
    ENV.ADMIN_EMAIL ||
    "shareeqshaikh194@gmail.com"
  ).toLowerCase();

  return normalized === adminEmail ? "admin" : "user";
}

/**
 * Seeds the administrator account at server start idempotently.
 * Reads ADMIN_EMAIL (default: shareeqshaikh194@gmail.com) and ADMIN_PASSWORD from environment.
 * If no user with normalized ADMIN_EMAIL exists:
 *   - role: "admin"
 *   - emailVerified: true
 *   - passwordHash: bcrypt hash of ADMIN_PASSWORD
 * Never logs or stores plain password in code.
 */
export async function seedAdminAccount(): Promise<User | null> {
  const adminEmail = (
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
    ENV.ADMIN_EMAIL ||
    "shareeqshaikh194@gmail.com"
  ).toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD?.trim() || ENV.ADMIN_PASSWORD?.trim();

  return usersRepo.atomicMutation((users) => {
    const existing = users.find(
      (u) => u.email.trim().toLowerCase() === adminEmail
    );
    if (existing) {
      // Already exists. Ensure role and verification are accurate.
      let modified = false;
      if (existing.role !== "admin") {
        existing.role = "admin";
        modified = true;
      }
      if (!existing.emailVerified) {
        existing.emailVerified = true;
        modified = true;
      }
      return { result: existing, modified };
    }

    if (!adminPassword) {
      console.warn(`[Seed] ADMIN_PASSWORD not set in environment. Skipping admin seed for ${adminEmail}.`);
      return { result: null, modified: false };
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword, salt);
    const now = new Date().toISOString();

    const adminUser: User = {
      id: `usr_admin_${crypto.randomBytes(4).toString("hex")}`,
      name: "Admin",
      email: adminEmail,
      passwordHash,
      role: "admin",
      emailVerified: true,
      createdAt: now,
    };

    users.push(adminUser);
    console.log(`[Seed] Seeded initial admin account: ${adminEmail}`);
    return { result: adminUser, modified: true };
  });
}

/**
 * Idempotent migration executed once at server start.
 * Scans users.json and updates:
 *   - role = roleForEmail(email)
 *   - email = normalized (trim + lowercase)
 * Preserves user IDs, password hashes, orders, and subscriptions without deleting or recreating records.
 * Uses atomic file write with mutex lock.
 */
export async function migrateUserRoles(): Promise<{ changedCount: number; totalUsers: number }> {
  return usersRepo.atomicMutation((users) => {
    let changedCount = 0;
    let modified = false;

    for (const user of users) {
      const normalizedEmail = user.email.trim().toLowerCase();
      const expectedRole = roleForEmail(normalizedEmail);

      let userChanged = false;
      if (user.email !== normalizedEmail) {
        user.email = normalizedEmail;
        userChanged = true;
      }
      if (user.role !== expectedRole) {
        user.role = expectedRole;
        userChanged = true;
        changedCount++;
      }
      if (userChanged) {
        modified = true;
      }
    }

    if (changedCount > 0 || modified) {
      console.log(
        `[Migration] User roles migrated: ${changedCount} role(s) updated across ${users.length} user record(s).`
      );
    } else {
      console.log(
        `[Migration] User roles verified: 0 roles changed across ${users.length} user record(s).`
      );
    }

    return {
      result: { changedCount, totalUsers: users.length },
      modified,
    };
  });
}
