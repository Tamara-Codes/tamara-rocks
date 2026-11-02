const { createHmac, timingSafeEqual } = require('crypto');

function signature(payload, env) {
  const secret = env.UNSUBSCRIBE_SECRET || env.RESEND_API_KEY;
  if (!secret) throw new Error('Unsubscribe links are not configured.');
  return createHmac('sha256', secret).update(`workshop-unsubscribe:${payload}`).digest('hex');
}

function unsubscribeUrl(email, env = process.env) {
  const payload = Buffer.from(email).toString('base64url');
  const origin = new URL(env.SITE_URL || 'https://www.tamara.rocks').origin;
  return `${origin}/unsubscribe?token=${payload}.${signature(payload, env)}`;
}

function readUnsubscribeToken(token, env = process.env) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [, payload, supplied] = match;
  if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(payload, env), 'hex'))) return null;
  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

module.exports = { unsubscribeUrl, readUnsubscribeToken };
