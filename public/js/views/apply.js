import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { input, select, textarea, checkGroup, formState, submitButton } from '../components/form.js';
import { META } from '../meta.js';
import { api, ApiError } from '../api.js';
import { toast } from '../components/toast.js';

/** Public "Become an Open Ajar intern" application. No account required; it reaches the team's roster. */
export default function apply(ctx) {
  ctx.setTitle('Become an intern');
  const root = h('div', { class: 'container' });

  const fields = [
    input({ name: 'fullName', label: 'Your name', required: true, autocomplete: 'name', maxlength: 120 }),
    input({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' }),
    select({ name: 'grade', label: 'Grade', options: META.grades.map((g) => ({ value: g, label: `Grade ${g}` })), placeholder: 'Choose your grade' }),
    input({ name: 'school', label: 'Your school', maxlength: 160 }),
    input({ name: 'location', label: 'Your city or area', maxlength: 160, help: 'So we can match you with businesses nearby.' }),
    checkGroup({ name: 'interests', label: 'What kind of work interests you?', options: META.interests }),
    textarea({ name: 'skills', label: 'Skills or experience', rows: 3, maxlength: 1000, help: 'Anything you’re good at or have done before. It’s fine if this is short.' }),
    input({ name: 'availability', label: 'When are you available?', maxlength: 300, help: 'For example: after school, weekends, about 10 hours a week.' }),
    textarea({ name: 'statement', label: 'Why do you want to intern?', rows: 4, required: true, maxlength: 2000, help: 'A few honest sentences. What do you hope to get out of it?' }),
    input({ name: 'link', label: 'A link (optional)', type: 'url', maxlength: 300, placeholder: 'https://', help: 'A portfolio, résumé, LinkedIn, or anything that shows who you are.' }),
  ];
  const state = formState(fields);
  const btn = submitButton('Submit application');

  const form = h('form', { class: 'opp-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    state.clearErrors();
    btn.setBusy(true, 'Sending…');
    try {
      await api.post('/api/intern-applications', state.values());
      done();
      toast('Application sent');
    } catch (err) {
      state.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null);
      btn.setBusy(false);
    }
  } }, state.summary,
    h('div', { class: 'form-grid' }, fields.map((f) => f.el)),
    h('div', { class: 'form-actions' }, btn));

  function done() {
    root.replaceChildren(
      h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Become an intern'), h('h1', { tabindex: '-1' }, 'Application received.'), h('p', null, 'Thanks for applying.')),
      h('div', { class: 'success' },
        h('p', null, 'We’ll review your application and reach out by email when we have a match with one of the businesses we work with. Keep an eye on your inbox.'),
        h('div', { class: 'state__actions' }, h('a', { class: 'btn', href: '#/' }, 'Back to home'))));
    window.scrollTo({ top: 0 });
    root.querySelector('h1').focus();
  }

  root.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Become an intern'),
      h('h1', null, 'Apply to intern with Open Ajar.'),
      h('p', null, 'We place motivated high-school students as interns with local businesses we work with. Tell us about yourself and we’ll be in touch when there’s a fit.')),
    h('div', { class: 'submit' },
      h('aside', { class: 'submit__aside' },
        h('h2', null, 'How it works'),
        h('ol', null,
          h('li', null, 'You apply here. It takes a few minutes.'),
          h('li', null, 'We get to know you and what you’re looking for.'),
          h('li', null, 'When a business we work with needs an intern who fits, we introduce you.'),
          h('li', null, 'You get real experience. They get a hand.')),
        h('p', { class: 'help' }, 'Applying does not guarantee a placement. We reach out as opportunities come up.')),
      h('div', { class: 'submit__form' }, form)));
  return root;
}
