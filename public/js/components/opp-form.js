import { h } from '../dom.js';
import { input, textarea, select, checkGroup, formState, submitButton } from './form.js';
import { META } from '../meta.js';
import { ApiError } from '../api.js';

/**
 * The one opportunity form, used by:
 *  - "submit"  a new submission (adds "About you" fields for reviewers)
 *  - "edit"    a submitter revising after changes were requested
 *  - "admin"   an admin editing any listing (adds verification + expiry)
 * onSubmit(values) must return a promise; ApiError 422s are mapped onto fields.
 */
export function oppForm({ mode = 'submit', initial = {}, onSubmit, submitLabel = 'Submit for review' }) {
  const v = initial;
  const fields = [
    input({ name: 'title', label: 'Opportunity title', value: v.title, required: true, maxlength: 140 }),
    input({ name: 'org', label: 'Organization', value: v.org, required: true, maxlength: 140, help: 'Who runs it. Use the real, official name.' }),
    select({ name: 'type', label: 'Type', options: META.types, value: v.type, required: true }),
    textarea({ name: 'summary', label: 'Summary', value: v.summary, required: true, rows: 4, maxlength: 600, help: 'What is it, in a few plain sentences? (20–600 characters)' }),

    checkGroup({ name: 'grades', label: 'Open to grades', options: META.grades.map((g) => ({ value: g, label: `Grade ${g}` })), values: v.grades || [], required: true, numeric: true }),
    textarea({ name: 'eligibility', label: 'Who can apply', value: v.eligibility, required: true, rows: 3, maxlength: 600, help: 'Age, grade, location, citizenship or any other requirement.' }),
    textarea({ name: 'requirements', label: 'What applicants need', value: (v.requirements || []).join('\n'), rows: 4, help: 'One item per line, e.g. “Two recommendation letters”. Students get these as a checklist.' }),
    checkGroup({ name: 'interests', label: 'Interest areas', options: META.interests, values: v.interests || [] }),

    select({ name: 'cost', label: 'Cost to the student', options: META.costs, value: v.cost, required: true }),
    input({ name: 'costNote', label: 'Cost or pay details', value: v.costNote, maxlength: 200, help: 'Fees, stipend, award amount, or fee waivers. Only state what the organization publishes.' }),
    select({ name: 'format', label: 'Format', options: META.formats, value: v.format, required: true }),
    input({ name: 'location', label: 'Location', value: v.location, required: true, maxlength: 200, help: '“Online”, a city, or “Nationwide (U.S.)”.' }),
    select({ name: 'commitment', label: 'Time commitment', options: META.commitments, value: v.commitment, required: true }),
    input({ name: 'commitmentNote', label: 'Commitment detail', value: v.commitmentNote, maxlength: 200, help: 'For example “six weeks in summer”.' }),

    input({ name: 'deadlineDate', label: 'Application deadline', type: 'date', value: v.deadlineDate || '', help: 'Leave blank if it’s rolling or unknown. Dated listings close automatically after this date.' }),
    input({ name: 'deadlineNote', label: 'Deadline note', value: v.deadlineNote, maxlength: 200, help: 'For example “Rolling” or “Applications open each fall”.' }),
    input({ name: 'url', label: 'Official application or info link', type: 'url', value: v.url || '', autocomplete: 'off', maxlength: 500, placeholder: 'https://', help: 'Link to the organization’s own page. Students apply there, not through Open Ajar.' }),
  ];

  const meta = [];
  if (mode !== 'admin') {
    meta.push(
      select({ name: 'relationship', label: 'How are you connected to this?', options: META.relationships, value: v.relationship, required: true }),
      input({ name: 'contactEmail', label: 'Contact email for reviewers', type: 'email', value: v.contactEmail, required: true, autocomplete: 'email', help: 'Only Open Ajar reviewers see this. It’s never shown publicly.' }));
  } else {
    meta.push(
      select({ name: 'verification', label: 'Verification level', options: { unreviewed: 'Unreviewed', source: 'Source-linked', verified: 'Verified' }, value: v.rawVerification === 'demo' ? 'unreviewed' : v.rawVerification, placeholder: null, help: 'Verified means you checked the official page recently.' }),
      input({ name: 'expiresAt', label: 'Hide from students after', type: 'date', value: v.expiresAt ? v.expiresAt.slice(0, 10) : '', help: 'Optional. Overrides the automatic close after the deadline.' }));
  }

  const all = [...fields, ...meta];
  const state = formState(all);
  const btn = submitButton(submitLabel);

  const section = (title, blurb, ...items) => h('fieldset', { class: 'form-section' }, h('legend', null, title), blurb && h('p', { class: 'form-section__blurb' }, blurb), h('div', { class: 'form-grid' }, items.map((f) => f.el)));
  const F = (n) => fields.find((f) => f.name === n);

  const form = h('form', { class: 'opp-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    state.clearErrors();
    const values = state.values();
    if (mode === 'admin') { values.expiresAt = values.expiresAt ? new Date(`${values.expiresAt}T23:59:59Z`).toISOString() : null; }
    btn.setBusy(true, 'Sending…');
    try { await onSubmit(values); }
    catch (err) {
      if (err instanceof ApiError) state.showErrors(err.errors, Object.keys(err.errors || {}).length ? null : err.message);
      else throw err;
    } finally { btn.setBusy(false); }
  } },
    state.summary,
    section('The basics', null, F('title'), F('org'), F('type'), F('summary')),
    section('Who it’s for', null, F('grades'), F('eligibility'), F('requirements'), F('interests')),
    section('Cost, format and time', null, F('cost'), F('costNote'), F('format'), F('location'), F('commitment'), F('commitmentNote')),
    section('Timing and link', null, F('deadlineDate'), F('deadlineNote'), F('url')),
    section(mode === 'admin' ? 'Review settings' : 'About you', mode === 'admin' ? null : 'So a reviewer can follow up if something needs checking.', ...meta),
    h('div', { class: 'form-actions' }, btn));

  return { el: form, state };
}
