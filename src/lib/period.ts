export type Period = 'today' | '7d' | 'month' | 'all';

export function periodStartMs(p: Period): number {
  if (p === 'all') return 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === '7d') d.setDate(d.getDate() - 6);
  if (p === 'month') d.setDate(1);
  return d.getTime();
}
export const inPeriod = (iso: string, p: Period) => new Date(iso).getTime() >= periodStartMs(p);
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
