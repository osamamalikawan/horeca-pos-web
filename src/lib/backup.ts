import { db } from './db';

/**
 * Saves everything still waiting to upload (sales, stock movements, payments ...) to a JSON file.
 * It reads only the local database, so it works while signed out and offline.
 */
export async function downloadUnsyncedBackup(): Promise<number> {
  const rows = await db.outbox.toArray();
  const blob = new Blob([JSON.stringify({ app: 'horeca-pos', saved_at: new Date().toISOString(), waiting: rows }, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `horeca-unsynced-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return rows.length;
}
