/**
 * Creates (or promotes) an admin. There is no default admin and no admin sign-up route.
 *   node server/scripts/create-admin.js you@example.com
 * The password is typed at a hidden prompt. It is never accepted on the command line or logged.
 */
import readline from 'node:readline';
import { config } from '../config.js';
import { createRepo } from '../repo/index.js';
import { hashPassword, passwordProblem } from '../auth/passwords.js';
import { isEmail, normEmail } from '../validation/validate.js';

const email = process.argv[2] ? normEmail(process.argv[2]) : '';
if (!isEmail(email)) { console.error('Usage: node server/scripts/create-admin.js <email>'); process.exit(1); }

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const repo = createRepo(config);
const existing = repo.getUserByEmail(email);
if (existing) {
  repo.updateUser(existing.id, { role: 'admin', disabled: false });
  repo.markEmailVerified(existing.id);
  repo.deleteUserSessions(existing.id);
  repo.addAudit({ actorId: null, action: 'admin_granted_cli', targetType: 'user', targetId: existing.id });
  console.log(`${email} is now an admin. Their existing sessions were signed out.`);
} else {
  const name = await new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question('Display name: ', (a) => { rl.close(); r(a.trim() || 'Admin'); }); });
  const pw = await askHidden('Password (10+ characters): ');
  const problem = passwordProblem(pw, email);
  if (problem) { console.error(problem); process.exit(1); }
  const id = repo.createUser({ email, passwordHash: await hashPassword(pw), displayName: name, role: 'admin', emailVerified: true });
  repo.addAudit({ actorId: null, action: 'admin_created_cli', targetType: 'user', targetId: id });
  console.log(`Admin created: ${email}`);
}
repo.close();
