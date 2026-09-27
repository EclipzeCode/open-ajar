/**
 * Funding page settings. Edit these values as the campaign changes.
 *
 *   raised      how much has actually been raised so far, in whole dollars. KEEP THIS HONEST.
 *   used        how much has actually been spent to expand student opportunities, in whole dollars.
 *               Remaining is computed as raised - used, so these two must be real figures.
 *   donateUrl   the link your Donate button points to. Paste your real GoFundMe (or other) link here.
 *               If it is left empty, the button emails the team instead so nothing is broken.
 */
export const SUPPORT = {
  raised: 4367,
  used: 3199,
  donateUrl: '',   // <-- PASTE YOUR GOFUNDME LINK HERE, e.g. 'https://www.gofundme.com/f/your-campaign'
  donateNote: 'Donations are handled securely by GoFundMe.',
  contactEmail: 'openajar27116@gmail.com',
};

/**
 * How the fund is put to work. These describe the PLAN, not things already done.
 * Keep them realistic and honest. Do not claim partnerships or results that have not happened yet.
 */
export const USES = [
  { label: 'Keep Open Ajar free for students', note: 'Students never pay to use Open Ajar. Contributions cover what it costs to run, so money is never the reason a student misses an opportunity.' },
  { label: 'Find and verify more opportunities', note: 'We add and check internships, programs, scholarships and competitions, and confirm each one links to a real application before it goes live.' },
  { label: 'Place students as interns', note: 'We reach out to local businesses, introduce them to motivated students, and help set up internships that give students real, hands-on experience.' },
  { label: 'Reach the students who need it most', note: 'We get Open Ajar in front of students who don’t already have someone pointing them toward opportunities.' },
];
