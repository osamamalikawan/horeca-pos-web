'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Hidden on screen; when printing, it is the only thing on the page. */
export default function PrintPortal({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  return el ? createPortal(<div className="print-area">{children}</div>, el) : null;
}
