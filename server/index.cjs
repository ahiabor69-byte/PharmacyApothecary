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
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    total_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
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
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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

app.get("/api/users", requireAuth, requireRole("admin"), (_request, response) => {
  const users = db.prepare("SELECT id, username, display_name AS displayName, role FROM users ORDER BY display_name COLLATE NOCASE").all();
  response.json(users);
});

app.post("/api/users", requireAuth, requireRole("admin"), (request, response) => {
  const username = String(request.body?.username ?? "").trim().toLowerCase();
  const displayName = String(request.body?.displayName ?? "").trim();
  const password = String(request.body?.password ?? "");
  const role = String(request.body?.role ?? "");

  if (!username || !displayName || !password || !["admin", "pharmacist", "cashier"].includes(role)) {
    return response.status(400).json({ error: "Username, display name, password, and a valid role are required." });
  }
  if (password.length < 8) return response.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return response.status(409).json({ error: "That username is already in use." });
  }

  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)").run(id, username, displayName, role, hashPassword(password));

  response.status(201).json({ id, username, displayName, role });
});

app.patch("/api/users/:id", requireAuth, requireRole("admin"), (request, response) => {
  const userId = request.params.id;
  const existing = db.prepare("SELECT id, username, display_name AS displayName, role FROM users WHERE id = ?").get(userId);
  if (!existing) return response.status(404).json({ error: "User not found." });
  if (request.user.id === userId) {
    return response.status(400).json({ error: "You cannot edit your own account from this form." });
  }

  const nextUsername = String(request.body?.username ?? existing.username).trim().toLowerCase();
  const nextDisplayName = String(request.body?.displayName ?? existing.displayName).trim();
  const nextRole = String(request.body?.role ?? existing.role);
  const nextPassword = request.body?.password ? String(request.body.password) : null;

  if (!nextUsername || !nextDisplayName || !["admin", "pharmacist", "cashier"].includes(nextRole)) {
    return response.status(400).json({ error: "Username, display name, and a valid role are required." });
  }
  if (nextPassword && nextPassword.length < 8) return response.status(400).json({ error: "Password must be at least 8 characters." });

  const duplicate = db.prepare("SELECT 1 FROM users WHERE username = ? AND id != ?").get(nextUsername, userId);
  if (duplicate) return response.status(409).json({ error: "That username is already in use." });

  db.transaction(() => {
    db.prepare("UPDATE users SET username = ?, display_name = ?, role = ? WHERE id = ?").run(nextUsername, nextDisplayName, nextRole, userId);
    if (nextPassword) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(nextPassword), userId);
    }
  })();

  const updatedUser = db.prepare("SELECT id, username, display_name AS displayName, role FROM users WHERE id = ?").get(userId);
  response.json(updatedUser);
});

app.delete("/api/users/:id", requireAuth, requireRole("admin"), (request, response) => {
  const userId = request.params.id;
  if (request.user.id === userId) return response.status(400).json({ error: "You cannot delete your own account." });

  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(userId);
  if (!target) return response.status(404).json({ error: "User not found." });

  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  if (target.role === "admin" && adminCount <= 1) {
    return response.status(400).json({ error: "At least one admin account must remain." });
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  response.status(204).end();
});

app.patch("/api/auth/password", requireAuth, (request, response) => {
  const currentPassword = String(request.body?.currentPassword ?? "");
  const newPassword = String(request.body?.newPassword ?? "");
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(request.user.id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) return response.status(400).json({ error: "Current password is incorrect." });
  if (newPassword.length < 8) return response.status(400).json({ error: "New password must be at least 8 characters." });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), request.user.id);
  response.status(204).end();
});

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
  const salesToday = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS units_sold_today, COUNT(*) AS sales_count_today FROM sales WHERE date(sold_at, 'localtime') = date('now', 'localtime')").get();
  response.json({ metrics: { ...metrics, ...salesToday }, products });
});

app.get("/api/products", requireAuth, (_request, response) => {
  response.json(db.prepare("SELECT * FROM products ORDER BY name").all());
});

app.get("/api/expenses", requireAuth, requireRole("admin"), (_request, response) => {
  response.json(db.prepare("SELECT id, category, description, amount, expense_date FROM expenses ORDER BY expense_date DESC, id DESC").all());
});

app.get("/api/reports/summary", requireAuth, requireRole("admin"), (_request, response) => {
  const sales = db.prepare("SELECT COALESCE(SUM(quantity * selling_price), 0) AS revenue, COALESCE(SUM(quantity), 0) AS units_sold, COUNT(*) AS transactions FROM sales").get();
  const expenses = db.prepare("SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses").get();
  response.json({ revenue: Math.round(sales.revenue * 100), expenses: Math.round(expenses.expenses * 100), unitsSold: sales.units_sold, transactions: sales.transactions });
});

app.get("/api/history", requireAuth, (_request, response) => {
  response.json(db.prepare("SELECT sales.id, products.name, sales.quantity, sales.sold_at, sales.payment_method FROM sales JOIN products ON products.id = sales.product_id ORDER BY sales.sold_at DESC, sales.id DESC LIMIT 50").all());
});

app.post("/api/expenses", requireAuth, requireRole("admin"), (request, response) => {
  const expense = request.body;
  if (!expense?.category || !expense?.description || !Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0 || !expense?.expenseDate) {
    return response.status(400).json({ error: "Category, description, positive amount, and date are required." });
  }
  const result = db.prepare("INSERT INTO expenses (category, description, amount, expense_date) VALUES (?, ?, ?, ?)").run(expense.category, expense.description, Number(expense.amount), expense.expenseDate);
  response.status(201).json(db.prepare("SELECT id, category, description, amount, expense_date FROM expenses WHERE id = ?").get(result.lastInsertRowid));
});

app.post("/api/products", requireAuth, requireRole("admin", "pharmacist"), (request, response) => {
  const product = request.body;
  if (!product?.sku || !product?.name) {
    return response.status(400).json({ error: "SKU and medicine name are required." });
  }
  const insert = db.prepare(`
    INSERT INTO products (sku, name, dosage_form, strength, category, stock, reorder_level, purchase_price_cents, selling_price_cents, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(product.sku, product.name, product.dosageForm ?? "", product.strength ?? "", product.category ?? "", product.stock ?? 0, product.reorderLevel ?? 5, product.purchasePriceCents ?? 0, product.sellingPriceCents ?? 0, product.expiryDate ?? "");
  const productId = result.lastInsertRowid.toString();
  db.prepare("INSERT INTO sync_outbox (id, entity, entity_id, operation, payload) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "products", productId, "upsert", JSON.stringify(product));
  response.status(201).json(db.prepare("SELECT * FROM products WHERE id = ?").get(productId));
});

app.post("/api/sales", requireAuth, (request, response) => {
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  if (!items.length) return response.status(400).json({ error: "A sale must contain at least one item." });
  const productIds = items.map((item) => Number(item.productId));
  const products = db.prepare(`SELECT id, name, stock, selling_price_cents FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`).all(...productIds);
  const productMap = new Map(products.map((product) => [String(product.id), product]));
  const normalizedItems = items.map((item) => ({ product: productMap.get(String(item.productId)), quantity: Number(item.quantity) }));
  if (normalizedItems.some(({ product, quantity }) => !product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.stock)) {
    return response.status(400).json({ error: "One or more items are no longer available in the requested quantity." });
  }
  const totalCents = normalizedItems.reduce((total, { product, quantity }) => total + product.selling_price_cents * quantity, 0);
  const recordSale = db.transaction(() => {
    const insertItem = db.prepare("INSERT INTO sales (product_id, quantity, selling_price, purchase_price, discount, payment_method, customer_name) VALUES (?, ?, ?, ?, 0, 'Cash', '')");
    const reduceStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    normalizedItems.forEach(({ product, quantity }) => {
      insertItem.run(product.id, quantity, product.selling_price_cents / 100, 0);
      reduceStock.run(quantity, product.id);
    });
  });
  recordSale();
  response.status(201).json({ totalCents });
});

app.patch("/api/products/:id", requireAuth, requireRole("admin"), (request, response) => {
  const product = request.body;
  if (!product?.sku || !product?.name) return response.status(400).json({ error: "SKU and medicine name are required." });
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(request.params.id);
  if (!existing) return response.status(404).json({ error: "Product not found." });
  try {
    db.prepare("UPDATE products SET sku = ?, name = ?, dosage_form = ?, strength = ?, category = ?, stock = ?, reorder_level = ?, purchase_price_cents = ?, selling_price_cents = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(product.sku, product.name, product.dosageForm ?? "", product.strength ?? "", product.category ?? "", Number(product.stock ?? 0), Number(product.reorderLevel ?? 5), Number(product.purchasePriceCents ?? 0), Number(product.sellingPriceCents ?? 0), product.expiryDate ?? "", request.params.id);
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: "That SKU is already in use." });
    throw error;
  }
  db.prepare("INSERT INTO sync_outbox (id, entity, entity_id, operation, payload) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "products", request.params.id, "update", JSON.stringify(product));
  response.json(db.prepare("SELECT * FROM products WHERE id = ?").get(request.params.id));
});

app.delete("/api/products/:id", requireAuth, requireRole("admin"), (request, response) => {
  const product = db.prepare("SELECT id, name, sku FROM products WHERE id = ?").get(request.params.id);
  if (!product) return response.status(404).json({ error: "Product not found." });
  db.prepare("DELETE FROM products WHERE id = ?").run(product.id);
  db.prepare("INSERT INTO sync_outbox (id, entity, entity_id, operation, payload) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "products", product.id, "delete", JSON.stringify(product));
  response.status(204).end();
});

async function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { app, startServer };
