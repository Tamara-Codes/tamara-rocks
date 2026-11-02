// Shared email layout for the training signup flow (underscore prefix: not a Vercel route).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderEmail({ title, eyebrow, heading, intro, panelLabel, panelText, buttonLabel, buttonUrl, panelNote, footer, unsubscribeUrl }) {
  const button = buttonUrl
    ? `
                              <div style="height:1px; margin:18px 0; background:#d5c4dd;"></div>
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                  <td style="border-radius:8px; background:#211d1c;">
                                    <a href="${escapeHtml(buttonUrl)}" style="display:inline-block; padding:13px 18px; color:#ffffff; font-size:14px; font-weight:700; line-height:1; text-decoration:none;">${escapeHtml(buttonLabel)}</a>
                                  </td>
                                </tr>
                              </table>`
    : '';
  const note = panelNote
    ? `<p style="margin:14px 0 0; color:#746d6a; font-size:13px; line-height:1.5;">${escapeHtml(panelNote)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0; padding:0; background:#fffaf7; color:#211d1c; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fffaf7;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px; border:1px solid #f2d2dc; border-radius:24px; overflow:hidden; background:#fffdfb;">
            <tr>
              <td style="padding:48px 44px 34px;">
                <p style="margin:0 0 22px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                <h1 style="margin:0; color:#211d1c; font-family:Georgia, 'Times New Roman', serif; font-size:42px; font-weight:400; letter-spacing:-1.4px; line-height:1.06;">${escapeHtml(heading)}</h1>
                <p style="margin:24px 0 0; color:#746d6a; font-size:16px; line-height:1.55;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 44px 44px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2e5f8; border-radius:16px;">
                  <tr>
                    <td style="padding:26px 28px;">
                      <p style="margin:0 0 13px; color:#c52d63; font-size:11px; font-weight:700; letter-spacing:1.3px; text-transform:uppercase;">${escapeHtml(panelLabel)}</p>
                      <p style="margin:0; color:#211d1c; font-size:16px; font-weight:700; line-height:1.45;">${escapeHtml(panelText)}</p>${button}
                      ${note}
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; color:#746d6a; font-size:13px; line-height:1.55;">If this email landed in Promotions or Spam, please move it to your inbox and add me to your contacts so you don’t miss the joining link or future workshop updates.</p>
                <p style="margin:26px 0 0; color:#211d1c; font-size:16px; line-height:1.55;">Talk soon,<br><strong>Tamara</strong></p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0; color:#8a827f; font-size:12px; line-height:1.5;">${escapeHtml(footer)}</p>
          ${unsubscribeUrl ? `<p style="margin:12px 0 0; font-size:12px; line-height:1.5;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#746d6a; text-decoration:underline;">Unsubscribe from workshop emails</a></p>` : ''}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = { escapeHtml, renderEmail };
