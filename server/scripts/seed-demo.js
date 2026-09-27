import { config } from '../config.js';
import { createRepo } from '../repo/index.js';
import { runProvider } from '../services/importer.js';
import * as demo from '../providers/demo.js';

const repo = createRepo(config);
if (process.argv.includes('--purge')) {
  console.log(`Removed ${repo.deleteDemoOpportunities()} demo listings.`);
} else {
  const r = await runProvider(repo, demo);
  console.log(`Demo listings: ${r.created} created, ${r.updated} refreshed, ${r.skipped.length} skipped.`);
}
repo.close();
