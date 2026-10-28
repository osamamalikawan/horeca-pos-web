'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULTS, loadSettings, resolveTheme, SETTINGS_KEY, type Settings } from '@/lib/settings';
import { markDirty } from '@/lib/settingsSync';

interface Ctx {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;   // a change made by the user: will be saved online
  replaceAll: (s: Settings) => void;                 // settings that came from the online copy: not saved back
}
const SettingsCtx = createContext<Ctx>({ settings: DEFAULTS, update: () => {}, replaceAll: () => {} });
export const useSettings = () => useContext(SettingsCtx);

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setSettings(loadSettings()); setLoaded(true); }, []);

  useEffect(() => {
    if (!loaded) return;
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(settings.theme); };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, loaded]);

  const update = useCallback((fn: (s: Settings) => Settings) => {
    setSettings((prev) => {
      const next = fn(prev);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      markDirty();
      return next;
    });
  }, []);

  const replaceAll = useCallback((next: Settings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  return <SettingsCtx.Provider value={{ settings, update, replaceAll }}>{children}</SettingsCtx.Provider>;
}
