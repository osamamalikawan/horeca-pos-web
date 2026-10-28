import { loadSettings } from './settings';
import { inDesktopApp, invokeDesktop } from './desktop';

export type PrintKind = 'receipt' | 'label' | 'document';

/** Height of what will be printed, in mm. The print area is hidden on screen, so show it off-screen to measure it. */
function printAreaHeightMm(): number {
  const el = document.querySelector<HTMLElement>('.print-area');
  if (!el) return 200;
  const before = el.getAttribute('style');
  el.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;visibility:hidden';
  const px = el.getBoundingClientRect().height;
  if (before === null) el.removeAttribute('style'); else el.setAttribute('style', before);
  return Math.min(2000, Math.max(30, Math.ceil((px * 25.4) / 96) + 6));
}

/**
 * Print what is in the print area.
 * Desktop app: straight to the printer chosen in Settings, with no dialog (receipts and statements use the
 * receipt printer setting only for receipts; labels use the sticker printer; statements the Windows default).
 * Browser: opens the normal print dialog. If direct printing fails, the dialog is used so nothing is lost.
 */
export async function printPage(pageCss: string, kind: PrintKind = 'receipt'): Promise<void> {
  if (inDesktopApp()) {
    const s = loadSettings();
    const job = kind === 'label' ? { w: s.label.widthMm, h: s.label.heightMm, printer: s.label.printerName }
      : kind === 'document' ? { w: 210, h: 297, printer: '' }
      : { w: s.receipt.paperMm, h: printAreaHeightMm(), printer: s.receipt.printerName };
    try {
      await invokeDesktop('print_document', { paperWidthMm: job.w, paperHeightMm: job.h, printerName: job.printer || null, copies: 1 });
      return;
    } catch (e) {
      console.warn('Direct printing failed, opening the print dialog instead:', e);
    }
  }
  const style = document.createElement('style');
  style.textContent = pageCss;
  document.head.appendChild(style);
  const done = () => { style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
export const RECEIPT_PAGE = '@page{margin:0}';
export const labelPage = (w: number, h: number) => `@page{size:${w}mm ${h}mm;margin:0}`;

let ctx: AudioContext | null = null;
export function beep(ok = true) {
  try {
    ctx = ctx ?? new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = ok ? 1500 : 300;
    g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.07 : 0.2));
  } catch {}
}
