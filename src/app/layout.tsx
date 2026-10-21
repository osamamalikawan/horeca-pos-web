import './globals.css';
import type { Metadata } from 'next';
import Providers from '@/components/Providers';

export const metadata: Metadata = { title: 'Horeca POS' };

// Sets the theme before first paint so there is no light/dark flash.
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem('horeca-settings')||'{}');var t=s.theme||'light';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
