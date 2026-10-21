/** Print the page with an extra @page rule (paper size), removed again afterwards. */
export function printPage(pageCss: string) {
  const s = document.createElement('style');
  s.textContent = pageCss;
  document.head.appendChild(s);
  const done = () => { s.remove(); window.removeEventListener('afterprint', done); };
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
