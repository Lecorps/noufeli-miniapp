/**
 * convex.js  –  Async ES module HTTP client for the Convex backend.
 *
 * Env var required:
 *   CONVEX_URL  –  e.g. https://happy-animal-123.convex.cloud
 */

function getConvexUrl() {
  const url = process.env.CONVEX_URL;
  if (!url) throw new Error('Missing env var: CONVEX_URL');
  return url.replace(/\/$/, '');
}

export async function convexMutation(path, args) {
  return _convexPost('/api/mutation', path, args);
}

export async function convexQuery(path, args) {
  return _convexPost('/api/query', path, args);
}

async function _convexPost(endpoint, path, args) {
  const url = getConvexUrl() + endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args: args || {}, format: 'json' }),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    throw new Error(`Convex non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (parsed.status === 'error' || parsed.code) {
    throw new Error(`Convex error [${path}]: ${parsed.message || JSON.stringify(parsed)}`);
  }
  return parsed.value !== undefined ? parsed.value : parsed;
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function dbEnsureUser(telegramId, firstName, lastName, username) {
  return convexMutation('users:ensureUser', {
    telegramId: String(telegramId),
    firstName:  firstName || undefined,
    lastName:   lastName  || undefined,
    username:   username  || undefined,
  });
}

export async function dbGetUser(telegramId) {
  return convexQuery('users:getUserByTelegramId', { telegramId: String(telegramId) });
}

export async function dbGetUserSummary(telegramId) {
  return convexQuery('users:getUserSummary', { telegramId: String(telegramId) });
}

export async function dbSetOrganizeInterval(telegramId, minutes) {
  return convexMutation('users:setUserSettings', {
    telegramId: String(telegramId),
    organizeIntervalMinutes: minutes,
  });
}

export async function dbMarkOrganizeDone(telegramId) {
  return convexMutation('users:markOrganizeSessionDone', { telegramId: String(telegramId) });
}

export async function dbListUsersWithPendingOrganize() {
  return convexQuery('users:listUsersWithPendingOrganize', {});
}

// ─── Goal helpers ─────────────────────────────────────────────────────────────

export async function dbCreateGoal(convexUserId, title, lifeArea, horizon, category) {
  return convexMutation('goals:createGoal', {
    userId: convexUserId, title, lifeArea,
    horizon:  horizon  || 'annum',
    category: category || 'main-quest',
  });
}

export async function dbCreateGoalsFromGapAnalysis(convexUserId, goalsArray) {
  return convexMutation('goals:createGoalsFromGapAnalysis', { userId: convexUserId, goals: goalsArray });
}

export async function dbListGoals(convexUserId) {
  return convexQuery('goals:listGoalsForUser', { userId: convexUserId, status: 'active' });
}

// ─── Activity helpers ─────────────────────────────────────────────────────────

export async function dbCaptureActivity(convexUserId, activityText, link) {
  return convexMutation('activities:captureActivity', {
    userId: convexUserId, activity: activityText, link: link || undefined,
  });
}

export async function dbListCaptured(convexUserId) {
  return convexQuery('activities:listCapturedActivities', { userId: convexUserId });
}

export async function dbListReady(convexUserId) {
  return convexQuery('activities:listReadyActivities', { userId: convexUserId });
}

export async function dbListCompleted(convexUserId) {
  return convexQuery('activities:listCompletedActivities', { userId: convexUserId });
}

export async function dbOrganizeActivity(activityDocId, opts) {
  return convexMutation('activities:organizeActivity', {
    activityDocId,
    goalId:        opts.goalId       || undefined,
    incup:         opts.incup        || '',
    lifeArea:      opts.lifeArea,
    horizon:       opts.horizon,
    exeType:       opts.exeType      || 'task',
    category:      opts.category     || 'main-quest',
    deadline:      opts.deadline     || undefined,
    estMinutes:    opts.estMinutes   || undefined,
    mentalBlock:   opts.mentalBlock  || false,
    feelingBefore: opts.feelingBefore || undefined,
    dependsOn:     opts.dependsOn    || undefined,
  });
}

export async function dbStartFocus(activityDocId) {
  return convexMutation('activities:startFocusSession', { activityDocId });
}

export async function dbFinishFocus(activityDocId) {
  return convexMutation('activities:finishFocusSession', { activityDocId });
}

export async function dbEvaluateActivity(activityDocId, feelingAfter) {
  return convexMutation('activities:evaluateActivity', { activityDocId, feelingAfter });
}

// ─── Habit helpers ────────────────────────────────────────────────────────────

export async function dbCreateHabit(convexUserId, opts) {
  return convexMutation('habits:createHabit', {
    userId: convexUserId, name: opts.name, lifeArea: opts.lifeArea,
    incup:  opts.incup  || undefined, easy:   opts.easy   || undefined,
    medium: opts.medium || undefined, hard:   opts.hard   || undefined,
    peak:   opts.peak   || undefined,
  });
}

export async function dbListHabits(convexUserId) {
  return convexQuery('habits:listHabits', { userId: convexUserId });
}

export async function dbLogHabit(habitDocId, difficultyLevel, feelingBefore, feelingAfter) {
  return convexMutation('habits:logHabitSession', {
    habitDocId, difficultyLevel,
    feelingBefore: feelingBefore || undefined,
    feelingAfter:  feelingAfter  || undefined,
  });
}

// ─── Conversation state ───────────────────────────────────────────────────────

export async function dbGetState(telegramId) {
  const user = await dbGetUser(telegramId);
  if (!user) return {};
  try {
    const raw = user.settings?.botState;
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export async function dbSetState(telegramId, state) {
  try {
    return await convexMutation('users:setUserSettings', {
      telegramId: String(telegramId),
      botState: JSON.stringify(state || {}),
    });
  } catch (e) {
    console.error('dbSetState error for', telegramId, e);
  }
}

export async function dbClearState(telegramId) {
  return dbSetState(telegramId, {});
}
