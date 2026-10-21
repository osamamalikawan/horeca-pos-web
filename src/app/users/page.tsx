'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { callAdmin } from '@/lib/adminUsers';
import { MODULES, PRESETS, withViews, type Profile } from '@/lib/permissions';
import Drawer from '@/components/Drawer';
import MigrationNotice from '@/components/MigrationNotice';
import { useProfile } from '@/components/ProfileProvider';

interface Form {
  id: string | null; email: string; name: string; password: string;
  role: 'admin' | 'staff'; active: boolean; permissions: string[];
}
const blank: Form = { id: null, email: '', name: '', password: '', role: 'staff', active: true, permissions: [] };

export default function UsersPage() {
  const { profile, isAdmin, legacy } = useProfile();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    if (!navigator.onLine) { setLoadErr('Users can only be managed while online.'); return; }
    const { data, error } = await supabase.from('profiles').select('id,email,name,role,permissions,active').order('name');
    if (error) setLoadErr(error.message); else { setUsers(data as Profile[]); setLoadErr(''); }
  }, []);
  useEffect(() => { if (isAdmin && !legacy) load(); }, [isAdmin, legacy, load]);

  const self = (id: string | null) => !!id && id === profile?.id;
  function openNew() { setErr(''); setNewPw(''); setForm({ ...blank }); }
  function openEdit(u: Profile) {
    setErr(''); setNewPw('');
    setForm({ id: u.id, email: u.email ?? '', name: u.name, password: '', role: u.role, active: u.active, permissions: u.permissions });
  }

  function toggle(module: string, action: string, on: boolean) {
    if (!form) return;
    const key = `${module}.${action}`;
    let next = on ? [...form.permissions, key] : form.permissions.filter((p) => p !== key);
    if (!on && action === 'view') next = next.filter((p) => !p.startsWith(module + '.'));   // no view, no other actions
    setForm({ ...form, permissions: withViews(next) });
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim(), email = form.email.trim();
    if (!name) return setErr('Enter the user’s name.');
    if (!form.id) {
      if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
      if (form.password.length < 8) return setErr('The password must be at least 8 characters.');
    }
    setBusy(true); setErr('');
    try {
      const perms = form.role === 'admin' ? [] : withViews(form.permissions);
      if (form.id) await callAdmin('update', { id: form.id, name, role: form.role, active: form.active, permissions: perms });
      else await callAdmin('create', { email, password: form.password, name, role: form.role, active: form.active, permissions: perms });
      setForm(null); await load();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function setPassword() {
    if (!form?.id) return;
    if (newPw.length < 8) return setErr('The password must be at least 8 characters.');
    setBusy(true); setErr('');
    try { await callAdmin('set_password', { id: form.id, password: newPw }); setNewPw(''); setErr(''); window.alert('Password changed.'); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!form?.id || !window.confirm('Delete this user? They will no longer be able to sign in. Sales they made stay in the records.')) return;
    setBusy(true); setErr('');
    try { await callAdmin('delete', { id: form.id }); setForm(null); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  if (!isAdmin) return null;
  if (legacy) return <MigrationNotice />;

  const summary = (u: Profile) => u.role === 'admin' ? 'Full access' : `${u.permissions.filter((p) => !p.endsWith('.view')).length} actions, ${u.permissions.filter((p) => p.endsWith('.view')).length} pages`;

  return (
    <>
      <div className="head">
        <div>
          <h1>Users</h1>
          <div className="mute">Who can sign in, and what each person can open and do.</div>
        </div>
        <div className="tools"><button className="btn primary" onClick={openNew}>Add user</button></div>
      </div>
      {loadErr && <div className="err" style={{ marginBottom: 12 }}>{loadErr}</div>}

      {users && (
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} onClick={() => openEdit(u)} style={u.active ? undefined : { color: 'var(--mute)' }}>
                <td>{u.name}{self(u.id) ? ' (you)' : ''}</td><td className="mute">{u.email}</td>
                <td>{u.role === 'admin' ? 'Administrator' : 'Staff'}</td><td className="mute">{summary(u)}</td>
                <td>{u.active ? 'Active' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} wide title={form?.id ? 'Edit user' : 'New user'}
        footer={form && (
          <>
            {form.id && !self(form.id) ? <button className="btn danger" disabled={busy} onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save user'}</button>
            </span>
          </>
        )}>
        {form && (
          <>
            <div className="two">
              <label>Name<input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Email (used to sign in)<input type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            </div>
            {!form.id && <label>Password (at least 8 characters)<input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>}

            <div style={{ display: 'grid', gap: 6 }}>
              <span className="mute" style={{ fontSize: 13 }}>Role</span>
              <div className="seg" style={{ gridTemplateColumns: '1fr 1fr', maxWidth: 360 }} role="group" aria-label="Role">
                <button className={form.role === 'staff' ? 'on' : ''} disabled={self(form.id)} onClick={() => setForm({ ...form, role: 'staff' })}>Staff, custom access</button>
                <button className={form.role === 'admin' ? 'on' : ''} onClick={() => setForm({ ...form, role: 'admin' })}>Administrator</button>
              </div>
              {form.role === 'admin' && <div className="mute" style={{ fontSize: 13 }}>Administrators can open everything, manage users, and cancel sales.</div>}
            </div>
            <label className="check"><input type="checkbox" checked={form.active} disabled={self(form.id)} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Can sign in</label>

            {form.role === 'staff' && (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="mute" style={{ fontSize: 13 }}>Start from</span>
                  {Object.entries(PRESETS).map(([name, perms]) => (
                    <button key={name} className="btn small" onClick={() => setForm({ ...form, permissions: withViews(perms) })}>{name}</button>
                  ))}
                  <button className="btn small quiet" onClick={() => setForm({ ...form, permissions: [] })}>Clear</button>
                </div>
                <table className="plain matrix">
                  <thead><tr><th>Page</th><th>Allowed to</th></tr></thead>
                  <tbody>
                    {MODULES.map((m) => (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                            {m.actions.map((a) => {
                              const on = form.permissions.includes(`${m.key}.${a.key}`);
                              const viewOn = form.permissions.includes(`${m.key}.view`);
                              return (
                                <label key={a.key} className="check" style={{ opacity: a.key !== 'view' && !viewOn ? 0.75 : 1 }}>
                                  <input type="checkbox" checked={on} onChange={(e) => toggle(m.key, a.key, e.target.checked)} />{a.label}
                                </label>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mute" style={{ fontSize: 13 }}>Ticking anything on a page also lets the user open that page.</div>
              </>
            )}

            {form.id && (
              <div className="summary">
                <h2>Set a new password</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="New password, at least 8 characters" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <button className="btn" disabled={busy} onClick={setPassword}>Change</button>
                </div>
              </div>
            )}
            {err && <div className="err">{err}</div>}
          </>
        )}
      </Drawer>
    </>
  );
}
