'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Kind, Party } from '@/lib/types';

export interface Line { product_id: string; name: string; unit_price: number; qty: number; disc: string }
export interface Split { kind: Kind; amount: string }

/** One open invoice (a "draft"). Several can be open at once; they survive page changes and reloads. */
export interface Draft {
  id: string; n: number;
  cart: Line[]; billDisc: string; customer: Party | null; cq: string; splits: Split[];
}

export const MAX_DRAFTS = 9;      // Alt+1 .. Alt+9
const KEY = 'horeca-pos-drafts';
const blank = (n: number): Draft => ({
  id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, n,
  cart: [], billDisc: '', customer: null, cq: '', splits: [{ kind: 'cash', amount: '' }],
});
export const draftIsEmpty = (d: Draft) => d.cart.length === 0;

interface Ctx {
  drafts: Draft[]; active: Draft;
  /** Change the active invoice. Safe to call from timers: it always works on the latest state. */
  patchActive: (f: (d: Draft) => Partial<Draft>) => void;
  switchTo: (idOrIndex: string | number) => void;
  newDraft: () => boolean;                       // false when the limit is reached
  closeDraft: (id: string) => void;
  finishDraft: (id: string) => void;             // after a completed sale: remove it (or reset it if it is the only one)
}
const noop = () => {};
const first = blank(1);
const PosDraftsCtx = createContext<Ctx>({
  drafts: [first], active: first, patchActive: noop, switchTo: noop, newDraft: () => false, closeDraft: noop, finishDraft: noop,
});
export const usePosDrafts = () => useContext(PosDraftsCtx);

interface State { drafts: Draft[]; activeId: string; next: number }

export default function PosDraftsProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<State>(() => ({ drafts: [first], activeId: first.id, next: 2 }));
  const loaded = useRef(false);
  const cur = useRef(st);
  cur.current = st;

  // restore after a reload (localStorage only exists in the browser, so this runs after mount)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as State;
        if (Array.isArray(s.drafts) && s.drafts.length && s.drafts.some((d) => d.id === s.activeId)) setSt(s);
      }
    } catch { /* ignore a damaged copy */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage full or blocked */ }
  }, [st]);

  const patchActive = useCallback((f: (d: Draft) => Partial<Draft>) => {
    setSt((s) => ({ ...s, drafts: s.drafts.map((d) => (d.id === s.activeId ? { ...d, ...f(d) } : d)) }));
  }, []);
  const switchTo = useCallback((x: string | number) => {
    setSt((s) => {
      const d = typeof x === 'number' ? s.drafts[x] : s.drafts.find((r) => r.id === x);
      return d ? { ...s, activeId: d.id } : s;
    });
  }, []);
  const newDraft = useCallback(() => {
    const s0 = cur.current;
    if (!s0.drafts.some(draftIsEmpty) && s0.drafts.length >= MAX_DRAFTS) return false;
    setSt((s) => {
      // reuse an empty invoice instead of piling up blank tabs
      const empty = s.drafts.find(draftIsEmpty);
      if (empty) return { ...s, activeId: empty.id };
      if (s.drafts.length >= MAX_DRAFTS) return s;
      const d = blank(s.next);
      return { drafts: [...s.drafts, d], activeId: d.id, next: s.next + 1 };
    });
    return true;
  }, []);
  const remove = (s: State, id: string): State => {
    const i = s.drafts.findIndex((d) => d.id === id);
    if (i < 0) return s;
    if (s.drafts.length === 1) { const d = blank(s.next); return { drafts: [d], activeId: d.id, next: s.next + 1 }; }
    const drafts = s.drafts.filter((d) => d.id !== id);
    const activeId = s.activeId === id ? drafts[Math.min(i, drafts.length - 1)].id : s.activeId;
    return { ...s, drafts, activeId };
  };
  const closeDraft = useCallback((id: string) => setSt((s) => remove(s, id)), []);
  const finishDraft = closeDraft;

  const active = st.drafts.find((d) => d.id === st.activeId) ?? st.drafts[0];
  return (
    <PosDraftsCtx.Provider value={{ drafts: st.drafts, active, patchActive, switchTo, newDraft, closeDraft, finishDraft }}>
      {children}
    </PosDraftsCtx.Provider>
  );
}
