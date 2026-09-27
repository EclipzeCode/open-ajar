import { h } from '../dom.js';

const UPDATED = 'September 21, 2026';
const CONTACT = 'openajar27116@gmail.com';

/** Renders a legal document from a simple section list. Text only, no fancy formatting. */
function legalPage(ctx, { title, intro, sections }) {
  ctx.setTitle(title);
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Open Ajar'),
      h('h1', null, title),
      h('p', null, `Last updated: ${UPDATED}`)),
    h('div', { class: 'legal' },
      intro.map((p) => h('p', { class: 'legal__intro' }, p)),
      sections.map((sec, i) => h('section', { class: 'legal__section', 'aria-labelledby': `sec-${i}` },
        h('h2', { id: `sec-${i}` }, sec.h),
        (sec.body || []).map((b) => (Array.isArray(b)
          ? h('ul', { class: 'legal__list' }, b.map((li) => h('li', null, li)))
          : h('p', null, b)))))),
    );
}

export function privacy(ctx) {
  return legalPage(ctx, {
    title: 'Privacy Policy',
    intro: [
      'Open Ajar is a student-founded platform that helps high-school students find and track opportunities. This policy explains what information we collect, why, and what we do with it. We tried to keep it plain.',
      'If anything here is unclear, email us at ' + CONTACT + '.',
    ],
    sections: [
      { h: 'Who we are', body: [
        'Open Ajar is run by its student team, Jayden Lee and Aayush Dhar. You can reach us at ' + CONTACT + '.',
      ] },
      { h: 'What we collect', body: [
        'When you create an account, we collect:',
        ['Your name and email address.', 'Your password, which we store only as a scrambled (hashed) value that we cannot read.', 'Optional profile details you choose to add: your grade, interests, and general location.'],
        'As you use Open Ajar, we store the opportunities you save and the ones you track, along with any notes, deadlines, and checklist items you add to them.',
        'If you submit an opportunity for review, we collect the listing details you provide and a contact email so our reviewers can follow up. Your contact email is never shown publicly.',
        'To keep you signed in, we store a session in a secure, browser-only cookie. This cookie is necessary for the site to work. We do not use advertising or tracking cookies.',
        'We do not knowingly collect more than this. We do not run ads, and we do not sell your information to anyone.',
      ] },
      { h: 'Why we use it', body: [
        'We use your information only to run Open Ajar:',
        ['To create and secure your account.', 'To sync your saved and tracked opportunities across your devices.', 'To send you account emails, such as confirming your email address and resetting your password.', 'To review opportunities that people submit before they appear to students.'],
      ] },
      { h: 'Who we share it with', body: [
        'We share information only with the services that make Open Ajar work, and only what they need:',
        ['Our email provider (Resend) receives your email address and the contents of account emails so it can deliver them.', 'Our hosting provider stores the site and its database on our behalf.', 'We load fonts from Google Fonts, which means Google may receive your device’s IP address when a page loads.'],
        'We do not sell your data, and we do not share it for advertising.',
      ] },
      { h: 'How we protect it', body: [
        'We take reasonable steps to protect your information. Passwords are hashed with a strong algorithm (scrypt) and are never stored in a readable form. The site is served over HTTPS, and sign-in cookies are marked HttpOnly and Secure so other scripts and networks cannot read them.',
        'No system is perfectly secure, but we try to follow sensible practices and to fix problems quickly.',
      ] },
      { h: 'How long we keep it', body: [
        'We keep your account information for as long as your account exists. You can delete your account at any time from your account page, which permanently removes your profile, saved opportunities, and tracked applications. You can also email us at ' + CONTACT + ' and we will delete it for you.',
      ] },
      { h: 'Students and parents', body: [
        'Open Ajar is intended for high-school students who are 13 or older. It is not directed to children under 13, and we do not knowingly collect information from them. If you are under 18, please use Open Ajar with a parent or guardian’s awareness.',
        'If you are a parent or guardian and believe your child has given us information, email us at ' + CONTACT + ' and we will remove it.',
      ] },
      { h: 'Your choices', body: [
        'You can view and update your profile details any time on your account page. You can remove saved or tracked opportunities whenever you like. You can also delete your entire account from your account page, or email us and we will take care of it.',
      ] },
      { h: 'Changes to this policy', body: [
        'If we change this policy, we will update the date at the top. For significant changes, we will try to let signed-in users know.',
      ] },
    ],
  });
}

export function terms(ctx) {
  return legalPage(ctx, {
    title: 'Terms of Service',
    intro: [
      'These terms cover your use of Open Ajar. By using the site or creating an account, you agree to them. Please read them.',
    ],
    sections: [
      { h: 'Who can use Open Ajar', body: [
        'You must be at least 13 years old to use Open Ajar. If you are under 18, you may use it only with the permission and awareness of a parent or guardian.',
        'When you create an account, please give accurate information and keep your password to yourself. You are responsible for what happens under your account.',
      ] },
      { h: 'What Open Ajar is, and is not', body: [
        'Open Ajar is a directory and set of tools that help you find and keep track of opportunities such as internships, programs, scholarships, and competitions. The opportunities themselves are run by other organizations, not by us.',
        'We link you to each organization’s official page, and you apply there. We do our best to keep listings accurate and to label how well each one has been checked, but details like deadlines, costs, and eligibility can change without notice. Always confirm the details on the official page before you apply or rely on them.',
        'We do not control these organizations, their application processes, or their decisions, and we are not responsible for them.',
      ] },
      { h: 'Submitting opportunities', body: [
        'If you submit an opportunity, you confirm that the information is accurate to the best of your knowledge and that you are allowed to share it. Submissions are reviewed before they appear, and we may edit, reject, expire, or remove any listing for any reason. By submitting, you allow us to display the listing on Open Ajar.',
        'Do not submit false, misleading, spam, or off-topic listings.',
      ] },
      { h: 'Using the site responsibly', body: [
        'Please use Open Ajar for its intended purpose. Do not try to break, overload, scrape, or gain unauthorized access to the site or other people’s accounts, and do not use it to harm others or break the law.',
      ] },
      { h: 'The service is provided as is', body: [
        'We offer Open Ajar as a free service and provide it "as is," without warranties of any kind. We do not promise that it will always be available, error-free, or that any opportunity listed will be available or lead to any particular result.',
        'To the extent the law allows, Open Ajar and its founders are not liable for any loss or damage arising from your use of the site or from any opportunity you find through it. Because Open Ajar is a free service run by students, this is important to us and to keeping it available.',
      ] },
      { h: 'Ending use', body: [
        'You can stop using Open Ajar and ask us to delete your account at any time by emailing ' + CONTACT + '. We may suspend or close accounts that break these terms.',
      ] },
      { h: 'Changes to these terms', body: [
        'We may update these terms. If we do, we will change the date at the top. If you keep using Open Ajar after a change, that means you accept the updated terms.',
      ] },
      { h: 'Contact', body: [
        'Questions about these terms? Email us at ' + CONTACT + '.',
      ] },
    ],
  });
}
