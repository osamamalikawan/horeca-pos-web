'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { syncNow } from '@/lib/sync';
import { checkSubscription, lockDevice, SEEN_KEY, SUB_CHECKED_KEY, SYNC_ERR_KEY, SYNC_LIMIT_MS } from '@/lib/subscription';
import { useProfile } from './ProfileProvider';
import { SYNC_AFTER_CHANGE_MS, SYNC_INTERVAL_MS } from '@/lib/syncTiming';

type Status = 'idle' | 'syncing' | 'error' | 'offline';
interface Ctx {
  status: Status; lastSync: string | null; error: string | null; pending: number;
  sync: () => Promise<void>; deadline: number | null; now: number; online: boolean;
  subChecked: string | null;     // last time the subscription was read from the server
}

const SyncCtx = createContext<Ctx>({
  status: 'idle', lastSync: null, error: null, pending: 0, sync: async () => {}, deadline: null, now: 0, online: true, subChecked: null,
});
export const useSync = () => useContext(SyncCtx);

export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null); // last sync, or first run if never synced
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);                     // first sync attempt finished
  const [online, setOnline] = useState(true);
  const [subChecked, setSubChecked] = useState<string | null>(null);
  const busy = useRef(false);
  const { refresh: refreshProfile } = useProfile();
  const pendingRaw = useLiveQuery(() => db.outbox.count(), []);
  const pending = pendingRaw ?? 0;
  const prevPending = useRef<number | null>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAgain = useRef(false);                       // a change arrived while a sync was running
  const syncRef = useRef<() => Promise<void>>(async () => {});

  const sync = useCallback(async () => {
    if (busy.current) return;
    if (!navigator.onLine) { setStatus('offline'); setReady(true); return; }
    busy.current = true; setStatus('syncing'); setError(null);
    try {
      // Step 1: the subscription. Always first, and it does not wait for (or depend on) the data sync.
      const sub = await checkSubscription();
      if (!sub.ok) {
        // Locked: still try once to upload waiting sales (as before), but the lock does not depend on it.
        try { await syncNow(); } catch { /* the device is locked either way */ }
        lockDevice(sub.reason); setStatus('idle'); return;
      }
      if (sub.reached) {
        // The 3-day rule exists so a paused or ended subscription is noticed. Reaching the server and reading it as
        // active satisfies that, even if the data sync below fails, so a sync problem alone never signs the device out.
        try { setSubChecked(localStorage.getItem(SUB_CHECKED_KEY)); } catch { /* ignore */ }
        setBaseline((b) => Math.max(b ?? 0, Date.now()));
      }
      // Step 2: the data (sales, products, ...). If this fails the subscription result above still stands.
      const r = await syncNow();
      if (r.failed.length) {
        // Everything else went through; these changes were refused by the server and stay queued (see Waiting to upload).
        const m = `${r.failed.length} change(s) could not upload. First problem, ${r.failed[0].table}: ${r.failed[0].message}`;
        setError(m); setStatus('error');
        setBaseline((b) => Math.max(b ?? 0, Date.now()));        // the server answered, so the device is in contact
        try { localStorage.setItem(SYNC_ERR_KEY, `${new Date().toLocaleString()}: ${m}`); } catch { /* ignore */ }
        refreshProfile();
        return;
      }
      const t = new Date(r.at).getTime();
      setLastSync(r.at); setBaseline(t); setStatus('idle');
      localStorage.setItem(SEEN_KEY, String(t));
      refreshProfile();
      try { localStorage.removeItem(SYNC_ERR_KEY); } catch { /* ignore */ }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg); setStatus('error');
      // The server answered with an error (not a network failure): the device is in contact, so a sync problem alone must not sign it out.
      if (!/failed to fetch|networkerror|network request failed|fetch failed|offline|timed? ?out/i.test(msg)) setBaseline((b) => Math.max(b ?? 0, Date.now()));
      try { localStorage.setItem(SYNC_ERR_KEY, `${new Date().toLocaleString()}: ${e?.message ?? String(e)}`); } catch { /* ignore */ }
    } finally {
      busy.current = false; setReady(true);
      if (syncAgain.current) {                    // upload what was added during this sync
        syncAgain.current = false;
        changeTimer.current = setTimeout(() => { changeTimer.current = null; syncRef.current(); }, SYNC_AFTER_CHANGE_MS);
      }
    }
  }, [refreshProfile]);
  syncRef.current = sync;

  // Sync a few seconds after the last NEW local change (a sale, expense, return...).
  // Several quick changes are sent together; failed syncs are not retried in a loop.
  useEffect(() => {
    if (pendingRaw === undefined) return;             // still loading the count
    const before = prevPending.current;
    prevPending.current = pendingRaw;
    if (before === null || pendingRaw <= before) return;
    if (busy.current) { syncAgain.current = true; return; }
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => { changeTimer.current = null; syncRef.current(); }, SYNC_AFTER_CHANGE_MS);
  }, [pendingRaw]);
  useEffect(() => () => { if (changeTimer.current) clearTimeout(changeTimer.current); }, []);

  useEffect(() => {
    (async () => {
      const ls = (await db.meta.get('lastSync'))?.value as string | undefined;
      let first = (await db.meta.get('firstSeen'))?.value as string | undefined;
      if (!ls && !first) { first = new Date().toISOString(); await db.meta.put({ key: 'firstSeen', value: first }); }
      if (ls) setLastSync(ls);
      let subAt = 0;
      try { const v = localStorage.getItem(SUB_CHECKED_KEY); subAt = v ? new Date(v).getTime() : 0; } catch { /* ignore */ }
      const start = Math.max(new Date((ls ?? first)!).getTime(), subAt);   // last data sync or last subscription check, whichever is newer
      setBaseline((b) => Math.max(b ?? 0, start));
    })();
    setOnline(navigator.onLine);
    try { setSubChecked(localStorage.getItem(SUB_CHECKED_KEY)); } catch { /* ignore */ }
    sync();                                        // on start
    const timer = setInterval(sync, SYNC_INTERVAL_MS);   // every hour
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => { setOnline(false); setStatus('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

  // 3-day rule: sign out when the device has gone too long without a sync, or the clock was set back.
  useEffect(() => {
    const tick = () => {
      const n = Date.now();
      setNow(n);
      const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
      const rolledBack = seen > 0 && n < seen - 5 * 60 * 1000;
      if (!rolledBack && n > seen) localStorage.setItem(SEEN_KEY, String(n));
      if (!ready) return;
      if (rolledBack) lockDevice('clock');
      else if (baseline !== null && n - baseline >= SYNC_LIMIT_MS) lockDevice('sync');
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [baseline, ready]);

  const deadline = baseline !== null ? baseline + SYNC_LIMIT_MS : null;
  return (
    <SyncCtx.Provider value={{ status, lastSync, error, pending, sync, deadline, now, online, subChecked }}>
      {children}
    </SyncCtx.Provider>
  );
}
