import { handleTelegramUpdate, verifyWebhookSecret } from './telegram.js';

export async function noufeliBot(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).send('Webhook is active');
    }

    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    if (!verifyWebhookSecret(req)) {
      return res.status(403).send('Forbidden');
    }

    const update = req.body;
    console.log('Received update:', JSON.stringify(update));

    await handleTelegramUpdate(update);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error in noufeliBot:', error);
    return res.status(500).send('Internal Server Error');
  }
}
