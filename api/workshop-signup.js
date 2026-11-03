const { neon } = require('@neondatabase/serverless');
const { Resend } = require('resend');
const { createHash } = require('crypto');
const { renderEmail } = require('./_email');
const { unsubscribeUrl } = require('./_unsubscribe');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let rateLimitTableReady = false;

function getClientIp(req) {
  const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || 'unknown').split(',')[0].trim();
}

function rateLimitKey(scope, value) {
  const secret = process.env.RATE_LIMIT_SALT || process.env.DATABASE_URL;
  return createHash('sha256').update(`${scope}:${value}:${secret}`).digest('hex');
}

async function ensureRateLimitTable(sql) {
  if (rateLimitTableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS workshop_signup_rate_limits (
      key TEXT PRIMARY KEY,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
    )
  `;
  rateLimitTableReady = true;
}

async function consumeRateLimit(sql, key, limit, windowSeconds) {
  const rows = await sql`
    INSERT INTO workshop_signup_rate_limits (key, window_started_at, attempts)
    VALUES (${key}, NOW(), 1)
    ON CONFLICT (key) DO UPDATE SET
      window_started_at = CASE
        WHEN workshop_signup_rate_limits.window_started_at < NOW() - (${windowSeconds} * INTERVAL '1 second') THEN NOW()
        ELSE workshop_signup_rate_limits.window_started_at
      END,
      attempts = CASE
        WHEN workshop_signup_rate_limits.window_started_at < NOW() - (${windowSeconds} * INTERVAL '1 second') THEN 1
        ELSE workshop_signup_rate_limits.attempts + 1
      END
    RETURNING attempts
  `;
  return rows[0].attempts <= limit;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = async function workshopSignup(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const honeypot = String(req.body?._honey || '').trim();
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!process.env.DATABASE_URL || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return res.status(500).json({ error: 'Workshop signup is not configured yet.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureRateLimitTable(sql);

    const withinIpLimit = await consumeRateLimit(sql, rateLimitKey('ip', getClientIp(req)), 5, 15 * 60);
    if (!withinIpLimit) {
      return res.status(429).json({ error: 'Please wait a little before trying again.' });
    }

    const withinEmailLimit = await consumeRateLimit(sql, rateLimitKey('email', email), 3, 60 * 60);
    if (!withinEmailLimit) {
      return res.status(429).json({ error: 'Please wait a little before trying again.' });
    }

    const signup = await sql`
      INSERT INTO workshop_signups (email)
      VALUES (${email})
      ON CONFLICT (email) DO NOTHING
      RETURNING email
    `;

    if (signup.length === 0) {
      return res.status(200).json({ ok: true, alreadyRegistered: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: [email],
        replyTo: 'codewithtamara@gmail.com',
        subject: "Your spot is saved — AI Demystified workshop",
        html: renderEmail({
          title: 'Your workshop spot is saved',
          eyebrow: '✦ Free live AI workshop',
          heading: 'Thanks for joining!',
          intro: 'Your spot is saved for AI Demystified — a free, practical 60-minute live workshop on context windows, RAG, hallucinations and prompting.',
          panelLabel: 'Save the date',
          panelText: 'Thursday, 12 November 2026 at 18:00 CET (Central European Time).',
          panelNote: 'I’ll send you another email with the joining link before the workshop. Looking forward to seeing you there!',
          footer: 'You received this because you signed up for the AI workshop at tamara.rocks.',
          unsubscribeUrl: unsubscribeUrl(email, process.env),
        }),
      });

      if (error) throw new Error(error.message || 'Resend could not send the confirmation email.');
    } catch (error) {
      // A mailing-provider outage must never erase a workshop registration.
      // The signup is already persisted and can be retried or contacted manually.
      console.error('Workshop acknowledgement email failed:', error);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Workshop signup failed:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
