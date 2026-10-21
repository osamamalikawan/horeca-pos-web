import BarcodeSvg from './BarcodeSvg';
import { money } from '@/lib/util';
import type { Settings } from '@/lib/settings';

export default function LabelView({ name, price, barcode, s }: {
  name: string; price: number | null; barcode: string; s: Settings['label'];
}) {
  const px = (mm: number) => mm * 3.78;
  const ean = /^\d{13}$/.test(barcode);
  const modules = ean ? 100 : barcode.length * 11 + 35;
  const barWidth = Math.min(2.5, Math.max(1, Math.floor(((px(s.widthMm) - 14) / modules) * 10) / 10));
  const textMm = (s.showName ? 4.5 : 0) + (s.showPrice ? 4.5 : 0);
  const barHeight = Math.max(20, Math.round(px(s.heightMm - 7 - textMm) - 14));
  return (
    <div className="label" style={{ width: `${s.widthMm}mm`, height: `${s.heightMm}mm` }}>
      {s.showName && <div className="label-name">{name || ' '}</div>}
      <BarcodeSvg value={barcode} height={barHeight} barWidth={barWidth} fontSize={11} />
      {s.showPrice && price !== null && <div className="label-price">{money(price)}</div>}
    </div>
  );
}
