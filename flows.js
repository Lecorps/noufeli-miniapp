import { sendTelegramMessage } from './api.js';
import { callConvex } from './convex.js';

export async function executeFlow(chatId, userInput) {
  console.log(`Executing flow for chatId: ${chatId}, input: ${userInput}`);
  
  const flowData = await callConvex('flows:getFlow', { chatId });
  
  if (!flowData) {
    await sendTelegramMessage(chatId, 'No active flow found.');
    return;
  }
  
  await sendTelegramMessage(chatId, `Processing: ${userInput}`);
}