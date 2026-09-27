/**
 * Role-based access control. Roles are assigned by admins only; self-registration always creates a student.
 * To add a role, add it here and to the CHECK constraint in the schema. No route checks role names directly:
 * they ask can(user, permission), so new roles need no route changes.
 */
export const ROLES = ['student', 'organization', 'counselor', 'admin'];

const BASE = ['profile.edit', 'library.manage', 'submission.create', 'submission.read_own'];

export const PERMISSIONS = {
  student: BASE,
  organization: BASE,
  // Reserved for the future counselor portal: 'counselor.students.read' is intentionally not granted yet.
  counselor: BASE,
  admin: [...BASE, 'opportunity.review', 'user.manage', 'audit.read'],
};

export const can = (user, permission) => !!user && (PERMISSIONS[user.role] || []).includes(permission);
