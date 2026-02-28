import { sendTelegramMessage } from './api.js';
import { executeFlow } from './flows.js';

export async function processUpdate(update) {
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === '/start') {
      await sendTelegramMessage(chatId, 'Welcome to Noufeli Bot!');
    } else {
      await executeFlow(chatId, text);
    }
  }
}