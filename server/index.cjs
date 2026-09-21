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
    generic_name TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    barcode TEXT DEFAULT '',
    batch_number TEXT DEFAULT '',
    supplier TEXT DEFAULT '',
    received_date TEXT DEFAULT '',
    pack_size TEXT DEFAULT '',
    storage_location TEXT DEFAULT '',
    storage_condition TEXT DEFAULT '',
    invoice_reference TEXT DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS mobile_money_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    api_base_url TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mobile_money_transactions (
    id TEXT PRIMARY KEY,
    sale_id TEXT,
    provider_code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'rejected', 'failed')),
    external_reference TEXT DEFAULT '',
    merchant_reference TEXT DEFAULT '',
    response_code TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_code) REFERENCES mobile_money_providers(code)
  );
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    total_cents INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    mobile_money_provider TEXT DEFAULT '',
    mobile_money_phone TEXT DEFAULT '',
    mobile_money_status TEXT DEFAULT 'none',
    transaction_id TEXT DEFAULT '',
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

const providerCount = db.prepare("SELECT COUNT(*) AS count FROM mobile_money_providers").get().count;
if (providerCount === 0) {
  const insertProvider = db.prepare("INSERT INTO mobile_money_providers (id, name, code, status, api_base_url) VALUES (?, ?, ?, ?, ?)");
  const seedProviders = [
    ["mtn", "MTN MoMo", "mtn", "active", process.env.MTN_MOMO_API_BASE_URL ?? ""],
    ["vodafone", "Vodafone Cash", "vodafone", "active", process.env.VODAFONE_CASH_API_BASE_URL ?? ""],
    ["airteltigo", "AirtelTigo Money", "airteltigo", "active", process.env.AIRTELTIGO_MONEY_API_BASE_URL ?? ""],
  ];
  db.transaction(() => seedProviders.forEach(([id, name, code, status, baseUrl]) => insertProvider.run(randomUUID(), name, code, status, baseUrl)))();
}

function getProviderByCode(providerCode) {
  return db.prepare("SELECT id, name, code, status, api_base_url FROM mobile_money_providers WHERE code = ?").get(String(providerCode ?? "").trim().toLowerCase()) ?? null;
}

function buildGatewayReference(transactionId, amountCents) {
  return `MM-${Date.now()}-${transactionId.slice(0, 8)}-${String(amountCents).padStart(6, "0")}`;
}

async function submitProviderTransaction({ providerCode, phoneNumber, amountCents, saleId, merchantReference }) {
  const provider = getProviderByCode(providerCode);
  const normalizedPhone = String(phoneNumber ?? "").replace(/\D/g, "");
  const safeReference = merchantReference || buildGatewayReference(randomUUID(), amountCents);
  const requestBody = {
    providerCode,
    phoneNumber: normalizedPhone,
    amountCents: Number(amountCents ?? 0),
    saleId: saleId ? String(saleId) : null,
    merchantReference: safeReference,
    timestamp: new Date().toISOString(),
  };

  if (!provider || !provider.api_base_url) {
    return {
      ok: true,
      status: "submitted",
      responseCode: "SIMULATED",
      externalReference: `sim-${safeReference}`,
      merchantReference: safeReference,
      payload: JSON.stringify({ provider: provider?.name ?? providerCode, phoneNumber: normalizedPhone, amountCents: Number(amountCents ?? 0), merchantReference: safeReference, mode: "sandbox" }),
      requestBody,
    };
  }

  try {
    const response = await fetch(`${provider.api_base_url.replace(/\/$/, "")}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(requestBody),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error ?? json?.message ?? "Provider rejected the payment request.");
    }
    const gatewayStatus = String(json?.status ?? "submitted").toLowerCase();
    return {
      ok: true,
      status: ["pending", "submitted", "confirmed", "rejected", "failed"].includes(gatewayStatus) ? gatewayStatus : "submitted",
      responseCode: String(json?.responseCode ?? "ACCEPTED"),
      externalReference: String(json?.externalReference ?? `ext-${safeReference}`),
      merchantReference: String(json?.merchantReference ?? safeReference),
      payload: JSON.stringify({ provider: provider.name, phoneNumber: normalizedPhone, amountCents: Number(amountCents ?? 0), merchantReference: String(json?.merchantReference ?? safeReference), gateway: json ?? {} }),
      requestBody,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      responseCode: "GATEWAY_ERROR",
      externalReference: "",
      merchantReference: safeReference,
      payload: JSON.stringify({ provider: provider.name, phoneNumber: normalizedPhone, amountCents: Number(amountCents ?? 0), merchantReference: safeReference, gatewayError: String(error.message ?? error) }),
      requestBody,
    };
  }
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("products", "purchase_price_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("products", "selling_price_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("products", "generic_name", "TEXT DEFAULT ''");
ensureColumn("products", "manufacturer", "TEXT DEFAULT ''");
ensureColumn("products", "barcode", "TEXT DEFAULT ''");
ensureColumn("products", "batch_number", "TEXT DEFAULT ''");
ensureColumn("products", "supplier", "TEXT DEFAULT ''");
ensureColumn("products", "received_date", "TEXT DEFAULT ''");
ensureColumn("products", "pack_size", "TEXT DEFAULT ''");
ensureColumn("products", "storage_location", "TEXT DEFAULT ''");
ensureColumn("products", "storage_condition", "TEXT DEFAULT ''");
ensureColumn("products", "invoice_reference", "TEXT DEFAULT ''");
ensureColumn("products", "created_at", "TEXT");
ensureColumn("products", "updated_at", "TEXT");
ensureColumn("sales", "user_id", "TEXT");
ensureColumn("sales", "total_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sales", "payment_method", "TEXT NOT NULL DEFAULT 'Cash'");
ensureColumn("sales", "mobile_money_provider", "TEXT DEFAULT ''");
ensureColumn("sales", "mobile_money_phone", "TEXT DEFAULT ''");
ensureColumn("sales", "mobile_money_status", "TEXT DEFAULT 'none'");
ensureColumn("sales", "transaction_id", "TEXT DEFAULT ''");

const saleItemsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_items'").get();
if (!saleItemsExists) {
  db.exec(`
    CREATE TABLE sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    )
  `);
} else {
  const saleItemsColumns = db.prepare("PRAGMA table_info(sale_items)").all();
  const productIdColumn = saleItemsColumns.find((column) => column.name === "product_id");
  if (productIdColumn && productIdColumn.type && !productIdColumn.type.toUpperCase().includes("TEXT")) {
    db.exec(`
      ALTER TABLE sale_items RENAME TO sale_items_legacy;
      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
      );
      INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price_cents)
      SELECT id, sale_id, product_id, quantity, unit_price_cents FROM sale_items_legacy;
      DROP TABLE sale_items_legacy;
    `);
  }
}

if (db.prepare("SELECT COUNT(*) AS count FROM sales WHERE payment_method IS NULL OR payment_method = ''").get().count > 0) {
  db.exec("UPDATE sales SET payment_method = 'Cash' WHERE payment_method IS NULL OR payment_method = ''");
}
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

app.get("/api/reports/sales", requireAuth, requireRole("admin"), (request, response) => {
  const period = request.query.period === "monthly" ? "monthly" : "daily";
  const format = period === "monthly" ? "%Y-%m" : "%Y-%m-%d";
  const limit = period === "monthly" ? 12 : 14;
  const rows = db.prepare(`
    SELECT
      strftime(?, sold_at, 'localtime') AS period,
      COALESCE(SUM(quantity * selling_price - COALESCE(discount, 0)), 0) AS revenue,
      COALESCE(SUM(quantity), 0) AS units_sold,
      COUNT(*) AS transactions
    FROM sales
    GROUP BY strftime(?, sold_at, 'localtime')
    ORDER BY period DESC
    LIMIT ?
  `).all(format, format, limit).reverse();

  response.json({
    period,
    periods: rows.map((row) => ({
      period: row.period,
      revenue: Math.round(row.revenue * 100),
      unitsSold: row.units_sold,
      transactions: row.transactions,
    })),
  });
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
    INSERT INTO products (sku, name, dosage_form, strength, category, generic_name, manufacturer, barcode, batch_number, supplier, received_date, pack_size, storage_location, storage_condition, invoice_reference, stock, reorder_level, purchase_price_cents, selling_price_cents, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(product.sku, product.name, product.dosageForm ?? "", product.strength ?? "", product.category ?? "", product.genericName ?? "", product.manufacturer ?? "", product.barcode ?? "", product.batchNumber ?? "", product.supplier ?? "", product.receivedDate ?? "", product.packSize ?? "", product.storageLocation ?? "", product.storageCondition ?? "", product.invoiceReference ?? "", product.stock ?? 0, product.reorderLevel ?? 5, product.purchasePriceCents ?? 0, product.sellingPriceCents ?? 0, product.expiryDate ?? "");
  const productId = result.lastInsertRowid.toString();
  db.prepare("INSERT INTO sync_outbox (id, entity, entity_id, operation, payload) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "products", productId, "upsert", JSON.stringify(product));
  response.status(201).json(db.prepare("SELECT * FROM products WHERE id = ?").get(productId));
});

app.get("/api/mobile-money/providers", requireAuth, (_request, response) => {
  response.json(db.prepare("SELECT id, name, code, api_base_url, status FROM mobile_money_providers ORDER BY name COLLATE NOCASE").all().map((provider) => ({
    ...provider,
    api_base_url: provider.api_base_url || process.env.MOBILE_MONEY_API_BASE_URL || "",
  })));
});

app.get("/api/mobile-money/transactions", requireAuth, (request, response) => {
  const saleId = request.query.saleId ? String(request.query.saleId) : null;
  const rows = saleId
    ? db.prepare("SELECT * FROM mobile_money_transactions WHERE sale_id = ? ORDER BY created_at DESC").all(saleId)
    : db.prepare("SELECT * FROM mobile_money_transactions ORDER BY created_at DESC LIMIT 50").all();
  response.json(rows);
});

app.post("/api/mobile-money/transactions", requireAuth, async (request, response) => {
  const providerCode = String(request.body?.providerCode ?? "").trim().toLowerCase();
  const phoneNumber = String(request.body?.phoneNumber ?? "").trim();
  const amountCents = Number(request.body?.amountCents ?? 0);
  const saleId = request.body?.saleId ? String(request.body.saleId) : null;

  if (!providerCode || !phoneNumber || !Number.isFinite(amountCents) || amountCents <= 0) {
    return response.status(400).json({ error: "Provider, phone number, and a positive amount are required." });
  }

  const provider = getProviderByCode(providerCode);
  if (!provider || provider.status !== "active") {
    return response.status(400).json({ error: "Selected mobile money provider is not available." });
  }

  const transactionId = randomUUID();
  const merchantReference = buildGatewayReference(transactionId, amountCents);
  const providerResult = await submitProviderTransaction({ providerCode, phoneNumber, amountCents, saleId, merchantReference });

  db.prepare("INSERT INTO mobile_money_transactions (id, sale_id, provider_code, phone_number, amount_cents, status, external_reference, merchant_reference, response_code, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    transactionId,
    saleId,
    provider.code,
    phoneNumber,
    amountCents,
    providerResult.status,
    providerResult.externalReference,
    providerResult.merchantReference,
    providerResult.responseCode,
    providerResult.payload
  );

  if (saleId) {
    db.prepare("UPDATE sales SET transaction_id = ?, mobile_money_status = ? WHERE id = ?").run(transactionId, providerResult.status, saleId);
  }

  response.status(201).json({
    id: transactionId,
    saleId,
    providerCode: provider.code,
    merchantReference: providerResult.merchantReference,
    status: providerResult.status,
    amountCents,
    phoneNumber,
    responseCode: providerResult.responseCode,
  });
});

app.post("/api/mobile-money/callback", (request, response) => {
  const transactionId = String(request.body?.transactionId ?? "").trim();
  const status = String(request.body?.status ?? "").trim().toLowerCase();
  const responseCode = String(request.body?.responseCode ?? "").trim();
  const merchantReference = String(request.body?.merchantReference ?? "").trim();

  if (!transactionId || !status || !["pending", "submitted", "confirmed", "rejected", "failed"].includes(status)) {
    return response.status(400).json({ error: "A valid transaction ID and status are required." });
  }

  const transaction = db.prepare("SELECT * FROM mobile_money_transactions WHERE id = ?").get(transactionId)
    ?? db.prepare("SELECT * FROM mobile_money_transactions WHERE merchant_reference = ?").get(merchantReference || transactionId);

  if (!transaction) {
    return response.status(404).json({ error: "Transaction not found." });
  }

  db.prepare("UPDATE mobile_money_transactions SET status = ?, response_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, responseCode || transaction.response_code || status.toUpperCase(), transaction.id);
  db.prepare("UPDATE sales SET mobile_money_status = ? WHERE id = ?").run(status, transaction.sale_id);

  response.json({ ok: true, status, saleId: transaction.sale_id });
});

app.post("/api/sales", requireAuth, async (request, response) => {
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  const paymentMethod = String(request.body?.paymentMethod ?? "Cash");
  const providerCode = String(request.body?.providerCode ?? "").trim().toLowerCase();
  const phoneNumber = String(request.body?.phoneNumber ?? "").trim();

  if (!items.length) return response.status(400).json({ error: "A sale must contain at least one item." });
  const productIds = items.map((item) => Number(item.productId));
  const products = db.prepare(`SELECT id, name, stock, selling_price_cents FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`).all(...productIds);
  const productMap = new Map(products.map((product) => [String(product.id), product]));
  const normalizedItems = items.map((item) => ({ product: productMap.get(String(item.productId)), quantity: Number(item.quantity) }));
  if (normalizedItems.some(({ product, quantity }) => !product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.stock)) {
    return response.status(400).json({ error: "One or more items are no longer available in the requested quantity." });
  }

  const totalCents = normalizedItems.reduce((total, { product, quantity }) => total + product.selling_price_cents * quantity, 0);
  const isMobileMoney = paymentMethod === "Mobile money";
  const provider = isMobileMoney ? getProviderByCode(providerCode) : null;

  if (isMobileMoney && (!provider || provider.status !== "active" || !phoneNumber)) {
    return response.status(400).json({ error: "A valid provider and mobile money phone number are required for mobile-money payments." });
  }

  const mobileMoneyResult = isMobileMoney
    ? await submitProviderTransaction({
        providerCode: provider.code,
        phoneNumber,
        amountCents: totalCents,
        saleId: null,
        merchantReference: null,
      })
    : null;

  const recordSale = db.transaction(() => {
    const insertSale = db.prepare("INSERT INTO sales (product_id, quantity, selling_price, purchase_price, discount, payment_method, customer_name, user_id, total_cents, mobile_money_provider, mobile_money_phone, mobile_money_status, transaction_id) VALUES (?, ?, ?, ?, 0, ?, '', ?, ?, ?, ?, ?, ?)");
    const reduceStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    const paymentStatus = isMobileMoney ? mobileMoneyResult.status : "none";
    let primarySaleId = null;

    normalizedItems.forEach(({ product, quantity }) => {
      const saleResult = insertSale.run(product.id, quantity, product.selling_price_cents, product.purchase_price_cents ?? 0, paymentMethod, request.user.id, totalCents, isMobileMoney ? provider.code : "", isMobileMoney ? phoneNumber : "", paymentStatus, "");
      const saleId = Number(saleResult.lastInsertRowid);
      if (primarySaleId === null) primarySaleId = saleId;
      reduceStock.run(quantity, product.id);
    });

    if (isMobileMoney) {
      const transactionId = randomUUID();
      const merchantReference = mobileMoneyResult.merchantReference || buildGatewayReference(transactionId, totalCents);
      db.prepare("INSERT INTO mobile_money_transactions (id, sale_id, provider_code, phone_number, amount_cents, status, external_reference, merchant_reference, response_code, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        transactionId,
        String(primarySaleId),
        provider.code,
        phoneNumber,
        totalCents,
        mobileMoneyResult.status,
        mobileMoneyResult.externalReference,
        merchantReference,
        mobileMoneyResult.responseCode,
        mobileMoneyResult.payload
      );
      db.prepare("UPDATE sales SET transaction_id = ?, mobile_money_status = ? WHERE id = ?").run(transactionId, paymentStatus, primarySaleId);
    }

    return primarySaleId;
  });

  const saleId = recordSale();
  response.status(201).json({ totalCents, saleId, paymentMethod, providerCode: isMobileMoney ? providerCode : null, phoneNumber: isMobileMoney ? phoneNumber : null, mobileMoneyStatus: isMobileMoney ? mobileMoneyResult.status : null, merchantReference: isMobileMoney ? mobileMoneyResult.merchantReference : null });
});

app.patch("/api/products/:id", requireAuth, requireRole("admin"), (request, response) => {
  const product = request.body;
  if (!product?.sku || !product?.name) return response.status(400).json({ error: "SKU and medicine name are required." });
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(request.params.id);
  if (!existing) return response.status(404).json({ error: "Product not found." });
  try {
    db.prepare("UPDATE products SET sku = ?, name = ?, dosage_form = ?, strength = ?, category = ?, generic_name = ?, manufacturer = ?, barcode = ?, batch_number = ?, supplier = ?, received_date = ?, pack_size = ?, storage_location = ?, storage_condition = ?, invoice_reference = ?, stock = ?, reorder_level = ?, purchase_price_cents = ?, selling_price_cents = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(product.sku, product.name, product.dosageForm ?? "", product.strength ?? "", product.category ?? "", product.genericName ?? "", product.manufacturer ?? "", product.barcode ?? "", product.batchNumber ?? "", product.supplier ?? "", product.receivedDate ?? "", product.packSize ?? "", product.storageLocation ?? "", product.storageCondition ?? "", product.invoiceReference ?? "", Number(product.stock ?? 0), Number(product.reorderLevel ?? 5), Number(product.purchasePriceCents ?? 0), Number(product.sellingPriceCents ?? 0), product.expiryDate ?? "", request.params.id);
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
  const saleCount = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sales WHERE product_id = ?) +
      (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) AS count
  `).get(product.id, product.id).count;
  if (saleCount > 0) {
    return response.status(409).json({ error: "This product has sales history and cannot be removed." });
  }
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

if (require.main === module) {
  startServer()
    .then((server) => {
      console.log(`Apotheca API listening at http://127.0.0.1:${PORT}`);
      const shutdown = () => server.close(() => process.exit(0));
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error("API startup error:", error);
      process.exitCode = 1;
    });
}
