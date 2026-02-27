/**
 * convex/lib/ids.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Human-readable ID generators for goals, activities, and habits.
 *
 * Pattern:  PREFIX-NNNN   (e.g. G-0001, A-0042, H-0003)
 *
 * Strategy: query the relevant table for the user, find the highest existing
 * numeric suffix, and return prefix + (max + 1) zero-padded to 4 digits.
 * This is done inside mutations (which are serialised per document key in
 * Convex), so there is no race condition.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type MutationCtx } from "../_generated/server";
import { type Id } from "../_generated/dataModel";

/** Zero-pad a number to 4 digits: 1 → "0001". */
function pad(n: number): string {
  return String(n).padStart(4, "0");
}

/** Extract numeric suffix from an ID string like "G-0042" → 42. */
function extractNum(id: string): number {
  const parts = id.split("-");
  const last = parts[parts.length - 1];
  const n = parseInt(last, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Generate the next goal ID for a user.
 * Queries all goals for the user and returns the next sequential ID.
 */
export async function nextGoalId(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const goals = await ctx.db
    .query("goals")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const max = goals.reduce((acc, g) => Math.max(acc, extractNum(g.goalId)), 0);
  return `G-${pad(max + 1)}`;
}

/**
 * Generate the next activity ID for a user.
 * Queries all activities for the user and returns the next sequential ID.
 */
export async function nextActivityId(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const activities = await ctx.db
    .query("activities")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const max = activities.reduce(
    (acc, a) => Math.max(acc, extractNum(a.activityId)),
    0,
  );
  return `A-${pad(max + 1)}`;
}

/**
 * Generate the next habit ID for a user.
 * Queries all habits for the user and returns the next sequential ID.
 */
export async function nextHabitId(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const habits = await ctx.db
    .query("habits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const max = habits.reduce((acc, h) => Math.max(acc, extractNum(h.habitId)), 0);
  return `H-${pad(max + 1)}`;
}
