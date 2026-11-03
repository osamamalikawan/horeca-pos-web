'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { ago } from '@/lib/util';
import { BUILD_SHA, WEB_VERSION, checkForUpdate, getShellVersion, type UpdateResult } from '@/lib/version';
import { useSync } from './SyncProvider';
import { useDesktopUpdate } from './UpdateProvider';

export default function SyncPopover() {
  const { status, lastSync, error, sync, deadline, now, online, subChecked } = useSync();
  const desk = useDesktopUpdate();
  const [open, setOpen] = useState(false);
  const [shell, setShell] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const waiting = useLiveQuery(async () => ({
    sales: await db.outbox.filter((o) => o.table === 'invoices').count(),
    all: await db.outbox.count(),
  }), []) ?? { sales: 0, all: 0 };

  useEffect(() => { getShellVersion().then(setShell); }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const pill =
    status === 'syncing' ? 'Syncing…' :
    status === 'offline' || !online ? 'Offline' :
    status === 'error' ? 'Sync failed' :
    lastSync ? `Synced ${ago(lastSync, now)}` : 'Not synced yet';

  const hoursLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 3600000));
  const otherChanges = Math.max(waiting.all - waiting.sales, 0);

  async function check() {
    setChecking(true); setUpd(null);
    setUpd(await checkForUpdate());
    setChecking(false);
  }

  return (
    <div className="syncwrap" ref={box}>
      <button className="pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className={'dot ' + (!online || status === 'offline' ? 'off' : status === 'error' ? 'err' : '')} />
        <span>{pill}</span>
        {desk.supported && desk.status === 'available' && <b>Update</b>}
      </button>

      {open && (
        <div className="pop" role="dialog" aria-label="Sync status">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Sync status</h3>
            <span className={'badge ' + (online ? '' : 'off')}>{online ? 'Online' : 'Offline'}</span>
          </div>
          <dl className="kv">
            <dt>Last synced</dt>
            <dd className="num">{lastSync ? `${ago(lastSync, now)}, ${new Date(lastSync).toLocaleString()}` : 'Never'}</dd>
            <dt>Subscription checked</dt>
            <dd className="num">{subChecked ? ago(subChecked, now) : 'Not yet'}</dd>
            <dt>Waiting to upload</dt>
            <dd className="num">{waiting.sales} sale(s){otherChanges > 0 ? `, ${otherChanges} other changes` : ''}</dd>
            <dt>Sync needed within</dt>
            <dd className={'num ' + (hoursLeft !== null && hoursLeft <= 12 ? 'warn' : '')}>{hoursLeft === null ? '' : `${hoursLeft} h`}</dd>
          </dl>
          {status === 'error' && error && <div className="err">{error}</div>}
          <button className="btn primary" onClick={sync} disabled={status === 'syncing' || !online}>
            {status === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
          <hr className="rule" />
          <dl className="kv">
            <dt>Desktop version</dt>
            <dd className="num">{shell ? `v${shell}` : 'Browser'}</dd>
            <dt>Web version</dt>
            <dd className="num">v{WEB_VERSION} ({BUILD_SHA})</dd>
          </dl>
          {desk.supported ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {desk.status === 'available' || desk.status === 'preparing' || desk.status === 'downloading' || desk.status === 'installing' ? (
                <>
                  <div><b>Version {desk.version} is available.</b></div>
                  {desk.notes && <div className="mute">{desk.notes.slice(0, 200)}</div>}
                  {desk.status === 'available' && <button className="btn primary" onClick={desk.install}>Install and restart</button>}
                  {desk.status === 'preparing' && <div className="mute">Uploading waiting changes first…</div>}
                  {desk.status === 'downloading' && <div className="mute num">Downloading… {desk.progress ?? 0}%</div>}
                  {desk.status === 'installing' && <div className="mute">Installing. The app will restart.</div>}
                </>
              ) : (
                <button className="linkbtn" onClick={desk.check} disabled={desk.status === 'checking'}>{desk.status === 'checking' ? 'Checking…' : 'Check for updates'}</button>
              )}
              {desk.status === 'latest' && <div className="mute">You are on the latest version.</div>}
              {desk.error && <div className="err">{desk.error}</div>}
            </div>
          ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            <button className="linkbtn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check for updates'}</button>
            {upd?.state === 'latest' && <div className="mute">You are on the latest version.</div>}
            {upd?.state === 'error' && <div className="err">Could not check. Are you online?</div>}
            {upd?.state === 'desktop' && <div className="mute">Desktop updates will arrive with the desktop updater.</div>}
            {upd?.state === 'available' && (
              <div>A newer version is available: {upd.latest}. <button className="linkbtn" onClick={() => location.reload()}>Reload</button></div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
