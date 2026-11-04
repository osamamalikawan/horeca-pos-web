'use client';
import { useMemo, useState } from 'react';
import { fieldLevel } from '@/lib/permissions';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveStock, putRow } from '@/lib/db';
import { genEan13, money, qtyFmt, uid } from '@/lib/util';
import type { Product } from '@/lib/types';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import LabelView from '@/components/LabelView';
import PrintPortal from '@/components/PrintPortal';
import { useSettings } from '@/components/SettingsProvider';
import { labelPage, printPage } from '@/lib/print';

interface Form {
  id: string | null; name: string; barcode: string; category: string;
  cost: string; price: string; stock: string; alert: string; supplier: string; code: string;
}
const blank: Form = { id: null, name: '', barcode: '', category: '', cost: '', price: '', stock: '', alert: '', supplier: '', code: '' };

export default function ProductsPage() {
  const { settings } = useSettings();
  const { can } = useProfile();
  const canEdit = can('products.edit');
  const costLevel = fieldLevel(can, 'cost'), stockLevel = fieldLevel(can, 'stock');
  const seeCost = costLevel !== 'hide', seeStock = stockLevel !== 'hide';
  const [copies, setCopies] = useState('');
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted_at).toArray(), []);
  const suppliers = useLiveQuery(() => db.parties.filter((p) => p.type === 'supplier' && !p.deleted_at).toArray(), []) ?? [];
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = (products ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? '').includes(s) || (p.category ?? '').toLowerCase().includes(s)
      || (p.short_code ?? '').toLowerCase().includes(s) || (p.supplier_id ? (supName.get(p.supplier_id) ?? '').toLowerCase().includes(s) : false)) : all;
  }, [products, q, supName]);

  function openEdit(p: Product) {
    setError('');
    setForm({
      id: p.id, name: p.name, barcode: p.barcode ?? '', category: p.category ?? '',
      cost: String(p.cost_price), price: String(p.sale_price), stock: String(p.stock_qty), alert: String(p.low_stock_alert ?? 0),
      supplier: p.supplier_id ?? '', code: p.short_code ?? '',
    });
  }
  function openNew(barcode = '') { setError(''); setForm({ ...blank, barcode }); }

  // A scanner types the code and presses Enter: open the product, or start a new one with that barcode.
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const s = q.trim();
    if (!s) return;
    const hit = (products ?? []).find((p) => p.barcode === s || (!!p.short_code && p.short_code.toLowerCase() === s.toLowerCase()));
    if (hit) { openEdit(hit); setQ(''); setMsg(''); }
    else if (canEdit && /^\d{6,}$/.test(s)) { openNew(s); setQ(''); setMsg(''); }
    else if (list.length === 1) openEdit(list[0]);
    else setMsg(`No product matches “${s}”`);
  }

  async function newBarcode() {
    for (let i = 0; i < 20; i++) {
      const c = genEan13();
      if (!(products ?? []).some((p) => p.barcode === c)) { setForm((f) => f && { ...f, barcode: c }); return; }
    }
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const price = Number(form.price), cost = Number(form.cost || 0), stock = Number(form.stock || 0), alert = Number(form.alert || 0);
    const barcode = form.barcode.trim() || null;
    const code = form.code.trim() || null;
    const supplier_id = form.supplier || null;
    if (!name) return setError('Enter a product name.');
    if (!isFinite(price) || price < 0 || form.price === '') return setError('Enter a sale price.');
    if (!isFinite(cost) || !isFinite(stock) || !isFinite(alert)) return setError('Cost, stock and alert level must be numbers.');
    if (Math.max(Math.abs(price), Math.abs(cost), Math.abs(stock), Math.abs(alert)) >= 1e7) return setError('One of the numbers is far too large. Did a barcode get scanned into the wrong box?');
    if (barcode) {
      const clash = (products ?? []).find((p) => p.barcode === barcode && p.id !== form.id);
      if (clash) return setError(`Barcode already used by “${clash.name}”.`);
    }
    if (code) {
      if (!/^\S{1,20}$/.test(code)) return setError('The short code can be up to 20 characters, with no spaces.');
      const low = code.toLowerCase();
      const clash = (products ?? []).find((p) => p.id !== form.id && ((p.short_code ?? '').toLowerCase() === low || p.barcode === code));
      if (clash) return setError(`Short code already used by “${clash.name}”.`);
      if ((products ?? []).some((p) => p.id !== form.id && p.barcode === code)) return setError('That code is another product’s barcode.');
    }
    // values the user may not change are kept as they were (a hidden or view-only value is never overwritten)
    const newCost = costLevel === 'edit' ? cost : 0, newStock = stockLevel === 'edit' ? stock : 0;
    const now = new Date().toISOString();
    if (!form.id) {
      const id = uid();
      await putRow('products', {
        id, barcode, name, category: form.category.trim() || null, cost_price: newCost, sale_price: price,
        stock_qty: 0, low_stock_alert: alert, supplier_id, short_code: code, created_at: now, deleted_at: null,
      });
      if (newStock !== 0) await moveStock(id, newStock, 'opening');
    } else {
      const cur = await db.products.get(form.id);
      if (!cur) return;
      await putRow('products', {
        ...cur, barcode, name, category: form.category.trim() || null,
        cost_price: costLevel === 'edit' ? cost : cur.cost_price, sale_price: price, low_stock_alert: alert, supplier_id, short_code: code,
      });
      const diff = stockLevel === 'edit' ? stock - Number(cur.stock_qty) : 0;
      if (diff !== 0) await moveStock(cur.id, diff, 'adjustment');
    }
    setForm(null);
  }

  async function remove() {
    if (!form?.id) return;
    const cur = await db.products.get(form.id);
    if (!cur) return;
    await putRow('products', { ...cur, deleted_at: new Date().toISOString() });
    setForm(null);
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => f && { ...f, [k]: e.target.value });

  return (
    <>
      <div className="head">
        <div>
          <h1>Products</h1>
          <div className="mute">{products ? `${products.length} products` : ' '}</div>
        </div>
        <div className="tools">
          <input style={{ width: 300 }} value={q} autoFocus placeholder="Scan a barcode, short code or search"
            onChange={(e) => { setQ(e.target.value); setMsg(''); }} onKeyDown={onSearchKey} />
          {canEdit && <button className="btn primary" onClick={() => openNew()}>Add product</button>}
        </div>
      </div>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}

      {products && products.length === 0 ? (
        <div className="empty">No products yet. Scan a barcode or choose Add product to create the first one.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Code</th><th>Barcode</th><th>Category</th><th>Supplier</th>{seeCost && <th className="right">Cost</th>}<th className="right">Sale price</th>{seeStock && <th className="right">Stock</th>}</tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const low = p.stock_qty <= 0 || (p.low_stock_alert > 0 && p.stock_qty <= p.low_stock_alert);
              return (
                <tr key={p.id} onClick={() => openEdit(p)}>
                  <td>{p.name}</td>
                  <td className="num">{p.short_code ?? ''}</td>
                  <td className="num mute">{p.barcode ?? ''}</td>
                  <td className="mute">{p.category ?? ''}</td>
                  <td className="mute">{p.supplier_id ? supName.get(p.supplier_id) ?? '' : ''}</td>
                  {seeCost && <td className="right num">{money(p.cost_price)}</td>}
                  <td className="right num">{money(p.sale_price)}</td>
                  {seeStock && <td className={'right num ' + (low ? 'warn' : '')}>{qtyFmt(p.stock_qty)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer
        open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit product' : 'New product'}
        footer={form && (
          <>
            {form.id && canEdit ? <button className="btn danger" onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setForm(null)}>Cancel</button>
              {canEdit && <button className="btn primary" onClick={save}>Save product</button>}
            </span>
          </>
        )}
      >
        {form && (
          <>
            <label>Name<input value={form.name} onChange={set('name')} autoFocus /></label>
            <label>Barcode
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={form.barcode} onChange={set('barcode')} placeholder="Scan or type" />
                <button className="btn" type="button" onClick={newBarcode}>Generate</button>
              </div>
            </label>
            {form.barcode.trim() && (
              <div className="bc">
                <LabelView name={form.name} price={form.price ? Number(form.price) : null} barcode={form.barcode.trim()}
                  s={{ ...settings.label, copies: 1 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ width: 70, height: 30 }} inputMode="numeric" aria-label="Number of labels" placeholder={String(settings.label.copies)}
                    value={copies} onChange={(e) => setCopies(e.target.value)} />
                  <button className="btn small" type="button" onClick={() => printPage(labelPage(settings.label.widthMm, settings.label.heightMm), 'label')}>
                    Print labels
                  </button>
                </div>
                <PrintPortal>
                  {Array.from({ length: Math.min(Math.max(Math.floor(Number(copies)) || settings.label.copies, 1), 200) }, (_, i) => (
                    <LabelView key={i} name={form.name} price={form.price ? Number(form.price) : null} barcode={form.barcode.trim()} s={settings.label} />
                  ))}
                </PrintPortal>
              </div>
            )}
            <div className="two">
              <label>Short code<input value={form.code} onChange={set('code')} placeholder="Quick code to type at the POS" maxLength={20} /></label>
              <label>Category<input value={form.category} onChange={set('category')} /></label>
            </div>
            <label>Supplier
              <select value={form.supplier} onChange={(e) => setForm((f) => f && { ...f, supplier: e.target.value })}>
                <option value="">None</option>
                {suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="two">
              {seeCost && <label>Cost price<input inputMode="decimal" value={form.cost} onChange={set('cost')} disabled={costLevel !== 'edit'} /></label>}
              <label>Sale price<input inputMode="decimal" value={form.price} onChange={set('price')} /></label>
            </div>
            <div className="two">
              {seeStock && <label>{form.id ? 'Stock on hand' : 'Opening stock'}<input inputMode="decimal" value={form.stock} onChange={set('stock')} disabled={stockLevel !== 'edit'} /></label>}
              <label>Low stock alert<input inputMode="decimal" value={form.alert} onChange={set('alert')} /></label>
            </div>
            {form.id && stockLevel === 'edit' && <div className="mute">Changing stock records an adjustment in the stock history.</div>}
            {error && <div className="err">{error}</div>}
          </>
        )}
      </Drawer>
    </>
  );
}
