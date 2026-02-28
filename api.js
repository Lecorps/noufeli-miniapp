export async function sendTelegramMessage(chatId, text) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
  
  return await response.json();
}

export async function logToSheet(sheetName, message) {
  try {
    const SHEET_ID = process.env.SHEET_ID;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}:append?valueInputOption=RAW`;
    
    const timestamp = new Date().toISOString();
    const values = [[timestamp, message]];
    
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GOOGLE_OAUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });
  } catch (error) {
    console.error('Error logging to sheet:', error);
  }
}