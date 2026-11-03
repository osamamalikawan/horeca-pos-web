'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';
import { usePosDrafts, MAX_DRAFTS } from './PosDrafts';
import { permForPath } from '@/lib/permissions';
import { ACCOUNT_ITEMS, NAV_GROUPS } from '@/lib/nav';
import { money } from '@/lib/util';

/**
 * Keys that work on every page:
 *   Alt+1..9  open that POS invoice      Alt+N  new invoice      Alt+W  close this invoice
 *   Alt+<letter>  open a page (shown next to each menu item)     Alt+K or Ctrl+K  jump list
 */
export default function GlobalShortcuts() {
  const router = useRouter();
  const { can } = useProfile();
  const { drafts, active, switchTo, newDraft, closeDraft } = usePosDrafts();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(
    () => [...NAV_GROUPS.flatMap((g) => g.items), ...ACCOUNT_ITEMS].filter((n) => { const need = permForPath(n.href); return !need || can(need); }),
    [can],
  );
  const canPos = pages.some((p) => p.href === '/pos/');
  const goPos = useCallback(() => { if (canPos) router.push('/pos/'); }, [canPos, router]);

  // always call the newest handlers from one listener
  const h = useRef({ pages, drafts, active, canPos });
  h.current = { pages, drafts, active, canPos };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { pages, drafts, active, canPos } = h.current;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') { e.preventDefault(); setQ(''); setSel(0); setOpen((o) => !o); return; }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const code = e.code;
      if (code === 'KeyK') { e.preventDefault(); setQ(''); setSel(0); setOpen((o) => !o); return; }
      if (!canPos) { /* pages only */ }
      const digit = /^(Digit|Numpad)([1-9])$/.exec(code);
      if (digit && canPos) {
        const i = Number(digit[2]) - 1;
        if (i < drafts.length) { e.preventDefault(); switchTo(i); goPos(); }
        return;
      }
      if (code === 'KeyN' && canPos) { e.preventDefault(); if (!newDraft()) window.alert(`You can keep ${MAX_DRAFTS} invoices open at once.`); goPos(); return; }
      if (code === 'KeyW' && canPos) {
        e.preventDefault();
        if (active.cart.length && !window.confirm('Close this invoice? Its items will be removed.')) return;
        closeDraft(active.id);
        return;
      }
      const combo = 'Alt+' + (e.shiftKey ? 'Shift+' : '') + code.replace(/^Key/, '');
      const page = pages.find((p) => p.key === combo);
      if (page) { e.preventDefault(); router.push(page.href); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, goPos, switchTo, newDraft, closeDraft]);

  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

  type Row = { id: string; label: string; hint: string; key?: string; run: () => void };
  const rows: Row[] = useMemo(() => {
    const inv: Row[] = canPos ? drafts.map((d, i) => ({
      id: 'inv' + d.id, label: `Invoice #${d.n}${d.customer ? `, ${d.customer.name}` : ''}`,
      hint: d.cart.length ? `${d.cart.length} products, ${money(d.cart.reduce((s, l) => s + l.qty * l.unit_price, 0))}` : 'empty',
      key: `Alt+${i + 1}`, run: () => { switchTo(i); goPos(); },
    })) : [];
    const pg: Row[] = pages.map((p) => ({ id: p.href, label: p.label, hint: p.hint, key: p.key, run: () => router.push(p.href) }));
    const s = q.trim().toLowerCase();
    return [...inv, ...pg].filter((r) => !s || r.label.toLowerCase().includes(s) || r.hint.toLowerCase().includes(s));
  }, [drafts, pages, canPos, q, switchTo, goPos, router]);

  if (!open) return null;
  const pick = (r?: Row) => { if (!r) return; setOpen(false); r.run(); };
  return (
    <>
      <div className="backdrop" onClick={() => setOpen(false)} />
      <div className="palette" role="dialog" aria-label="Jump to">
        <input ref={inputRef} value={q} placeholder="Jump to a page or an open invoice" aria-label="Jump to"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(rows[sel]); }
          }} />
        <div className="plist">
          {rows.length === 0 && <div className="empty">Nothing matches.</div>}
          {rows.map((r, i) => (
            <button key={r.id} className={'prow' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              <span><b>{r.label}</b> <span className="hint">{r.hint}</span></span>
              {r.key && <span className="kbd">{r.key}</span>}
            </button>
          ))}
        </div>
        <div className="hint" style={{ padding: '8px 12px' }}>Alt+N new invoice, Alt+W close invoice, Alt+1 to 9 switch invoice.</div>
      </div>
    </>
  );
}
