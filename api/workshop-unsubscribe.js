const { neon } = require('@neondatabase/serverless');
const { Resend } = require('resend');
const { readUnsubscribeToken } = require('./_unsubscribe');
const { escapeHtml } = require('./_email');
const { createHash } = require('crypto');

function page(res, status, heading, message, token) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const actions = token
    ? `<form method="POST" action="/unsubscribe"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Confirm unsubscribe</button></form><div class="secondary"><a href="/">Keep me on the list</a></div>`
    : '<a href="/">← Back to tamara.rocks</a>';
  return res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)} — Tamara</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fffaf7;color:#211d1c;font-family:Arial,Helvetica,sans-serif}.page{max-width:564px;margin:64px auto;padding:0 22px}.brand{font:italic 22px Georgia,serif;margin:0 0 28px}main{padding:40px;border:1px solid #f2d2dc;border-radius:24px;background:#fffdfb}.eyebrow{margin:0 0 22px;color:#c52d63;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase}h1{margin:0 0 20px;font:normal 42px/1.1 Georgia,serif;letter-spacing:-1px}.copy{margin:0 0 26px;color:#746d6a;font-size:16px;line-height:1.65}button{display:block;width:100%;padding:15px 22px;border:0;border-radius:9px;background:#211d1c;color:#fff;font:bold 14px/1.4 Arial,sans-serif;cursor:pointer}a{color:#c52d63;font-size:13px;line-height:1.6}.secondary{text-align:center;margin-top:18px}.footer{text-align:center;color:#746d6a;font-size:12px;margin:24px 0 0}@media(max-width:420px){.page{margin:30px auto;padding:0 12px}main{padding:30px 24px}h1{font-size:36px}}
</style></head><body><div class="page"><p class="brand">tamara.rocks</p><main><p class="eyebrow">✦ Workshop emails</p><h1>${escapeHtml(heading)}</h1><p class="copy">${escapeHtml(message)}</p>${actions}</main><p class="footer">Tamara Martinović · AI engineer &amp; educator</p></div></body></html>`);
}

module.exports = async function workshopUnsubscribe(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return page(res, 405, 'Please use your email link', 'Open the unsubscribe link in your workshop email.');
  }
  if (!(process.env.UNSUBSCRIBE_SECRET || process.env.RESEND_API_KEY)) {
    return page(res, 503, 'Please try again later', 'You can also reply to the workshop email to ask to unsubscribe.');
  }
  const token = req.method === 'POST' ? req.body?.token : req.query?.token;
  const email = readUnsubscribeToken(token);
  if (!email) return page(res, 400, 'This link is invalid', 'Please use the unsubscribe link in your workshop email, or reply to that email for help.');

  // Opening a link (including email security scanners) never changes the list.
  if (req.method === 'GET') {
    return page(res, 200, 'Want to unsubscribe?', 'You’ll stop receiving workshop reminders and updates from me. Just confirm below.', token);
  }
  if (!process.env.DATABASE_URL) {
    return page(res, 503, 'Please try again later', 'We couldn’t unsubscribe you yet. Please try again later or reply to the workshop email for help.');
  }
  let removed;
  try {
    const sql = neon(process.env.DATABASE_URL);
    removed = await sql`DELETE FROM workshop_signups WHERE email = ${email} RETURNING email`;
  } catch {
    console.error('Workshop unsubscribe database operation failed.');
    return page(res, 502, 'Please try again', 'We couldn’t unsubscribe you yet. Please try again, or reply to the workshop email for help.');
  }

  // Notification failures must never undo a successful unsubscribe.
  if (removed.length > 0) {
    try {
      if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error('Email configuration missing.');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: ['codewithtamara@gmail.com'],
        replyTo: email,
        subject: 'Workshop unsubscribe completed',
        text: `${email} confirmed their unsubscribe at tamara.rocks. Their signup has been deleted from Neon’s workshop_signups table. No manual removal is needed. Use a fresh Neon list for future workshop mailings.`,
      }, {
        idempotencyKey: `workshop-unsubscribe-${createHash('sha256').update(email).digest('hex')}`,
      });
      if (error) throw new Error('Notification failed.');
    } catch {
      console.error('Workshop unsubscribe completed, but the owner notification failed.');
    }
  }
  return page(res, 200, 'You’re unsubscribed.', 'Thank you for letting me know. You won’t receive any more workshop emails from me. Changed your mind? You’re always welcome to sign up again.');
};
