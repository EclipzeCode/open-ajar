// Small progressive enhancements. Every page works without this file.

// Mobile menu
const menuBtn = document.querySelector('.menu-btn');
menuBtn?.addEventListener('click', () => {
  const open = document.getElementById('nav').classList.toggle('is-open');
  menuBtn.setAttribute('aria-expanded', open);
});

// "Are you sure?" for destructive buttons and forms
document.addEventListener('click', (e) => {
  const el = e.target.closest('button[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) e.preventDefault();
});
document.addEventListener('submit', (e) => {
  if (e.target.dataset.confirm && !confirm(e.target.dataset.confirm)) e.preventDefault();
});

// Browse: apply filters as soon as a checkbox or dropdown changes
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  form.addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox], select')) form.requestSubmit();
  });
});

// Browse: filters start open on wide screens, collapsed on phones
const filters = document.querySelector('details.filters');
if (filters && matchMedia('(min-width: 861px)').matches) filters.open = true;

// Admin queue: select-all checkbox
document.querySelector('[data-select-all]')?.addEventListener('change', (e) => {
  e.target.closest('form').querySelectorAll('input[name=ids]').forEach((c) => { c.checked = e.target.checked; });
});

// Tracker: save stage, checklist ticks, deadline and notes in the background as they change
document.querySelectorAll('form[data-autosave]').forEach((form) => {
  const status = form.querySelector('.save-state');
  let timer;
  const save = async () => {
    const body = new FormData(form);
    body.delete('new_item'); // adding an item reloads the page so it shows up
    status.textContent = 'Saving…';
    try {
      const r = await fetch(form.getAttribute('action'), { method: 'POST', body, headers: { 'X-Requested-With': 'fetch' } });
      if (!r.ok) throw new Error();
      status.textContent = 'Saved';
    } catch { status.textContent = 'Couldn’t save. Check your connection and try again.'; }
  };
  form.addEventListener('change', (e) => { if (e.target.name !== 'new_item') { clearTimeout(timer); save(); } });
  form.querySelector('textarea')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 800); });
});
