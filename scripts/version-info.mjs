import fs from 'node:fs';
import { execSync } from 'node:child_process';

/** Version shown in the sync popup: package.json version + short git commit. */
export function versionInfo() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  let sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  if (!sha) {
    try { sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  }
  return { version: pkg.version, sha: sha || 'local' };
}
