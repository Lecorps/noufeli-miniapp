/**
 * setup.js  –  One-time webhook registration script.
 * Run manually after each deployment:
 *
 *   WEBHOOK_URL=https://your-cloud-run-url.run.app \
 *   BOT_TOKEN=your-token \
 *   WEBHOOK_SECRET=your-secret \
 *   node setup.js
 */

const webhookUrl = process.env.WEBHOOK_URL;
const botToken   = process.env.BOT_TOKEN;
const secret     = process.env.WEBHOOK_SECRET;

if (!webhookUrl || !botToken) {
  console.error('WEBHOOK_URL and BOT_TOKEN env vars are required.');
  process.exit(1);
}

const payload = { url: webhookUrl };
if (secret) {
  payload.secret_token = secret;
  console.log('Registering webhook WITH secret token.');
} else {
  console.warn('WEBHOOK_SECRET not set – registering without verification.');
}

const res  = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(payload),
});

const result = await res.json();
console.log('setWebhook result:', JSON.stringify(result, null, 2));
