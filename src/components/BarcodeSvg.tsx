'use client';
import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function BarcodeSvg({ value, height = 54, barWidth = 2, fontSize = 14 }: {
  value: string; height?: number; barWidth?: number; fontSize?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    const ean = /^\d{13}$/.test(value);
    const opts = { displayValue: true, height, width: barWidth, margin: 0, fontSize, background: '#ffffff', lineColor: '#000000' };
    try {
      JsBarcode(ref.current, value, { ...opts, format: ean ? 'EAN13' : 'CODE128' });
    } catch {
      try { JsBarcode(ref.current, value, { ...opts, format: 'CODE128' }); } catch {}
    }
  }, [value, height, barWidth, fontSize]);
  return <svg ref={ref} />;
}
