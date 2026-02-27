/**
 * convex/habits.ts - Habit tracking and streak management
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { nextHabitId } from "./lib/ids";
import * as xp from "./lib/xp";

export const createHabit = mutation({
  args: {
    userId: v.id("users"), name: v.string(),
    lifeArea: v.union(v.literal("health"),v.literal("wealth"),v.literal("relationships"),v.literal("self"),v.literal("career"),v.literal("fun"),v.literal("environment"),v.literal("spirituality")),
    incup: v.optional(v.string()),
    easy: v.optional(v.string()), medium: v.optional(v.string()),
    hard: v.optional(v.string()), peak: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const habitId = await nextHabitId(ctx, args.userId);
    const docId = await ctx.db.insert("habits", {
      userId: args.userId, habitId, name: args.name,
      lifeArea: args.lifeArea, incup: args.incup,
      easy: args.easy, medium: args.medium, hard: args.hard, peak: args.peak,
      startDate: Date.now(), currentStreak: 0, maxStreak: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    return { habitId, _id: docId };
  },
});

export const logHabitSession = mutation({
  args: {
    habitDocId: v.id("habits"),
    difficultyLevel: v.union(v.literal("easy"),v.literal("medium"),v.literal("hard"),v.literal("peak")),
    feelingBefore: v.optional(v.union(v.literal("joyful"),v.literal("excited"),v.literal("hopeful"),v.literal("calm"),v.literal("curious"),v.literal("neutral"),v.literal("bored"),v.literal("anxious"),v.literal("frustrated"),v.literal("overwhelmed"),v.literal("defeated"))),
    feelingAfter: v.optional(v.union(v.literal("joyful"),v.literal("excited"),v.literal("hopeful"),v.literal("calm"),v.literal("curious"),v.literal("neutral"),v.literal("bored"),v.literal("anxious"),v.literal("frustrated"),v.literal("overwhelmed"),v.literal("defeated"))),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitDocId);
    if (!habit) throw new Error("Habit not found");
    const newStreak = habit.currentStreak + 1;
    const habitXp = xp.computeHabitXp({ difficulty: args.difficultyLevel as xp.DifficultyLevel, currentStreak: newStreak });
    const emotionDelta = xp.computeEmotionDelta(args.feelingBefore, args.feelingAfter);
    await ctx.db.patch(args.habitDocId, {
      currentStreak: newStreak, maxStreak: Math.max(newStreak, habit.maxStreak),
      emotionBefore: args.feelingBefore, emotionAfter: args.feelingAfter, emotionDelta,
      updatedAt: Date.now(),
    });
    const user = await ctx.db.get(habit.userId);
    if (user) await ctx.db.patch(habit.userId, { totalXp: user.totalXp + habitXp, updatedAt: Date.now() });
    return { habitXp, currentStreak: newStreak };
  },
});

export const listHabits = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db.query("habits").withIndex("by_user", q => q.eq("userId", userId)).collect();
  },
});
