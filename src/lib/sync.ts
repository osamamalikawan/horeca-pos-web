import { db, TABLES, type TableName } from './db';
import { supabase } from './supabase';

const PAGE = 1000;

// products.stock_qty is owned by the server (maintained by a trigger from stock_movements).
function payload(table: TableName, row: Record<string, any>) {
  if (table === 'products') {
    const { stock_qty, ...rest } = row;
    return rest;
  }
  return row;
}

/** Push queued local changes, then pull everything changed on the server. */
export async function syncNow() {
  if (!supabase) throw new Error('Supabase is not configured');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline');

  // ---- push (outbox keeps insertion order, so parents land before children)
  let pushed = 0;
  for (;;) {
    const batch = await db.outbox.orderBy('seq').limit(200).toArray();
    if (!batch.length) break;
    let i = 0;
    while (i < batch.length) {
      const table = batch[i].table;
      const group = [batch[i]];
      let j = i + 1;
      while (j < batch.length && batch[j].table === table) group.push(batch[j++]);
      const rows = new Map<string, Record<string, any>>();
      group.forEach((g) => rows.set(g.row.id, payload(table, g.row)));
      const { error } = await supabase.from(table).upsert([...rows.values()], { onConflict: 'id' });
      if (error) throw new Error(`${table}: ${error.message}`);
      await db.outbox.bulkDelete(group.map((g) => g.seq!));
      pushed += group.length;
      i = j;
    }
  }

  // ---- pull (only after the outbox is empty, so server stock never clobbers unsent changes)
  let pulled = 0;
  for (const table of TABLES) {
    const since: string = (await db.meta.get('since:' + table))?.value ?? '1970-01-01T00:00:00Z';
    let latest = since;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table).select('*').gte('updated_at', since)
        .order('updated_at').order('id').range(from, from + PAGE - 1);
      if (error) {
        // table not created on the server yet (migration not run): skip it instead of blocking the whole sync
        if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message)) break;
        throw new Error(`${table}: ${error.message}`);
      }
      if (!data || !data.length) break;
      await db.table(table).bulkPut(data);
      pulled += data.length;
      latest = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    await db.meta.put({ key: 'since:' + table, value: latest });
  }

  const now = new Date().toISOString();
  await db.meta.put({ key: 'lastSync', value: now });
  return { pushed, pulled, at: now };
}
