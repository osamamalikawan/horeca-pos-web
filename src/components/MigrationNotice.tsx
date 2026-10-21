export default function MigrationNotice() {
  return (
    <div className="notice" style={{ marginBottom: 16, maxWidth: 640 }}>
      This page needs the database update first. Run <b>migration_users_employees_ledgers.sql</b> in the Supabase SQL editor, then press Sync now.
    </div>
  );
}
