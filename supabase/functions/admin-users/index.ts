// Supabase Edge Function: lets an administrator of the POS manage users.
// The service-role key stays here on the server and is never sent to the app.
// Deploy:  supabase functions deploy admin-users
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const cleanPerms = (p: unknown): string[] =>
  Array.isArray(p) ? [...new Set(p.filter((x): x is string => typeof x === 'string' && /^[a-z]+\.[a-z]+$/.test(x)))] : [];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // who is calling?
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle();
    if (!me || !me.active || me.role !== 'admin') return json({ error: 'Only an administrator can manage users' }, 403);

    const body = await req.json();
    const action = String(body.action ?? '');

    // never leave the business without an active administrator
    const otherActiveAdmins = async (excludeId: string) => {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
        .eq('role', 'admin').eq('active', true).neq('id', excludeId);
      return count ?? 0;
    };

    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const name = String(body.name ?? '').trim();
      const role = body.role === 'admin' ? 'admin' : 'staff';
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400);
      if (password.length < 8) return json({ error: 'The password must be at least 8 characters' }, 400);
      if (!name) return json({ error: 'Enter the name' }, 400);
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !created.user) return json({ error: error?.message ?? 'Could not create the login' }, 400);
      const { error: perr } = await admin.from('profiles').insert({
        id: created.user.id, email, name, role, active: body.active !== false,
        permissions: role === 'admin' ? [] : cleanPerms(body.permissions),
      });
      if (perr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: perr.message }, 400); }
      return json({ ok: true, id: created.user.id });
    }

    const id = String(body.id ?? '');
    if (!id) return json({ error: 'Missing user' }, 400);

    if (action === 'update') {
      const { data: target } = await admin.from('profiles').select('role, active').eq('id', id).maybeSingle();
      if (!target) return json({ error: 'User not found' }, 404);
      const role = body.role === 'admin' ? 'admin' : 'staff';
      const active = body.active !== false;
      const losesAdmin = target.role === 'admin' && target.active && (role !== 'admin' || !active);
      if (id === user.id && (role !== 'admin' || !active)) return json({ error: 'You cannot remove your own administrator access' }, 400);
      if (losesAdmin && (await otherActiveAdmins(id)) === 0) return json({ error: 'There must be at least one active administrator' }, 400);
      const patch: Record<string, unknown> = { role, active, permissions: role === 'admin' ? [] : cleanPerms(body.permissions) };
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) return json({ error: error.message }, 400);
      // a disabled user cannot sign in at all
      await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      return json({ ok: true });
    }

    if (action === 'set_password') {
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'The password must be at least 8 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (id === user.id) return json({ error: 'You cannot delete yourself' }, 400);
      const { data: target } = await admin.from('profiles').select('role, active').eq('id', id).maybeSingle();
      if (target?.role === 'admin' && target.active && (await otherActiveAdmins(id)) === 0) {
        return json({ error: 'There must be at least one active administrator' }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
