'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Header from './Header';
import { useProfile } from './ProfileProvider';
import { permForPath } from '@/lib/permissions';
import { ACCOUNT_ITEMS, NAV_GROUPS } from '@/lib/nav';
import SettingsSync from './SettingsSync';
import GlobalShortcuts from './GlobalShortcuts';

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { can, isAdmin } = useProfile();

  const allowedHref = (href: string) => { const need = permForPath(href); return !need || can(need); };
  const items = [...NAV_GROUPS.flatMap((g) => g.items), ...ACCOUNT_ITEMS].filter((n) => allowedHref(n.href));
  const need = permForPath(path);
  const allowed = !need || can(need);

  return (
    <>
      <SettingsSync />
      <GlobalShortcuts />
      <Header />
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
