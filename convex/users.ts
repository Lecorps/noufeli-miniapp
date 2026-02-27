/**
 * convex/users.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * User management: upsert on first contact, update settings, read profile.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ─── Mutations ──────────────────────────────────────────────────────────────────────

/**
 * ensureUser
 * Called on every /start or first incoming message from a Telegram user.
 * Creates the user document if it doesn't exist yet; otherwise is a no-op.
 * Returns the Convex _id of the user.
 */
export const ensureUser = mutation({
  args: {
    telegramId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    username: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_telegram_id", (q) => q.eq("telegramId", args.telegramId))
      .unique();

    if (existing !== null) {
      // Update profile fields in case name/username changed in Telegram
      await ctx.db.patch(existing._id, {
        firstName: args.firstName,
        lastName: args.lastName,
        username: args.username,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    // First contact: create a fresh user document
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      telegramId: args.telegramId,
      firstName: args.firstName,
      lastName: args.lastName,
      username: args.username,
      settings: {},
      totalXp: 0,
      chrysolite: 0,
      hp: 100, // start with full HP
      createdAt: now,
      updatedAt: now,
    });

    return userId;
  },
});

/**
 * setUserSettings
 * Saves organize interval and/or timezone from the /start onboarding flow.
 * Partial: only updates fields that are provided.
 */
export const setUserSettings = mutation({
  args: {
    telegramId: v.string(),
    organizeIntervalMinutes: v.optional(v.number()),
    timezone: v.optional(v.string()),
    chatId: v.optional(v.string()),
    botState: v.optional(v.string()), // JSON-stringified conversation state
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegram_id", (q) => q.eq("telegramId", args.telegramId))
      .unique();

    if (!user) {
      throw new Error(`User not found for telegramId: ${args.telegramId}`);
    }

    const updatedSettings = {
      ...user.settings,
      ...(args.organizeIntervalMinutes !== undefined
        ? { organizeIntervalMinutes: args.organizeIntervalMinutes }
        : {}),
      ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
      ...(args.chatId   !== undefined ? { chatId:   args.chatId   } : {}),
      ...(args.botState !== undefined ? { botState: args.botState } : {}),
    };

    await ctx.db.patch(user._id, {
      settings: updatedSettings,
      updatedAt: Date.now(),
    });

    return user._id;
  },
});

/**
 * markOrganizeSessionDone
 * Records the timestamp of the last organize session so the reminder
 * scheduler knows when to fire next.
 */
export const markOrganizeSessionDone = mutation({
  args: { telegramId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegram_id", (q) => q.eq("telegramId", args.telegramId))
      .unique();

    if (!user) throw new Error(`User not found: ${args.telegramId}`);

    await ctx.db.patch(user._id, {
      settings: { ...user.settings, lastOrganizedAt: Date.now() },
      updatedAt: Date.now(),
    });
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────────

/**
 * getUserByTelegramId
 * Lightweight profile fetch used by the Mini App and bot handlers.
 */
export const getUserByTelegramId = query({
  args: { telegramId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_telegram_id", (q) => q.eq("telegramId", args.telegramId))
      .unique();
  },
});

/**
 * getUserSummary
 * Returns XP, HP, chrysolite and activity counts for the summary screen.
 */
export const getUserSummary = query({
  args: { telegramId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegram_id", (q) => q.eq("telegramId", args.telegramId))
      .unique();

    if (!user) return null;

    // Count activities by status
    const allActivities = await ctx.db
      .query("activities")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const capturedCount = allActivities.filter(
      (a) => a.status === "captured",
    ).length;
    const readyCount = allActivities.filter(
      (a) => a.status === "organized",
    ).length;
    const doneCount = allActivities.filter(
      (a) => a.status === "complete" || a.status === "complete-late",
    ).length;

    const habitCount = await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
      .then((h) => h.length);

    const goalCount = await ctx.db
      .query("goals")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .collect()
      .then((g) => g.length);

    // Simple level/rank calculation: level = floor(totalXp / 500) + 1
    const level = Math.floor(user.totalXp / 500) + 1;
    const ranks = [
      "Novice", "Apprentice", "Journeyman", "Adept",
      "Expert", "Master", "Grandmaster", "Legend",
    ];
    const rank = ranks[Math.min(level - 1, ranks.length - 1)];

    return {
      totalXp: user.totalXp,
      chrysolite: user.chrysolite,
      hp: user.hp,
      level,
      rank,
      capturedCount,
      readyCount,
      doneCount,
      habitCount,
      goalCount,
    };
  },
});

/**
 * listUsersWithPendingOrganize
 * Used by the scheduler to find users who are due for an organize reminder.
 * Returns all users who have a configured organizeIntervalMinutes and whose
 * last organize session is older than that interval (or who have never organised).
 */
export const listUsersWithPendingOrganize = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const now = Date.now();

    return users.filter((u) => {
      const interval = u.settings.organizeIntervalMinutes;
      if (!interval) return false;
      const lastDone = u.settings.lastOrganizedAt ?? 0;
      return now - lastDone >= interval * 60 * 1000;
    });
  },
});
