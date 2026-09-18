const express = require("express");
const Database = require("better-sqlite3");
const path = require("node:path");
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require("node:crypto");

const PORT = 4317;
const dbPath = path.join(__dirname, "..", "pharmacy.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    dosage_form TEXT DEFAULT '',
    strength TEXT DEFAULT '',
    category TEXT DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 5,
    purchase_price_cents INTEGER NOT NULL DEFAULT 0,
    selling_price_cents INTEGER NOT NULL DEFAULT 0,
    expiry_date TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist', 'cashier')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const sessions = new Map();

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  const insertUser = db.prepare("INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)");
  const seedUsers = [
    ["admin", "Pharmacy Admin", "admin", "admin123"],
    ["pharmacist", "Lead Pharmacist", "pharmacist", "pharmacist123"],
    ["cashier", "Front Counter", "cashier", "cashier123"],
  ];
  const seed = db.transaction(() => seedUsers.forEach(([username, displayName, role, password]) => insertUser.run(randomUUID(), username, displayName, role, hashPassword(password))));
  seed();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("products", "purchase_price_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("products", "selling_price_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("products", "created_at", "TEXT");
ensureColumn("products", "updated_at", "TEXT");
db.exec(`
  UPDATE products
  SET purchase_price_cents = CAST(ROUND(COALESCE(purchase_price, 0) * 100) AS INTEGER),
      selling_price_cents = CAST(ROUND(COALESCE(selling_price, 0) * 100) AS INTEGER),
      created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
      updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
  WHERE purchase_price_cents = 0 AND selling_price_cents = 0
`);

const app = express();
app.use((request, response, next) => {
  const origin = request.get("origin");
  if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173" || origin === "null") {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json());

function requireAuth(request, response, next) {
  const token = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return response.status(401).json({ error: "Sign in required." });
  }
  request.user = session.user;
  next();
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.role)) return response.status(403).json({ error: "Your access level cannot perform this action." });
    next();
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, database: "sqlite", sync: "local-only" });
});

app.post("/api/auth/login", (request, response) => {
  const username = String(request.body?.username ?? "").trim().toLowerCase();
  const password = String(request.body?.password ?? "");
  const user = db.prepare("SELECT id, username, display_name, role, password_hash FROM users WHERE username = ?").get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return response.status(401).json({ error: "Incorrect username or password." });
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role }, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  response.json({ token, user: sessions.get(token).user });
});

app.get("/api/auth/me", requireAuth, (request, response) => response.json({ user: request.user }));

app.post("/api/auth/logout", requireAuth, (request, response) => {
  const token = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  sessions.delete(token);
  response.status(204).end();
});

app.get("/api/dashboard", requireAuth, (_request, response) => {
  const metrics = db.prepare(`
    SELECT
      COALESCE(SUM(stock * purchase_price_cents), 0) AS inventory_value_cents,
      COUNT(*) AS product_count,
      COALESCE(SUM(CASE WHEN stock <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_count,
      COALESCE(SUM(CASE WHEN expiry_date != '' AND expiry_date <= date('now', '+30 day') THEN 1 ELSE 0 END), 0) AS expiring_count
    FROM products
  `).get();
  const products = db.prepare(`
    SELECT id, sku, name, dosage_form, strength, stock, reorder_level, expiry_date
    FROM products
    WHERE stock <= reorder_level OR (expiry_date != '' AND expiry_date <= date('now', '+30 day'))
    ORDER BY stock ASC, expiry_date ASC
    LIMIT 8
  `).all();
  response.json({ metrics, products });
});

app.get("/api/products", requireAuth, (_request, response) => {
  response.json(db.prepare("SELECT * FROM products ORDER BY name").all());
});

app.post("/api/products", requireAuth, requireRole("admin", "pharmacist"), (request, response) => {
  const product = request.body;
  if (!product?.sku || !product?.name) {
    return response.status(400).json({ error: "SKU and medicine name are required." });
  }
  const productId = randomUUID();
  const insert = db.prepare(`
    INSERT INTO products (id, sku, name, dosage_form, strength, category, stock, reorder_level, purchase_price_cents, selling_price_cents, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(productId, product.sku, product.name, product.dosageForm ?? "", product.strength ?? "", product.category ?? "", product.stock ?? 0, product.reorderLevel ?? 5, product.purchasePriceCents ?? 0, product.sellingPriceCents ?? 0, product.expiryDate ?? "");
  db.prepare("INSERT INTO sync_outbox (id, entity, entity_id, operation, payload) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "products", productId, "upsert", JSON.stringify(product));
  response.status(201).json(db.prepare("SELECT * FROM products WHERE id = ?").get(productId));
});

async function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { app, startServer };
