-- Paid workshops only. Does not read or modify workshop_signups.
CREATE TABLE IF NOT EXISTS workshop_sessions (
    id TEXT PRIMARY KEY,
    workshop_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (duration_minutes > 0),
    capacity SMALLINT NOT NULL DEFAULT 8 CHECK (capacity BETWEEN 1 AND 8),
    price_cents INTEGER NOT NULL DEFAULT 4900 CHECK (price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
    booking_open BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (id, workshop_slug)
);

CREATE TABLE IF NOT EXISTS workshop_bookings (
    id UUID PRIMARY KEY,
    session_id TEXT NOT NULL,
    workshop_slug TEXT NOT NULL,
    email TEXT NOT NULL CHECK (email = lower(trim(email)) AND length(email) <= 254),
    name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 100),
    timezone TEXT NOT NULL DEFAULT 'Europe/Zagreb' CHECK (length(timezone) <= 100),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'payment_pending', 'paid', 'waitlisted', 'cancelled', 'expired')),
    seat_no SMALLINT CHECK (seat_no BETWEEN 1 AND 8),
    cancel_token_hash TEXT NOT NULL UNIQUE,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_link TEXT,
    payment_invited_at TIMESTAMPTZ,
    payment_due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (session_id, workshop_slug) REFERENCES workshop_sessions(id, workshop_slug),
    UNIQUE (workshop_slug, email),
    UNIQUE (session_id, seat_no),
    CHECK ((status IN ('reserved', 'payment_pending', 'paid')) = (seat_no IS NOT NULL)),
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS workshop_bookings_session_status ON workshop_bookings(session_id, status, created_at);

CREATE TABLE IF NOT EXISTS workshop_booking_email_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id UUID NOT NULL REFERENCES workshop_bookings(id),
    booking_version INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reservation', 'waitlist', 'owner', 'payment', 'paid', 'cancelled')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    provider_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token TEXT,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    UNIQUE (booking_id, booking_version, kind)
);
CREATE INDEX IF NOT EXISTS workshop_booking_email_pending ON workshop_booking_email_outbox(next_attempt_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS workshop_booking_rate_limits (
    key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION workshop_queue_email(p_id UUID, p_kind TEXT, p_cancel_url TEXT DEFAULT '')
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO workshop_booking_email_outbox(booking_id, booking_version, kind, payload)
    SELECT b.id, b.version, p_kind, jsonb_build_object(
        'email', b.email, 'name', b.name, 'timezone', b.timezone, 'status', b.status,
        'title', s.title, 'startsAt', s.starts_at, 'durationMinutes', s.duration_minutes,
        'priceCents', s.price_cents, 'currency', s.currency, 'paymentLink', b.payment_link,
        'cancelUrl', p_cancel_url)
    FROM workshop_bookings b JOIN workshop_sessions s ON s.id = b.session_id WHERE b.id = p_id
    ON CONFLICT (booking_id, booking_version, kind) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION workshop_expire_session(p_session TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM workshop_sessions WHERE id = p_session FOR UPDATE;
    UPDATE workshop_bookings SET status = 'expired', seat_no = NULL, updated_at = NOW(), version = version + 1
    WHERE session_id = p_session AND status = 'payment_pending' AND payment_due_at <= NOW();
END;
$$;

CREATE OR REPLACE FUNCTION workshop_reserve(
    p_id UUID, p_session TEXT, p_email TEXT, p_name TEXT, p_timezone TEXT,
    p_token_hash TEXT, p_cancel_url TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    s workshop_sessions%ROWTYPE;
    existing workshop_bookings%ROWTYPE;
    next_seat SMALLINT;
    new_status TEXT;
BEGIN
    SELECT * INTO s FROM workshop_sessions WHERE id = p_session;
    IF NOT FOUND OR NOT s.booking_open OR s.starts_at <= NOW() THEN
        RETURN jsonb_build_object('error', 'closed');
    END IF;
    -- Serialize duplicate submissions across the two dates, then seat allocations within one date.
    PERFORM pg_advisory_xact_lock(hashtextextended(s.workshop_slug || ':' || p_email, 0));
    PERFORM workshop_expire_session(p_session);
    SELECT * INTO existing FROM workshop_bookings WHERE workshop_slug = s.workshop_slug AND email = p_email;
    IF FOUND THEN
        RETURN jsonb_build_object('duplicate', true, 'status', existing.status, 'sessionId', existing.session_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM workshop_bookings WHERE session_id = s.id AND status = 'waitlisted') THEN
        SELECT n INTO next_seat FROM generate_series(1, s.capacity) n
        WHERE NOT EXISTS (SELECT 1 FROM workshop_bookings WHERE session_id = s.id AND seat_no = n)
        ORDER BY n LIMIT 1;
    END IF;
    new_status := CASE WHEN next_seat IS NULL THEN 'waitlisted' ELSE 'reserved' END;
    INSERT INTO workshop_bookings(id, session_id, workshop_slug, email, name, timezone, status, seat_no, cancel_token_hash)
    VALUES(p_id, s.id, s.workshop_slug, p_email, p_name, p_timezone, new_status, next_seat, p_token_hash);
    PERFORM workshop_queue_email(p_id, CASE WHEN next_seat IS NULL THEN 'waitlist' ELSE 'reservation' END, p_cancel_url);
    PERFORM workshop_queue_email(p_id, 'owner');
    RETURN jsonb_build_object('id', p_id, 'status', new_status, 'sessionId', s.id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION workshop_manage_booking(
    p_id UUID, p_action TEXT, p_link TEXT DEFAULT NULL, p_token_hash TEXT DEFAULT NULL, p_cancel_url TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE b workshop_bookings%ROWTYPE; s workshop_sessions%ROWTYPE; next_seat SMALLINT;
BEGIN
    SELECT * INTO b FROM workshop_bookings WHERE id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(b.workshop_slug || ':' || b.email, 0));
    PERFORM workshop_expire_session(b.session_id);
    SELECT * INTO b FROM workshop_bookings WHERE id = p_id FOR UPDATE;
    SELECT * INTO s FROM workshop_sessions WHERE id = b.session_id;
    IF p_action = 'cancel' THEN
        IF b.status IN ('cancelled', 'expired') THEN RETURN jsonb_build_object('ok', true); END IF;
        IF b.status = 'paid' THEN RETURN jsonb_build_object('error', 'paid_booking'); END IF;
        UPDATE workshop_bookings SET status = 'cancelled', seat_no = NULL, updated_at = NOW(), version = version + 1 WHERE id = p_id;
        PERFORM workshop_queue_email(p_id, 'cancelled');
    ELSIF p_action = 'invite_payment' THEN
        IF b.status <> 'reserved' OR s.starts_at <= NOW() THEN RETURN jsonb_build_object('error', 'invalid_status'); END IF;
        UPDATE workshop_bookings SET status = 'payment_pending', payment_link = p_link, updated_at = NOW(), version = version + 1 WHERE id = p_id;
        PERFORM workshop_queue_email(p_id, 'payment');
    ELSIF p_action = 'mark_paid' THEN
        IF b.status <> 'payment_pending' THEN RETURN jsonb_build_object('error', 'invalid_status'); END IF;
        UPDATE workshop_bookings SET status = 'paid', paid_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = p_id;
        PERFORM workshop_queue_email(p_id, 'paid');
    ELSIF p_action = 'promote' THEN
        IF b.status <> 'waitlisted' OR NOT s.booking_open OR s.starts_at <= NOW() THEN RETURN jsonb_build_object('error', 'invalid_status'); END IF;
        IF b.id <> (SELECT id FROM workshop_bookings WHERE session_id = s.id AND status = 'waitlisted' ORDER BY created_at, id LIMIT 1)
            THEN RETURN jsonb_build_object('error', 'waiting_order'); END IF;
        SELECT n INTO next_seat FROM generate_series(1, s.capacity) n
        WHERE NOT EXISTS (SELECT 1 FROM workshop_bookings WHERE session_id = s.id AND seat_no = n) ORDER BY n LIMIT 1;
        IF next_seat IS NULL THEN RETURN jsonb_build_object('error', 'full'); END IF;
        UPDATE workshop_bookings SET status = 'reserved', seat_no = next_seat, cancel_token_hash = p_token_hash,
            updated_at = NOW(), version = version + 1 WHERE id = p_id;
        PERFORM workshop_queue_email(p_id, 'reservation', p_cancel_url);
    ELSE RETURN jsonb_build_object('error', 'invalid_action');
    END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION workshop_queue_email(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION workshop_expire_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION workshop_reserve(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION workshop_manage_booking(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

INSERT INTO workshop_sessions(id, workshop_slug, title, starts_at) VALUES
('lead-generation-2026-11-25', 'lead-generation-2026-11', 'Lead Generation and Cold Outreach', '2026-11-25T18:00:00Z'),
('lead-generation-2026-11-28', 'lead-generation-2026-11', 'Lead Generation and Cold Outreach', '2026-11-28T17:00:00Z')
ON CONFLICT (id) DO NOTHING;
