import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Accepts the new "sb_publishable_..." key or the legacy anon key.
// (Each name must be written out in full so Next.js can inline it at build time.)
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
