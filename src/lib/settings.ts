export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  theme: Theme;
  store: { name: string; address: string; phone: string; footer: string };
  receipt: { paperMm: number; printerName: string; autoPrint: boolean };
  label: {
    widthMm: number; heightMm: number; printerName: string;
    showName: boolean; showPrice: boolean; copies: number;
  };
  scanner: { terminator: 'enter' | 'tab' | 'none'; minLength: number; beep: boolean; focusAnywhere: boolean };
}

export const DEFAULTS: Settings = {
  theme: 'light',
  store: { name: 'Horeca Store', address: '', phone: '', footer: 'Thank you for your purchase' },
  receipt: { paperMm: 80, printerName: '', autoPrint: false },
  label: { widthMm: 50, heightMm: 30, printerName: '', showName: true, showPrice: true, copies: 1 },
  scanner: { terminator: 'enter', minLength: 4, beep: true, focusAnywhere: true },
};

export const SETTINGS_KEY = 'horeca-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      theme: p.theme ?? DEFAULTS.theme,
      store: { ...DEFAULTS.store, ...p.store },
      receipt: { ...DEFAULTS.receipt, ...p.receipt },
      label: { ...DEFAULTS.label, ...p.label },
      scanner: { ...DEFAULTS.scanner, ...p.scanner },
    };
  } catch {
    return DEFAULTS;
  }
}

export function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}
