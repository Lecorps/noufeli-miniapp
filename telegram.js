/**
 * telegram.js  –  Telegram Bot API wrappers + update router
 * Async ES module for Node.js / Cloud Run.
 *
 * Env vars required:
 *   BOT_TOKEN      – Telegram bot token
 *   WEBHOOK_SECRET – Secret to verify incoming webhook requests
 *   MINI_APP_URL   – Hosted Mini App URL (used by handleDoFlow / handleEvaluateFlow)
 *
 * Dependency graph (no cycles):
 *   index.js → telegram.js → flows.js → convex.js
 *                          → convex.js
 *
 * flows.js imports send helpers (sendMessage etc.) from telegram.js.
 * To avoid a circular import, the flow handler functions are NOT imported
 * at the top level here. Instead, routeMessage and routeCallbackQuery use
 * a dynamic import() which Node resolves after both modules are fully
 * initialised, so all exports are defined by the time they're called.
 */

import { dbEnsureUser } from './convex.js';

const TG_API = 'https://api.telegram.org/bot';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

async function tgRequest(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('Missing env var: BOT_TOKEN');
  const res = await fetch(`${TG_API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`tgRequest ${method} failed (${res.status}):`, t.slice(0, 300));
  }
  return res.json();
}

export async function sendMessage(chatId, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

export async function editMessage(chatId, messageId, text, extra = {}) {
  return tgRequest('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
}

export async function answerCallbackQuery(callbackQueryId, text = '') {
  return tgRequest('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

export async function sendWebAppButton(chatId, text, buttonText, webAppUrl) {
  return sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: webAppUrl } }]] },
  });
}

export function inlineButtons(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

export function replyKeyboard(rows, oneTime = true) {
  return { reply_markup: { keyboard: rows, one_time_keyboard: oneTime, resize_keyboard: true } };
}

// ---------------------------------------------------------------------------
// Webhook secret verification
// ---------------------------------------------------------------------------

export function verifyWebhookSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) { console.warn('WEBHOOK_SECRET not set – skipping verification.'); return true; }
  const incoming = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (incoming !== secret) { console.warn('Webhook secret mismatch – rejected.'); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Webhook registration helpers
// ---------------------------------------------------------------------------

export async function setWebhook(webhookUrl) {
  const secret = process.env.WEBHOOK_SECRET;
  const payload = { url: webhookUrl };
  if (secret) { payload.secret_token = secret; console.log('Registering webhook WITH secret token.'); }
  else { console.warn('WEBHOOK_SECRET not set – registering without verification.'); }
  const result = await tgRequest('setWebhook', payload);
  console.log('setWebhook result:', JSON.stringify(result));
  return result;
}

export async function deleteWebhook() {
  const result = await tgRequest('deleteWebhook', {});
  console.log('deleteWebhook result:', JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// Main update handler
// ---------------------------------------------------------------------------

export async function handleTelegramUpdate(update) {
  if (update.message) {
    await routeMessage(update.message);
  } else if (update.callback_query) {
    await routeCallbackQuery(update.callback_query);
  }
}

async function routeMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = (msg.text || '').trim();

  // Dynamic import resolves after both modules are fully initialised,
  // so flows.js exports are guaranteed to be defined by this point.
  const flows = await import('./flows.js');

  try {
    await dbEnsureUser(String(userId), msg.from.first_name, msg.from.last_name, msg.from.username);
  } catch (e) {
    console.error('ensureUser error:', e);
  }

  if (msg.forward_date || msg.forward_from || msg.forward_origin) {
    await flows.handleForwardedMessage(msg); return;
  }

  if (text.startsWith('/start'))    { await flows.handleStart(msg);                        return; }
  if (text.startsWith('/reset'))    { await flows.handleReset(msg);                        return; }
  if (text.startsWith('/do'))       { await flows.handleDoFlow(msg);                       return; }
  if (text.startsWith('/evaluate')) { await flows.handleEvaluateFlow(msg);                 return; }
  if (text.startsWith('/habits'))   { await flows.handleHabitsMenu(msg);                   return; }
  if (text.startsWith('/summary'))  { await flows.sendDailySummary(chatId, userId);        return; }

  await flows.handleConversationState(msg);
}

async function routeCallbackQuery(cq) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const data   = cq.data;

  const flows = await import('./flows.js');

  await answerCallbackQuery(cq.id);

  try {
    await dbEnsureUser(String(userId), cq.from.first_name, cq.from.last_name, cq.from.username);
  } catch (e) {
    console.error('ensureUser error in callback:', e);
  }

  if (data.startsWith('ORG_ORDER:'))   { await flows.handleOrganizeOrder(cq);    return; }
  if (data.startsWith('ORG_GOAL:'))    { await flows.handleOrganizeGoal(cq);     return; }
  if (data.startsWith('ORG_INCUP:'))   { await flows.handleOrganizeIncup(cq);    return; }
  if (data.startsWith('ORG_AREA:'))    { await flows.handleOrganizeArea(cq);     return; }
  if (data.startsWith('ORG_HORIZON:')) { await flows.handleOrganizeHorizon(cq);  return; }
  if (data.startsWith('ORG_TYPE:'))    { await flows.handleOrganizeType(cq);     return; }
  if (data.startsWith('ORG_CAT:'))     { await flows.handleOrganizeCategory(cq); return; }
  if (data.startsWith('ORG_DONE'))     { await flows.handleOrganizeDone(cq);     return; }
  if (data.startsWith('SETUP_GUIDE:')) { await flows.handleSetupGuide(cq);       return; }
  if (data.startsWith('HABIT_LOG:'))   { await flows.handleHabitLog(cq);         return; }
  if (data.startsWith('HABIT_DIFF:'))  { await flows.handleHabitDiff(cq);        return; }
  if (data === 'DO_FLOW')   { await flows.handleDoFlow({ chat: { id: chatId }, from: { id: userId } });   return; }
  if (data === 'EVAL_FLOW') { await flows.handleEvaluateFlow({ chat: { id: chatId }, from: { id: userId } }); return; }
}
