'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import SyncPopover from './SyncPopover';
import { useSettings } from './SettingsProvider';
import { useProfile } from './ProfileProvider';
import { supabase } from '@/lib/supabase';
import { permForPath } from '@/lib/permissions';
import { ACCOUNT_ITEMS, NAV_GROUPS, sameRoute, type NavItem } from '@/lib/nav';
import type { Theme } from '@/lib/settings';

const THEMES: { v: Theme; label: string }[] = [{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }];

export default function Header() {
  const path = usePathname();
  const { settings, update } = useSettings();
  const { profile, can } = useProfile();
  const [open, setOpen] = useState<string | null>(null);      // the open menu: a group name, 'user', or null
  const [mobile, setMobile] = useState(false);               // small screens: the whole menu behind one button
  const root = useRef<HTMLElement>(null);

  const allowed = (href: string) => { const need = permForPath(href); return !need || can(need); };
  const groups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.href)) })).filter((g) => g.items.length),
    [can],   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const account = ACCOUNT_ITEMS.filter((i) => allowed(i.href));

  // close menus on a page change, a click elsewhere, or Esc
  useEffect(() => { setOpen(null); setMobile(false); }, [path]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(null); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setMobile(false); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, []);

  // arrow keys move through an open menu
  function menuKeys(e: React.KeyboardEvent<HTMLElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  }
  function triggerKeys(e: React.KeyboardEvent<HTMLElement>, name: string) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(name);
      requestAnimationFrame(() => e.currentTarget.parentElement?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    }
  }

  const dark = typeof window !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const link = (i: NavItem, extra = '') => (
    <Link key={i.href} href={i.href} role="menuitem" className={'menuitem ' + (sameRoute(path, i.href) ? 'cur ' : '') + extra}>
      <span className="mi-top"><span>{i.label}</span>{i.key && <span className="kbd">{i.key}</span>}</span><span className="hint">{i.hint}</span>
    </Link>
  );

  return (
    <header className="top" ref={root}>
      <Link href="/" className="brand">Horeca POS</Link>
      <button className="menu-toggle btn small quiet" aria-expanded={mobile} onClick={() => setMobile((m) => !m)}>Menu</button>

      <nav className={'mainnav' + (mobile ? ' show' : '')} aria-label="Main">
        {groups.map((g) => {
          const active = g.items.some((i) => sameRoute(path, i.href));
          if (g.items.length === 1) {
            const i = g.items[0];
            return <Link key={g.label} href={i.href} className={'navbtn ' + (active ? 'on' : '')}>{i.label}</Link>;
          }
          return (
            <div key={g.label} className="dd">
              <button className={'navbtn ' + (active ? 'on' : '')} aria-haspopup="menu" aria-expanded={open === g.label}
                onClick={() => setOpen(open === g.label ? null : g.label)} onKeyDown={(e) => triggerKeys(e, g.label)}>
                {g.label}<span className="caret" aria-hidden>▾</span>
              </button>
              {open === g.label && <div className="menu" role="menu" onKeyDown={menuKeys}>{g.items.map((i) => link(i))}</div>}
            </div>
          );
        })}
      </nav>

      <div className="hright">
        <SyncPopover />
        <div className="dd">
          <button className="navbtn userbtn" aria-haspopup="menu" aria-expanded={open === 'user'}
            onClick={() => setOpen(open === 'user' ? null : 'user')} onKeyDown={(e) => triggerKeys(e, 'user')}>
            <span className="avatar" aria-hidden>{(profile?.name || profile?.email || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="uname">{profile?.name || 'Account'}</span><span className="caret" aria-hidden>▾</span>
          </button>
          {open === 'user' && (
            <div className="menu end" role="menu" onKeyDown={menuKeys}>
              <div className="who">
                <b>{profile?.name || 'Signed in'}</b>
                <span className="hint">{profile?.role === 'admin' ? 'Administrator' : 'Staff'}{profile?.email ? `, ${profile.email}` : ''}</span>
              </div>
              {account.map((i) => link(i))}
              <div className="sep" />
              <div className="themerow" role="group" aria-label="Theme">
                {THEMES.map((t) => (
                  <button key={t.v} className={(settings.theme === t.v ? 'on' : '')} onClick={() => update((s) => ({ ...s, theme: t.v }))}>{t.label}</button>
                ))}
              </div>
              <div className="sep" />
              <button role="menuitem" className="menuitem danger" onClick={() => supabase?.auth.signOut({ scope: 'local' })}><span>Sign out</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
