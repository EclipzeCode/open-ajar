/**
 * DEMO PROVIDER: development fixtures only.
 *
 * Everything here is fictional. Organizations, links, deadlines and terms are invented to exercise the UI, and
 * every row is stored with is_demo = 1, shown with a "Demo" label, and has no application URL.
 * Remove them all at any time with:  node server/scripts/seed-demo.js --purge
 *
 * Real listings must come through the submission form or a real provider (see ./README.md), and always start
 * as Pending Review.
 */
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const base = {
  org: 'Demo Organization (fictional)',
  url: null,
  costNote: 'Demo listing. No real cost.',
  requirements: ['Demo requirement one', 'Demo requirement two', 'Demo requirement three'],
  eligibility: 'Demo listing: eligibility is invented for development.',
};

export const name = 'demo';
export const demo = true;

export async function* fetch() {
  const rows = [
    { externalId: 'demo-research', status: 'approved', title: 'DEMO: Example Summer Research Program', type: 'Research program', interests: ['STEM', 'Research'], grades: [11], cost: 'Free', format: 'In person', location: 'Demo City', commitment: 'Summer', commitmentNote: 'Six weeks (demo)', deadlineDate: inDays(38), deadlineNote: 'Demo deadline', summary: 'A fictional research program used to test search, filters, saving and tracking. It is not a real opportunity.' },
    { externalId: 'demo-scholarship', status: 'approved', title: 'DEMO: Sample Community Scholarship', type: 'Scholarship', interests: ['Leadership', 'Service'], grades: [12], cost: 'Award', format: 'Online', location: 'Anywhere (demo)', commitment: 'One-off', commitmentNote: 'One application (demo)', deadlineDate: inDays(21), deadlineNote: 'Demo deadline', summary: 'A fictional scholarship for development. Amounts, terms and organizations are invented.' },
    { externalId: 'demo-internship', status: 'approved', title: 'DEMO: Placeholder Software Internship', type: 'Internship', interests: ['Computer science', 'Business & finance'], grades: [11, 12], cost: 'Award', format: 'Hybrid', location: 'Demo City', commitment: 'Summer', commitmentNote: 'Ten weeks (demo)', deadlineDate: inDays(64), deadlineNote: 'Demo deadline', costNote: 'Demo listing. No real pay is offered.', summary: 'A fictional internship that exists only to test how paid roles appear. There is no real employer, salary or role.' },
    { externalId: 'demo-job', status: 'approved', title: 'DEMO: Fictional Weekend Job Posting', type: 'Job', interests: ['Business & finance'], grades: [10, 11, 12], cost: 'Award', format: 'In person', location: 'Demo Town', commitment: 'School year', commitmentNote: 'Weekends (demo)', deadlineDate: null, deadlineNote: 'Rolling (demo)', costNote: 'Demo listing. No real pay is offered.', summary: 'A fictional part-time job listing. No real business, wage or schedule.' },
    { externalId: 'demo-competition', status: 'approved', title: 'DEMO: Imaginary Design Competition', type: 'Competition', interests: ['Arts & media', 'Computer science'], grades: [9, 10, 11, 12], cost: 'Free', format: 'Online', location: 'Anywhere (demo)', commitment: 'Flexible', commitmentNote: 'Self-paced (demo)', deadlineDate: inDays(90), deadlineNote: 'Demo deadline', summary: 'A fictional competition used to check how open-ended deadlines and long titles behave.' },
    { externalId: 'demo-volunteer', status: 'approved', title: 'DEMO: Sample Neighborhood Volunteer Role', type: 'Volunteer', interests: ['Service'], grades: [9, 10, 11, 12], cost: 'Free', format: 'In person', location: 'Demo Town', commitment: 'Flexible', commitmentNote: 'A few hours a month (demo)', deadlineDate: null, deadlineNote: 'Rolling (demo)', summary: 'A fictional volunteer role with a rolling deadline, to test empty and rolling states.' },
    { externalId: 'demo-mentorship', status: 'approved', title: 'DEMO: Example Peer Mentorship', type: 'Mentorship', interests: ['Leadership', 'Writing & humanities'], grades: [10, 11, 12], cost: 'Free', format: 'Online', location: 'Anywhere (demo)', commitment: 'School year', commitmentNote: 'Monthly (demo)', deadlineDate: inDays(12), deadlineNote: 'Demo deadline', summary: 'A fictional mentorship program with a near deadline, to test the soon-closing treatment.' },
    { externalId: 'demo-shadow', status: 'approved', title: 'DEMO: Sample Job Shadow Day', type: 'Job shadow', interests: ['Business & finance', 'STEM'], grades: [9, 10, 11, 12], cost: 'Varies', format: 'In person', location: 'Demo City', commitment: 'One-off', commitmentNote: 'One day (demo)', deadlineDate: inDays(29), deadlineNote: 'Demo deadline', summary: 'A fictional job-shadow day. No real host organization.' },
    // Pending items so the admin review queue isn't empty in development.
    { externalId: 'demo-pending-1', status: 'pending_review', title: 'DEMO: Pending Submission Example', type: 'Academic program', interests: ['STEM'], grades: [10, 11], cost: 'Fee', format: 'Hybrid', location: 'Demo City', commitment: 'Summer', commitmentNote: 'Four weeks (demo)', deadlineDate: inDays(50), deadlineNote: 'Demo deadline', summary: 'A fictional submission waiting for admin review. Approve, reject or request changes to try the workflow.' },
    { externalId: 'demo-pending-2', status: 'pending_review', title: 'DEMO: Another Pending Submission', type: 'Entrepreneurship', interests: ['Business & finance', 'Leadership'], grades: [11, 12], cost: 'Free', format: 'Online', location: 'Anywhere (demo)', commitment: 'Flexible', commitmentNote: 'Self-paced (demo)', deadlineDate: null, deadlineNote: 'Rolling (demo)', summary: 'A second fictional submission in the review queue, to test list and filter states.' },
  ];
  for (const r of rows) yield { ...base, ...r };
}
