'use client';
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { readMeta, SETTINGS_SYNC_DELAY_MS, syncSettings } from '@/lib/settingsSync';
import { useSettings } from './SettingsProvider';
import { useProfile } from './ProfileProvider';
import { useSync } from './SyncProvider';

/** Saves this login's settings online and restores them on a new or reinstalled computer. Renders nothing. */
export default function SettingsSync() {
  const { settings, replaceAll } = useSettings();
  const { profile } = useProfile();
  const { lastSync, online } = useSync();
  const userId = profile?.id;
  const running = useRef(false);
  const latest = useRef(settings);
  latest.current = settings;

  const run = useCallback(async () => {
    if (!supabase || !userId || running.current || !navigator.onLine) return;
    running.current = true;
    let result = 'same';
    try { result = await syncSettings(supabase, userId, latest.current, replaceAll); } catch { result = 'error'; }
    finally { running.current = false; }
    // something was changed while saving: save once more (not after errors, so a problem never loops)
    if (result === 'pushed' && readMeta().dirty) setTimeout(run, SETTINGS_SYNC_DELAY_MS);
  }, [userId, replaceAll]);

  // at start, after every full sync, and when the internet comes back
  useEffect(() => { const t = setTimeout(run, SETTINGS_SYNC_DELAY_MS); return () => clearTimeout(t); }, [run, lastSync, online]);
  // shortly after a change made on this computer
  useEffect(() => {
    if (!readMeta().dirty) return;
    const t = setTimeout(run, SETTINGS_SYNC_DELAY_MS);
    return () => clearTimeout(t);
  }, [settings, run]);

  return null;
}
