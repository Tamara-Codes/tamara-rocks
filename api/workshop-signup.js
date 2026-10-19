const { neon } = require('@neondatabase/serverless');
const { Resend } = require('resend');
const { createHash } = require('crypto');

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
        subject: 'You’re on the list — AI Demystified is coming soon',
        html: "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>You’re confirmed</title>\n  </head>\n  <body style=\"margin:0; padding:0; background:#fffaf7; color:#211d1c; font-family:Arial, Helvetica, sans-serif;\">\n    <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"background:#fffaf7;\">\n      <tr>\n        <td align=\"center\" style=\"padding:36px 16px;\">\n          <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"max-width:640px; border:1px solid #f2d2dc; border-radius:24px; overflow:hidden; background:#fffdfb;\">\n            <tr>\n              <td style=\"padding:48px 44px 34px;\">\n                <p style=\"margin:0 0 22px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;\">✦ Free video training · Coming soon</p>\n                <h1 style=\"margin:0; color:#211d1c; font-family:Georgia, 'Times New Roman', serif; font-size:42px; font-weight:400; letter-spacing:-1.4px; line-height:1.06;\">You’re on the list.</h1>\n                <p style=\"margin:24px 0 0; color:#746d6a; font-size:16px; line-height:1.55;\">Thanks for signing up! The video is coming soon, and I’ll email you the link as soon as it’s ready so you can watch whenever suits you.</p>\n              </td>\n            </tr>\n            <tr>\n              <td style=\"padding:0 44px 44px;\">\n                <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"background:#f2e5f8; border-radius:16px;\">\n                  <tr>\n                    <td style=\"padding:26px 28px;\">\n                      <p style=\"margin:0 0 13px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.3px; text-transform:uppercase;\">While you wait</p>\n                      <p style=\"margin:0; color:#211d1c; font-size:16px; font-weight:700; line-height:1.45;\">Thanks for being patient with me while I put it together! In the meantime, feel free to hit reply and tell me what you’d most like to learn about AI.</p>\n\n                    </td>\n                  </tr>\n                </table>\n                <p style=\"margin:26px 0 0; color:#211d1c; font-size:16px; line-height:1.55;\">Talk soon,<br><strong>Tamara</strong></p>\n              </td>\n            </tr>\n          </table>\n          <p style=\"margin:18px 0 0; color:#8a827f; font-size:12px; line-height:1.5;\">You received this because you asked for the training at tamara.rocks.</p>\n        </td>\n      </tr>\n    </table>\n  </body>\n</html>",
      });

      if (error) {
        throw new Error(error.message || 'Resend could not send the confirmation email.');
      }
    } catch (error) {
      await sql`DELETE FROM workshop_signups WHERE email = ${email}`;
      throw error;
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Workshop signup failed:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
