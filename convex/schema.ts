import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Enum Literals ────────────────────────────────────────────────────────────

// Life areas mirrored from the Google Sheets system
const LIFE_AREA = v.union(
  v.literal("spiritual"),
  v.literal("physical"),
  v.literal("mental"),
  v.literal("financial"),
  v.literal("social"),
  v.literal("emotional")
);

// Goal time horizon
const HORIZON = v.union(
  v.literal("today"),
  v.literal("week"),
  v.literal("month"),
  v.literal("quarter"),
  v.literal("annum"),
  v.literal("someday")
);

// Goal / Activity category (CODE quest types)
const CATEGORY = v.union(
  v.literal("main-quest"),
  v.literal("side-quest"),
  v.literal("fake-boss"),
  v.literal("sleeping-dragon"),
  v.literal("void-filler")
);

// Activity execution type
const EXE_TYPE = v.union(
  v.literal("task"),
  v.literal("project"),
  v.literal("habit")
);

// Activity lifecycle status
const ACTIVITY_STATUS = v.union(
  v.literal("captured"),
  v.literal("organized"),
  v.literal("in-progress"),
  v.literal("complete"),
  v.literal("complete-late"),
  v.literal("abandoned")
);

// Goal status
const GOAL_STATUS = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("paused"),
  v.literal("abandoned")
);

// Emotion options (from EMOTION_LIST in types.ts)
const EMOTION = v.union(
  v.literal("joyful"),
  v.literal("excited"),
  v.literal("hopeful"),
  v.literal("calm"),
  v.literal("curious"),
  v.literal("neutral"),
  v.literal("bored"),
  v.literal("anxious"),
  v.literal("frustrated"),
  v.literal("overwhelmed"),
  v.literal("defeated")
);

// ─── Schema ───────────────────────────────────────────────────────────────────

export default defineSchema({
  // ── 1. users ──────────────────────────────────────────────────────────────
  // One record per Telegram user. Created/upserted on first /start.
  users: defineTable({
    // Telegram numeric user ID (string to avoid JS bigint issues)
    telegramId: v.string(),
    // Display name pulled from Telegram
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    username: v.optional(v.string()),
    // User settings
    settings: v.object({
      // How often to remind user to organize their capture inbox (minutes)
      organizeIntervalMinutes: v.optional(v.number()),
      // IANA timezone string, e.g. "America/New_York"
      timezone: v.optional(v.string()),
      // When the user last ran an organize session (epoch ms)
      lastOrganizedAt: v.optional(v.number()),
      // Telegram chat ID (stored so triggers know where to send messages)
      chatId: v.optional(v.string()),
      // JSON-stringified bot conversation state (flow, step, queue, etc.)
      botState: v.optional(v.string()),
    }),
    // Running XP totals for the user
    totalXp: v.number(),
    // Chrysolite (premium XP / currency) balance
    chrysolite: v.number(),
    // Current HP (health points, decremented on late/abandoned tasks)
    hp: v.number(),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Fast lookup by telegramId on every incoming Telegram message
    .index("by_telegram_id", ["telegramId"]),

  // ── 2. goals ──────────────────────────────────────────────────────────────
  // High-level goals that activities are linked to.
  goals: defineTable({
    // Reference to users._id
    userId: v.id("users"),
    // Human-readable auto-incremented ID per user, e.g. "G-0001"
    goalId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    lifeArea: LIFE_AREA,
    // Time horizon for achieving this goal
    horizon: HORIZON,
    status: GOAL_STATUS,
    // Quest category that determines XP multipliers & display color
    category: CATEGORY,
    // Gap-analysis score that led to this goal being created (0-10)
    gapScore: v.optional(v.number()),
    // Timestamps (epoch ms)
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    // Unique goalId per user (enforced in mutation logic)
    .index("by_user_goal_id", ["userId", "goalId"]),

  // ── 3. activities ─────────────────────────────────────────────────────────
  // The core TODO / task table. One record per activity regardless of stage.
  // Fields progress from sparse (captured) to fully populated (evaluated).
  activities: defineTable({
    // Owner
    userId: v.id("users"),
    // Human-readable auto-incremented ID per user, e.g. "A-0042"
    activityId: v.string(),

    // ── Capture fields (set at creation) ──
    // Raw text the user sent/forwarded to the bot
    activity: v.string(),
    // Optional URL attached to the captured item
    link: v.optional(v.string()),
    // Emotion before starting the activity (captured at organize or start)
    feelingBefore: v.optional(EMOTION),
    // ISO timestamp when captured
    capturedAt: v.number(),

    // ── Organize fields (set during organize flow) ──
    // Linked goal (optional — task may exist without a goal)
    goalId: v.optional(v.string()),
    // INCUP priority score string, e.g. "IIICU"
    incup: v.optional(v.string()),
    lifeArea: v.optional(LIFE_AREA),
    horizon: v.optional(HORIZON),
    // Task type determines XP rules
    exeType: v.optional(EXE_TYPE),
    category: v.optional(CATEGORY),
    // Estimated duration in minutes
    estMinutes: v.optional(v.number()),
    // Hard deadline (epoch ms)
    deadline: v.optional(v.number()),
    // Parent activity for subtasks (activityId string)
    dependsOn: v.optional(v.string()),
    // Whether the user reported a mental block when organising
    mentalBlock: v.optional(v.boolean()),

    // ── Execution fields (set during Do phase) ──
    // Timestamp when focus session started (epoch ms)
    sessionStart: v.optional(v.number()),
    // Actual time spent in minutes (computed at session end)
    actualMinutes: v.optional(v.number()),
    // When the task was marked done (epoch ms)
    completedAt: v.optional(v.number()),

    // ── Evaluate fields (set during Evaluate phase) ──
    feelingAfter: v.optional(EMOTION),
    // Numeric delta between feelingBefore and feelingAfter
    emotionDelta: v.optional(v.number()),

    // ── Lifecycle status ──
    status: ACTIVITY_STATUS,
    updatedAt: v.number(),

    // ── XP fields (computed and stored for history/display) ──
    captureXp: v.number(),
    organiseXp: v.optional(v.number()),
    doneXp: v.optional(v.number()),
    evaluateXp: v.optional(v.number()),
    totalXp: v.number(),
    // Chrysolite bonus earned on this activity
    chrysolite: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_captured_at", ["userId", "capturedAt"])
    .index("by_user_goal", ["userId", "goalId"])
    .index("by_user_activity_id", ["userId", "activityId"]),

  // ── 4. habits ─────────────────────────────────────────────────────────────
  // Habit definitions. Each session log is stored as an activity row
  // with exeType = "habit", linked here via habitId.
  habits: defineTable({
    userId: v.id("users"),
    // Human-readable ID per user, e.g. "H-0003"
    habitId: v.string(),
    name: v.string(),
    lifeArea: LIFE_AREA,
    // INCUP score for this habit
    incup: v.optional(v.string()),
    // Difficulty threshold descriptions
    easy: v.optional(v.string()),
    medium: v.optional(v.string()),
    hard: v.optional(v.string()),
    peak: v.optional(v.string()),
    // Habit tracking start date (epoch ms)
    startDate: v.number(),
    // Aggregated stats (updated on each log)
    currentStreak: v.number(),
    maxStreak: v.number(),
    avgDifficulty: v.optional(v.number()),
    emotionBefore: v.optional(EMOTION),
    emotionAfter: v.optional(EMOTION),
    emotionDelta: v.optional(v.number()),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_habit_id", ["userId", "habitId"]),

  // ── 5. sessions (optional — focus session log) ────────────────────────────
  // Stores individual focus session records separate from the activity,
  // useful for analytics (time-on-task history, interruption tracking).
  sessions: defineTable({
    userId: v.id("users"),
    // References activities._id
    activityDocId: v.id("activities"),
    activityId: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    // Actual duration in minutes
    durationMinutes: v.optional(v.number()),
    // Reason the session was interrupted (if applicable)
    interruptedReason: v.optional(v.string()),
    // Whether the session completed the task
    completedTask: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_activity", ["activityDocId"]),
});
