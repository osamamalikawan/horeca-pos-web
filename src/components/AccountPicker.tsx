'use client';
import type { Account } from '@/lib/types';

const ORDER = ['cash', 'bank', 'easypaisa', 'jazzcash'];
export const sortAccounts = (a: Account[]) => [...a].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
export const defaultAccountId = (a: Account[] | undefined) => a?.find((x) => x.kind === 'cash')?.id ?? a?.[0]?.id ?? '';

export default function AccountPicker({ accounts, value, onChange }: {
  accounts: Account[] | undefined; value: string; onChange: (id: string) => void;
}) {
  const list = sortAccounts(accounts ?? []);
  const cur = value || defaultAccountId(accounts);
  return (
    <div className="seg" role="group" aria-label="Account">
      {list.map((a) => (
        <button type="button" key={a.id} className={cur === a.id ? 'on' : ''} onClick={() => onChange(a.id)}>{a.name}</button>
      ))}
    </div>
  );
}
