(() => {
    'use strict';
    const login = document.getElementById('admin-login');
    const workspace = document.getElementById('admin-workspace');
    const message = document.getElementById('admin-message');
    const sessionFilter = document.getElementById('session-filter');
    const statusFilter = document.getElementById('status-filter');
    const actionDialog = document.getElementById('admin-action-dialog');
    const actionForm = document.getElementById('admin-action-form');
    const labels = { reserved: 'Reserved', payment_pending: 'Payment requested', paid: 'Paid', waitlisted: 'Waiting list', cancelled: 'Cancelled', expired: 'Expired' };
    let data = { bookings: [], sessions: [] };
    let pending = null;
    const when = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
    async function request(body) {
        const response = await fetch('/api/workshop-booking-admin', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
        const result = await response.json();
        if (response.status === 401) { login.hidden = false; workspace.hidden = true; }
        if (!response.ok) throw new Error(result.error || 'Please try again.');
        return result;
    }
    const filtered = () => data.bookings.filter(b => (!sessionFilter.value || b.session_id === sessionFilter.value) && (!statusFilter.value || b.status === statusFilter.value));
    function render() {
        const overview = document.getElementById('session-overview');
        overview.replaceChildren();
        for (const session of data.sessions) {
            const group = data.bookings.filter(b => b.session_id === session.id);
            const card = el('article', null, 'session-summary');
            card.append(el('h2', when(session.startsAt)), el('strong', `${group.filter(b => ['reserved','payment_pending','paid'].includes(b.status)).length} / ${session.capacity} places held`),
                el('p', `${group.filter(b => b.status === 'paid').length} paid · ${group.filter(b => b.status === 'waitlisted').length} waiting`));
            overview.append(card);
        }
        const list = document.getElementById('bookings-list');
        list.replaceChildren();
        if (!filtered().length) list.append(el('p', 'No bookings in this view yet.'));
        for (const booking of filtered()) {
            const card = el('article', null, 'booking-row');
            const person = el('div');
            person.append(el('h3', booking.name || 'Name not supplied'), el('p', booking.email), el('small', `Registered ${when(booking.created_at)}`));
            const details = el('div');
            details.append(el('span', labels[booking.status], `booking-status status-${booking.status}`), el('p', when(data.sessions.find(s => s.id === booking.session_id).startsAt)));
            if (booking.payment_due_at && booking.status === 'payment_pending') details.append(el('p', `Payment due ${when(booking.payment_due_at)}`));
            if (booking.emails_failed) details.append(el('p', 'Email delivery needs a retry.'));
            else if (booking.emails_pending) details.append(el('small', data.development ? 'Email queued for preview' : 'Email queued'));
            const actions = el('div', null, 'admin-actions');
            const add = (label, action) => { const button = el('button', label); button.type = 'button'; button.addEventListener('click', () => openAction(booking, action)); actions.append(button); };
            if (booking.status === 'reserved') add('Send payment link', 'invite_payment');
            if (booking.status === 'payment_pending') add('Mark paid', 'mark_paid');
            if (booking.status === 'waitlisted') add('Offer a place', 'promote');
            if (['reserved','payment_pending','waitlisted'].includes(booking.status)) add('Cancel', 'cancel');
            card.append(person, details, actions); list.append(card);
        }
    }
    async function load(silent = false) {
        try {
            data = await request(); login.hidden = true; workspace.hidden = false;
            document.getElementById('admin-dev-note').hidden = !data.development;
            const selected = sessionFilter.value;
            sessionFilter.replaceChildren(new Option('All sessions', ''));
            data.sessions.forEach(s => sessionFilter.append(new Option(when(s.startsAt), s.id)));
            sessionFilter.value = selected;
            if (!silent) message.textContent = '';
            render();
        } catch (error) { if (!silent) message.textContent = error.message; }
    }
    login.addEventListener('submit', async event => {
        event.preventDefault();
        try { await request({ action: 'login', secret: login.elements.secret.value }); login.reset(); await load(); } catch(error) { message.textContent = error.message; }
    });
    const localLogin = document.getElementById('local-login');
    localLogin.hidden = window.__BOOKING_LOCAL_DEV__ !== true;
    localLogin.addEventListener('click', async () => { try { await request({ action: 'local_login' }); await load(); } catch(error) { message.textContent = error.message; } });
    sessionFilter.addEventListener('change', render); statusFilter.addEventListener('change', render);
    document.getElementById('refresh-bookings').addEventListener('click', () => load());
    document.getElementById('admin-logout').addEventListener('click', async () => { await request({ action: 'logout' }); login.hidden = false; workspace.hidden = true; data = { bookings: [], sessions: [] }; document.getElementById('bookings-list').replaceChildren(); });
    document.getElementById('retry-emails').addEventListener('click', async () => { try { const result = await request({ action: 'retry_emails' }); message.textContent = result.preview ? 'Test mode: no emails were sent.' : `${result.sent} emails sent. Any remaining messages stay queued.`; await load(true); } catch(error) { message.textContent = error.message; } });
    function openAction(booking, action) {
        pending = { id: booking.id, action };
        const copy = {
            invite_payment: ['Send payment link', `Send ${booking.email} a payment invitation for €49. Their 48-hour deadline starts when the email is sent.`],
            mark_paid: ['Confirm payment received', `Mark ${booking.email} as paid only after checking their payment in Stripe. This sends a booking confirmation.`],
            cancel: ['Cancel this reservation?', `Release the place held by ${booking.email}. A cancellation email will be queued.`],
            promote: ['Offer the next waiting place', `Reserve an available place for ${booking.email} and email them. Places are offered in waiting-list order.`],
        }[action];
        document.getElementById('admin-action-title').textContent = copy[0]; document.getElementById('admin-action-copy').textContent = copy[1];
        document.getElementById('payment-link-field').hidden = action !== 'invite_payment';
        actionForm.elements.paymentLink.required = action === 'invite_payment'; actionForm.elements.paymentLink.value = '';
        document.getElementById('admin-action-error').textContent = ''; actionDialog.showModal();
    }
    document.getElementById('admin-action-close').addEventListener('click', () => actionDialog.close());
    actionForm.addEventListener('submit', async event => {
        event.preventDefault(); const button = document.getElementById('admin-action-submit'); button.disabled = true;
        try { await request({ ...pending, paymentLink: actionForm.elements.paymentLink.value }); actionDialog.close(); await load(); }
        catch(error) { document.getElementById('admin-action-error').textContent = error.message; }
        finally { button.disabled = false; }
    });
    document.getElementById('export-bookings').addEventListener('click', () => {
        const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'" + String(value ?? '').charAt(0)).replace(/"/g, '""') + '"';
        const rows = [['Name','Email','Session','Status','Registered','Payment deadline','Paid at'], ...filtered().map(b => [b.name,b.email,when(data.sessions.find(s=>s.id===b.session_id).startsAt),labels[b.status],b.created_at,b.payment_due_at,b.paid_at])];
        const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row=>row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const link = el('a'); link.href = url; link.download = 'paid-workshop-bookings.csv'; link.click(); URL.revokeObjectURL(url);
    });
    load(true);
})();
