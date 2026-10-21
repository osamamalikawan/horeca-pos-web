'use client';
import AuthGate from './AuthGate';
import SettingsProvider from './SettingsProvider';
import ProfileProvider from './ProfileProvider';
import SyncProvider from './SyncProvider';
import Shell from './Shell';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <AuthGate>
        <ProfileProvider>
          <SyncProvider>
            <Shell>{children}</Shell>
          </SyncProvider>
        </ProfileProvider>
      </AuthGate>
    </SettingsProvider>
  );
}
