'use client';
import AuthGate from './AuthGate';
import SettingsProvider from './SettingsProvider';
import ProfileProvider from './ProfileProvider';
import SyncProvider from './SyncProvider';
import UpdateProvider from './UpdateProvider';
import Shell from './Shell';
import PosDraftsProvider from './PosDrafts';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <AuthGate>
        <ProfileProvider>
          <SyncProvider>
            <UpdateProvider>
              <PosDraftsProvider><Shell>{children}</Shell></PosDraftsProvider>
            </UpdateProvider>
          </SyncProvider>
        </ProfileProvider>
      </AuthGate>
    </SettingsProvider>
  );
}
