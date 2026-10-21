import { db } from './db';

export const uid = () => crypto.randomUUID();
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 });
export const money = (n: number) => 'Rs ' + fmt.format(n || 0);
export const qtyFmt = (n: number) => fmt.format(n || 0);

/** "50" = fixed amount, "10%" = percent of base. Never exceeds base. */
export function parseDiscount(raw: string, base: number) {
  const t = raw.trim();
  if (!t) return 0;
  const v = parseFloat(t);
  if (!isFinite(v) || v < 0) return 0;
  if (t.endsWith('%')) return round2((base * Math.min(v, 100)) / 100);
  return round2(Math.min(v, base));
}

export function deviceCode() {
  let c = localStorage.getItem('deviceCode');
  if (!c) {
    c = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    localStorage.setItem('deviceCode', c);
  }
  return c;
}

/** Per-device numbering (e.g. KQD-00012) so two offline devices never clash. */
export async function nextInvoiceNo() {
  const m = await db.meta.get('invoiceSeq');
  const n = (m?.value ?? 0) + 1;
  await db.meta.put({ key: 'invoiceSeq', value: n });
  return `${deviceCode()}-${String(n).padStart(5, '0')}`;
}

/** In-store EAN-13 (prefix 20 is reserved for internal use). */
export function genEan13() {
  let b = '20';
  for (let i = 0; i < 10; i++) b += Math.floor(Math.random() * 10);
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(b[i]) * (i % 2 ? 3 : 1);
  return b + ((10 - (s % 10)) % 10);
}

/** "just now", "12 min ago", "2 h ago", "3 d ago" */
export function ago(iso: string | null, now: number) {
  if (!iso) return 'never';
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

/** Per-device document numbers, e.g. R-KQD-00003 (return) or P-KQD-00001 (purchase). */
export async function nextNo(key: string, prefix: string) {
  const m = await db.meta.get(key);
  const n = (m?.value ?? 0) + 1;
  await db.meta.put({ key, value: n });
  return `${prefix}${deviceCode()}-${String(n).padStart(5, '0')}`;
}

/** Save text as a CSV file (UTF-8 with BOM so Excel shows Urdu and other scripts correctly). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const text = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
