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

/** Fills anything missing with defaults, so settings from an older or newer version still load. */
export function normalizeSettings(p: any): Settings {
  const o = p && typeof p === 'object' ? p : {};
  return {
    theme: ['light', 'dark', 'system'].includes(o.theme) ? o.theme : DEFAULTS.theme,
    store: { ...DEFAULTS.store, ...o.store },
    receipt: { ...DEFAULTS.receipt, ...o.receipt },
    label: { ...DEFAULTS.label, ...o.label },
    scanner: { ...DEFAULTS.scanner, ...o.scanner },
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULTS;
  }
}

export function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}
