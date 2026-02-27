/**
 * convex/lib/xp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure XP formula functions. No Convex imports — keeps formulas testable and
 * easy to tweak independently of flow logic.
 *
 * XP Philosophy (CODE framework):
 *   Capture  → reward immediately for dumping brain load
 *   Organise → reward for enriching / prioritising
 *   Done     → biggest reward, scaled by difficulty + timeliness
 *   Evaluate → bonus for closing the loop with reflection
 *
 * Chrysolite = premium currency earned only on exceptional performance.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type CategoryKey =
  | "main-quest"
  | "side-quest"
  | "fake-boss"
  | "sleeping-dragon"
  | "void-filler";

export type HorizonKey =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "annum"
  | "someday";

// ─── Category XP Multipliers ─────────────────────────────────────────────────
// main-quest tasks are most important so they earn the most XP.

export const CATEGORY_MULTIPLIER: Record<CategoryKey, number> = {
  "main-quest": 2.0,
  "side-quest": 1.25,
  "fake-boss": 1.0,   // urgent but not truly important
  "sleeping-dragon": 1.5, // important, deferred — big reward to wake it up
  "void-filler": 0.5,
};

// ─── Horizon XP Adders ───────────────────────────────────────────────────────
// Tighter deadlines = harder to plan = small bonus.

export const HORIZON_BONUS: Record<HorizonKey, number> = {
  today: 5,
  week: 3,
  month: 2,
  quarter: 1,
  annum: 0,
  someday: 0,
};

// ─── INCUP Score Parser ───────────────────────────────────────────────────────
// INCUP string is 5 chars, each char = one dimension (Importance, Novelty,
// Control, Urgency, Panic). Uppercase = high (1), lowercase = low (0).
// Max INCUP score = 5.

export function parseIncupScore(incup: string): number {
  if (!incup) return 0;
  let score = 0;
  for (const ch of incup.slice(0, 5)) {
    if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) score++;
  }
  return score;
}

// ─── 1. Capture XP ────────────────────────────────────────────────────────────
// Flat reward for getting something out of your head.
// Bonus if a URL/link is attached (means you captured a resource, not just text).

export function computeCaptureXp(opts: { hasLink: boolean }): number {
  const base = 10;
  const linkBonus = opts.hasLink ? 5 : 0;
  return base + linkBonus;
}

// ─── 2. Organise XP ──────────────────────────────────────────────────────────
// Reward for enriching a captured item with context.
// Scales with category multiplier, INCUP score, and whether fields were filled.

export interface OrganiseXpInput {
  category: CategoryKey;
  horizon: HorizonKey;
  incup: string;
  hasGoal: boolean;
  hasDeadline: boolean;
  hasEstMinutes: boolean;
  mentalBlock: boolean;
}

export function computeOrganiseXp(input: OrganiseXpInput): number {
  const base = 20;
  const categoryMult = CATEGORY_MULTIPLIER[input.category] ?? 1.0;
  const horizonBonus = HORIZON_BONUS[input.horizon] ?? 0;
  const incupBonus = parseIncupScore(input.incup) * 2; // up to +10
  const goalBonus = input.hasGoal ? 5 : 0;
  const deadlineBonus = input.hasDeadline ? 3 : 0;
  const estBonus = input.hasEstMinutes ? 2 : 0;
  const blockPenalty = input.mentalBlock ? -5 : 0; // face the block = still penalised slightly

  const raw =
    base * categoryMult +
    horizonBonus +
    incupBonus +
    goalBonus +
    deadlineBonus +
    estBonus +
    blockPenalty;

  return Math.max(5, Math.round(raw));
}

// ─── 3. Done XP ──────────────────────────────────────────────────────────────
// Biggest reward. Penalised for being late; bonus for finishing fast.

export interface DoneXpInput {
  organiseXp: number;          // Done XP scales from Organise XP
  completedAt: number;         // epoch ms
  deadline: number | undefined; // epoch ms, optional
  mentalBlock: boolean;
  actualMinutes: number | undefined;
  estMinutes: number | undefined;
}

export interface DoneXpResult {
  doneXp: number;
  isLate: boolean;
  chrysolite: number; // bonus currency for on-time + under-estimate
}

export function computeDoneXp(input: DoneXpInput): DoneXpResult {
  const base = input.organiseXp * 1.5;
  const now = input.completedAt;

  // Late penalty
  let isLate = false;
  let latePenalty = 0;
  if (input.deadline !== undefined) {
    if (now > input.deadline) {
      isLate = true;
      const overMs = now - input.deadline;
      const overHours = overMs / (1000 * 60 * 60);
      // 5% penalty per hour late, capped at 50%
      latePenalty = Math.min(0.5, overHours * 0.05);
    }
  }

  // Mental block bonus — finishing despite a block = extra reward
  const blockBonus = input.mentalBlock ? 10 : 0;

  // Speed bonus — finished faster than estimated
  let speedBonus = 0;
  let chrysolite = 0;
  if (
    input.actualMinutes !== undefined &&
    input.estMinutes !== undefined &&
    input.estMinutes > 0
  ) {
    const ratio = input.actualMinutes / input.estMinutes;
    if (ratio <= 0.8 && !isLate) {
      // Finished 20%+ faster than estimated AND on time → chrysolite!
      chrysolite = 1;
      speedBonus = 15;
    } else if (ratio <= 1.0) {
      speedBonus = 5;
    }
  }

  const doneXp = Math.max(
    1,
    Math.round(base * (1 - latePenalty) + blockBonus + speedBonus),
  );

  return { doneXp, isLate, chrysolite };
}

// ─── 4. Evaluate XP ──────────────────────────────────────────────────────────
// Closing the loop: reward for logging how you felt after.

export interface EvaluateXpInput {
  doneXp: number;
  emotionDelta: number; // positive = improved mood, negative = mood dropped
}

export function computeEvaluateXp(input: EvaluateXpInput): number {
  const base = Math.round(input.doneXp * 0.2); // 20% of Done XP for reflecting
  const moodBonus = input.emotionDelta > 0 ? Math.min(10, input.emotionDelta * 3) : 0;
  return Math.max(5, base + moodBonus);
}

// ─── Emotion Delta Calculator ─────────────────────────────────────────────────
// Maps emotion strings to numeric scores then diffs them.
// Higher number = more positive state.

const EMOTION_SCORE: Record<string, number> = {
  joyful: 10,
  excited: 9,
  hopeful: 8,
  calm: 7,
  curious: 6,
  neutral: 5,
  bored: 4,
  anxious: 3,
  frustrated: 2,
  overwhelmed: 1,
  defeated: 0,
};

export function emotionScore(emotion: string | undefined): number {
  if (!emotion) return 5; // default neutral
  return EMOTION_SCORE[emotion] ?? 5;
}

export function computeEmotionDelta(
  before: string | undefined,
  after: string | undefined,
): number {
  return emotionScore(after) - emotionScore(before);
}

// ─── Habit XP ─────────────────────────────────────────────────────────────────
// XP earned for logging a habit session.

export type DifficultyLevel = "easy" | "medium" | "hard" | "peak";

export const HABIT_XP: Record<DifficultyLevel, number> = {
  easy: 5,
  medium: 10,
  hard: 20,
  peak: 35,
};

export function computeHabitXp(opts: {
  difficulty: DifficultyLevel;
  currentStreak: number;
}): number {
  const base = HABIT_XP[opts.difficulty];
  // Streak multiplier: every 7 days adds 10% bonus, capped at 2x
  const streakMult = Math.min(2.0, 1.0 + Math.floor(opts.currentStreak / 7) * 0.1);
  return Math.round(base * streakMult);
}
