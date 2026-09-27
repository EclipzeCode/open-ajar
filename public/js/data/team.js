/**
 * The people shown on the Team page. Edit this file to add details; nothing else needs to change.
 * A field left empty is simply not shown, so the page never displays placeholder text.
 *
 *   photo:   put the image in public/img/team/ and set e.g. '/img/team/jayden.jpg'  (square-ish or 4:5 portrait works best)
 *   bio:     one or two sentences, in your own words
 *   email:   shown as a "mailto:" link. Consider a shared team address instead of a personal one (see the note in the README).
 *   links:   [{ label: 'LinkedIn', href: 'https://…' }]
 */
export const TEAM = [
  {
    name: 'Jayden Lee', role: 'Cofounder & Executive Director', photo: '/img/team/jayden.jpg', email: '', links: [],
    bio: 'Jayden Lee is a cofounder and the executive director of Open Ajar, a student-founded platform that helps high-school students find, understand, and pursue opportunities, whether or not they know the right people. He’s grateful that his parents never pressured him, but without anyone to point him toward opportunities, he missed some. Finding them on his own, while balancing everything else in high school, was harder than it should have been. Open Ajar is the tool he wishes he’d had.',
  },
  {
    name: 'Aayush Dhar', role: 'Cofounder', photo: '/img/team/aayush.jpg', email: '', links: [],
    bio: 'Aayush Dhar is a cofounder of Open Ajar. He was fortunate to have people who pointed him toward opportunities and helped him take them, and he saw how much of a difference that made. He helped start Open Ajar so that access like that doesn’t depend on luck or who you know, and so any student can find real opportunities and actually pursue them.',
  },
];

/**
 * The rest of the team, shown as smaller cards below the cofounders.
 * Same fields as above; photo/bio/links are optional (an initials badge shows when there's no photo).
 */
export const CREW = [
  {
    name: 'Jack Lee', role: 'Co Vice President', photo: '', email: '', links: [],
    bio: 'Jack Lee is a co vice president of Open Ajar. He helps the team reach more high-school students and keep the community running, so that finding an opportunity is never about who you happen to know.',
  },
  {
    name: 'Corbin Jimenez', role: 'Co Vice President', photo: '', email: '', links: [],
    bio: 'Corbin Jimenez is a co vice president of Open Ajar. He works on getting Open Ajar in front of the students who need it most and making their experience a good one, from a first visit to a first real opportunity.',
  },
];

/** Optional single contact for the whole team, shown at the bottom of the page. */
export const TEAM_CONTACT = { label: 'Get in touch', email: 'openajar27116@gmail.com' };
