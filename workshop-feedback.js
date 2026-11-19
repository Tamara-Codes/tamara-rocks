(() => {
    const form = document.getElementById('feedback-form');
    const button = document.getElementById('feedback-submit');
    const error = document.getElementById('feedback-error');
    const thanks = document.getElementById('feedback-thanks');
    const name = document.getElementById('first-name');
    const takeaway = document.getElementById('takeaway');
    const preview = window.__WORKSHOPS_PREVIEW__ === true;
    const permission = () => form.elements.publicationPermission.value;
    let submitting = false;

    document.getElementById('feedback-preview').hidden = !preview;
    document.getElementById('feedback-test-again').hidden = !preview;
    document.getElementById('feedback-test-result').hidden = !preview;

    function updateNameRequirement() {
        const named = permission() === 'named';
        name.required = named;
        document.getElementById('name-optional').hidden = named;
        document.getElementById('name-hint').textContent = named
            ? 'Please add your first name so I can credit your quote.'
            : 'You’re welcome to leave this blank.';
        name.setCustomValidity('');
    }
    form.addEventListener('change', updateNameRequirement);
    name.addEventListener('input', () => name.setCustomValidity(''));
    takeaway.addEventListener('input', () => takeaway.setCustomValidity(''));
    updateNameRequirement();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submitting) return;
        if (!takeaway.value.trim()) {
            takeaway.setCustomValidity('Please share one thing you’re taking away from the workshop.');
        }
        if (permission() === 'named' && !name.value.trim()) {
            name.setCustomValidity('Please add your first name, or choose another sharing option.');
        }
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        const payload = {
            takeaway: data.get('takeaway').trim(),
            improvement: data.get('improvement').trim(),
            firstName: data.get('firstName').trim(),
            publicationPermission: data.get('publicationPermission'),
            _honey: data.get('_honey'),
        };
        error.hidden = true;
        submitting = true;
        button.disabled = true;
        button.textContent = 'Sending…';
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(20000),
            });
            const result = await response.json();
            if (!response.ok || result.ok !== true) {
                throw new Error(result.error || 'Your feedback couldn’t be saved. Please try again.');
            }
            if (preview !== (result.preview === true)) throw new Error('The form couldn’t confirm whether your response was saved. Please try again.');
            const summaries = {
                named: `You’ve allowed a quote with your first name, ${payload.firstName}. Thank you for helping others discover the workshop.`,
                anonymous: 'You’ve allowed an anonymous quote. Your name won’t be included if I share your words.',
                private: 'Your feedback will stay private. Thank you for helping me improve.',
            };
            document.getElementById('permission-summary').textContent = summaries[payload.publicationPermission];
            form.hidden = true;
            thanks.hidden = false;
            thanks.focus();
        } catch (failure) {
            error.textContent = failure.name === 'TimeoutError' || failure instanceof TypeError
                ? 'We couldn’t confirm your feedback was saved. Please check your connection and try again. Your answers are still here.'
                : failure.message;
            error.hidden = false;
        } finally {
            submitting = false;
            button.disabled = false;
            button.textContent = 'Send feedback';
        }
    });

    document.getElementById('feedback-test-again').addEventListener('click', () => {
        form.reset();
        updateNameRequirement();
        error.hidden = true;
        thanks.hidden = true;
        form.hidden = false;
        takeaway.focus();
    });
})();
