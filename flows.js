/**
 * flows.js  –  Telegram bot conversation flows (async ES module)
 */

import {
  convexMutation,
  dbEnsureUser, dbGetUser, dbGetUserSummary,
  dbSetOrganizeInterval, dbMarkOrganizeDone, dbListUsersWithPendingOrganize,
  dbCreateGoalsFromGapAnalysis,
  dbListGoals, dbCaptureActivity, dbListCaptured,
  dbOrganizeActivity, dbCreateHabit, dbListHabits, dbLogHabit,
  dbGetState, dbSetState, dbClearState,
} from './convex.js';

import {
  sendMessage, editMessage, sendWebAppButton, inlineButtons,
} from './telegram.js';

const LIFE_AREAS = ['spiritual','physical','mental','financial','social','emotional'];
const LIFE_AREA_LABELS = {
  spiritual: 'Spiritual ✝️', physical: 'Physical 💪', mental: 'Mental 🧠',
  financial: 'Financial 💰', social: 'Social 👥',     emotional: 'Emotional ❤️',
};
const HORIZONS      = ['today','week','month','quarter','annum','someday'];
const INCUP_OPTIONS = ['Interesting','Novel','Challenging','Urgent','Pressure/Passion'];
const CATEGORIES    = ['main-quest','side-quest','fake-boss','sleeping-dragon','void-filler'];
const EXE_TYPES     = ['task','project','habit'];

// ─── State helpers ────────────────────────────────────────────────────────────

async function getState(telegramId) {
  return (await dbGetState(telegramId)) || {};
}

async function setState(telegramId, state) {
  await dbSetState(telegramId, state);
}

async function clearState(telegramId) {
  await dbClearState(telegramId);
}

async function setWaiting(telegramId, waiting) {
  const state = await getState(telegramId);
  state.waiting4Reply = !!waiting;
  await setState(telegramId, state);
}

async function isWaiting(telegramId) {
  const state = await getState(telegramId);
  return !!(state && state.waiting4Reply);
}

// ─── /start ──────────────────────────────────────────────────────────────────

export async function handleStart(msg) {
  const chatId     = msg.chat.id;
  const telegramId = String(msg.from.id);
  const name       = msg.from.first_name || 'Adventurer';

  const convexUserId = await dbEnsureUser(telegramId, msg.from.first_name, msg.from.last_name, msg.from.username);
  await convexMutation('users:setUserSettings', { telegramId, chatId: String(chatId) });

  const existing = await getState(telegramId);
  if (existing && existing.flow) {
    await sendMessage(chatId,
      `⏳ You're already in the middle of setup, ${name}\n\n` +
      'Please answer the current question to continue, or send /reset to start over.'
    );
    return;
  }

  await setState(telegramId, { flow: 'onboarding', convexUserId });
  await sendMessage(chatId,
    `⚔️ Welcome to <b>Noufeli</b>, ${name}!\n\n` +
    'I turn your captured thoughts into an epic quest system.\n\nHow would you like to start?',
    inlineButtons([[
      { text: 'Help me set goals',  callback_data: 'SETUP_GUIDE:start' },
      { text: 'Add goals manually', callback_data: 'SETUP_GUIDE:manual' },
    ]])
  );
}

// ─── Setup guide callbacks ────────────────────────────────────────────────────

export async function handleSetupGuide(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const data       = cq.data;

  await convexMutation('users:setUserSettings', { telegramId, chatId: String(chatId) });

  const state        = await getState(telegramId);
  const convexUserId = state.convexUserId || await dbEnsureUser(telegramId);

  if (data === 'SETUP_GUIDE:manual') {
    await editMessage(chatId, cq.message.message_id, '⚔️ Welcome to <b>Noufeli</b>!\n\n✅ Manual setup selected.');
    await setState(telegramId, { flow: 'manual_goals', step: 'waiting', convexUserId });
    await setWaiting(telegramId, true);
    await sendMessage(chatId,
      '📋 <b>Set up your goals</b>\n\nCopy the format below, fill in each area, then send it back:\n\n' +
      '<pre>Spiritual: \nPhysical: \nMental: \nFinancial: \nSocial: \nEmotional: </pre>'
    );
    return;
  }

  if (data === 'SETUP_GUIDE:start') {
    await editMessage(chatId, cq.message.message_id, '⚔️ Welcome to <b>Noufeli</b>!\n\n✅ Guided setup selected.');
    await setState(telegramId, { flow: 'gap_analysis', areaIndex: 0, step: 'ideal', areaData: {}, convexUserId });
    await askGapAnalysisQuestion(chatId, telegramId);
    return;
  }

  if (data.startsWith('SETUP_GUIDE:interval:')) {
    const minutes = parseInt(data.split(':')[2]);
    const user = await dbGetUser(telegramId);
    if (user?.settings?.organizeIntervalMinutes > 0) return; // duplicate guard

    await dbSetOrganizeInterval(telegramId, minutes);
    await dbMarkOrganizeDone(telegramId);

    const label = minutes === 90 ? '90 min' : minutes === 120 ? '2 hours' : '4 hours';
    await editMessage(chatId, cq.message.message_id,
      `How often should I remind you to organise captured activities?\n\n✅ <b>${label}</b> selected.`
    );
    await sendMessage(chatId,
      `✅ Got it! I'll remind you every ${minutes >= 60 ? (minutes / 60) + ' hour(s)' : minutes + ' min'}.\n\n` +
      'You\'re all set! Forward me any message to capture it as a task. 🚀'
    );
    await clearState(telegramId);
  }
}

// ─── /reset ──────────────────────────────────────────────────────────────────

export async function handleReset(msg) {
  const chatId     = msg.chat.id;
  const telegramId = String(msg.from.id);
  await dbEnsureUser(telegramId, msg.from.first_name, msg.from.last_name, msg.from.username);
  await dbClearState(telegramId);
  await sendMessage(chatId,
    '🔄 State cleared! Send /start to begin setup again, or just forward a message to capture a task.'
  );
}

// ─── Manual goals ─────────────────────────────────────────────────────────────

async function handleManualGoalsReply(chatId, telegramId, text, state) {
  const areaMap = {
    spiritual: 'spiritual', physical: 'physical', mental: 'mental',
    financial: 'financial', social: 'social', emotional: 'emotional',
  };
  const saved = [], skipped = [], goalsToCreate = [];

  text.split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) return;
    const rawArea = line.substring(0, colonIdx).trim().toLowerCase();
    const goal    = line.substring(colonIdx + 1).trim();
    const area    = areaMap[rawArea];
    if (!area) return;
    if (!goal) { skipped.push(rawArea); return; }
    goalsToCreate.push({ title: goal, lifeArea: area, horizon: 'annum', category: 'main-quest' });
    saved.push(`✅ <b>${rawArea.charAt(0).toUpperCase() + rawArea.slice(1)}:</b> ${goal}`);
  });

  if (saved.length === 0) {
    await sendMessage(chatId,
      '⚠️ I couldn\'t read any goals. Use the format:\n\n<pre>Spiritual: your goal here</pre>'
    );
    return;
  }

  await dbCreateGoalsFromGapAnalysis(state.convexUserId, goalsToCreate);

  let summary = '🏆 <b>Goals saved!</b>\n\n' + saved.join('\n');
  if (skipped.length > 0) summary += '\n\n⏭️ Skipped (blank): ' + skipped.join(', ');
  await sendMessage(chatId, summary);

  await setState(telegramId, { flow: 'onboarding', step: 'interval', convexUserId: state.convexUserId });
  await setWaiting(telegramId, true);
  await sendMessage(chatId,
    'Almost done! How often should I remind you to organise?',
    inlineButtons([[
      { text: '90 min',  callback_data: 'SETUP_GUIDE:interval:90' },
      { text: '2 hours', callback_data: 'SETUP_GUIDE:interval:120' },
      { text: '4 hours', callback_data: 'SETUP_GUIDE:interval:240' },
    ]])
  );
}

// ─── Gap analysis ─────────────────────────────────────────────────────────────

async function askGapAnalysisQuestion(chatId, telegramId) {
  const state = await getState(telegramId);
  const area  = LIFE_AREAS[state.areaIndex];
  if (!area) { await deriveGoalsFromGapAnalysis(chatId, telegramId); return; }
  if (await isWaiting(telegramId)) return;

  const label = LIFE_AREA_LABELS[area] || area;
  const stepTexts = {
    ideal:    `In your <b>${label}</b> life area, describe your <b>ideal</b> state:`,
    current:  `What is your <b>current</b> state in ${label}?`,
    obstacle: 'What are the main <b>obstacles</b> stopping you?',
  };
  await sendMessage(chatId, stepTexts[state.step] || 'Tell me more:');
  await setWaiting(telegramId, true);
}

async function handleGapAnalysisReply(chatId, telegramId, text, state) {
  const area = LIFE_AREAS[state.areaIndex];
  if (!state.areaData) state.areaData = {};
  if (!state.areaData[area]) state.areaData[area] = {};
  await setWaiting(telegramId, false);
  state.areaData[area][state.step] = text;
  if (state.step === 'ideal')        state.step = 'current';
  else if (state.step === 'current') state.step = 'obstacle';
  else { state.areaIndex++; state.step = 'ideal'; }
  await setState(telegramId, state);
  await askGapAnalysisQuestion(chatId, telegramId);
}

async function deriveGoalsFromGapAnalysis(chatId, telegramId) {
  const state    = await getState(telegramId);
  const areaData = state.areaData || {};
  const goalsToCreate = [];

  LIFE_AREAS.forEach(area => {
    const d = areaData[area];
    if (!d?.ideal) return;
    goalsToCreate.push({ title: `Reach ideal ${area}: ${d.ideal.substring(0, 80)}`, lifeArea: area, horizon: 'annum', category: 'main-quest' });
    if (d.obstacle?.length > 20) {
      goalsToCreate.push({ title: `Overcome ${area} obstacle: ${d.obstacle.substring(0, 80)}`, lifeArea: area, horizon: 'quarter', category: 'sleeping-dragon' });
    }
  });

  await dbCreateGoalsFromGapAnalysis(state.convexUserId, goalsToCreate);
  await sendMessage(chatId,
    `🏆 Gap analysis complete! Created <b>${goalsToCreate.length}</b> goals.\n\nHow often should I remind you to organise?`,
    inlineButtons([[
      { text: '90 min',  callback_data: 'SETUP_GUIDE:interval:90' },
      { text: '2 hours', callback_data: 'SETUP_GUIDE:interval:120' },
      { text: '4 hours', callback_data: 'SETUP_GUIDE:interval:240' },
    ]])
  );
  await setState(telegramId, { flow: 'onboarding', step: 'interval', convexUserId: state.convexUserId });
  await setWaiting(telegramId, true);
}

// ─── Conversation state router ────────────────────────────────────────────────

export async function handleConversationState(msg) {
  const chatId     = msg.chat.id;
  const telegramId = String(msg.from.id);
  const text       = msg.text || '';
  const state      = await getState(telegramId);
  if (!state?.flow) return;

  if (state.flow === 'gap_analysis') { await handleGapAnalysisReply(chatId, telegramId, text, state); return; }
  if (state.flow === 'manual_goals') { await handleManualGoalsReply(chatId, telegramId, text, state); return; }
  if (state.flow === 'organise')     { await handleOrganiseTextReply(chatId, telegramId, text, state); return; }
  if (state.flow === 'habit_create') { await handleHabitCreateReply(chatId, telegramId, text, state); return; }
}

// ─── Capture (forwarded messages) ────────────────────────────────────────────

export async function handleForwardedMessage(msg) {
  const chatId     = msg.chat.id;
  const telegramId = String(msg.from.id);

  let text = msg.text || msg.caption || '';
  if (msg.forward_origin?.type === 'channel') text = text || '[Channel post]';

  let link;
  if (msg.forward_from_chat && msg.forward_from_message_id) {
    link = `https://t.me/c/${String(msg.forward_from_chat.id).replace('-100', '')}/${msg.forward_from_message_id}`;
  }

  const convexUserId = await dbEnsureUser(telegramId, msg.from.first_name, msg.from.last_name, msg.from.username);
  const result = await dbCaptureActivity(convexUserId, text, link);

  await sendMessage(chatId,
    `⚡ <b>Captured!</b>\n\n📋 <code>${result.activityId}</code>\n` +
    `📝 ${text.substring(0, 80)}${text.length > 80 ? '…' : ''}\n` +
    `✨ +${result.captureXp} CaptureXP\n\nForward more or use /organise when ready!`
  );
}

// ─── Organise flow ────────────────────────────────────────────────────────────

export async function triggerOrganiseReminder(telegramId, chatId) {
  const state = await getState(telegramId);
  if (state?.flow) return;
  const convexUserId = await dbEnsureUser(telegramId);
  const captured = await dbListCaptured(convexUserId);
  if (!captured?.length) return;
  await sendMessage(chatId,
    `📬 You have <b>${captured.length}</b> captured activities to organise.\n\nWhich order?`,
    inlineButtons([[
      { text: '⏰ First → Last', callback_data: 'ORG_ORDER:asc' },
      { text: '🔄 Last → First', callback_data: 'ORG_ORDER:desc' },
    ]])
  );
}

export async function handleOrganizeOrder(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const order      = cq.data.split(':')[1];
  const state      = await getState(telegramId);
  const convexUserId = state.convexUserId || await dbEnsureUser(telegramId);

  let captured = await dbListCaptured(convexUserId);
  if (!captured?.length) { await sendMessage(chatId, '✅ Nothing to organise right now!'); return; }
  if (order === 'desc') captured = captured.reverse();

  await setState(telegramId, {
    flow: 'organise', convexUserId,
    queue: captured.map(a => ({ id: a._id, activityId: a.activityId, activity: a.activity })),
    qIndex: 0,
  });
  await presentOrganiseItem(chatId, telegramId);
}

async function presentOrganiseItem(chatId, telegramId) {
  const state = await getState(telegramId);
  if (state.qIndex >= state.queue.length) { await finishOrganise(chatId, telegramId); return; }
  if (await isWaiting(telegramId)) return;

  const item  = state.queue[state.qIndex];
  const goals = await dbListGoals(state.convexUserId) || [];
  const goalList = goals.length > 0
    ? goals.map((g, i) => `${i + 1}. ${g.title} [${g.goalId}]`).join('\n')
    : 'No goals yet — reply <code>0</code> to skip';

  await sendMessage(chatId,
    `🗂️ <b>Organising ${state.qIndex + 1}/${state.queue.length}</b>\n\n📝 ${item.activity}\n\n` +
    `<b>Step 1/7:</b> Which goal does this belong to?\n\n${goalList}\n\nReply with a number or <code>0</code> to skip:`
  );
  state.step  = 'goal';
  state.goals = goals;
  await setState(telegramId, state);
  await setWaiting(telegramId, true);
}

async function handleOrganiseTextReply(chatId, telegramId, text, state) {
  if (state.step !== 'goal') return;
  await setWaiting(telegramId, false);
  const goals = state.goals || [];
  const idx   = parseInt(text.trim()) - 1;
  const goal  = (idx >= 0 && goals[idx]) ? goals[idx] : null;
  state.pendingGoalId = goal ? goal.goalId : undefined;
  await setState(telegramId, state);
  await askOrganiseStep(chatId, telegramId, 'incup');
}

export async function handleOrganizeGoal(cq) {}

export async function handleOrganizeIncup(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const state      = await getState(telegramId);
  await setWaiting(telegramId, false);
  const tag = cq.data.replace('ORG_INCUP:', '');
  if (!state.incupSelected) state.incupSelected = [];

  if (tag === 'DONE') {
    state.pendingIncup = state.incupSelected.join('');
    delete state.incupSelected;
    await setState(telegramId, state);
    await askOrganiseStep(chatId, telegramId, 'area');
    return;
  }

  const idx = state.incupSelected.indexOf(tag);
  if (idx >= 0) state.incupSelected.splice(idx, 1); else state.incupSelected.push(tag);
  await setState(telegramId, state);

  const buttons = INCUP_OPTIONS.map(opt => {
    const sel = state.incupSelected.includes(opt) ? '✅ ' : '';
    return [{ text: sel + opt, callback_data: 'ORG_INCUP:' + opt }];
  });
  buttons.push([{ text: '✔️ Done', callback_data: 'ORG_INCUP:DONE' }]);
  await editMessage(chatId, cq.message.message_id,
    '🗂️ <b>Step 2/7:</b> INCUP tags (tap to toggle):',
    { reply_markup: { inline_keyboard: buttons } }
  );
  await setWaiting(telegramId, true);
}

export async function handleOrganizeArea(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const state      = await getState(telegramId);
  await setWaiting(telegramId, false);

  if (cq.data.startsWith('ORG_AREA:habit:')) {
    const area = cq.data.replace('ORG_AREA:habit:', '');
    state.habitLifeArea = area;
    state.step = 'variants';
    await setState(telegramId, state);
    await sendMessage(chatId,
      `💪 Enter difficulty variants for <b>${state.habitName || 'this habit'}</b>:\n\n` +
      'Format: <code>Easy / Medium / Hard / Peak</code>\n' +
      'Example: <code>10 min walk / 30 min walk / 5km run / 10km run</code>'
    );
    await setWaiting(telegramId, true);
    return;
  }

  state.pendingArea = cq.data.replace('ORG_AREA:', '');
  await setState(telegramId, state);
  await askOrganiseStep(chatId, telegramId, 'horizon');
}

export async function handleOrganizeHorizon(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const state      = await getState(telegramId);
  await setWaiting(telegramId, false);
  state.pendingHorizon = cq.data.replace('ORG_HORIZON:', '');
  await setState(telegramId, state);
  await askOrganiseStep(chatId, telegramId, 'type');
}

export async function handleOrganizeType(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const state      = await getState(telegramId);
  await setWaiting(telegramId, false);
  state.pendingType = cq.data.replace('ORG_TYPE:', '');
  await setState(telegramId, state);
  await askOrganiseStep(chatId, telegramId, 'category');
}

export async function handleOrganizeCategory(cq) {
  const chatId     = cq.message.chat.id;
  const telegramId = String(cq.from.id);
  const state      = await getState(telegramId);
  await setWaiting(telegramId, false);

  const item   = state.queue[state.qIndex];
  const result = await dbOrganizeActivity(item.id, {
    goalId:      state.pendingGoalId,
    incup:       state.pendingIncup || '',
    lifeArea:    state.pendingArea,
    horizon:     state.pendingHorizon,
    exeType:     state.pendingType || 'task',
    category:    cq.data.replace('ORG_CAT:', ''),
    mentalBlock: false,
  });

  await sendMessage(chatId, `✅ Organised! <b>+${result.organiseXp} OrganiseXP</b>`);

  state.qIndex++;
  delete state.pendingGoalId; delete state.pendingIncup;
  delete state.pendingArea;   delete state.pendingHorizon;
  delete state.pendingType;
  await setState(telegramId, state);
  await presentOrganiseItem(chatId, telegramId);
}

export async function handleOrganizeDone(cq) {
  await finishOrganise(cq.message.chat.id, String(cq.from.id));
}

async function askOrganiseStep(chatId, telegramId, step) {
  const state = await getState(telegramId);
  if (await isWaiting(telegramId)) return;
  state.step = step;
  await setState(telegramId, state);

  if (step === 'incup') {
    const buttons = INCUP_OPTIONS.map(opt => [{ text: opt, callback_data: 'ORG_INCUP:' + opt }]);
    buttons.push([{ text: '✔️ Done', callback_data: 'ORG_INCUP:DONE' }]);
    await sendMessage(chatId, '🗂️ <b>Step 2/7:</b> INCUP tags (tap to toggle):', { reply_markup: { inline_keyboard: buttons } });
    await setWaiting(telegramId, true);
  } else if (step === 'area') {
    await sendMessage(chatId, '🗂️ <b>Step 3/7:</b> Life Area:',
      inlineButtons([
        LIFE_AREAS.slice(0, 3).map(a => ({ text: LIFE_AREA_LABELS[a] || a, callback_data: 'ORG_AREA:' + a })),
        LIFE_AREAS.slice(3).map(a => ({ text: LIFE_AREA_LABELS[a] || a, callback_data: 'ORG_AREA:' + a })),
      ])
    );
    await setWaiting(telegramId, true);
  } else if (step === 'horizon') {
    await sendMessage(chatId, '🗂️ <b>Step 4/7:</b> Horizon:',
      inlineButtons([
        HORIZONS.slice(0, 3).map(h => ({ text: h, callback_data: 'ORG_HORIZON:' + h })),
        HORIZONS.slice(3).map(h => ({ text: h, callback_data: 'ORG_HORIZON:' + h })),
      ])
    );
    await setWaiting(telegramId, true);
  } else if (step === 'type') {
    await sendMessage(chatId, '🗂️ <b>Step 5/7:</b> Execution type:',
      inlineButtons([EXE_TYPES.map(t => ({ text: t, callback_data: 'ORG_TYPE:' + t }))])
    );
    await setWaiting(telegramId, true);
  } else if (step === 'category') {
    await sendMessage(chatId, '🗂️ <b>Step 6/7:</b> Quest category:',
      inlineButtons([
        CATEGORIES.slice(0, 2).map(c => ({ text: c, callback_data: 'ORG_CAT:' + c })),
        CATEGORIES.slice(2).map(c => ({ text: c, callback_data: 'ORG_CAT:' + c })),
      ])
    );
    await setWaiting(telegramId, true);
  }
}

async function finishOrganise(chatId, telegramId) {
  await dbMarkOrganizeDone(telegramId);
  await clearState(telegramId);
  await sendMessage(chatId,
    '🎉 Organising complete!\n\nWhat would you like to do next?',
    inlineButtons([[
      { text: '⚔️ Execute tasks',      callback_data: 'DO_FLOW' },
      { text: '📊 Evaluate done tasks', callback_data: 'EVAL_FLOW' },
    ]])
  );
}

// ─── Do / Evaluate ───────────────────────────────────────────────────────────

export async function handleDoFlow(msg) {
  const chatId     = msg.chat.id;
  const telegramId = msg.from ? String(msg.from.id) : '';
  const url = (process.env.MINI_APP_URL || 'https://your-mini-app.example.com') + `?tab=do&userId=${telegramId}`;
  await sendWebAppButton(chatId, '⚔️ Open your quest list to execute tasks:', '🗡️ Execute Quests', url);
}

export async function handleEvaluateFlow(msg) {
  const chatId     = msg.chat.id;
  const telegramId = msg.from ? String(msg.from.id) : '';
  const url = (process.env.MINI_APP_URL || 'https://your-mini-app.example.com') + `?tab=evaluate&userId=${telegramId}`;
  await sendWebAppButton(chatId, '📊 Open completed quests to evaluate:', '🔍 Evaluate Quests', url);
}

// ─── Habits ───────────────────────────────────────────────────────────────────

export async function handleHabitsMenu(msg) {
  const chatId       = msg.chat.id;
  const telegramId   = String(msg.from.id);
  const state        = await getState(telegramId);
  const convexUserId = state.convexUserId || await dbEnsureUser(telegramId);
  const habits       = await dbListHabits(convexUserId) || [];

  if (habits.length === 0) {
    await sendMessage(chatId, '📿 No habits yet. Let\'s create one!\nSend me the habit name:');
    await setState(telegramId, { flow: 'habit_create', step: 'name', convexUserId });
    await setWaiting(telegramId, true);
    return;
  }

  await sendMessage(chatId,
    '📿 <b>Your habits:</b>\n\n' + habits.map(h => `• ${h.name} 🔥${h.currentStreak}`).join('\n') + '\n\nLog a completion:',
    inlineButtons(habits.slice(0, 8).map(h => [{ text: `${h.name} 🔥${h.currentStreak}`, callback_data: 'HABIT_LOG:' + h._id }]))
  );
}

async function handleHabitCreateReply(chatId, telegramId, text, state) {
  if (state.step === 'name') {
    state.habitName = text;
    state.step = 'lifeArea';
    await setState(telegramId, state);
    await sendMessage(chatId, 'Life area for this habit?',
      inlineButtons([
        LIFE_AREAS.slice(0, 3).map(a => ({ text: LIFE_AREA_LABELS[a] || a, callback_data: 'ORG_AREA:habit:' + a })),
        LIFE_AREAS.slice(3).map(a => ({ text: LIFE_AREA_LABELS[a] || a, callback_data: 'ORG_AREA:habit:' + a })),
      ])
    );
    await setWaiting(telegramId, true);
    return;
  }
  if (state.step === 'variants') {
    const parts = text.split('/').map(t => t.trim());
    await dbCreateHabit(state.convexUserId, {
      name: state.habitName, lifeArea: state.habitLifeArea || 'mental',
      easy: parts[0] || undefined, medium: parts[1] || undefined,
      hard: parts[2] || undefined, peak:   parts[3] || undefined,
    });
    await sendMessage(chatId, `✅ Habit "<b>${state.habitName}</b>" created! 🔥\nUse /habits to log completions.`);
    await clearState(telegramId);
  }
}

export async function handleHabitLog(cq) {
  const chatId       = cq.message.chat.id;
  const telegramId   = String(cq.from.id);
  const habitDocId   = cq.data.replace('HABIT_LOG:', '');
  const state        = await getState(telegramId);
  const convexUserId = state.convexUserId || await dbEnsureUser(telegramId);
  const habits       = await dbListHabits(convexUserId) || [];
  const habit        = habits.find(h => h._id === habitDocId);
  if (!habit) { await sendMessage(chatId, 'Habit not found.'); return; }

  const variants = [
    { label: habit.easy   || 'Easy',   key: 'easy' },
    { label: habit.medium || 'Medium', key: 'medium' },
    { label: habit.hard   || 'Hard',   key: 'hard' },
    { label: habit.peak   || 'Peak',   key: 'peak' },
  ];
  await sendMessage(chatId, `💪 Logging <b>${habit.name}</b>\n\nSelect difficulty:`,
    inlineButtons(variants.map(v => [{ text: v.label, callback_data: `HABIT_DIFF:${habitDocId}:${v.key}` }]))
  );
}

export async function handleHabitDiff(cq) {
  const chatId   = cq.message.chat.id;
  const parts    = cq.data.split(':');
  const habitDocId   = parts[1];
  const difficulty   = parts[2];
  const result = await dbLogHabit(habitDocId, difficulty);
  await editMessage(chatId, cq.message.message_id,
    `✅ Logged! <b>+${result.habitXp} XP</b>  🔥 Streak: ${result.currentStreak}`
  );
}

// ─── Daily summary ────────────────────────────────────────────────────────────

export async function sendDailySummary(chatId, telegramId) {
  const summary = await dbGetUserSummary(String(telegramId));
  if (!summary) { await sendMessage(chatId, '⚠️ No data found yet. Forward a message to get started!'); return; }
  await sendMessage(chatId,
    `📊 <b>Daily Summary</b>\n\n` +
    `⚔️ Rank: <b>${summary.rank}</b> (Level ${summary.level})\n` +
    `✨ Total XP: <b>${summary.totalXp}</b>\n` +
    `💎 Chrysolite: <b>${summary.chrysolite}</b>\n` +
    `❤️ HP: <b>${summary.hp}/100</b>\n\n` +
    `📋 Captured: ${summary.capturedCount}  |  Ready: ${summary.readyCount}  |  Done: ${summary.doneCount}\n` +
    `🎯 Active goals: ${summary.goalCount}  |  Habits: ${summary.habitCount}\n\nKeep going! 🏆`
  );
}

// ─── Organise reminder trigger ────────────────────────────────────────────────

export async function organiseReminderTrigger() {
  try {
    const users = await dbListUsersWithPendingOrganize();
    if (!users?.length) return;
    await Promise.all(users.map(async user => {
      try {
        const { telegramId } = user;
        const chatId = user.settings?.chatId;
        if (!chatId) return;
        if (!user.settings?.lastOrganizedAt) return;
        const state = await dbGetState(telegramId);
        if (state?.flow) { console.log(`Skipping reminder for ${telegramId} – mid-conversation`); return; }
        await triggerOrganiseReminder(telegramId, chatId);
      } catch (e) {
        console.error('Reminder error for user', user.telegramId, e);
      }
    }));
  } catch (e) {
    console.error('organiseReminderTrigger error:', e);
  }
}
