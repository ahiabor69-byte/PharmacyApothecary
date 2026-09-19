const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const sourcePath = path.resolve(process.argv[2] ?? "pharmacy.db");
const targetPath = path.resolve(process.argv[3] ?? sourcePath);
const sameDatabase = sourcePath === targetPath;

if (!fs.existsSync(sourcePath)) {
  console.error(`Source database not found: ${sourcePath}`);
  process.exit(1);
}

if (sameDatabase) {
  const backupPath = `${targetPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const backupDb = new Database(targetPath);
  backupDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  backupDb.close();
  console.log(`Backup created: ${backupPath}`);
}

const source = new Database(sourcePath, { readonly: !sameDatabase });
const target = sameDatabase ? source : new Database(targetPath);
target.pragma("foreign_keys = ON");

function hasTable(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columns(database, table) {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function value(row, name, fallback = null) {
  return row && Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null ? row[name] : fallback;
}

function moneyToCents(amount) {
  return Math.round(Number(amount ?? 0) * 100);
}

target.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 5,
    purchase_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    expiry_date TEXT NOT NULL DEFAULT '',
    barcode TEXT DEFAULT '',
    dosage_form TEXT DEFAULT '',
    strength TEXT DEFAULT '',
    purchase_price_cents INTEGER NOT NULL DEFAULT 0,
    selling_price_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    batch_number TEXT NOT NULL,
    quantity_received INTEGER NOT NULL,
    quantity_remaining INTEGER NOT NULL,
    purchase_price REAL NOT NULL,
    expiry_date TEXT NOT NULL,
    received_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    reference TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    expense_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    selling_price REAL NOT NULL,
    purchase_price REAL NOT NULL,
    sold_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    customer_name TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist', 'cashier')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS migration_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    products INTEGER NOT NULL,
    batches INTEGER NOT NULL,
    sales INTEGER NOT NULL,
    stock_movements INTEGER NOT NULL,
    expenses INTEGER NOT NULL,
    users INTEGER NOT NULL
  );
`);

const sourceTables = ["products", "batches", "sales", "stock_movements", "expenses", "users"];
const sourceRows = new Map(sourceTables.map((table) => [table, hasTable(source, table) ? source.prepare(`SELECT * FROM ${table}`).all() : []]));

const transaction = target.transaction(() => {
  for (const row of sourceRows.get("products")) {
    const purchasePrice = Number(value(row, "purchase_price", 0));
    const sellingPrice = Number(value(row, "selling_price", 0));
    target.prepare(`
      INSERT INTO products (
        id, sku, name, category, supplier, stock, reorder_level, purchase_price,
        selling_price, expiry_date, barcode, dosage_form, strength,
        purchase_price_cents, selling_price_cents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(id) DO UPDATE SET
        sku = excluded.sku, name = excluded.name, category = excluded.category,
        supplier = excluded.supplier, stock = excluded.stock, reorder_level = excluded.reorder_level,
        purchase_price = excluded.purchase_price, selling_price = excluded.selling_price,
        expiry_date = excluded.expiry_date, barcode = excluded.barcode,
        dosage_form = excluded.dosage_form, strength = excluded.strength,
        purchase_price_cents = excluded.purchase_price_cents,
        selling_price_cents = excluded.selling_price_cents,
        updated_at = excluded.updated_at
    `).run(
      value(row, "id"),
      value(row, "sku", ""),
      value(row, "name", ""),
      value(row, "category", ""),
      value(row, "supplier", ""),
      Number(value(row, "stock", 0)),
      Number(value(row, "reorder_level", 5)),
      purchasePrice,
      sellingPrice,
      value(row, "expiry_date", ""),
      value(row, "barcode", ""),
      value(row, "dosage_form", ""),
      value(row, "strength", ""),
      Number(value(row, "purchase_price_cents", moneyToCents(purchasePrice))),
      Number(value(row, "selling_price_cents", moneyToCents(sellingPrice))),
      value(row, "created_at"),
      value(row, "updated_at"),
    );
  }

  for (const row of sourceRows.get("batches")) {
    target.prepare(`
      INSERT OR REPLACE INTO batches (id, product_id, batch_number, quantity_received, quantity_remaining, purchase_price, expiry_date, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value(row, "id"),
      value(row, "product_id"),
      value(row, "batch_number", ""),
      Number(value(row, "quantity_received", 0)),
      Number(value(row, "quantity_remaining", 0)),
      Number(value(row, "purchase_price", 0)),
      value(row, "expiry_date", ""),
      value(row, "received_at"),
    );
  }

  for (const row of sourceRows.get("stock_movements")) {
    target.prepare(`
      INSERT OR REPLACE INTO stock_movements (id, product_id, movement_type, quantity, reference, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value(row, "id"),
      value(row, "product_id"),
      value(row, "movement_type", ""),
      Number(value(row, "quantity", 0)),
      value(row, "reference", ""),
      value(row, "notes", ""),
      value(row, "created_at"),
    );
  }

  for (const row of sourceRows.get("expenses")) {
    target.prepare(`
      INSERT OR REPLACE INTO expenses (id, category, description, amount, expense_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      value(row, "id"),
      value(row, "category", ""),
      value(row, "description", ""),
      Number(value(row, "amount", 0)),
      value(row, "expense_date", ""),
      value(row, "created_at"),
    );
  }

  for (const row of sourceRows.get("sales")) {
    target.prepare(`
      INSERT OR REPLACE INTO sales (id, product_id, quantity, selling_price, purchase_price, sold_at, discount, payment_method, customer_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value(row, "id"),
      value(row, "product_id"),
      Number(value(row, "quantity", 0)),
      Number(value(row, "selling_price", 0)),
      Number(value(row, "purchase_price", 0)),
      value(row, "sold_at"),
      Number(value(row, "discount", 0)),
      value(row, "payment_method", "Cash"),
      value(row, "customer_name", ""),
    );
  }

  for (const row of sourceRows.get("users")) {
    if (!value(row, "password_hash") || !["admin", "pharmacist", "cashier"].includes(value(row, "role"))) continue;
    target.prepare(`
      INSERT OR REPLACE INTO users (id, username, display_name, role, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      value(row, "id"),
      value(row, "username", ""),
      value(row, "display_name", value(row, "username", "")),
      value(row, "role"),
      value(row, "password_hash"),
      value(row, "created_at"),
    );
  }

  target.prepare(`
    INSERT INTO migration_history (source_path, products, batches, sales, stock_movements, expenses, users)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourcePath,
    sourceRows.get("products").length,
    sourceRows.get("batches").length,
    sourceRows.get("sales").length,
    sourceRows.get("stock_movements").length,
    sourceRows.get("expenses").length,
    sourceRows.get("users").length,
  );
});

transaction();

console.log(JSON.stringify({
  source: sourcePath,
  target: targetPath,
  products: sourceRows.get("products").length,
  batches: sourceRows.get("batches").length,
  sales: sourceRows.get("sales").length,
  stockMovements: sourceRows.get("stock_movements").length,
  expenses: sourceRows.get("expenses").length,
  users: sourceRows.get("users").length,
}, null, 2));

if (!sameDatabase) source.close();
target.close();
