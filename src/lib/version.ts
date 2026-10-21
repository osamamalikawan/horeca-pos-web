export const WEB_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'local';

/** Version of the Tauri desktop shell, or null when running in a normal browser. */
export async function getShellVersion(): Promise<string | null> {
  const w = window as any;
  if (!w.__TAURI_INTERNALS__) return null;
  try { return await w.__TAURI_INTERNALS__.invoke('plugin:app|version'); } catch { return null; }
}

export type UpdateResult = { state: 'latest' } | { state: 'available'; latest: string } | { state: 'error' } | { state: 'desktop' };

export async function checkForUpdate(): Promise<UpdateResult> {
  if (await getShellVersion()) return { state: 'desktop' };
  try {
    const r = await fetch('/version.json?' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    return j.sha === BUILD_SHA ? { state: 'latest' } : { state: 'available', latest: `v${j.version} (${j.sha})` };
  } catch { return { state: 'error' }; }
}
