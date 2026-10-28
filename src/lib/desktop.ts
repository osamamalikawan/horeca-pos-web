/** True only inside the Windows desktop app (Tauri). */
export const inDesktopApp = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

/** Call a command written in the desktop app's Rust code. */
export async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as any;
  if (!w.__TAURI_INTERNALS__) throw new Error('Not running in the desktop app');
  return w.__TAURI_INTERNALS__.invoke(command, args ?? {}) as Promise<T>;
}

export interface PrinterInfo { name: string; isDefault: boolean }
/** Printers installed on this Windows computer (desktop app only). */
export const listPrinters = () => invokeDesktop<PrinterInfo[]>('list_printers');
