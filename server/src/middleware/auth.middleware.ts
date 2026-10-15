import type { Request, Response, NextFunction } from "express";
import { usersRepo } from "../storage/json-repository.js";
import type { User } from "../types/index.js";

// Extend express request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: {
        userId?: string;
        [key: string]: any;
      } | null;
    }
  }
}

/**
 * Authentication middleware that loads fresh user state from storage on every request.
 * SECURITY: Never trust any role in the session cookie. Only req.session.userId is read,
 * and the user object + role is freshly retrieved from usersRepo.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (userId) {
      const freshUser = await usersRepo.getById(userId);
      if (freshUser) {
        req.user = freshUser;
      } else {
        req.user = undefined;
        if (req.session) {
          req.session = null;
        }
      }
    } else {
      req.user = undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
    return;
  }
  next();
}

/**
 * Checks that the freshly loaded stored role is "admin".
 * Demoted users lose admin privileges immediately on their next request.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
    return;
  }
  // Fresh stored role check
  if (req.user.role !== "admin") {
    res.status(403).json({
      error: "Admin privileges required for this action",
      code: "FORBIDDEN",
    });
    return;
  }
  next();
}
