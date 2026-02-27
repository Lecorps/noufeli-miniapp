/**
 * convex/activities.ts - Full CODE lifecycle implementation
 * Capture → Organize → Do → Evaluate with XP rewards at each stage
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { nextActivityId } from "./lib/ids";
import * as xp from "./lib/xp";

/* ====== CAPTURE ====== */
export const captureActivity = mutation({
  args: { userId: v.id("users"), activity: v.string(), link: v.optional(v.string()) },
  handler: async (ctx, { userId, activity, link }) => {
    const activityId = await nextActivityId(ctx, userId);
    const captureXp = xp.computeCaptureXp({ hasLink: !!link });
    const doc = await ctx.db.insert("activities", {
      userId, activityId, activity, link,
      status: "captured", capturedAt: Date.now(), updatedAt: Date.now(),
      captureXp, totalXp: captureXp,
    });
    // Award XP to user
    const user = await ctx.db.get(userId);
    if (user) await ctx.db.patch(userId, { totalXp: user.totalXp + captureXp, updatedAt: Date.now() });
    return { _id: doc, activityId, captureXp };
  },
});

/* ====== ORGANIZE ====== */
export const organizeActivity = mutation({
  args: {
    activityDocId: v.id("activities"),
    goalId: v.optional(v.string()),
    incup: v.string(),
    lifeArea: v.union(v.literal("health"),v.literal("wealth"),v.literal("relationships"),v.literal("self"),v.literal("career"),v.literal("fun"),v.literal("environment"),v.literal("spirituality")),
    horizon: v.union(v.literal("today"),v.literal("week"),v.literal("month"),v.literal("quarter"),v.literal("annum"),v.literal("someday")),
    exeType: v.union(v.literal("task"),v.literal("project"),v.literal("habit")),
    category: v.union(v.literal("main-quest"),v.literal("side-quest"),v.literal("fake-boss"),v.literal("sleeping-dragon"),v.literal("void-filler")),
    deadline: v.optional(v.number()),
    estMinutes: v.optional(v.number()),
    mentalBlock: v.optional(v.boolean()),
    feelingBefore: v.optional(v.union(v.literal("joyful"),v.literal("excited"),v.literal("hopeful"),v.literal("calm"),v.literal("curious"),v.literal("neutral"),v.literal("bored"),v.literal("anxious"),v.literal("frustrated"),v.literal("overwhelmed"),v.literal("defeated"))),
    dependsOn: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const activity = await ctx.db.get(args.activityDocId);
    if (!activity) throw new Error("Activity not found");
    const orgXp = xp.computeOrganiseXp({
      category: args.category as xp.CategoryKey, horizon: args.horizon as xp.HorizonKey,
      incup: args.incup, hasGoal: !!args.goalId, hasDeadline: !!args.deadline,
      hasEstMinutes: !!args.estMinutes, mentalBlock: args.mentalBlock ?? false,
    });
    await ctx.db.patch(args.activityDocId, {
      goalId: args.goalId, incup: args.incup, lifeArea: args.lifeArea,
      horizon: args.horizon, exeType: args.exeType, category: args.category,
      deadline: args.deadline, estMinutes: args.estMinutes,
      mentalBlock: args.mentalBlock ?? false, feelingBefore: args.feelingBefore,
      dependsOn: args.dependsOn, status: "organized",
      organiseXp: orgXp, totalXp: activity.totalXp + orgXp, updatedAt: Date.now(),
    });
    const user = await ctx.db.get(activity.userId);
    if (user) await ctx.db.patch(activity.userId, { totalXp: user.totalXp + orgXp, updatedAt: Date.now() });
    return { organiseXp: orgXp };
  },
});

/* ====== DO ====== */
export const startFocusSession = mutation({
  args: { activityDocId: v.id("activities") },
  handler: async (ctx, { activityDocId }) => {
    await ctx.db.patch(activityDocId, { sessionStart: Date.now(), status: "in-progress", updatedAt: Date.now() });
  },
});

export const finishFocusSession = mutation({
  args: { activityDocId: v.id("activities"), interruptedReason: v.optional(v.string()) },
  handler: async (ctx, { activityDocId, interruptedReason }) => {
    const activity = await ctx.db.get(activityDocId);
    if (!activity || !activity.sessionStart) throw new Error("No active session");
    const now = Date.now();
    const actualMinutes = Math.round((now - activity.sessionStart) / 60000);
    const isLate = activity.deadline ? now > activity.deadline : false;
    const doneResult = xp.computeDoneXp({
      organiseXp: activity.organiseXp ?? 0, completedAt: now,
      deadline: activity.deadline, mentalBlock: activity.mentalBlock ?? false,
      actualMinutes, estMinutes: activity.estMinutes,
    });
    const status = doneResult.isLate ? "complete-late" : "complete";
    await ctx.db.patch(activityDocId, {
      actualMinutes, completedAt: now, status, sessionStart: undefined,
      doneXp: doneResult.doneXp, totalXp: activity.totalXp + doneResult.doneXp,
      chrysolite: (activity.chrysolite ?? 0) + doneResult.chrysolite,
      updatedAt: now,
    });
    const user = await ctx.db.get(activity.userId);
    if (user) await ctx.db.patch(activity.userId, {
      totalXp: user.totalXp + doneResult.doneXp,
      chrysolite: user.chrysolite + doneResult.chrysolite,
      hp: doneResult.isLate ? Math.max(0, user.hp - 10) : user.hp,
      updatedAt: now,
    });
    return { doneXp: doneResult.doneXp, chrysolite: doneResult.chrysolite };
  },
});

/* ====== EVALUATE ====== */
export const evaluateActivity = mutation({
  args: {
    activityDocId: v.id("activities"),
    feelingAfter: v.union(v.literal("joyful"),v.literal("excited"),v.literal("hopeful"),v.literal("calm"),v.literal("curious"),v.literal("neutral"),v.literal("bored"),v.literal("anxious"),v.literal("frustrated"),v.literal("overwhelmed"),v.literal("defeated")),
  },
  handler: async (ctx, { activityDocId, feelingAfter }) => {
    const activity = await ctx.db.get(activityDocId);
    if (!activity || !activity.doneXp) throw new Error("Activity not completed");
    const emotionDelta = xp.computeEmotionDelta(activity.feelingBefore, feelingAfter);
    const evalXp = xp.computeEvaluateXp({ doneXp: activity.doneXp, emotionDelta });
    await ctx.db.patch(activityDocId, {
      feelingAfter, emotionDelta, evaluateXp: evalXp,
      totalXp: activity.totalXp + evalXp, updatedAt: Date.now(),
    });
    const user = await ctx.db.get(activity.userId);
    if (user) await ctx.db.patch(activity.userId, { totalXp: user.totalXp + evalXp, updatedAt: Date.now() });
    return { evaluateXp: evalXp, emotionDelta };
  },
});

/* ====== QUERIES ====== */
export const listCapturedActivities = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db.query("activities")
      .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "captured"))
      .order("asc").collect();
  },
});

export const listReadyActivities = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db.query("activities")
      .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "organized"))
      .collect();
  },
});

export const listCompletedActivities = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const all = await ctx.db.query("activities").withIndex("by_user", q => q.eq("userId", userId)).collect();
    return all.filter(a => a.status === "complete" || a.status === "complete-late").sort((a,b) => (b.completedAt??0) - (a.completedAt??0));
  },
});
