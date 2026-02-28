import { processUpdate } from './telegram.js';

export async function noufeliBot(req, res) {
  try {
    // Handle GET requests (for webhook verification)
    if (req.method === 'GET') {
      return res.status(200).send('Webhook is active');
    }
    
    // Only process POST requests
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const update = req.body;
    console.log('Received update:', JSON.stringify(update));
    
    

    await processUpdate(update);
    
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error in noufeliBot:', error);
    return res.status(500).send('Internal Server Error');
  }
}
