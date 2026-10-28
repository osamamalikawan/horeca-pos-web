'use client';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/components/SettingsProvider';
import { labelPage, printPage, RECEIPT_PAGE } from '@/lib/print';
import type { Settings, Theme } from '@/lib/settings';
import PrintPortal from '@/components/PrintPortal';
import ReceiptView, { type Receipt } from '@/components/ReceiptView';
import LabelView from '@/components/LabelView';
import PrinterSelect from '@/components/PrinterSelect';

const SAMPLE: Receipt = {
  no: 'TEST-00001', date: new Date().toISOString(), customer: null,
  lines: [
    { name: 'Sample product A', qty: 2, price: 150, disc: 0, total: 300 },
    { name: 'Sample product B', qty: 1, price: 480, disc: 30, total: 450 },
  ],
  subtotal: 780, itemDisc: 30, billDisc: 0, discountTotal: 30, total: 750,
  payments: [{ name: 'Cash', amount: 750 }], change: 0, balance: 0,
};

const num = (v: string, fallback: number) => { const n = Number(v); return isFinite(n) && n > 0 ? n : fallback; };

export default function SettingsPage() {
  const { settings: s, update } = useSettings();
  const set = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) =>
    update((cur) => ({ ...cur, [k]: { ...(cur[k] as object), ...patch } }));

  const [test, setTest] = useState<'receipt' | 'label' | null>(null);
  function testPrint(kind: 'receipt' | 'label') {
    setTest(kind);
    setTimeout(() => {
      printPage(kind === 'receipt' ? RECEIPT_PAGE : labelPage(s.label.widthMm, s.label.heightMm), kind === 'receipt' ? 'receipt' : 'label');
      setTimeout(() => setTest(null), 500);
    }, 200);
  }

  // scanner test
  const [scan, setScan] = useState('');
  const [result, setResult] = useState<{ value: string; ms: number } | null>(null);
  const times = useRef<number[]>([]);
  function finish(v: string) {
    if (!v) return;
    const t = times.current;
    setResult({ value: v, ms: t.length > 1 ? Math.round(t[t.length - 1] - t[0]) : 0 });
    setScan(''); times.current = [];
  }
  useEffect(() => {
    if (s.scanner.terminator !== 'none' || !scan) return;
    const t = setTimeout(() => finish(scan), 250);
    return () => clearTimeout(t);
  }, [scan, s.scanner.terminator]);
  const gap = result && result.value.length > 1 ? result.ms / (result.value.length - 1) : null;

  const themes: { v: Theme; label: string }[] = [{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }];

  return (
    <>
      <div className="head"><h1>Settings</h1></div>
      <p className="mute" style={{ maxWidth: 760, marginTop: 0 }}>
        These settings are saved on this device only, so each counter can have its own printers and scanner.
      </p>

      <section className="section">
        <h2>Appearance</h2>
        <div className="seg" style={{ maxWidth: 320, gridTemplateColumns: 'repeat(3, 1fr)' }} role="group" aria-label="Theme">
          {themes.map((t) => (
            <button key={t.v} className={s.theme === t.v ? 'on' : ''} onClick={() => update((c) => ({ ...c, theme: t.v }))}>{t.label}</button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Receipt printer (thermal)</h2>
        <div className="two">
          <label>Store name<input value={s.store.name} onChange={(e) => set('store', { name: e.target.value })} /></label>
          <label>Phone<input value={s.store.phone} onChange={(e) => set('store', { phone: e.target.value })} /></label>
        </div>
        <label>Address<input value={s.store.address} onChange={(e) => set('store', { address: e.target.value })} /></label>
        <label>Footer message<input value={s.store.footer} onChange={(e) => set('store', { footer: e.target.value })} /></label>
        <div className="two">
          <label>Paper width
            <select value={s.receipt.paperMm} onChange={(e) => set('receipt', { paperMm: Number(e.target.value) })}>
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </select>
          </label>
          <label>Printer<PrinterSelect value={s.receipt.printerName} onChange={(name) => set('receipt', { printerName: name })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.receipt.autoPrint} onChange={(e) => set('receipt', { autoPrint: e.target.checked })} />Print the invoice automatically after every sale</label>
        <div className="mute" style={{ fontSize: 13 }}>
          In the desktop app, receipts print straight to the printer chosen here, with no print dialog.
          In a browser, a program cannot see your printers, so the normal print dialog opens and you choose the printer there.
        </div>
        <div><button className="btn" onClick={() => testPrint('receipt')}>Print test receipt</button></div>
      </section>

      <section className="section">
        <h2>Barcode scanner</h2>
        <div className="two">
          <label>Scanner sends after the code
            <select value={s.scanner.terminator} onChange={(e) => set('scanner', { terminator: e.target.value as Settings['scanner']['terminator'] })}>
              <option value="enter">Enter key</option>
              <option value="tab">Tab key</option>
              <option value="none">Nothing (add when typing stops)</option>
            </select>
          </label>
          <label>Shortest barcode accepted<input inputMode="numeric" value={s.scanner.minLength} onChange={(e) => set('scanner', { minLength: Math.floor(num(e.target.value, 4)) })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.scanner.beep} onChange={(e) => set('scanner', { beep: e.target.checked })} />Beep on a successful scan, and a low tone when no product matches</label>
        <label className="check"><input type="checkbox" checked={s.scanner.focusAnywhere} onChange={(e) => set('scanner', { focusAnywhere: e.target.checked })} />On the POS page, send scans to the search box even when nothing is selected</label>
        <label>Test the scanner
          <input value={scan} placeholder="Click here, then scan a barcode" onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key.length === 1) times.current.push(performance.now());
              const end = (s.scanner.terminator === 'enter' && e.key === 'Enter') || (s.scanner.terminator === 'tab' && e.key === 'Tab') || e.key === 'Enter';
              if (end) { e.preventDefault(); finish(scan); }
            }} />
        </label>
        {result && (
          <div className="num">
            Read “{result.value}”, {result.value.length} characters in {result.ms} ms
            {gap !== null && (gap < 40 ? ', looks like a scanner.' : ', looks like typing by hand.')}
          </div>
        )}
        <div className="mute" style={{ fontSize: 13 }}>USB and Bluetooth scanners that act like a keyboard work with no driver. If scans arrive without pressing Enter, choose “Nothing”.</div>
      </section>

      <section className="section">
        <h2>Sticker printer (barcode labels)</h2>
        <div className="two">
          <label>Label width (mm)<input inputMode="decimal" value={s.label.widthMm} onChange={(e) => set('label', { widthMm: num(e.target.value, 50) })} /></label>
          <label>Label height (mm)<input inputMode="decimal" value={s.label.heightMm} onChange={(e) => set('label', { heightMm: num(e.target.value, 30) })} /></label>
        </div>
        <div className="two">
          <label>Printer<PrinterSelect value={s.label.printerName} onChange={(name) => set('label', { printerName: name })} /></label>
          <label>Labels per print<input inputMode="numeric" value={s.label.copies} onChange={(e) => set('label', { copies: Math.floor(num(e.target.value, 1)) })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.label.showName} onChange={(e) => set('label', { showName: e.target.checked })} />Show product name</label>
        <label className="check"><input type="checkbox" checked={s.label.showPrice} onChange={(e) => set('label', { showPrice: e.target.checked })} />Show sale price</label>
        <div className="bc"><LabelView name="Sample product" price={250} barcode="2012345678903" s={s.label} /></div>
        <div className="mute" style={{ fontSize: 13 }}>
          In the desktop app, labels print straight to this printer at the size above, one label per sticker.
          In a browser, choose the sticker printer in the print dialog and set the same paper size there.
        </div>
        <div><button className="btn" onClick={() => testPrint('label')}>Print test label</button></div>
      </section>

      {test === 'receipt' && <PrintPortal><ReceiptView r={SAMPLE} store={s.store} paperMm={s.receipt.paperMm} /></PrintPortal>}
      {test === 'label' && <PrintPortal><LabelView name="Sample product" price={250} barcode="2012345678903" s={s.label} /></PrintPortal>}
    </>
  );
}
