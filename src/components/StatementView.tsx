import { money } from '@/lib/util';
import type { Statement } from '@/lib/statements';

export default function StatementView({ s, from, to, store }: { s: Statement; from?: string; to?: string; store?: string }) {
  const period = from || to ? `${from || 'start'} to ${to || 'today'}` : 'All dates';
  return (
    <div className="stmt" style={{ display: 'grid', gap: 10 }}>
      <div>
        {store && <div style={{ fontWeight: 700 }}>{store}</div>}
        <h1>Statement of account</h1>
        <div>{s.name}{s.phone ? `, ${s.phone}` : ''}</div>
        <div>{period}</div>
      </div>
      <table>
        <thead>
          <tr><th>Date</th><th>Details</th><th className="right">{s.plusLabel}</th><th className="right">{s.minusLabel}</th><th className="right">Balance</th></tr>
        </thead>
        <tbody>
          <tr><td /><td><b>Opening balance</b></td><td /><td /><td className="right num"><b>{money(s.opening)}</b></td></tr>
          {s.rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{new Date(r.at).toLocaleDateString()}</td>
              <td>{r.label}{r.ref ? ` ${r.ref}` : ''}{r.note ? `, ${r.note}` : ''}</td>
              <td className="right num">{r.plus ? money(r.plus) : ''}</td>
              <td className="right num">{r.minus ? money(r.minus) : ''}</td>
              <td className="right num">{money(r.balance)}</td>
            </tr>
          ))}
          <tr>
            <td /><td><b>Totals</b></td>
            <td className="right num"><b>{money(s.totalPlus)}</b></td><td className="right num"><b>{money(s.totalMinus)}</b></td><td />
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 15 }}><b>{s.balanceLabel}: {money(s.closing)}</b></div>
    </div>
  );
}
