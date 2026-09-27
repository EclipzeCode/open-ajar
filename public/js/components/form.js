import { h } from '../dom.js';

/**
 * Accessible form primitives. Every control has a visible label, helper text and inline error are tied on with
 * aria-describedby, and after a failed submit a linked error summary takes focus (fields keep their inline errors).
 */
let uid = 0;
const nextId = (name) => `f-${name}-${++uid}`;

function wrap({ id, name, label, help, required, control, extra }) {
  const errId = `${id}-err`, helpId = `${id}-help`;
  const error = h('p', { class: 'field-error', id: errId, hidden: true });
  const describedBy = [help && helpId, errId].filter(Boolean).join(' ');
  const el = h('div', { class: 'field', 'data-field': name },
    h('label', { for: id }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    help && h('p', { class: 'help', id: helpId }, help),
    control, error, extra);
  return {
    el, name, label, control,
    setError(msg) {
      error.hidden = !msg; error.textContent = msg || '';
      control.toggleAttribute('aria-invalid', !!msg);
      if (msg) control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', describedBy);
    },
    focus: () => control.focus(),
    get: () => control.value,
    set: (v) => { control.value = v ?? ''; },
  };
}

export function input({ name, label, type = 'text', value = '', help, required, autocomplete, maxlength, placeholder, inputmode }) {
  const id = nextId(name);
  const control = h('input', { class: 'input', id, name, type, value, autocomplete, maxlength, placeholder, inputmode, required: required ? true : null, 'aria-required': required ? 'true' : null });
  control.value = value ?? '';
  return wrap({ id, name, label, help, required, control });
}

export function textarea({ name, label, value = '', help, required, rows = 4, maxlength }) {
  const id = nextId(name);
  const control = h('textarea', { class: 'textarea', id, name, rows, maxlength, 'aria-required': required ? 'true' : null });
  control.value = value ?? '';
  return wrap({ id, name, label, help, required, control });
}

export function select({ name, label, options, value = '', help, required, placeholder = 'Choose…' }) {
  const id = nextId(name);
  const opts = Array.isArray(options) ? options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })) : Object.entries(options).map(([value, label]) => ({ value, label }));
  const control = h('select', { class: 'select', id, name, 'aria-required': required ? 'true' : null },
    placeholder !== null && h('option', { value: '' }, placeholder),
    opts.map((o) => h('option', { value: o.value }, o.label)));
  control.value = value ?? '';
  return wrap({ id, name, label, help, required, control });
}

/** A group of checkboxes as a fieldset. get() returns an array of the checked values. */
export function checkGroup({ name, label, options, values = [], help, required, numeric = false }) {
  const id = nextId(name);
  const errId = `${id}-err`;
  const error = h('p', { class: 'field-error', id: errId, hidden: true });
  const boxes = options.map((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const cb = h('input', { type: 'checkbox', name, value: val });
    cb.checked = values.map(String).includes(String(val));
    return { cb, node: h('label', { class: 'check check--inline' }, cb, h('span', null, typeof o === 'object' ? o.label : String(o))) };
  });
  const fs = h('fieldset', { class: 'field field--group', 'data-field': name, 'aria-describedby': [help && `${id}-help`, errId].filter(Boolean).join(' ') },
    h('legend', { class: 'legend' }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    help && h('p', { class: 'help', id: `${id}-help` }, help),
    h('div', { class: 'check-row' }, boxes.map((b) => b.node)), error);
  return {
    el: fs, name, label, control: boxes[0].cb,
    setError(msg) { error.hidden = !msg; error.textContent = msg || ''; boxes[0].cb.toggleAttribute('aria-invalid', !!msg); },
    focus: () => boxes[0].cb.focus(),
    get: () => boxes.filter((b) => b.cb.checked).map((b) => (numeric ? Number(b.cb.value) : b.cb.value)),
    set: (arr) => boxes.forEach((b) => { b.cb.checked = (arr || []).map(String).includes(b.cb.value); }),
  };
}

/** Collects fields for a form, applies server errors, and builds the focusable error summary. */
export function formState(fields) {
  const summary = h('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: true });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  return {
    summary,
    values: () => Object.fromEntries(fields.map((f) => [f.name, f.get()])),
    clearErrors() { fields.forEach((f) => f.setError('')); summary.hidden = true; summary.replaceChildren(); },
    /** errors: { fieldName: message }. Focuses the summary (or the single error) so screen readers announce it. */
    showErrors(errors, generic) {
      fields.forEach((f) => f.setError(errors?.[f.name] || ''));
      const entries = Object.entries(errors || {}).filter(([k]) => byName[k]);
      if (!entries.length && !generic) { summary.hidden = true; return; }
      summary.replaceChildren(
        h('p', { class: 'error-summary__title' }, generic || (entries.length === 1 ? 'There’s 1 thing to fix' : `There are ${entries.length} things to fix`)),
        entries.length ? h('ul', null, entries.map(([k, msg]) => h('li', null, h('a', { href: `#${k}`, onclick: (e) => { e.preventDefault(); byName[k].focus(); } }, `${byName[k].label}: ${msg}`)))) : null);
      summary.hidden = false;
      summary.focus();
    },
  };
}

export function submitButton(label) {
  const btn = h('button', { type: 'submit', class: 'btn' }, label);
  btn.setBusy = (busy, busyLabel = 'Working…') => { btn.disabled = busy; btn.classList.toggle('is-loading', busy); btn.textContent = busy ? busyLabel : label; };
  return btn;
}
