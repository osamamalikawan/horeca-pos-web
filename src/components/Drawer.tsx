'use client';
import { useEffect } from 'react';

export default function Drawer({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className={'drawer' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}
