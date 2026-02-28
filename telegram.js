/**
 * telegram.js  –  Telegram Bot API wrappers + update router
 * Async ES module for Node.js / Cloud Run.
 *
 * Env vars required:
 *   BOT_TOKEN      – Telegram bot token
 *   WEBHOOK_SECRET – Secret to verify incoming webhook requests
 *   MINI_APP_URL   – Hosted Mini App URL (used by handleDoFlow / handleEvaluateFlow)
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

// ---------------------------------------------------------------------------
// Keyboard builders  (synchronous, no API call)
// ---------------------------------------------------------------------------

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
// Webhook registration helpers  (call once via admin route or setup script)
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
// Main update handler (call this from your Express / Cloud Run route)
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

  // Ensure user exists in Convex on every message so getState() always works.
  try {
    await dbEnsureUser(String(userId), msg.from.first_name, msg.from.last_name, msg.from.username);
  } catch (e) {
    console.error('ensureUser error:', e);
  }

  // Forwarded message → Capture flow
  if (msg.forward_date || msg.forward_from || msg.forward_origin) {
    await handleForwardedMessage(msg);
    return;
  }

  // Commands
  if (text.startsWith('/start'))    { await handleStart(msg);                               return; }
  if (text.startsWith('/reset'))    { await handleReset(msg);                               return; }
  if (text.startsWith('/do'))       { await handleDoFlow(msg);                              return; }
  if (text.startsWith('/evaluate')) { await handleEvaluateFlow(msg);                        return; }
  if (text.startsWith('/habits'))   { await handleHabitsMenu(msg);                          return; }
  if (text.startsWith('/summary'))  { await sendDailySummary(chatId, userId);               return; }

  // State-machine conversation
  await handleConversationState(msg);
}

async function routeCallbackQuery(cq) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const data   = cq.data;

  await answerCallbackQuery(cq.id);

  // Ensure user exists so getState() works in all handlers.
  try {
    await dbEnsureUser(String(userId), cq.from.first_name, cq.from.last_name, cq.from.username);
  } catch (e) {
    console.error('ensureUser error in callback:', e);
  }

  if (data.startsWith('ORG_ORDER:'))   { await handleOrganizeOrder(cq);    return; }
  if (data.startsWith('ORG_GOAL:'))    { await handleOrganizeGoal(cq);     return; }
  if (data.startsWith('ORG_INCUP:'))   { await handleOrganizeIncup(cq);    return; }
  if (data.startsWith('ORG_AREA:'))    { await handleOrganizeArea(cq);     return; }
  if (data.startsWith('ORG_HORIZON:')) { await handleOrganizeHorizon(cq);  return; }
  if (data.startsWith('ORG_TYPE:'))    { await handleOrganizeType(cq);     return; }
  if (data.startsWith('ORG_CAT:'))     { await handleOrganizeCategory(cq); return; }
  if (data.startsWith('ORG_DONE'))     { await handleOrganizeDone(cq);     return; }
  if (data.startsWith('SETUP_GUIDE:')) { await handleSetupGuide(cq);       return; }
  if (data.startsWith('HABIT_LOG:'))   { await handleHabitLog(cq);         return; }
  if (data.startsWith('HABIT_DIFF:'))  { await handleHabitDiff(cq);        return; }
  if (data === 'DO_FLOW')   { await handleDoFlow({ chat: { id: chatId }, from: { id: userId } });   return; }
  if (data === 'EVAL_FLOW') { await handleEvaluateFlow({ chat: { id: chatId }, from: { id: userId } }); return; }
}

