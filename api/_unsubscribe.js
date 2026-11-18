const { createHmac, timingSafeEqual } = require('crypto');

function signingSecrets(env) {
  const secrets = [...new Set([env.UNSUBSCRIBE_SECRET, env.RESEND_API_KEY].filter(Boolean))];
  if (secrets.length === 0) throw new Error('Unsubscribe links are not configured.');
  return secrets;
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(`workshop-unsubscribe:${payload}`).digest('hex');
}

function unsubscribeUrl(email, env = process.env) {
  const payload = Buffer.from(email).toString('base64url');
  const origin = new URL(env.SITE_URL || 'https://www.tamara.rocks').origin;
  return `${origin}/unsubscribe?token=${payload}.${signature(payload, signingSecrets(env)[0])}`;
}

function readUnsubscribeToken(token, env = process.env) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [, payload, supplied] = match;
  // Keep links issued before a dedicated unsubscribe key was configured working.
  const valid = signingSecrets(env).some(secret =>
    timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(payload, secret), 'hex'))
  );
  if (!valid) return null;
  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

module.exports = { unsubscribeUrl, readUnsubscribeToken };
