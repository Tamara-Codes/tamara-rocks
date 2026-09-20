const { neon } = require('@neondatabase/serverless');
const { Resend } = require('resend');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const workshopMeetLink = process.env.WORKSHOP_MEET_URL || 'https://meet.google.com/abc-defg-hij';

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
  const localTime = String(req.body?.localTime || '').trim().slice(0, 80);
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!process.env.DATABASE_URL || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return res.status(500).json({ error: 'Workshop signup is not configured yet.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO workshop_signups (email)
      VALUES (${email})
      ON CONFLICT (email) DO NOTHING
    `;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const localTimeLine = localTime
      ? `<p style="margin:12px 0 0; color:#746d6a; font-size:14px; line-height:1.5;">Your local time: <strong style="color:#211d1c;">${escapeHtml(localTime)}</strong></p>`
      : '';
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      replyTo: 'codewithtamara@gmail.com',
      subject: 'You’re on the list — AI Demystified workshop',
      html: `
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>You’re on the list</title>
          </head>
          <body style="margin:0; padding:0; background:#fffaf7; color:#211d1c; font-family:Arial, Helvetica, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fffaf7;">
              <tr>
                <td align="center" style="padding:36px 16px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px; border:1px solid #f2d2dc; border-radius:24px; overflow:hidden; background:#fffdfb;">
                    <tr>
                      <td style="padding:48px 44px 34px;">
                        <p style="margin:0 0 22px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">✦ Free live workshop</p>
                        <h1 style="margin:0; color:#211d1c; font-family:Georgia, 'Times New Roman', serif; font-size:42px; font-weight:400; letter-spacing:-1.4px; line-height:1.06;">You’re on the list.</h1>
                        <p style="margin:24px 0 0; color:#746d6a; font-size:16px; line-height:1.55;">Your spot is saved for AI Demystified — a practical session on how modern AI systems actually work.</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:0 44px 44px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2e5f8; border-radius:16px;">
                          <tr>
                            <td style="padding:26px 28px;">
                              <p style="margin:0 0 13px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.3px; text-transform:uppercase;">Save your spot</p>
                              <p style="margin:0; color:#211d1c; font-size:16px; font-weight:700; line-height:1.45;">Thursday, 1 October<br>19:00 Croatia time</p>
                              ${localTimeLine}
                              <div style="height:1px; margin:18px 0; background:#d5c4dd;"></div>
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                  <td style="border-radius:8px; background:#211d1c;">
                                    <a href="${escapeHtml(workshopMeetLink)}" style="display:inline-block; padding:13px 18px; color:#ffffff; font-size:14px; font-weight:700; line-height:1; text-decoration:none;">Join Google Meet</a>
                                  </td>
                                </tr>
                              </table>
                              <p style="margin:14px 0 0; color:#746d6a; font-size:13px; line-height:1.5;">I’ll send a reminder before we begin.</p>
                            </td>
                          </tr>
                        </table>
                        <p style="margin:26px 0 0; color:#211d1c; font-size:16px; line-height:1.55;">See you there,<br><strong>Tamara</strong></p>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:18px 0 0; color:#8a827f; font-size:12px; line-height:1.5;">You received this because you saved a workshop spot at tamara.rocks.</p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    if (error) {
      throw new Error(error.message || 'Resend could not send the confirmation email.');
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Workshop signup failed:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
