'use client';
import { useRef, useState } from 'react';

/**
 * Number field that edits through a text draft, so "0." and ".5" can be typed.
 * - clearOnFocus: the box empties when clicked; leaving it empty restores the old value.
 * - live: commit while typing (used for quantity); otherwise commit on Enter or when leaving the box.
 * Invalid, empty or zero input always falls back to the previous value.
 */
export default function NumInput({ value, onCommit, clearOnFocus = false, live = false, decimals = 2, className, label }: {
  value: number; onCommit: (n: number) => void; clearOnFocus?: boolean; live?: boolean;
  decimals?: number; className?: string; label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null); // null = not being edited
  const cancelled = useRef(false);
  const factor = 10 ** decimals;
  const parse = (t: string) => {
    const n = Number(t);
    return t.trim() !== '' && isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * factor) / factor : null;   // 1e7+ is almost surely a scanned barcode
  };

  return (
    <input
      className={className} inputMode="decimal" aria-label={label}
      value={draft ?? String(value)} placeholder={String(value)}
      onFocus={(e) => {
        cancelled.current = false;
        if (clearOnFocus) setDraft('');
        else { setDraft(String(value)); const el = e.target; requestAnimationFrame(() => el.select()); }
      }}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^\d*\.?\d*$/.test(t)) return;
        setDraft(t);
        if (live) { const n = parse(t); if (n !== null) onCommit(n); }
      }}
      onBlur={() => {
        if (draft !== null && !live && !cancelled.current) { const n = parse(draft); if (n !== null) onCommit(n); }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === 'Enter') el.blur();
        if (e.key === 'Escape') { cancelled.current = true; el.blur(); }
      }}
    />
  );
}
