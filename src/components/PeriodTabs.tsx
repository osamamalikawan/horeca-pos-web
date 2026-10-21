'use client';
import type { Period } from '@/lib/period';

const OPTS: { v: Period; label: string }[] = [
  { v: 'today', label: 'Today' }, { v: '7d', label: '7 days' },
  { v: 'month', label: 'This month' }, { v: 'all', label: 'All time' },
];

export default function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="seg period" role="group" aria-label="Period">
      {OPTS.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}
