# Apotheca desktop migration

The original PySide6 application remains available through `app.py`. The new desktop foundation uses:

- Electron for the desktop shell
- React and TypeScript for the renderer
- Express for the local service boundary
- SQLite with WAL mode for offline transactional storage
- A `sync_outbox` table for future cloud synchronization

## Run the new shell

```bash
npm install
npm run dev
```

The local API runs on `127.0.0.1:4317`. The SQLite database is still `pharmacy.db` in the project directory for this first migration slice. Existing Python data is not automatically migrated yet because the new schema uses UUIDs and integer cents for money; that conversion should happen as an explicit migration step after the domain operations are ported.

## Migrate an existing database

Make a backup before migrating. To migrate the current database in place:

```bash
npm run migrate
```

The command creates a timestamped `pharmacy.db.backup-...` file, preserves
existing product, batch, sale, stock movement, expense, and user records, and
records the migration in `migration_history`.

To migrate a separate legacy database into a new target database:

```bash
node scripts/migrate-legacy-db.cjs /path/to/legacy.db /path/to/pharmacy.db
```
