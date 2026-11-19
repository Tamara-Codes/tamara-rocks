const { neon } = require('@neondatabase/serverless');
const { createHash } = require('node:crypto');

const WORKSHOP = 'ai-demystified-free';
const PERMISSION_VERSION = '2026-11-19-v1';
const PERMISSION_PROMPT = 'May I share a quote from your feedback? On tamara.rocks and in workshop promotional materials.';
const PERMISSION_CHOICES = Object.freeze({
    named: 'Yes, with my first name.',
    anonymous: 'Yes, anonymously.',
    private: 'Please keep my feedback private.',
});

function validateFeedback(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Please complete the feedback form.';
    if (typeof body.takeaway !== 'string' || !body.takeaway.trim() || body.takeaway.length > 2000) {
        return 'Please share your takeaway in 2,000 characters or fewer.';
    }
    if (body.improvement != null && (typeof body.improvement !== 'string' || body.improvement.length > 2000)) {
        return 'Please keep your suggestions to 2,000 characters or fewer.';
    }
    if (body.firstName != null && (typeof body.firstName !== 'string' || body.firstName.length > 80)) {
        return 'Please keep your first name to 80 characters or fewer.';
    }
    if (typeof body.publicationPermission !== 'string' || !Object.hasOwn(PERMISSION_CHOICES, body.publicationPermission)) return 'Please choose how your feedback may be shared.';
    if (body.publicationPermission === 'named' && !body.firstName?.trim()) {
        return 'Please add your first name, or choose another sharing option.';
    }
    return null;
}

async function workshopFeedback(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }
    const allowedOrigins = new Set(['https://tamara.rocks', 'https://www.tamara.rocks']);
    if (process.env.VERCEL_URL) allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
        return res.status(403).json({ error: 'Please send your feedback using the workshop form.' });
    }
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 32768) {
        return res.status(413).json({ error: 'Please keep your feedback within the form’s character limits.' });
    }
    if (req.body?._honey) return res.status(200).json({ ok: true });
    const validationError = validateFeedback(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: 'Feedback is temporarily unavailable. Please try again later or email tamara@nosastra.co.' });
    }

    try {
        const sql = neon(process.env.DATABASE_URL);
        const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
        const ip = String((Array.isArray(forwarded) ? forwarded[0] : forwarded) || 'unknown').split(',')[0].trim();
        const salt = process.env.RATE_LIMIT_SALT || process.env.DATABASE_URL;
        const key = createHash('sha256').update(`workshop-feedback:${ip}:${salt}`).digest('hex');
        const limits = await sql`
            INSERT INTO workshop_feedback_rate_limits (key, window_started_at, attempts)
            VALUES (${key}, NOW(), 1)
            ON CONFLICT (key) DO UPDATE SET
                window_started_at = CASE
                    WHEN workshop_feedback_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW()
                    ELSE workshop_feedback_rate_limits.window_started_at
                END,
                attempts = CASE
                    WHEN workshop_feedback_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE workshop_feedback_rate_limits.attempts + 1
                END
            RETURNING attempts
        `;
        if (!limits[0] || limits[0].attempts > 5) {
            return res.status(429).json({ error: 'Please wait a little before sending more feedback.' });
        }
        const permission = req.body.publicationPermission;
        // Server owns workshop identity, permission wording and review status.
        // No mail, subscription, public quote or paid booking is created here.
        await sql`
            INSERT INTO workshop_feedback (
                workshop_slug, takeaway, improvement, first_name,
                publication_permission, permission_version, permission_prompt,
                permission_choice, permission_recorded_at, review_status
            ) VALUES (
                ${WORKSHOP}, ${req.body.takeaway.trim()}, ${(req.body.improvement || '').trim()},
                ${(req.body.firstName || '').trim()}, ${permission}, ${PERMISSION_VERSION},
                ${PERMISSION_PROMPT}, ${PERMISSION_CHOICES[permission]}, NOW(), 'unreviewed'
            )
        `;
        return res.status(200).json({ ok: true });
    } catch {
        console.error('Workshop feedback could not be saved.');
        return res.status(500).json({ error: 'Your feedback couldn’t be saved. Please try again. Your answers are still in the form.' });
    }
}

module.exports = workshopFeedback;
module.exports.validateFeedback = validateFeedback;
