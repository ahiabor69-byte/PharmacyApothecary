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
