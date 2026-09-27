/** Single source of truth for taxonomy. The client fetches this from /api/meta, so it can never drift. */
import { STATES } from '../util/states.js';

export const META = {
  states: STATES,
  types: ['Internship', 'Job', 'Research program', 'Scholarship', 'Summer program', 'Competition', 'Volunteer', 'Job shadow', 'Mentorship', 'Academic program', 'Entrepreneurship', 'Arts & athletics'],
  grades: [9, 10, 11, 12],
  costs: { Free: 'Free', Fee: 'Has a fee', Varies: 'Varies', Award: 'Pays or awards money' },
  formats: ['In person', 'Online', 'Hybrid', 'Varies'],
  commitments: ['One-off', 'Summer', 'School year', 'Flexible'],
  interests: ['STEM', 'Computer science', 'Research', 'Health & medicine', 'Business & finance', 'Arts & media', 'Writing & humanities', 'Civics & law', 'Service', 'Leadership', 'Career exploration', 'Environment', 'Sports & outdoors', 'Academics & college prep'],
  stages: ['Interested', 'Preparing', 'Applied', 'Interview', 'Accepted', 'Completed'],
  verification: { unreviewed: 'Unreviewed', source: 'Source-linked', verified: 'Verified', demo: 'Demo' },
  relationships: { organization_rep: 'I represent the organization', counselor_teacher: 'I’m a counselor or teacher', student_or_parent: 'I’m a student or parent', other: 'Something else' },
  statuses: { pending_review: 'Pending review', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected', expired: 'Expired' },
};
