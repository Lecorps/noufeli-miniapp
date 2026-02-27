/**
 * convex/goals.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Goal management: guided gap-analysis setup, CRUD, and queries for the
 * organize flow.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { nextGoalId } from "./lib/ids";

// ─── Mutations ──────────────────────────────────────────────────────────────────────

/**
 * createGoalsFromGapAnalysis
 * Called at the end of the /start onboarding guided flow.
 *
 * Input: an array of gap-analysis entries, one per life area the user
 * rated below their satisfaction threshold. Each entry includes the
 * life area, a title the bot composed (or the user typed), a horizon,
 * and a category for quest classification.
 *
 * Generates sequential goalIds (G-0001, G-0002 …) and inserts goal records.
 * Returns the list of created goals with their IDs.
 */
export const createGoalsFromGapAnalysis = mutation({
  args: {
    userId: v.id("users"),
    goals: v.array(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        lifeArea: v.union(
          v.literal("spiritual"),
          v.literal("physical"),
          v.literal("mental"),
          v.literal("financial"),
          v.literal("social"),
          v.literal("emotional"),
        ),
        horizon: v.union(
          v.literal("today"),
          v.literal("week"),
          v.literal("month"),
          v.literal("quarter"),
          v.literal("annum"),
          v.literal("someday"),
        ),
        category: v.union(
          v.literal("main-quest"),
          v.literal("side-quest"),
          v.literal("fake-boss"),
          v.literal("sleeping-dragon"),
          v.literal("void-filler"),
        ),
        gapScore: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const created: Array<{ goalId: string; _id: string }> = [];

    for (const g of args.goals) {
      const goalId = await nextGoalId(ctx, args.userId);
      const docId = await ctx.db.insert("goals", {
        userId: args.userId,
        goalId,
        title: g.title,
        description: g.description,
        lifeArea: g.lifeArea,
        horizon: g.horizon,
        status: "active",
        category: g.category,
        gapScore: g.gapScore,
        createdAt: now,
        updatedAt: now,
      });
      created.push({ goalId, _id: docId });
    }

    return created;
  },
});

/**
 * createGoal
 * Create a single goal (used for manual goal creation after onboarding).
 */
export const createGoal = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    lifeArea: v.union(
      v.literal("spiritual"), v.literal("physical"), v.literal("mental"),
      v.literal("financial"), v.literal("social"), v.literal("emotional"),
    ),
    horizon: v.union(
      v.literal("today"), v.literal("week"), v.literal("month"),
      v.literal("quarter"), v.literal("annum"), v.literal("someday"),
    ),
    category: v.union(
      v.literal("main-quest"), v.literal("side-quest"), v.literal("fake-boss"),
      v.literal("sleeping-dragon"), v.literal("void-filler"),
    ),
    gapScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const goalId = await nextGoalId(ctx, args.userId);
    const docId = await ctx.db.insert("goals", {
      userId: args.userId,
      goalId,
      title: args.title,
      description: args.description,
      lifeArea: args.lifeArea,
      horizon: args.horizon,
      status: "active",
      category: args.category,
      gapScore: args.gapScore,
      createdAt: now,
      updatedAt: now,
    });
    return { goalId, _id: docId };
  },
});

/**
 * updateGoal
 * Patch any fields of an existing goal (e.g. change status, horizon, category).
 */
export const updateGoal = mutation({
  args: {
    goalDocId: v.id("goals"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    horizon: v.optional(
      v.union(
        v.literal("today"), v.literal("week"), v.literal("month"),
        v.literal("quarter"), v.literal("annum"), v.literal("someday"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"), v.literal("completed"),
        v.literal("paused"), v.literal("abandoned"),
      ),
    ),
    category: v.optional(
      v.union(
        v.literal("main-quest"), v.literal("side-quest"), v.literal("fake-boss"),
        v.literal("sleeping-dragon"), v.literal("void-filler"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { goalDocId, ...fields } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.description !== undefined) patch.description = fields.description;
    if (fields.horizon !== undefined) patch.horizon = fields.horizon;
    if (fields.status !== undefined) patch.status = fields.status;
    if (fields.category !== undefined) patch.category = fields.category;
    await ctx.db.patch(goalDocId, patch);
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────────

/**
 * listGoalsForUser
 * Returns active goals for display in the organize flow and Mini App.
 * Sorted by creation date ascending (oldest goal first).
 */
export const listGoalsForUser = query({
  args: {
    userId: v.id("users"),
    status: v.optional(
      v.union(
        v.literal("active"), v.literal("completed"),
        v.literal("paused"), v.literal("abandoned"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const statusFilter = args.status ?? "active";
    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", statusFilter),
      )
      .collect();

    // Return in a lean shape suited for the organize flow pick-list
    return goals.map((g) => ({
      _id: g._id,
      goalId: g.goalId,
      title: g.title,
      lifeArea: g.lifeArea,
      horizon: g.horizon,
      category: g.category,
      status: g.status,
    }));
  },
});

/**
 * getGoalByGoalId
 * Fetch a single goal by its human-readable ID (e.g. "G-0003").
 */
export const getGoalByGoalId = query({
  args: { userId: v.id("users"), goalId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("goals")
      .withIndex("by_user_goal_id", (q) =>
        q.eq("userId", args.userId).eq("goalId", args.goalId),
      )
      .unique();
  },
});
