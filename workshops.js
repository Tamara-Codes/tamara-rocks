(() => {
    'use strict';
    const isPreview = window.__WORKSHOPS_PREVIEW__ === true;
    const formatLocal = (value) => new Intl.DateTimeFormat(undefined, {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(value));
    document.querySelectorAll('[data-local-datetime]').forEach((element) => {
        element.textContent = `Your time: ${formatLocal(element.dataset.localDatetime)}`;
    });
    const freeSummary = document.querySelector('.free-session-summary');
    const freeStart = new Date(freeSummary.dataset.start);
    const localPart = (options) => new Intl.DateTimeFormat(undefined, options).format(freeStart);
    freeSummary.querySelector('.free-summary-date').textContent = localPart({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    freeSummary.querySelector('.free-summary-time').textContent = localPart({ hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    freeSummary.querySelector('.free-calendar-day').textContent = localPart({ day: 'numeric' });
    freeSummary.querySelector('.free-calendar-month').textContent = localPart({ month: 'short' }).toLocaleUpperCase();

    // Availability and reservations come from the paid-workshop database.
    const sessions = {
        wednesday: { id: 'lead-generation-2026-11-25', label: 'Wednesday, 25 November 2026', time: '19:00 CET', utc: '2026-11-25T18:00:00Z' },
        saturday: { id: 'lead-generation-2026-11-28', label: 'Saturday, 28 November 2026', time: '18:00 CET', utc: '2026-11-28T17:00:00Z' },
    };
    const dialog = document.getElementById('reservation-dialog');
    const form = document.getElementById('paid-workshop-form');
    const result = document.getElementById('paid-result');
    const intro = document.getElementById('reservation-intro');
    const bookingNote = document.getElementById('paid-booking-note');
    const error = form.querySelector('.form-error');
    const submit = document.getElementById('reserve-submit');
    const closeButton = dialog.querySelector('.dialog-close');
    let selectedSession = null;
    let lastTrigger = null;
    let saving = false;
    let refreshing = false;
    function applyAvailability(rows) {
        Object.values(sessions).forEach(session => {
            const live = rows.find(row => row.id === session.id);
            session.live = live || null;
        });
        updateAvailability();
    }
    function updateAvailability() {
        Object.entries(sessions).forEach(([key, session]) => {
            const live = session.live;
            const counter = document.querySelector('[data-seats-for="' + key + '"]');
            const button = document.querySelector('[data-reserve-session="' + key + '"]');
            counter.textContent = !live ? 'Availability unavailable' : !live.open ? 'Reservations closed' : live.remaining === 0
                ? 'Fully reserved · Waiting list open' : live.remaining + (live.remaining === 1 ? ' place left' : ' places left');
            counter.classList.toggle('is-full', live?.remaining === 0);
            counter.setAttribute('aria-live', 'polite');
            button.disabled = !live || !live.open;
            const date = document.createElement('span');
            date.className = 'sr-only';
            date.textContent = ' for ' + session.label;
            button.replaceChildren(document.createTextNode(live?.remaining === 0 ? 'Join waiting list' : 'Reserve a place'), date);
        });
        if (dialog.open && !saving && !result.hidden) return;
        if (dialog.open && !saving && selectedSession) updateModalAvailability();
    }
    function updateModalAvailability() {
        const live = sessions[selectedSession].live;
        const full = live?.remaining === 0;
        document.getElementById('reservation-title').textContent = full ? 'Join the waiting list.' : 'Save yourself a seat.';
        document.getElementById('reservation-description').textContent = full ? 'This session is fully reserved. I’ll let you know if a place opens up.' : 'A small group, your questions, and a workflow you can use.';
        document.getElementById('selected-session-seats').textContent = !live ? 'Availability unavailable' : full ? 'Waiting list' : live.remaining + (live.remaining === 1 ? ' place left' : ' places left');
        submit.textContent = full ? 'Join waiting list' : 'Reserve my place';
        submit.disabled = !live || !live.open;
        bookingNote.textContent = full ? 'Joining the waiting list is free. I’ll email you if a place opens up.' : 'Nothing to pay now. Your reservation email will follow, then your payment link when checkout is ready.';
    }
    async function refreshAvailability() {
        if (refreshing) return;
        refreshing = true;
        try {
            const response = await fetch('/api/workshop-bookings', { cache: 'no-store' });
            const body = await response.json();
            if (!response.ok || !Array.isArray(body.sessions)) throw new Error('Unavailable');
            applyAvailability(body.sessions);
        } catch {
            Object.values(sessions).forEach(s => { s.live = null; });
            updateAvailability();
        } finally { refreshing = false; }
    }
    function openReservation(key, trigger) {
        if (saving || !sessions[key].live?.open) return;
        selectedSession = key;
        lastTrigger = trigger;
        const session = sessions[key];
        form.reset();
        error.hidden = true;
        form.hidden = false;
        intro.hidden = false;
        bookingNote.hidden = false;
        result.hidden = true;
        dialog.setAttribute('aria-labelledby', 'reservation-title');
        dialog.setAttribute('aria-describedby', 'reservation-description');
        document.getElementById('selected-session-label').textContent = session.label;
        document.getElementById('selected-session-time').textContent = session.time;
        document.getElementById('selected-session-local').textContent = 'Your time: ' + formatLocal(session.utc);
        updateModalAvailability();
        dialog.showModal();
        document.body.classList.add('dialog-open');
        refreshAvailability();
    }
    document.querySelectorAll('[data-reserve-session]').forEach(button => button.addEventListener('click', () => openReservation(button.dataset.reserveSession, button)));
    closeButton.addEventListener('click', () => { if (!saving) dialog.close(); });
    document.getElementById('reservation-done').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('click', event => {
        if (saving || event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
        document.body.classList.remove('dialog-open');
        lastTrigger?.focus({ preventScroll: true });
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || !form.reportValidity() || !selectedSession) return;
        error.hidden = true;
        saving = true;
        submit.disabled = true;
        closeButton.disabled = true;
        submit.textContent = 'Saving…';
        form.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch('/api/workshop-bookings', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ sessionId: sessions[selectedSession].id, email: form.elements.email.value.trim(),
                    name: form.elements.name.value.trim(), consent: form.elements.consent.checked,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zagreb',
                    _honey: form.elements._honey.value, turnstileToken: form.elements['cf-turnstile-response']?.value || '' }),
            });
            const body = await response.json();
            if (!response.ok || !body.ok) throw new Error(body.error || 'Your reservation could not be saved. Please try again.');
            if (body.sessions) applyAvailability(body.sessions);
            const waiting = body.status === 'waitlisted';
            document.getElementById('reservation-result-title').textContent = body.alreadyRegistered ? 'You’ve already registered.' : waiting ? 'You’re on the waiting list.' : 'One of the eight places is yours.';
            document.getElementById('reservation-result-session').textContent = body.alreadyRegistered ? 'Check your original reservation email for your chosen session.' : 'Your time: ' + formatLocal(sessions[selectedSession].utc);
            document.getElementById('reservation-result-copy').textContent = body.alreadyRegistered
                ? 'We haven’t created another booking or taken another place. If you need to change your session, reply to your reservation email or contact tamara@nosastra.co.'
                : waiting ? 'There’s nothing to pay. I’ll email you if a place becomes available, so you can decide whether to take it.'
                : 'Your reservation is saved. The AI workflows are ready; my checkout is still catching up. I’ll email your payment link when it’s ready. You’ll then have 48 hours to pay and confirm your booking.';
            const note = result.querySelector('.preview-feedback');
            note.hidden = !body.development;
            note.textContent = 'Saved to the test database. No email was sent.';
            form.hidden = true;
            intro.hidden = true;
            bookingNote.hidden = true;
            result.hidden = false;
            dialog.setAttribute('aria-labelledby', 'reservation-result-title');
            dialog.setAttribute('aria-describedby', 'reservation-result-copy');
            document.getElementById('reservation-done').focus();
        } catch (failure) {
            error.textContent = failure.message || 'Please try again or email tamara@nosastra.co.';
            error.hidden = false;
        } finally {
            saving = false;
            closeButton.disabled = false;
            form.removeAttribute('aria-busy');
            if (!form.hidden) updateModalAvailability();
            if (window.turnstile && form.dataset.widgetId) window.turnstile.reset(form.dataset.widgetId);
        }
    });
    refreshAvailability();
    window.setInterval(() => { if (!document.hidden) refreshAvailability(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAvailability(); });

    // Free signups remain independent of paid bookings.
    const freeDialog = document.getElementById('free-workshop-dialog');
    const freeTrigger = document.getElementById('open-free-workshop');
    const freeDone = document.getElementById('free-dialog-done');
    freeTrigger.addEventListener('click', () => {
        freeDialog.showModal();
        document.body.classList.add('dialog-open');
    });
    document.getElementById('free-dialog-close').addEventListener('click', () => freeDialog.close());
    freeDone.addEventListener('click', () => freeDialog.close());
    freeDialog.addEventListener('click', (event) => {
        if (event.target !== freeDialog) return;
        const box = freeDialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) freeDialog.close();
    });
    freeDialog.addEventListener('close', () => {
        document.body.classList.remove('dialog-open');
        freeTrigger.focus({ preventScroll: true });
    });
    const freeForm = document.getElementById('free-workshop-form');
    const freeEmail = freeForm.elements.email;
    function validateFreeEmail() {
        const tooManyDots = (freeEmail.value.split('@')[0].match(/\./g) || []).length > 1;
        freeEmail.setCustomValidity(tooManyDots ? 'Please use an email address with at most one dot before @.' : '');
    }
    freeEmail.addEventListener('input', validateFreeEmail);
    const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content;
    if (siteKey && !isPreview) {
        window.onWorkshopsTurnstileReady = () => {
            [freeForm, form].forEach(target => {
                const slot = document.createElement('div');
                target.insertBefore(slot, target.querySelector('button'));
                target.dataset.widgetId = window.turnstile.render(slot, { sitekey: siteKey });
            });
        };
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onWorkshopsTurnstileReady&render=explicit';
        script.async = true;
        document.head.appendChild(script);
    }
    freeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        validateFreeEmail();
        if (!freeForm.reportValidity()) return;
        const error = freeForm.querySelector('.form-error');
        const button = freeForm.querySelector('button');
        error.hidden = true;
        button.disabled = true;
        freeForm.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(freeForm.action, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ email: freeEmail.value.trim(), _honey: freeForm.elements._honey.value, turnstileToken: freeForm.elements['cf-turnstile-response']?.value || '' }),
            });
            const body = await response.json();
            if (!response.ok || !body.ok) throw new Error(body.error || 'Your signup could not be sent. Please try again.');
            const heading = document.createElement('strong');
            const message = document.createElement('p');
            heading.textContent = body.preview ? 'Preview complete' : body.alreadyRegistered ? 'You’re already on the list.' : 'Your free spot is saved.';
            message.textContent = body.preview ? 'Your details were not saved and no email was sent.' : body.alreadyRegistered ? 'Look out for the workshop joining details in your inbox. You don’t need to sign up again.' : 'Check your inbox for your confirmation. I’ll email the joining link before the workshop.';
            const result = document.getElementById('free-result');
            result.replaceChildren(heading, message);
            freeForm.hidden = true;
            result.hidden = false;
            freeDone.hidden = false;
            result.focus({ preventScroll: true });
        } catch (failure) {
            error.textContent = failure.message || 'Please try again or email tamara@nosastra.co.';
            error.hidden = false;
        } finally {
            button.disabled = false;
            freeForm.removeAttribute('aria-busy');
            if (window.turnstile && freeForm.dataset.widgetId) window.turnstile.reset(freeForm.dataset.widgetId);
        }
    });
})();
