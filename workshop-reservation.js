(() => {
    const token = location.hash.slice(1);
    const form = document.getElementById('cancel-booking');
    const message = document.getElementById('reservation-message');
    async function request(method) {
        const r = await fetch('/api/workshop-booking-cancel', { method, headers: { Authorization: 'Bearer ' + token } });
        const body = await r.json(); if (!r.ok) throw new Error(body.error); return body;
    }
    request('GET').then(body => {
        const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(body.startsAt));
        const status = { reserved: 'Reserved', payment_pending: 'Awaiting payment', paid: 'Paid and confirmed', waitlisted: 'On the waiting list', cancelled: 'Cancelled', expired: 'Expired' }[body.status];
        message.textContent = `${body.title} · ${when} · ${status}`;
        form.hidden = !['reserved','payment_pending','waitlisted'].includes(body.status);
    }).catch(error => { message.textContent = error.message; });
    form.addEventListener('submit', async event => {
        event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
        try { await request('POST'); form.hidden = true; message.textContent = 'Your reservation is cancelled. Your place has been released.'; }
        catch(error) { message.textContent = error.message; } finally { button.disabled = false; }
    });
})();
