'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SyncPopover from './SyncPopover';
import { useSettings } from './SettingsProvider';
import { useProfile } from './ProfileProvider';
import { supabase } from '@/lib/supabase';
import { resolveTheme } from '@/lib/settings';
import { permForPath } from '@/lib/permissions';

const NAV = [
  { href: '/', label: 'POS' },
  { href: '/sales/', label: 'Sales' },
  { href: '/returns/', label: 'Returns' },
  { href: '/products/', label: 'Products' },
  { href: '/purchases/', label: 'Purchases' },
  { href: '/suppliers/', label: 'Suppliers' },
  { href: '/customers/', label: 'Customers' },
  { href: '/employees/', label: 'Employees' },
  { href: '/expenses/', label: 'Expenses' },
  { href: '/payments/', label: 'Payments' },
  { href: '/accounts/', label: 'Accounts' },
  { href: '/ledgers/', label: 'Ledgers' },
  { href: '/settings/', label: 'Settings' },
  { href: '/users/', label: 'Users' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { settings, update } = useSettings();
  const { profile, can, isAdmin } = useProfile();
  const dark = typeof window !== 'undefined' && resolveTheme(settings.theme) === 'dark';

  const allowedHref = (href: string) => { const need = permForPath(href); return !need || can(need); };
  const items = NAV.filter((n) => allowedHref(n.href));
  const need = permForPath(path);
  const allowed = !need || can(need);

  return (
    <>
      <header className="top">
        <span className="brand">Horeca POS</span>
        <nav className="nav">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href || path === n.href.replace(/\/$/, '') ? 'on' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hright">
          <SyncPopover />
          <button className="btn small quiet" onClick={() => update((s) => ({ ...s, theme: dark ? 'light' : 'dark' }))}>
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="btn small quiet" title={profile?.email ?? undefined} onClick={() => supabase?.auth.signOut({ scope: 'local' })}>
            Sign out{profile?.name ? `, ${profile.name}` : ''}
          </button>
        </div>
      </header>
      <main className="page">
        {allowed ? children : (
          <div className="empty" style={{ maxWidth: 460, margin: '40px auto' }}>
            <h2 style={{ marginBottom: 8 }}>{need === 'admin' && !isAdmin ? 'Administrators only' : 'You do not have access to this page'}</h2>
            {items[0] ? <Link className="btn" href={items[0].href} style={{ display: 'inline-flex', alignItems: 'center' }}>Go to {items[0].label}</Link>
              : <p>Ask the administrator to give you access.</p>}
          </div>
        )}
      </main>
    </>
  );
}
