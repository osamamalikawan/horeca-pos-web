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

export interface SyncFailure { table: string; id: string; message: string }
const NETWORK = /failed to fetch|networkerror|network request failed|fetch failed|offline|timed? ?out/i;

/**
 * Upload queued local changes, then download what changed on the server. The two halves are independent:
 *  - a change the server rejects is set aside (it stays queued and is retried next time) and the rest keep uploading,
 *    so one bad row can no longer hold up every sale queued behind it;
 *  - downloading always runs, but never overwrites a row that still has an unsent local change, and never replaces
 *    product stock while stock changes are still waiting to upload.
 * Rejected changes are returned in `failed`. `lastSync` is only recorded when nothing failed.
 */
export async function syncNow(client = supabase) {
  if (!client) throw new Error('Supabase is not configured');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline');

  // ---- upload (outbox keeps insertion order, so parents land before children)
  let pushed = 0;
  const failed: SyncFailure[] = [];
  const stuck = new Set<number>();
  const send = async (table: TableName, rows: Record<string, any>[]) => {
    const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
    if (error && NETWORK.test(error.message)) throw new Error(`${table}: ${error.message}`);   // no connection: stop, nothing is wrong with the data
    return error;
  };
  const dropOlder = async (table: string, entries: { seq?: number; row: Record<string, any> }[]) => {
    // a newer version of a record went up, so an older queued version of it must never be sent afterwards
    const newest = new Map<string, number>();
    entries.forEach((g) => newest.set(g.row.id, Math.max(newest.get(g.row.id) ?? 0, g.seq ?? 0)));
    const old = await db.outbox.filter((o) => o.table === table && newest.has(o.row.id) && (o.seq ?? 0) < newest.get(o.row.id)!).primaryKeys();
    if (old.length) await db.outbox.bulkDelete(old);
  };
  for (;;) {
    const batch = await db.outbox.orderBy('seq').filter((o) => !stuck.has(o.seq!)).limit(200).toArray();
    if (!batch.length) break;
    let i = 0;
    while (i < batch.length) {
      const table = batch[i].table;
      const group = [batch[i]];
      let j = i + 1;
      while (j < batch.length && batch[j].table === table) group.push(batch[j++]);
      const rows = new Map<string, Record<string, any>>();
      group.forEach((g) => rows.set(g.row.id, payload(table, g.row)));
      const error = await send(table, [...rows.values()]);
      if (!error) {
        await db.outbox.bulkDelete(group.map((g) => g.seq!));
        await dropOlder(table, group);
        pushed += group.length;
      } else {
        // find the row(s) the server refuses by sending them one at a time
        for (const g of group) {
          const e1 = await send(table, [payload(table, g.row)]);
          if (!e1) { await db.outbox.delete(g.seq!); await dropOlder(table, [g]); pushed++; }
          else { stuck.add(g.seq!); failed.push({ table, id: g.row.id, message: e1.message }); }
        }
      }
      i = j;
    }
  }

  // ---- download
  const waiting = await db.outbox.toArray();
  const waitingIds = new Map<string, Set<string>>();
  waiting.forEach((o) => { (waitingIds.get(o.table) ?? waitingIds.set(o.table, new Set()).get(o.table)!).add(o.row.id); });
  const stockWaiting = waiting.some((o) => o.table === 'stock_movements');
  let pulled = 0;
  for (const table of TABLES) {
    if (table === 'products' && stockWaiting) continue;     // the server's stock does not include the waiting movements yet
    const since: string = (await db.meta.get('since:' + table))?.value ?? '1970-01-01T00:00:00Z';
    let latest = since;
    const mine = waitingIds.get(table);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from(table).select('*').gte('updated_at', since)
        .order('updated_at').order('id').range(from, from + PAGE - 1);
      if (error) {
        // table not created on the server yet (migration not run): skip it instead of blocking the whole sync
        if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message)) break;
        throw new Error(`${table}: ${error.message}`);
      }
      if (!data || !data.length) break;
      const fresh = mine ? data.filter((r: any) => !mine.has(r.id)) : data;   // keep rows that still have an unsent local change
      if (fresh.length) await db.table(table).bulkPut(fresh);
      pulled += fresh.length;
      latest = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    await db.meta.put({ key: 'since:' + table, value: latest });
  }

  const now = new Date().toISOString();
  if (!failed.length) await db.meta.put({ key: 'lastSync', value: now });
  return { pushed, pulled, at: now, failed };
}
