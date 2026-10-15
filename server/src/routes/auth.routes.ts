import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { usersRepo } from "../storage/json-repository.js";
import { roleForEmail } from "../utils/roles.js";
import type { User } from "../types/index.js";

export const authRouter = Router();

// Zod schema for registration: strips any client-provided 'role' field
const RegisterSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.any().optional(), // stripped by Zod
  })
  .strip();

// Zod schema for login
const LoginSchema = z
  .object({
    email: z.string().trim().email("Invalid email address"),
    password: z.string(),
  })
  .strip();

// Zod schema for profile updates: strips any client-provided 'role' field
const UpdateProfileSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    role: z.any().optional(), // stripped by Zod
  })
  .strip();

// POST /api/v1/auth/register
authRouter.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = RegisterSchema.parse(req.body);
    const normalizedEmail = email.trim().toLowerCase();

    const adminEmail = (
      process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
      "shareeqshaikh194@gmail.com"
    ).toLowerCase();

    // Check duplicate using normalized email (admin email is always pre-registered/reserved)
    const existing = await usersRepo.findOne(
      (u) => u.email.trim().toLowerCase() === normalizedEmail
    );
    if (existing || normalizedEmail === adminEmail) {
      res.status(400).json({ error: "Email already registered", code: "EMAIL_EXISTS" });
      return;
    }

    // Role assignment: determined strictly by roleForEmail() (no first-user rule)
    const role = roleForEmail(normalizedEmail);

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    const newUser: User = {
      id: `usr_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`,
      name,
      email: normalizedEmail,
      passwordHash,
      role,
      createdAt: now,
    };

    await usersRepo.create(newUser);

    if (req.session) {
      req.session.userId = newUser.id;
      delete (req.session as any).role;
    }

    res.status(201).json({
      message: "Registration successful",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Validation error" });
      return;
    }
    res.status(500).json({ error: err.message || "Registration failed" });
  }
});

// POST /api/v1/auth/login
authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const normalizedEmail = email.trim().toLowerCase();

    // Find user using normalized email
    const user = await usersRepo.findOne(
      (u) => u.email.trim().toLowerCase() === normalizedEmail
    );
    if (!user) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    if (req.session) {
      req.session.userId = user.id;
      delete (req.session as any).role;
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Validation error" });
      return;
    }
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

// POST /api/v1/auth/logout
authRouter.post("/logout", (req: Request, res: Response): void => {
  if (req.session) {
    req.session = null;
  }
  res.json({ message: "Logged out successfully" });
});

// GET /api/v1/auth/me
authRouter.get("/me", (req: Request, res: Response): void => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt,
    },
  });
});

// PATCH /api/v1/auth/me - Profile update (safely strips 'role')
authRouter.patch("/me", async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }
  try {
    const parsed = UpdateProfileSchema.parse(req.body);
    const updateData: Partial<User> = {};
    if (parsed.name) updateData.name = parsed.name;

    const updated = await usersRepo.update(req.user.id, updateData);
    res.json({
      message: "Profile updated",
      user: {
        id: updated!.id,
        name: updated!.name,
        email: updated!.email,
        role: updated!.role,
        createdAt: updated!.createdAt,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Validation error" });
      return;
    }
    res.status(500).json({ error: err.message || "Update failed" });
  }
});
