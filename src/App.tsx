import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Boxes, ClipboardList, LayoutDashboard, PackageSearch, Plus, Receipt, Settings2, ShoppingCart, Wallet } from "lucide-react";

type Dashboard = {
  metrics: {
    inventory_value_cents: number;
    product_count: number;
    low_stock_count: number;
    expiring_count: number;
    units_sold_today: number;
    sales_count_today: number;
  };
  products: Array<{
    id: string;
    sku: string;
    name: string;
    dosage_form: string;
    strength: string;
    stock: number;
    reorder_level: number;
    expiry_date: string;
  }>;
};

type Product = Dashboard["products"][number] & {
  category?: string;
  purchase_price_cents?: number;
  selling_price_cents?: number;
};

type Expense = {
  id: number;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
};

type ReportSummary = { revenue: number; expenses: number; unitsSold: number; transactions: number };
type HistoryEntry = { id: number; name: string; quantity: number; sold_at: string; payment_method: string };

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "pharmacist" | "cashier";
};

type NewUserInput = {
  username: string;
  displayName: string;
  password: string;
  role: User["role"];
};

const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Inventory", icon: Boxes },
  { label: "Point of sale", icon: ShoppingCart },
  { label: "Stock history", icon: ClipboardList },
  { label: "Expenses", icon: Wallet },
  { label: "Reports", icon: Receipt },
];

const currency = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 2 });

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary>({ revenue: 0, expenses: 0, unitsSold: 0, transactions: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeNav, setActiveNav] = useState("Overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [receiveError, setReceiveError] = useState("");
  const [receiveForm, setReceiveForm] = useState({ sku: "", name: "", dosageForm: "Tablet", strength: "", category: "", stock: "", reorderLevel: "5", purchasePriceCents: "", sellingPriceCents: "", expiryDate: "" });
  const [saleError, setSaleError] = useState("");
  const [settingsError, setSettingsError] = useState("");

  const loadDashboard = (token: string, role?: User["role"]) => {
    fetch("http://127.0.0.1:4317/api/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Your session has expired.");
        return response.json();
      })
      .then(setDashboard)
      .catch((reason: Error) => {
        localStorage.removeItem("apotheca_token");
        setUser(null);
        setError(reason.message);
      });
    fetch("http://127.0.0.1:4317/api/products", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setProducts)
      .catch(() => setProducts([]));
    fetch("http://127.0.0.1:4317/api/expenses", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setExpenses)
      .catch(() => setExpenses([]));
    fetch("http://127.0.0.1:4317/api/reports/summary", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setReportSummary)
      .catch(() => setReportSummary({ revenue: 0, expenses: 0, unitsSold: 0, transactions: 0 }));
    fetch("http://127.0.0.1:4317/api/history", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setHistory)
      .catch(() => setHistory([]));
    if (role === "admin") {
      fetch("http://127.0.0.1:4317/api/users", { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => response.json())
        .then((payload) => setUsers(payload.map((entry: User) => ({ ...entry, displayName: entry.displayName ?? entry.username }))))
        .catch(() => setUsers([]));
    } else {
      setUsers([]);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return;
    fetch("http://127.0.0.1:4317/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Sign in required.");
        return response.json();
      })
      .then(({ user: signedInUser }: { user: User }) => {
        setUser(signedInUser);
        loadDashboard(token, signedInUser.role);
      })
      .catch(() => localStorage.removeItem("apotheca_token"));
  }, []);

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setLoginError("");
    fetch("http://127.0.0.1:4317/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loginForm) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to sign in.");
        return payload as { token: string; user: User };
      })
      .then(({ token, user: signedInUser }) => {
        localStorage.setItem("apotheca_token", token);
        setUser(signedInUser);
        setLoginForm({ username: "", password: "" });
        loadDashboard(token, signedInUser.role);
      })
      .catch((reason: Error) => setLoginError(reason.message))
      .finally(() => setIsSigningIn(false));
  }

  function handleLogout() {
    const token = localStorage.getItem("apotheca_token");
    if (token) fetch("http://127.0.0.1:4317/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    localStorage.removeItem("apotheca_token");
    setUser(null);
    setDashboard(null);
  }

  function handleReceiveStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem("apotheca_token");
    if (!token) return;
    setReceiveError("");
    fetch("http://127.0.0.1:4317/api/products", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...receiveForm, stock: Number(receiveForm.stock), reorderLevel: Number(receiveForm.reorderLevel), purchasePriceCents: Math.round(Number(receiveForm.purchasePriceCents || 0) * 100), sellingPriceCents: Math.round(Number(receiveForm.sellingPriceCents || 0) * 100) }) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to receive stock.");
        return payload as Product;
      })
      .then((product) => {
        setProducts((current) => [...current, product].sort((left, right) => left.name.localeCompare(right.name)));
        setIsReceiveOpen(false);
        setReceiveForm({ sku: "", name: "", dosageForm: "Tablet", strength: "", category: "", stock: "", reorderLevel: "5", purchasePriceCents: "", sellingPriceCents: "", expiryDate: "" });
        loadDashboard(token);
      })
      .catch((reason: Error) => setReceiveError(reason.message));
  }

  function openProductEditor(product: Product) {
    setEditingProduct(product);
    setReceiveError("");
    setReceiveForm({ sku: product.sku, name: product.name, dosageForm: product.dosage_form, strength: product.strength, category: product.category ?? "", stock: String(product.stock), reorderLevel: String(product.reorder_level), purchasePriceCents: String((product.purchase_price_cents ?? 0) / 100), sellingPriceCents: String((product.selling_price_cents ?? 0) / 100), expiryDate: product.expiry_date ?? "" });
    setIsReceiveOpen(true);
  }

  function handleEditProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem("apotheca_token");
    if (!token || !editingProduct) return;
    setReceiveError("");
    fetch(`http://127.0.0.1:4317/api/products/${editingProduct.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...receiveForm, stock: Number(receiveForm.stock), reorderLevel: Number(receiveForm.reorderLevel), purchasePriceCents: Math.round(Number(receiveForm.purchasePriceCents || 0) * 100), sellingPriceCents: Math.round(Number(receiveForm.sellingPriceCents || 0) * 100) }) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to update product.");
        return payload as Product;
      })
      .then((product) => {
        setProducts((current) => current.map((item) => item.id === product.id ? product : item).sort((left, right) => left.name.localeCompare(right.name)));
        setEditingProduct(null);
        setIsReceiveOpen(false);
        loadDashboard(token);
      })
      .catch((reason: Error) => setReceiveError(reason.message));
  }

  function handleDeleteProduct(product: Product) {
    if (!window.confirm(`Remove ${product.name} (${product.sku}) from inventory?`)) return;
    const token = localStorage.getItem("apotheca_token");
    if (!token) return;
    fetch(`http://127.0.0.1:4317/api/products/${product.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error ?? "Unable to remove product.");
        }
      })
      .then(() => {
        setProducts((current) => current.filter((item) => item.id !== product.id));
        loadDashboard(token);
      })
      .catch((reason: Error) => setError(reason.message));
  }

  function handleCompleteSale(items: Array<{ productId: string; quantity: number }>) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    setSaleError("");
    return fetch("http://127.0.0.1:4317/api/sales", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to complete sale.");
        return payload;
      })
      .then((result) => {
        loadDashboard(token);
        setSaleError("");
        return result;
      })
      .catch((reason: Error) => {
        setSaleError(reason.message);
        throw reason;
      });
  }

  function handleAddExpense(expense: { category: string; description: string; amount: number; expenseDate: string }) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    return fetch("http://127.0.0.1:4317/api/expenses", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(expense) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to save expense.");
        return payload as Expense;
      })
      .then((savedExpense) => {
        setExpenses((current) => [savedExpense, ...current]);
        return savedExpense;
      });
  }

  function handleCreateUser(nextUser: NewUserInput) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    return fetch("http://127.0.0.1:4317/api/users", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(nextUser) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to create user.");
        return payload as User;
      })
      .then((createdUser) => {
        setUsers((current) => [...current, createdUser].sort((left, right) => left.displayName.localeCompare(right.displayName)));
        return createdUser;
      });
  }

  function handleUpdateUser(id: string, nextUser: Partial<NewUserInput> & { username: string; displayName: string; role: User["role"] }) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    const payload = { ...nextUser, ...(nextUser.password ? { password: nextUser.password } : {}) };
    return fetch(`http://127.0.0.1:4317/api/users/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to update user.");
        return result as User;
      })
      .then((updatedUser) => {
        setUsers((current) => current.map((entry) => entry.id === id ? updatedUser : entry).sort((left, right) => left.displayName.localeCompare(right.displayName)));
        return updatedUser;
      });
  }

  function handleDeleteUser(id: string) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    return fetch(`http://127.0.0.1:4317/api/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "Unable to delete user.");
        }
      })
      .then(() => {
        setUsers((current) => current.filter((entry) => entry.id !== id));
      });
  }

  function handleChangePassword(currentPassword: string, newPassword: string) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    setSettingsError("");
    return fetch("http://127.0.0.1:4317/api/auth/password", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error ?? "Unable to change password.");
        }
      })
      .catch((reason: Error) => {
        setSettingsError(reason.message);
        throw reason;
      });
  }

  if (!user) {
    return <LoginScreen form={loginForm} error={loginError || error} isSigningIn={isSigningIn} onChange={setLoginForm} onSubmit={handleLogin} />;
  }

  const canManageInventory = user.role === "admin" || user.role === "pharmacist";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <div><strong>APOTHECA</strong><span>Retail pharmacy operations</span></div>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button className={`nav-item ${activeNav === label ? "active" : ""}`} key={label} onClick={() => setActiveNav(label)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Inventory" && <span className="nav-count">{dashboard?.metrics.product_count ?? "--"}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user.role === "admin" && <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} onClick={() => setActiveNav("Settings")}><Settings2 size={18} strokeWidth={1.8} /><span>Settings</span></button>}
          <div className="sync-status"><span className="status-dot" />Local database connected<span className="sync-detail">Sync ready</span></div>
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <div><p className="eyebrow">Monday, 18 September 2026</p><h1>{activeNav}</h1></div>
          <div className="account-actions"><div className="user-chip"><span className="avatar">{user.displayName.charAt(0)}</span><span><strong>{user.displayName}</strong><small>{user.role}</small></span></div><button className="sign-out" onClick={handleLogout}>Sign out</button>{canManageInventory && (activeNav === "Overview" || activeNav === "Inventory") && <button className="primary-action" onClick={() => setIsReceiveOpen(true)}><Plus size={17} /> Receive stock</button>}</div>
        </header>
        {error ? <div className="error-banner"><AlertTriangle size={18} />{error}</div> : null}
        <div className="content-scroll"><PageContent activeNav={activeNav} dashboard={dashboard} products={products} expenses={expenses} history={history} reportSummary={reportSummary} searchQuery={searchQuery} onSearchChange={setSearchQuery} user={user} users={users} onDeleteProduct={handleDeleteProduct} onEditProduct={openProductEditor} onCompleteSale={handleCompleteSale} onAddExpense={handleAddExpense} onCreateUser={handleCreateUser} onUpdateUser={handleUpdateUser} onDeleteUser={handleDeleteUser} onChangePassword={handleChangePassword} settingsError={settingsError} saleError={saleError} /></div>
      </section>
      {isReceiveOpen && <ReceiveStockModal form={receiveForm} error={receiveError} isEditing={Boolean(editingProduct)} onChange={setReceiveForm} onClose={() => { setIsReceiveOpen(false); setEditingProduct(null); }} onSubmit={editingProduct ? handleEditProduct : handleReceiveStock} />}
    </main>
  );
}

function PageContent({ activeNav, dashboard, products, expenses, history, reportSummary, searchQuery, onSearchChange, user, users, onDeleteProduct, onEditProduct, onCompleteSale, onAddExpense, onCreateUser, onUpdateUser, onDeleteUser, onChangePassword, settingsError, saleError }: { activeNav: string; dashboard: Dashboard | null; products: Product[]; expenses: Expense[]; history: HistoryEntry[]; reportSummary: ReportSummary; searchQuery: string; onSearchChange: (query: string) => void; user: User; users: User[]; onDeleteProduct: (product: Product) => void; onEditProduct: (product: Product) => void; onCompleteSale: (items: Array<{ productId: string; quantity: number }>) => Promise<unknown>; onAddExpense: (expense: { category: string; description: string; amount: number; expenseDate: string }) => Promise<unknown>; onCreateUser: (user: NewUserInput) => Promise<unknown>; onUpdateUser: (id: string, user: Partial<NewUserInput> & { username: string; displayName: string; role: User["role"] }) => Promise<unknown>; onDeleteUser: (id: string) => Promise<unknown>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<unknown>; settingsError: string; saleError: string }) {
  if (activeNav === "Inventory") return <InventoryPage products={products} onDeleteProduct={onDeleteProduct} onEditProduct={onEditProduct} />;
  if (activeNav === "Point of sale") return <SalesPage products={products} onCompleteSale={onCompleteSale} error={saleError} />;
  if (activeNav === "Stock history") return <HistoryPage history={history} />;
  if (activeNav === "Expenses") return <ExpensesPage expenses={expenses} onAddExpense={onAddExpense} />;
  if (activeNav === "Reports") return <ReportsPage dashboard={dashboard} summary={reportSummary} />;
  if (activeNav === "Settings") return <SettingsPage user={user} users={users} onCreateUser={onCreateUser} onUpdateUser={onUpdateUser} onDeleteUser={onDeleteUser} onChangePassword={onChangePassword} error={settingsError} />;
  return <OverviewPage dashboard={dashboard} searchQuery={searchQuery} onSearchChange={onSearchChange} />;
}

function OverviewPage({ dashboard, searchQuery, onSearchChange }: { dashboard: Dashboard | null; searchQuery: string; onSearchChange: (query: string) => void }) {
  const visibleProducts = (dashboard?.products ?? []).filter((product) => `${product.name} ${product.sku} ${product.strength}`.toLowerCase().includes(searchQuery.toLowerCase()));
  return <><section className="intro-row"><div><h2>Good morning, operator.</h2><p>Here is the pulse of your pharmacy today.</p></div><div className="quick-search"><PackageSearch size={18} /><input aria-label="Search inventory" placeholder="Search inventory" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} /></div></section><section className="metric-grid"><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="teal" /><MetricCard label="Products tracked" value={(dashboard?.metrics.product_count ?? 0).toString()} detail="Across all categories" icon={<Activity />} accent="ochre" /><MetricCard label="Low stock" value={(dashboard?.metrics.low_stock_count ?? 0).toString()} detail="Need your attention" icon={<AlertTriangle />} accent="coral" /><MetricCard label="Expiring soon" value={(dashboard?.metrics.expiring_count ?? 0).toString()} detail="Within 30 days" icon={<Receipt />} accent="plum" /></section><section className="work-grid"><div className="panel attention-panel"><PanelHeading eyebrow="Needs attention" title="Inventory watchlist" /><ProductTable products={visibleProducts} /></div><div className="panel activity-panel"><PanelHeading eyebrow="Coming next" title="Daily rhythm" /><div className="rhythm-list"><RhythmItem time="Today" title={`${dashboard?.metrics.units_sold_today ?? 0} items sold`} detail={`${dashboard?.metrics.sales_count_today ?? 0} completed sales`} /><RhythmItem time="08:00" title="Opening stock check" detail="Inventory review" /><RhythmItem time="16:00" title="Expiry review" detail="Check priority batches" /></div><div className="tip-card"><span>FIELD NOTE</span><p>Keep batch receiving and sales in one continuous audit trail.</p></div></div></section></>;
}

function InventoryPage({ products, onDeleteProduct, onEditProduct }: { products: Product[]; onDeleteProduct: (product: Product) => void; onEditProduct: (product: Product) => void }) {
  return <><section className="page-intro"><div><p className="eyebrow">Stock control</p><h2>Inventory catalogue</h2><p>Track quantities, reorder points, and expiry dates across every medicine.</p></div><div className="metric-inline"><strong>{products.length}</strong><span>Products listed</span></div></section><div className="panel full-panel"><ProductTable products={products} showCategory onDeleteProduct={onDeleteProduct} onEditProduct={onEditProduct} /></div></>;
}

function SalesPage({ products, onCompleteSale, error }: { products: Product[]; onCompleteSale: (items: Array<{ productId: string; quantity: number }>) => Promise<unknown>; error: string }) {
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [completed, setCompleted] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const total = cart.reduce((sum, line) => sum + (line.product.selling_price_cents ?? 0) * line.quantity, 0);

  function addToSale(product: Product) {
    setCompleted(false);
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: Math.min(line.quantity + 1, product.stock) } : line);
      return [...current, { product, quantity: 1 }];
    });
  }

  function completeSale() {
    if (!cart.length) return;
    setIsCompleting(true);
    onCompleteSale(cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })))
      .then(() => {
        setCart([]);
        setCompleted(true);
      })
      .catch(() => undefined)
      .finally(() => setIsCompleting(false));
  }

  return <><section className="page-intro"><div><p className="eyebrow">Counter workspace</p><h2>Point of sale</h2><p>Start a sale by selecting an in-stock medicine.</p></div><div className="sale-total"><span>Current sale</span><strong>{currency.format(total / 100)}</strong></div></section><section className="work-grid"><div className="panel sale-panel"><PanelHeading eyebrow="Available now" title="Choose a product" /><div className="product-picker">{products.filter((product) => product.stock > 0).slice(0, 8).map((product) => <button className="product-option" key={product.id} onClick={() => addToSale(product)}><span><strong>{product.name}</strong><small>{product.strength} {product.dosage_form} · {product.stock} in stock</small></span><b>{currency.format((product.selling_price_cents ?? 0) / 100)}</b></button>)}{!products.length && <div className="empty-state"><ShoppingCart size={24} /><p>No products available yet.</p></div>}</div></div><div className="panel sale-summary"><PanelHeading eyebrow="Transaction" title="Sale summary" />{completed ? <div className="sale-confirmation"><span className="confirmation-mark">✓</span><h3>Sale recorded</h3><p>The sale was saved and today's rhythm has been updated.</p></div> : cart.length ? <div className="sale-cart"><div>{cart.map((line) => <div className="sale-line" key={line.product.id}><div><strong>{line.product.name}</strong><small>{line.quantity} × {currency.format((line.product.selling_price_cents ?? 0) / 100)}</small></div><span>{currency.format(((line.product.selling_price_cents ?? 0) * line.quantity) / 100)}</span><button onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))} aria-label={`Remove ${line.product.name}`}>×</button></div>)}</div>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<div className="sale-cart-footer"><strong>Total</strong><strong>{currency.format(total / 100)}</strong><button className="primary-action" onClick={completeSale} disabled={isCompleting}>{isCompleting ? "Saving sale..." : "Complete sale"}</button></div></div> : <div className="empty-state"><Receipt size={24} /><p>Your sale is empty.</p><span>Select a product to begin.</span></div>}</div></section></>;
}

function HistoryPage({ history }: { history: HistoryEntry[] }) {
  return <><section className="page-intro"><div><p className="eyebrow">Audit trail</p><h2>Stock history</h2><p>Recent completed sales and inventory movement records.</p></div></section><div className="panel full-panel"><div className="table-wrap"><table><thead><tr><th>Medicine</th><th>Event</th><th>Quantity</th><th>Recorded</th><th>Payment</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td><span className="pill warning">Sale</span></td><td>-{entry.quantity}</td><td>{entry.sold_at}</td><td>{entry.payment_method}</td></tr>)}</tbody></table>{!history.length && <div className="empty-state"><ClipboardList size={24} /><p>No stock movements recorded.</p></div>}</div></div></>;
}

function ExpensesPage({ expenses, onAddExpense }: { expenses: Expense[]; onAddExpense: (expense: { category: string; description: string; amount: number; expenseDate: string }) => Promise<unknown> }) {
  const [form, setForm] = useState({ category: "Supplies", description: "", amount: "", expenseDate: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    onAddExpense({ ...form, amount: Number(form.amount), expenseDate: form.expenseDate }).then(() => setForm({ ...form, description: "", amount: "" })).catch((reason: Error) => setError(reason.message));
  }
  return <><section className="page-intro"><div><p className="eyebrow">Operating costs</p><h2>Expenses</h2><p>Keep rent, salaries, transport, and other pharmacy costs in view.</p></div></section><div className="metric-grid"><MetricCard label="Recorded total" value={currency.format(total)} detail="All saved expenses" icon={<Wallet />} accent="coral" /><MetricCard label="Entries" value={String(expenses.length)} detail="Saved locally" icon={<Receipt />} accent="ochre" /></div><section className="work-grid"><form className="panel expense-form" onSubmit={submit}><div className="panel-heading"><div><p className="eyebrow">New record</p><h3>Add expense</h3></div></div><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Supplies</option><option>Rent</option><option>Utilities</option><option>Salaries</option><option>Transport</option><option>Taxes</option><option>Other</option></select></label><label>Description<input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Amount<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>Date<input required type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-action" type="submit"><Plus size={17} /> Save expense</button></form><div className="panel full-panel"><PanelHeading eyebrow="Saved locally" title="Recent expenses" /><div className="table-wrap"><table><thead><tr><th>Category</th><th>Description</th><th>Date</th><th>Amount</th></tr></thead><tbody>{expenses.slice(0, 10).map((expense) => <tr key={expense.id}><td><span className="pill info">{expense.category}</span></td><td>{expense.description}</td><td>{expense.expense_date}</td><td><strong>{currency.format(expense.amount)}</strong></td></tr>)}</tbody></table>{!expenses.length && <div className="empty-state"><Wallet size={24} /><p>No expenses recorded for this period.</p></div>}</div></div></section></>;
}

function SettingsPage({ user, users, onCreateUser, onUpdateUser, onDeleteUser, onChangePassword, error }: { user: User; users: User[]; onCreateUser: (user: NewUserInput) => Promise<unknown>; onUpdateUser: (id: string, user: Partial<NewUserInput> & { username: string; displayName: string; role: User["role"] }) => Promise<unknown>; onDeleteUser: (id: string) => Promise<unknown>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<unknown>; error: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState("");
  const [newUser, setNewUser] = useState<NewUserInput>({ username: "", displayName: "", password: "", role: "cashier" });
  const [newUserConfirm, setNewUserConfirm] = useState("");
  const [newUserSaved, setNewUserSaved] = useState(false);
  const [newUserError, setNewUserError] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<NewUserInput> & { username: string; displayName: string; role: User["role"] }>({ username: "", displayName: "", role: "cashier" });
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordConfirm, setEditPasswordConfirm] = useState("");
  const [editUserError, setEditUserError] = useState("");
  const [editUserSaved, setEditUserSaved] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setFormError("");
    if (newPassword !== confirmation) {
      setFormError("New passwords do not match.");
      return;
    }
    onChangePassword(currentPassword, newPassword).then(() => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSaved(true);
    }).catch(() => undefined);
  }

  function submitNewUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewUserError("");
    setNewUserSaved(false);
    if (newUser.password !== newUserConfirm) {
      setNewUserError("Passwords do not match.");
      return;
    }
    onCreateUser(newUser).then(() => {
      setNewUser({ username: "", displayName: "", password: "", role: "cashier" });
      setNewUserConfirm("");
      setNewUserSaved(true);
    }).catch((reason: Error) => setNewUserError(reason.message));
  }

  function startEditUser(entry: User) {
    setEditingUserId(entry.id);
    setEditDraft({ username: entry.username, displayName: entry.displayName, role: entry.role });
    setEditPassword("");
    setEditPasswordConfirm("");
    setEditUserError("");
    setEditUserSaved(false);
  }

  function submitEditUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUserId) return;
    setEditUserError("");
    setEditUserSaved(false);
    if (editPassword && editPassword !== editPasswordConfirm) {
      setEditUserError("Passwords do not match.");
      return;
    }
    const payload = {
      username: editDraft.username,
      displayName: editDraft.displayName,
      role: editDraft.role,
      ...(editPassword ? { password: editPassword } : {}),
    };
    onUpdateUser(editingUserId, payload).then(() => {
      setEditingUserId(null);
      setEditDraft({ username: "", displayName: "", role: "cashier" });
      setEditPassword("");
      setEditPasswordConfirm("");
      setEditUserSaved(true);
    }).catch((reason: Error) => setEditUserError(reason.message));
  }

  function deleteUser(entry: User) {
    if (!window.confirm(`Delete ${entry.displayName} (${entry.username})?`)) return;
    onDeleteUser(entry.id).catch((reason: Error) => setEditUserError(reason.message));
  }

  return <><section className="page-intro"><div><p className="eyebrow">Workspace administration</p><h2>Settings</h2><p>Manage your local account and security preferences.</p></div></section><section className="settings-grid"><div className="panel account-panel"><PanelHeading eyebrow="Signed in account" title="Account details" /><div className="account-detail"><span className="avatar large-avatar">{user.displayName.charAt(0)}</span><div><strong>{user.displayName}</strong><span>{user.username}</span><small>{user.role} access</small></div></div><div className="settings-note"><Settings2 size={18} /><p>This pharmacy workspace stores its data locally on this computer.</p></div></div><form className="panel password-form" onSubmit={submit}><PanelHeading eyebrow="Security" title="Change password" /><label>Current password<input required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirm new password<input required minLength={8} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{(error || formError) && <div className="login-error"><AlertTriangle size={16} />{error || formError}</div>}{saved && <div className="save-confirmation">Password changed successfully.</div>}<button className="primary-action" type="submit">Save password</button></form>{user.role === "admin" && <div className="panel user-panel"><PanelHeading eyebrow="Access control" title="Add user" /><form className="user-form" onSubmit={submitNewUser}><label>Username<input required value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} /></label><label>Display name<input required value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} /></label><label>Role<select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as User["role"] }))}><option value="admin">Admin</option><option value="pharmacist">Pharmacist</option><option value="cashier">Cashier</option></select></label><label>Password<input required type="password" minLength={8} value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} /></label><label>Confirm password<input required type="password" minLength={8} value={newUserConfirm} onChange={(event) => setNewUserConfirm(event.target.value)} /></label>{newUserError && <div className="login-error"><AlertTriangle size={16} />{newUserError}</div>}{newUserSaved && <div className="save-confirmation">User created successfully.</div>}<button className="primary-action" type="submit">Create user</button></form><div className="user-list"><h4>Current users</h4><ul>{users.length ? users.map((entry) => <li key={entry.id}><div><span>{entry.displayName}</span><small>{entry.username} · {entry.role}</small></div>{entry.id !== user.id && <div className="row-actions"><button className="edit-button" onClick={() => startEditUser(entry)}>Edit</button><button className="remove-button" onClick={() => deleteUser(entry)}>Delete</button></div>}</li>) : <li>No other users yet.</li>}</ul></div>{editingUserId && <form className="user-form edit-user-form" onSubmit={submitEditUser}><h4>Edit user</h4><label>Username<input required value={editDraft.username} onChange={(event) => setEditDraft((current) => ({ ...current, username: event.target.value }))} /></label><label>Display name<input required value={editDraft.displayName} onChange={(event) => setEditDraft((current) => ({ ...current, displayName: event.target.value }))} /></label><label>Role<select value={editDraft.role} onChange={(event) => setEditDraft((current) => ({ ...current, role: event.target.value as User["role"] }))}><option value="admin">Admin</option><option value="pharmacist">Pharmacist</option><option value="cashier">Cashier</option></select></label><label>New password (optional)<input type="password" minLength={8} value={editPassword} onChange={(event) => setEditPassword(event.target.value)} /></label><label>Confirm password<input type="password" minLength={8} value={editPasswordConfirm} onChange={(event) => setEditPasswordConfirm(event.target.value)} /></label>{editUserError && <div className="login-error"><AlertTriangle size={16} />{editUserError}</div>}{editUserSaved && <div className="save-confirmation">User updated successfully.</div>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setEditingUserId(null)}>Cancel</button><button className="primary-action" type="submit">Save changes</button></div></form>}</div>}</section></>;
}

function ReportsPage({ dashboard, summary }: { dashboard: Dashboard | null; summary: ReportSummary }) {
  const net = summary.revenue - summary.expenses;
  return <><section className="page-intro"><div><p className="eyebrow">Business intelligence</p><h2>Reports</h2><p>Saved sales, expense, and inventory measures from this local workspace.</p></div><span className="report-period">All time</span></section><section className="metric-grid"><MetricCard label="Revenue" value={currency.format(summary.revenue / 100)} detail={`${summary.transactions} transactions`} icon={<Receipt />} accent="teal" /><MetricCard label="Expenses" value={currency.format(summary.expenses / 100)} detail="Saved operating costs" icon={<Wallet />} accent="coral" /><MetricCard label="Net position" value={currency.format(net / 100)} detail={`${summary.unitsSold} units sold`} icon={<Activity />} accent="ochre" /><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="plum" /></section><div className="panel full-panel report-placeholder"><Activity size={26} /><h3>Performance snapshot</h3><p>Revenue minus recorded expenses currently equals {currency.format(net / 100)}.</p></div></>;
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div></div>;
}

function ProductTable({ products, showCategory = false, onDeleteProduct, onEditProduct }: { products: Product[]; showCategory?: boolean; onDeleteProduct?: (product: Product) => void; onEditProduct?: (product: Product) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Medicine</th><th>SKU</th>{showCategory && <th>Category</th>}<th>On hand</th><th>Expiry</th><th>Status</th>{(onEditProduct || onDeleteProduct) && <th>Action</th>}</tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><span className="table-subtitle">{product.strength} {product.dosage_form}</span></td><td>{product.sku}</td>{showCategory && <td>{product.category || "General"}</td>}<td><strong>{product.stock}</strong><span className="table-subtitle">Reorder at {product.reorder_level}</span></td><td>{product.expiry_date || "No date"}</td><td><span className={`pill ${product.stock <= product.reorder_level ? "warning" : "info"}`}>{product.stock <= product.reorder_level ? "Low stock" : "Healthy"}</span></td>{(onEditProduct || onDeleteProduct) && <td className="row-actions">{onEditProduct && <button className="edit-button" onClick={() => onEditProduct(product)}>Edit</button>}{onDeleteProduct && <button className="remove-button" onClick={() => onDeleteProduct(product)}>Remove</button>}</td>}</tr>)}</tbody></table>{!products.length && <div className="empty-state"><PackageSearch size={24} /><p>No products found.</p></div>}</div>;
}

function ReceiveStockModal({ form, error, isEditing, onChange, onClose, onSubmit }: { form: { sku: string; name: string; dosageForm: string; strength: string; category: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }; error: string; isEditing: boolean; onChange: (form: { sku: string; name: string; dosageForm: string; strength: string; category: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }) => void; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const field = (name: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...form, [name]: event.target.value });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="receive-stock-title"><div className="modal-heading"><div><p className="eyebrow">{isEditing ? "Stock details" : "Inventory intake"}</p><h2 id="receive-stock-title">{isEditing ? "Edit inventory item" : "Receive stock"}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button></div><form className="stock-form" onSubmit={onSubmit}><label>Medicine name<input required value={form.name} onChange={field("name")} /></label><label>SKU<input required value={form.sku} onChange={field("sku")} /></label><label>Dosage form<select value={form.dosageForm} onChange={field("dosageForm")}><option>Tablet</option><option>Capsule</option><option>Syrup</option><option>Cream</option><option>Injection</option></select></label><label>Strength<input value={form.strength} onChange={field("strength")} placeholder="e.g. 500 mg" /></label><label>Category<input value={form.category} onChange={field("category")} placeholder="e.g. Antibiotics" /></label><label>{isEditing ? "Quantity on hand" : "Quantity received"}<input required min="1" type="number" value={form.stock} onChange={field("stock")} /></label><label>Reorder level<input min="0" type="number" value={form.reorderLevel} onChange={field("reorderLevel")} /></label><label>Purchase price<input min="0" step="0.01" type="number" value={form.purchasePriceCents} onChange={field("purchasePriceCents")} /></label><label>Selling price<input min="0" step="0.01" type="number" value={form.sellingPriceCents} onChange={field("sellingPriceCents")} /></label><label>Expiry date<input type="date" value={form.expiryDate} onChange={field("expiryDate")} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" type="submit">{isEditing ? "Save changes" : "Save stock"}</button></div></form></section></div>;
}

function MetricCard({ label, value, detail, icon, accent }: { label: string; value: string; detail: string; icon: React.ReactNode; accent: string }) {
  return <article className={`metric-card ${accent}`}><div className="metric-icon">{icon}</div><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}
function RhythmItem({ time, title, detail }: { time: string; title: string; detail: string }) {
  return <div className="rhythm-item"><time>{time}</time><div><strong>{title}</strong><span>{detail}</span></div><span className="rhythm-line" /></div>;
}

function LoginScreen({ form, error, isSigningIn, onChange, onSubmit }: { form: { username: string; password: string }; error: string; isSigningIn: boolean; onChange: (form: { username: string; password: string }) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <main className="login-shell"><section className="login-panel"><div className="brand-lockup login-brand"><div className="brand-mark">A</div><div><strong>APOTHECA</strong><span>Retail pharmacy operations</span></div></div><div className="login-copy"><p className="eyebrow">Secure workspace</p><h1>Welcome back.</h1><p>Sign in to continue to your pharmacy workspace.</p></div><form className="login-form" onSubmit={onSubmit}><label>Username<input required autoComplete="username" value={form.username} onChange={(event) => onChange({ ...form, username: event.target.value })} /></label><label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-action login-submit" disabled={isSigningIn}>{isSigningIn ? "Signing in..." : "Sign in"}</button></form><p className="login-note">Use your assigned account to access the right tools for your role.</p></section></main>;
}
