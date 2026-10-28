'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { db } from '@/lib/db';
import { AUTO_INSTALL_AT_LAUNCH, UPDATE_FIRST_CHECK_MS, UPDATE_RECHECK_MS } from '@/lib/updateTiming';
import { useSync } from './SyncProvider';

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'preparing' | 'downloading' | 'installing' | 'error';
interface Ctx {
  supported: boolean;                 // true only inside the Windows desktop app
  status: UpdateStatus; version: string | null; notes: string | null; progress: number | null; error: string | null;
  check: () => Promise<void>; install: () => Promise<void>;
}
const UpdateCtx = createContext<Ctx>({
  supported: false, status: 'idle', version: null, notes: null, progress: null, error: null,
  check: async () => {}, install: async () => {},
});
export const useDesktopUpdate = () => useContext(UpdateCtx);

const inDesktopApp = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const TRIED_KEY = 'horeca-update-tried';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// GitHub answers "Not Found" when no update has been published, which the updater reports as a JSON error
const friendly = (m: string) => /valid release json|not found|404|expected value|unexpected token/i.test(m)
  ? 'No update has been published yet, or the update address cannot be reached.' : m;

export default function UpdateProvider({ children }: { children: React.ReactNode }) {
  const { sync } = useSync();
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);
  const touched = useRef(false);     // has anyone used the app since it opened?

  useEffect(() => { setSupported(inDesktopApp()); }, []);
  useEffect(() => {
    const mark = () => { touched.current = true; };
    window.addEventListener('keydown', mark, true);
    window.addEventListener('pointerdown', mark, true);
    return () => { window.removeEventListener('keydown', mark, true); window.removeEventListener('pointerdown', mark, true); };
  }, []);

  const check = useCallback(async () => {
    if (!inDesktopApp() || busy.current) return;
    setStatus('checking'); setError(null);
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater');
      const found = await checkUpdate();
      if (found) { update.current = found; setVersion(found.version); setNotes(found.body ?? null); setStatus('available'); }
      else { update.current = null; setVersion(null); setNotes(null); setStatus('latest'); }
    } catch (e) { setError(friendly(message(e))); setStatus('error'); }
  }, []);

  const install = useCallback(async () => {
    const found = update.current;
    if (!found || busy.current) return;
    busy.current = true; setError(null); setStatus('preparing');
    try {
      await sync();                                           // upload what is waiting first
      const waiting = await db.outbox.count();
      if (waiting > 0) {
        setError(`${waiting} changes are still waiting to upload. Check the internet connection and sync first, then update.`);
        setStatus('available'); return;
      }
      setStatus('downloading'); setProgress(0);
      let total = 0, got = 0;
      await found.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) setProgress(Math.min(100, Math.round((got * 100) / total))); }
        else if (ev.event === 'Finished') setProgress(100);
      });
      setStatus('installing');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) { setError(message(e)); setStatus('error'); }
    finally { busy.current = false; }
  }, [sync]);

  // keep the newest functions for the timers below, so the timers never restart
  const checkRef = useRef(check), installRef = useRef(install);
  checkRef.current = check; installRef.current = install;

  useEffect(() => {
    if (!supported) return;
    const run = async (atLaunch: boolean) => {
      await checkRef.current();
      if (!atLaunch || !AUTO_INSTALL_AT_LAUNCH || !update.current) return;
      if (touched.current || sessionStorage.getItem(TRIED_KEY)) return;   // someone is using the app: ask instead
      sessionStorage.setItem(TRIED_KEY, '1');
      await installRef.current();
    };
    const first = setTimeout(() => run(true), UPDATE_FIRST_CHECK_MS);
    const again = setInterval(() => run(false), UPDATE_RECHECK_MS);
    return () => { clearTimeout(first); clearInterval(again); };
  }, [supported]);

  return (
    <UpdateCtx.Provider value={{ supported, status, version, notes, progress, error, check, install }}>
      {children}
    </UpdateCtx.Provider>
  );
}
