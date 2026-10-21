import fs from 'node:fs';
import { versionInfo } from './version-info.mjs';

// Written to public/version.json so the app can check whether a newer build is online.
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/version.json', JSON.stringify({ ...versionInfo(), builtAt: new Date().toISOString() }));
