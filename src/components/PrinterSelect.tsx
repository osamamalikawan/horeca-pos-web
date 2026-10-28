'use client';
import { useCallback, useEffect, useState } from 'react';
import { inDesktopApp, listPrinters, type PrinterInfo } from '@/lib/desktop';

/**
 * Printer chooser. In the desktop app it lists the printers installed on this computer.
 * In a browser a program cannot see the printers, so it is a plain name box (the print dialog does the choosing).
 */
export default function PrinterSelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [desktop, setDesktop] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setPrinters(await listPrinters()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (inDesktopApp()) { setDesktop(true); load(); } }, [load]);

  if (!desktop) {
    return <input value={value} placeholder="Chosen in the print dialog in a browser" onChange={(e) => onChange(e.target.value)} />;
  }
  const def = printers?.find((p) => p.isDefault);
  const known = !value || !!printers?.some((p) => p.name === value);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Printer">
          <option value="">{def ? `Windows default printer (${def.name})` : 'Windows default printer'}</option>
          {!known && <option value={value}>{value} (not found on this computer)</option>}
          {printers?.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
        </select>
        <button type="button" className="btn small quiet" style={{ height: 38 }} onClick={load} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
      </div>
      {error && <span className="err">Could not list printers: {error}</span>}
      {printers && printers.length === 0 && !error && <span className="mute" style={{ fontSize: 12 }}>No printers are installed on this computer.</span>}
    </div>
  );
}
