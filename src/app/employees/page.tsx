'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money, round2, uid } from '@/lib/util';
import { shortDate } from '@/lib/period';
import { employeeBalances } from '@/lib/ledger';
import { loadStatement } from '@/lib/statements';
import { addEmployeeEntry, removeEmployeeEntry } from '@/lib/employees';
import type { Employee, EmployeeEntryKind } from '@/lib/types';
import Drawer from '@/components/Drawer';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';
import MigrationNotice from '@/components/MigrationNotice';
import { useProfile } from '@/components/ProfileProvider';

interface Form { id: string | null; name: string; phone: string; designation: string; address: string; salary: string; joined: string; opening: string; active: boolean }
const blank: Form = { id: null, name: '', phone: '', designation: '', address: '', salary: '', joined: '', opening: '', active: true };
const KINDS: { kind: EmployeeEntryKind; label: string; hint: string }[] = [
  { kind: 'salary', label: 'Salary due', hint: 'Adds to what you owe. No money moves yet.' },
  { kind: 'bonus', label: 'Bonus', hint: 'Adds to what you owe. No money moves yet.' },
  { kind: 'deduction', label: 'Deduction', hint: 'Lowers what you owe (absence, fine). No money moves.' },
  { kind: 'advance', label: 'Advance', hint: 'Money paid now. Lowers what you owe.' },
  { kind: 'payment', label: 'Pay salary', hint: 'Money paid now. Lowers what you owe.' },
];
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function EmployeesPage() {
  const { can, legacy } = useProfile();
  const canEdit = can('employees.edit') && !legacy;
  const employees = useLiveQuery(() => db.employees.filter((e) => !e.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const owed = useLiveQuery(() => employeeBalances(), []);

  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<{ kind: EmployeeEntryKind; amount: string; month: string; accountId: string; note: string } | null>(null);
  const stmt = useLiveQuery(() => (form?.id ? loadStatement('employee', form.id) : undefined), [form?.id]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (employees ?? []).filter((e) => !s || e.name.toLowerCase().includes(s) || (e.phone ?? '').includes(s) || (e.designation ?? '').toLowerCase().includes(s))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [employees, q]);
  const totalOwed = round2(list.reduce((s, e) => s + Math.max(owed?.[e.id] ?? 0, 0), 0));

  function openNew() { setError(''); setEntry(null); setForm({ ...blank }); }
  function openEdit(e: Employee) {
    setError(''); setEntry(null);
    setForm({ id: e.id, name: e.name, phone: e.phone ?? '', designation: e.designation ?? '', address: e.address ?? '',
      salary: e.monthly_salary ? String(e.monthly_salary) : '', joined: e.joined_on ?? '', opening: e.opening_balance ? String(e.opening_balance) : '', active: e.active });
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const salary = Number(form.salary || 0), opening = Number(form.opening || 0);
    if (!name) return setError('Enter the employee name.');
    if (!isFinite(salary) || salary < 0) return setError('Monthly salary must be a number.');
    if (!isFinite(opening)) return setError('Opening balance must be a number.');
    if (salary >= 1e9 || Math.abs(opening) >= 1e9) return setError('That number is too large.');
    const cur = form.id ? await db.employees.get(form.id) : undefined;
    const id = cur?.id ?? uid();
    await putRow('employees', {
      ...(cur ?? { id, created_at: new Date().toISOString(), deleted_at: null }),
      name, phone: form.phone.trim() || null, designation: form.designation.trim() || null, address: form.address.trim() || null,
      monthly_salary: salary, joined_on: form.joined || null, opening_balance: opening, active: form.active,
    });
    if (!form.id) setForm({ ...form, id }); else setForm(null);
  }

  async function remove() {
    if (!form?.id || !window.confirm('Delete this employee? Their ledger entries stay in the records.')) return;
    const cur = await db.employees.get(form.id);
    if (cur) await putRow('employees', { ...cur, deleted_at: new Date().toISOString() });
    setForm(null);
  }

  function openEntry(kind: EmployeeEntryKind) {
    setError('');
    setEntry({ kind, amount: kind === 'salary' && form?.salary ? form.salary : '', month: thisMonth(), accountId: '', note: '' });
  }
  async function saveEntry() {
    if (!form?.id || !entry) return;
    const amount = Number(entry.amount);
    if (!isFinite(amount) || amount <= 0) return setError('Enter an amount above zero.');
    if (amount >= 1e9) return setError('That number is too large.');
    if (entry.kind === 'salary') {
      const dup = await db.employee_entries.filter((e) => e.employee_id === form.id && e.kind === 'salary' && e.month === entry.month && !e.deleted_at).count();
      if (dup) return setError(`Salary for ${entry.month} is already recorded. Delete it below first if it was a mistake.`);
    }
    try {
      await addEmployeeEntry({ employeeId: form.id, kind: entry.kind, amount, month: entry.month, accountId: entry.accountId || defaultAccountId(accounts), note: entry.note });
      setEntry(null); setError('');
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }
  async function deleteEntry(id: string, label: string) {
    if (window.confirm(`Delete this ${label.toLowerCase()} entry? Any money paid for it goes back to the account.`)) await removeEmployeeEntry(id);
  }

  const balance = form?.id ? owed?.[form.id] ?? 0 : 0;
  const moves = entry && (entry.kind === 'advance' || entry.kind === 'payment');

  return (
    <>
      {legacy && <MigrationNotice />}
      <div className="head">
        <div>
          <h1>Employees</h1>
          <div className="mute num">{list.length} {list.length === 1 ? 'employee' : 'employees'}, you owe {money(totalOwed)}</div>
        </div>
        <div className="tools">
          <input style={{ width: 240 }} placeholder="Search name, role or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && <button className="btn primary" onClick={openNew}>Add employee</button>}
        </div>
      </div>

      {employees && employees.length === 0 ? (
        <div className="empty">No employees yet. Add one, then record salary, advances and payments.</div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th className="right">Monthly salary</th><th>Status</th><th className="right">You owe</th></tr></thead>
          <tbody>
            {list.map((e) => {
              const o = owed?.[e.id] ?? 0;
              return (
                <tr key={e.id} onClick={() => openEdit(e)} style={e.active ? undefined : { color: 'var(--mute)' }}>
                  <td>{e.name}</td><td className="mute">{e.designation ?? ''}</td><td className="num mute">{e.phone ?? ''}</td>
                  <td className="right num">{Number(e.monthly_salary) > 0 ? money(e.monthly_salary) : ''}</td>
                  <td>{e.active ? 'Active' : 'Inactive'}</td>
                  <td className={'right num ' + (o > 0.5 ? 'warn' : '')}>{money(o)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} wide title={form?.id ? 'Employee' : 'New employee'}
        footer={form && (
          <>
            {form.id && canEdit ? <button className="btn danger" onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              {form.id && <Link className="btn" href={`/ledgers/?kind=employee&id=${form.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>Open ledger</Link>}
              <button className="btn quiet" onClick={() => setForm(null)}>Close</button>
              {canEdit && <button className="btn primary" onClick={save}>Save employee</button>}
            </span>
          </>
        )}>
        {form && (
          <>
            <div className="two">
              <label>Name<input value={form.name} autoFocus disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Phone<input inputMode="tel" value={form.phone} disabled={!canEdit} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
            <div className="two">
              <label>Designation<input value={form.designation} disabled={!canEdit} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></label>
              <label>Address<input value={form.address} disabled={!canEdit} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            </div>
            <div className="two">
              <label>Monthly salary<input inputMode="decimal" value={form.salary} disabled={!canEdit} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></label>
              <label>Joined on<input type="date" value={form.joined} disabled={!canEdit} onChange={(e) => setForm({ ...form, joined: e.target.value })} /></label>
            </div>
            <label>Opening balance (you owed them before the POS; negative if they owe you)
              <input inputMode="decimal" value={form.opening} disabled={!canEdit} onChange={(e) => setForm({ ...form, opening: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={form.active} disabled={!canEdit} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Currently employed</label>
            {error && !entry && <div className="err">{error}</div>}

            {form.id && (
              <>
                <div className="summary">
                  <div className="rl2"><b>{balance < 0 ? 'Employee owes you' : 'You owe the employee'}</b><b className={'num ' + (balance > 0.5 ? 'warn' : '')}>{money(Math.abs(balance))}</b></div>
                  {canEdit && !entry && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {KINDS.map((k) => <button key={k.kind} className="btn small" onClick={() => openEntry(k.kind)}>{k.label}</button>)}
                    </div>
                  )}
                  {canEdit && entry && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="seg wrap" role="group" aria-label="Entry type">
                        {KINDS.map((k) => <button key={k.kind} className={entry.kind === k.kind ? 'on' : ''} onClick={() => openEntry(k.kind)}>{k.label}</button>)}
                      </div>
                      <div className="mute" style={{ fontSize: 13 }}>{KINDS.find((k) => k.kind === entry.kind)?.hint}</div>
                      <div className="two">
                        <label>Amount<input inputMode="decimal" value={entry.amount} autoFocus onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></label>
                        {entry.kind === 'salary' && <label>Month<input type="month" value={entry.month} onChange={(e) => setEntry({ ...entry, month: e.target.value })} /></label>}
                      </div>
                      {moves && <label>Paid from<AccountPicker accounts={accounts} value={entry.accountId} onChange={(id) => setEntry({ ...entry, accountId: id })} /></label>}
                      <label>Note<input value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} /></label>
                      {error && <div className="err">{error}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn small primary" onClick={saveEntry}>Save entry</button>
                        <button className="btn small quiet" onClick={() => { setEntry(null); setError(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <h2>History</h2>
                {!stmt || stmt.rows.length === 0 ? <div className="mute">No entries yet.</div> : (
                  <table className="plain">
                    <tbody>
                      {[...stmt.rows].reverse().map((r) => (
                        <tr key={r.id}>
                          <td className="num mute">{shortDate(r.at)}</td>
                          <td>{r.label}{r.ref ? ` ${r.ref}` : ''}{r.note ? `, ${r.note}` : ''}</td>
                          <td className="right num">{r.plus ? money(r.plus) : `-${money(r.minus)}`}</td>
                          <td className="right num mute">{money(r.balance)}</td>
                          <td className="right">{canEdit && <button className="x" aria-label="Delete entry" onClick={() => deleteEntry(r.id, r.label)}>×</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
