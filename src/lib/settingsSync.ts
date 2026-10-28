import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSettings, SETTINGS_KEY, type Settings } from './settings';

/** Wait this long after a settings change before saving it online (so typing is saved once). */
export const SETTINGS_SYNC_DELAY_MS = 2000;

export const SYNC_META_KEY = 'horeca-settings-sync';
/** dirty: changed on this computer and not saved online yet. syncedAt: the online copy this computer last matched. */
export interface SyncMeta { dirty: boolean; syncedAt: string | null }

export function readMeta(): SyncMeta {
  try { const m = JSON.parse(localStorage.getItem(SYNC_META_KEY) || ''); return { dirty: !!m.dirty, syncedAt: m.syncedAt ?? null }; }
  catch { return { dirty: false, syncedAt: null }; }
}
export const writeMeta = (m: SyncMeta) => localStorage.setItem(SYNC_META_KEY, JSON.stringify(m));
export const markDirty = () => writeMeta({ ...readMeta(), dirty: true });

const missingTable = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /could not find the table/i.test(e.message ?? '');

export type SettingsSyncResult = 'pushed' | 'pulled' | 'same' | 'skipped' | 'error';

/**
 * Keeps this user's settings backed up in the database (table user_settings, one row per login).
 * - changed here and not saved yet  -> save them online (this computer wins)
 * - nothing online yet              -> save what this computer has (first backup)
 * - online copy differs from ours   -> use the online copy (fresh install, or changed on another computer)
 * Works offline: changes stay marked until the next time the internet is there. Never blocks the main sync.
 */
export async function syncSettings(
  client: SupabaseClient, userId: string, current: Settings, applyRemote: (s: Settings) => void,
): Promise<SettingsSyncResult> {
  const push = async (): Promise<SettingsSyncResult> => {
    // what this computer has saved locally is the newest truth; fall back to the in-memory copy on a fresh install
    const sentRaw = localStorage.getItem(SETTINGS_KEY);
    let toSend = current;
    try { if (sentRaw) toSend = normalizeSettings(JSON.parse(sentRaw)); } catch { /* use the in-memory copy */ }
    const { data, error } = await client.from('user_settings')
      .upsert({ id: userId, settings: toSend }, { onConflict: 'id' }).select('updated_at').single();
    if (error) return missingTable(error) ? 'skipped' : 'error';
    // if the user changed something while this was being saved, keep it marked for the next round
    const changedMeanwhile = localStorage.getItem(SETTINGS_KEY) !== sentRaw;
    writeMeta({ dirty: changedMeanwhile, syncedAt: data.updated_at });
    return 'pushed';
  };

  if (readMeta().dirty) return push();

  const { data, error } = await client.from('user_settings').select('settings, updated_at').eq('id', userId).maybeSingle();
  if (error) return missingTable(error) ? 'skipped' : 'error';
  if (!data) return push();
  if (data.updated_at !== readMeta().syncedAt) {
    if (readMeta().dirty) return 'same';                         // changed here while we were looking: it will be saved next
    applyRemote(normalizeSettings(data.settings));
    writeMeta({ dirty: false, syncedAt: data.updated_at });
    return 'pulled';
  }
  return 'same';
}
