'use client';
import AuthGate from './AuthGate';
import SettingsProvider from './SettingsProvider';
import ProfileProvider from './ProfileProvider';
import SyncProvider from './SyncProvider';
import UpdateProvider from './UpdateProvider';
import Shell from './Shell';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <AuthGate>
        <ProfileProvider>
          <SyncProvider>
            <UpdateProvider>
              <Shell>{children}</Shell>
            </UpdateProvider>
          </SyncProvider>
        </ProfileProvider>
      </AuthGate>
    </SettingsProvider>
  );
}
