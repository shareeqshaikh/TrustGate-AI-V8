import { Router, type Request, type Response } from "express";
import { usersRepo } from "../storage/json-repository.js";

export const unsubscribeRouter = Router();

// GET /api/v1/unsubscribe/:token - Validate token status without exposing user data
unsubscribeRouter.get("/:token", async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token?.trim();
  if (!token || token.length < 32) {
    res.status(400).json({ valid: false, message: "Invalid unsubscribe link format." });
    return;
  }

  const user = await usersRepo.findOne((u) => u.emailPreferences?.unsubscribeToken === token);
  if (!user) {
    res.status(404).json({ valid: false, message: "Unsubscribe link is invalid or has expired." });
    return;
  }

  res.json({
    valid: true,
    alreadyUnsubscribed: user.emailPreferences?.promotional === false,
  });
});

// POST /api/v1/unsubscribe/:token - Opt out of promotional emails
unsubscribeRouter.post("/:token", async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token?.trim();
  if (!token || token.length < 32) {
    res.status(400).json({ error: "Invalid unsubscribe link." });
    return;
  }

  const user = await usersRepo.findOne((u) => u.emailPreferences?.unsubscribeToken === token);
  if (!user) {
    res.status(404).json({ error: "Unsubscribe link is invalid or has expired." });
    return;
  }

  const updatedPreferences = {
    promotional: false,
    unsubscribeToken: token,
    unsubscribedAt: new Date().toISOString(),
  };

  await usersRepo.update(user.id, {
    emailPreferences: updatedPreferences,
  });

  res.json({
    success: true,
    message: "You have been successfully unsubscribed from marketing emails.",
  });
});
