import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Boxes, CalendarDays, ClipboardList, Download, FileDown, LayoutDashboard, PackageSearch, Plus, Receipt, ScanLine, Settings2, ShoppingCart, Wallet } from "lucide-react";

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
    generic_name?: string;
    manufacturer?: string;
    barcode?: string;
    batch_number?: string;
    supplier?: string;
    dosage_form: string;
    strength: string;
    stock: number;
    reorder_level: number;
    expiry_date: string;
    received_date?: string;
    pack_size?: string;
    storage_location?: string;
    storage_condition?: string;
    invoice_reference?: string;
  }>;
};

type Product = Dashboard["products"][number] & {
  category?: string;
  purchase_price_cents?: number;
  selling_price_cents?: number;
};

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;

type Expense = {
  id: number;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
};

type ReportSummary = { revenue: number; expenses: number; unitsSold: number; transactions: number };
type SalesPeriod = { period: string; revenue: number; unitsSold: number; transactions: number };
type SalesReport = { period: "daily" | "monthly"; periods: SalesPeriod[] };
type HistoryEntry = { id: number; name: string; quantity: number; sold_at: string; payment_method: string };
type MobileMoneyProvider = { id: string; name: string; code: string; status: string; api_base_url: string };

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
  const [salesReport, setSalesReport] = useState<SalesReport>({ period: "daily", periods: [] });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [mobileMoneyProviders, setMobileMoneyProviders] = useState<MobileMoneyProvider[]>([]);
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
  const emptyReceiveForm = { sku: "", name: "", genericName: "", manufacturer: "", barcode: "", batchNumber: "", dosageForm: "Tablet", strength: "", category: "", supplier: "", receivedDate: new Date().toISOString().slice(0, 10), packSize: "", storageLocation: "", storageCondition: "Room temperature", invoiceReference: "", stock: "", reorderLevel: "5", purchasePriceCents: "", sellingPriceCents: "", expiryDate: "" };
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
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
    if (role === "admin") {
      fetch("http://127.0.0.1:4317/api/expenses", { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => response.json())
        .then(setExpenses)
        .catch(() => setExpenses([]));
    } else {
      setExpenses([]);
    }
    if (role === "admin") {
      fetch("http://127.0.0.1:4317/api/reports/summary", { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => response.json())
        .then(setReportSummary)
        .catch(() => setReportSummary({ revenue: 0, expenses: 0, unitsSold: 0, transactions: 0 }));
      fetch("http://127.0.0.1:4317/api/reports/sales?period=daily", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setSalesReport)
      .catch(() => setSalesReport({ period: "daily", periods: [] }));
    } else {
      setReportSummary({ revenue: 0, expenses: 0, unitsSold: 0, transactions: 0 });
      setSalesReport({ period: "daily", periods: [] });
    }
    fetch("http://127.0.0.1:4317/api/history", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setHistory)
      .catch(() => setHistory([]));
    fetch("http://127.0.0.1:4317/api/mobile-money/providers", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then(setMobileMoneyProviders)
      .catch(() => setMobileMoneyProviders([]));
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
        setReceiveForm({ ...emptyReceiveForm });
        loadDashboard(token);
      })
      .catch((reason: Error) => setReceiveError(reason.message));
  }

  function openProductEditor(product: Product) {
    setEditingProduct(product);
    setReceiveError("");
    setReceiveForm({ sku: product.sku, name: product.name, genericName: product.generic_name ?? "", manufacturer: product.manufacturer ?? "", barcode: product.barcode ?? "", batchNumber: product.batch_number ?? "", dosageForm: product.dosage_form, strength: product.strength, category: product.category ?? "", supplier: product.supplier ?? "", receivedDate: product.received_date ?? "", packSize: product.pack_size ?? "", storageLocation: product.storage_location ?? "", storageCondition: product.storage_condition ?? "", invoiceReference: product.invoice_reference ?? "", stock: String(product.stock), reorderLevel: String(product.reorder_level), purchasePriceCents: String((product.purchase_price_cents ?? 0) / 100), sellingPriceCents: String((product.selling_price_cents ?? 0) / 100), expiryDate: product.expiry_date ?? "" });
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

  function handleCompleteSale(
    items: Array<{ productId: string; quantity: number }>,
    paymentMethod: string,
    providerCode?: string,
    phoneNumber?: string,
  ) {
    const token = localStorage.getItem("apotheca_token");
    if (!token) return Promise.reject(new Error("Your session has expired."));
    setSaleError("");
    return fetch("http://127.0.0.1:4317/api/sales", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items, paymentMethod, providerCode, phoneNumber }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to complete sale.");
        return payload;
      })
      .then((result) => {
        loadDashboard(token, user?.role);
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
  const canEditInventory = user.role === "admin";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <div><strong>APOTHECA</strong><span>Retail pharmacy operations</span></div>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.filter(({ label }) => !["Expenses", "Reports"].includes(label) || user.role === "admin").map(({ label, icon: Icon }) => (
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
          <div className="account-actions"><div className="user-chip"><span className="avatar">{user.displayName.charAt(0)}</span><span><strong>{user.displayName}</strong><small>{user.role}</small></span></div><button className="sign-out" onClick={handleLogout}>Sign out</button>{canManageInventory && (activeNav === "Overview" || activeNav === "Inventory") && <button className="receive-stock-action" onClick={() => setIsReceiveOpen(true)}><span className="receive-stock-icon"><Plus size={16} /></span><span><strong>Receive stock</strong><small>Add inventory record</small></span></button>}</div>
        </header>
        {error ? <div className="error-banner"><AlertTriangle size={18} />{error}</div> : null}
        <div className="content-scroll"><PageContent activeNav={activeNav} dashboard={dashboard} products={products} expenses={expenses} history={history} reportSummary={reportSummary} salesReport={salesReport} searchQuery={searchQuery} onSearchChange={setSearchQuery} user={user} users={users} mobileMoneyProviders={mobileMoneyProviders} onDeleteProduct={canEditInventory ? handleDeleteProduct : undefined} onEditProduct={canEditInventory ? openProductEditor : undefined} onCompleteSale={handleCompleteSale} onAddExpense={handleAddExpense} onCreateUser={handleCreateUser} onUpdateUser={handleUpdateUser} onDeleteUser={handleDeleteUser} onChangePassword={handleChangePassword} settingsError={settingsError} saleError={saleError} /></div>
      </section>
      {isReceiveOpen && <ReceiveStockModal form={receiveForm} error={receiveError} isEditing={Boolean(editingProduct)} onChange={setReceiveForm} onClose={() => { setIsReceiveOpen(false); setEditingProduct(null); }} onSubmit={editingProduct ? handleEditProduct : handleReceiveStock} />}
    </main>
  );
}

function PageContent({ activeNav, dashboard, products, expenses, history, reportSummary, salesReport, searchQuery, onSearchChange, user, users, mobileMoneyProviders, onDeleteProduct, onEditProduct, onCompleteSale, onAddExpense, onCreateUser, onUpdateUser, onDeleteUser, onChangePassword, settingsError, saleError }: { activeNav: string; dashboard: Dashboard | null; products: Product[]; expenses: Expense[]; history: HistoryEntry[]; reportSummary: ReportSummary; salesReport: SalesReport; searchQuery: string; onSearchChange: (query: string) => void; user: User; users: User[]; mobileMoneyProviders: MobileMoneyProvider[]; onDeleteProduct?: (product: Product) => void; onEditProduct?: (product: Product) => void; onCompleteSale: (items: Array<{ productId: string; quantity: number }>, paymentMethod: string, providerCode?: string, phoneNumber?: string) => Promise<unknown>; onAddExpense: (expense: { category: string; description: string; amount: number; expenseDate: string }) => Promise<unknown>; onCreateUser: (user: NewUserInput) => Promise<unknown>; onUpdateUser: (id: string, user: Partial<NewUserInput> & { username: string; displayName: string; role: User["role"] }) => Promise<unknown>; onDeleteUser: (id: string) => Promise<unknown>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<unknown>; settingsError: string; saleError: string }) {
  if (activeNav === "Inventory") return <InventoryPage products={products} onDeleteProduct={onDeleteProduct} onEditProduct={onEditProduct} />;
  if (activeNav === "Point of sale") return <SalesPage products={products} mobileMoneyProviders={mobileMoneyProviders} onCompleteSale={onCompleteSale} error={saleError} />;
  if (activeNav === "Stock history") return <HistoryPage history={history} />;
  if (activeNav === "Expenses" && user.role === "admin") return <ExpensesPage expenses={expenses} onAddExpense={onAddExpense} />;
  if (activeNav === "Reports" && user.role === "admin") return <ReportsPage dashboard={dashboard} summary={reportSummary} initialSalesReport={salesReport} />;
  if (activeNav === "Settings") return <SettingsPage user={user} users={users} onCreateUser={onCreateUser} onUpdateUser={onUpdateUser} onDeleteUser={onDeleteUser} onChangePassword={onChangePassword} error={settingsError} />;
  return <OverviewPage dashboard={dashboard} searchQuery={searchQuery} onSearchChange={onSearchChange} />;
}

function OverviewPage({ dashboard, searchQuery, onSearchChange }: { dashboard: Dashboard | null; searchQuery: string; onSearchChange: (query: string) => void }) {
  const visibleProducts = (dashboard?.products ?? []).filter((product) => `${product.name} ${product.sku} ${product.strength}`.toLowerCase().includes(searchQuery.toLowerCase()));
  return <><section className="overview-hero"><div className="overview-welcome"><p className="eyebrow">Daily overview</p><h2>Good morning, operator.</h2><p>Here is the pulse of your pharmacy today. Start with the items that need your attention.</p></div><div className="overview-search"><span className="search-label">Find in inventory</span><div className="quick-search"><PackageSearch size={18} /><input aria-label="Search inventory" placeholder="Medicine, SKU, barcode, or batch" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} /></div></div></section><section className="overview-section"><div className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Today's operations</h3></div><span className="section-caption">Live local snapshot</span></div><section className="metric-grid"><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="teal" /><MetricCard label="Products tracked" value={(dashboard?.metrics.product_count ?? 0).toString()} detail="Across all categories" icon={<Activity />} accent="ochre" /><MetricCard label="Low stock" value={(dashboard?.metrics.low_stock_count ?? 0).toString()} detail="Need your attention" icon={<AlertTriangle />} accent="coral" /><MetricCard label="Expiring soon" value={(dashboard?.metrics.expiring_count ?? 0).toString()} detail="Within 30 days" icon={<Receipt />} accent="plum" /></section></section><section className="overview-section"><div className="section-heading"><div><p className="eyebrow">Daily workflow</p><h3>Keep the counter moving</h3></div></div><section className="work-grid"><div className="panel attention-panel"><PanelHeading eyebrow="Needs attention" title="Inventory watchlist" /><ProductTable products={visibleProducts} /></div>  <div className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Coming next</p><h3>Daily rhythm</h3><span className="panel-supporting-copy">A simple sequence for the counter team.</span></div><span className="today-badge">Today</span></div><div className="rhythm-list"><RhythmItem time="Now" title={`${dashboard?.metrics.units_sold_today ?? 0} items sold`} detail={`${dashboard?.metrics.sales_count_today ?? 0} completed sales`} /><RhythmItem time="08:00" title="Opening stock check" detail="Review low-stock items before the first rush" /><RhythmItem time="16:00" title="Expiry review" detail="Check priority batches and storage locations" /></div>  <div className="tip-card"><div className="tip-card-header"><span className="tip-mark">✦</span><span>FIELD NOTE</span><span className="tip-rule" /></div><p>Keep batch receiving and sales in one continuous audit trail.</p><div className="tip-next"><span>Next best action</span><strong>Review the inventory watchlist <b>→</b></strong></div></div></div></section></section></>;
}

function InventoryPage({ products, onDeleteProduct, onEditProduct }: { products: Product[]; onDeleteProduct?: (product: Product) => void; onEditProduct?: (product: Product) => void }) {
  const lowStock = products.filter((product) => product.stock <= product.reorder_level).length;
  const expiring = products.filter((product) => product.expiry_date && product.expiry_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length;
  return <><section className="page-intro"><div><p className="eyebrow">Stock control</p><h2>Inventory catalogue</h2><p>Search, review, and maintain every medicine record from one place.</p></div><div className="inventory-summary"><div><strong>{products.length}</strong><span>Total products</span></div><div><strong>{lowStock}</strong><span>Low stock</span></div><div><strong>{expiring}</strong><span>Expiring soon</span></div></div></section><section className="panel inventory-panel"><div className="inventory-toolbar"><div><p className="eyebrow">Master list</p><h3>All inventory</h3><span>Use the details below to identify stock quickly.</span></div><div className="inventory-legend"><span><i className="legend-dot healthy" />Healthy</span><span><i className="legend-dot warning" />Needs attention</span></div></div><ProductTable products={products} showCategory onDeleteProduct={onDeleteProduct} onEditProduct={onEditProduct} /></section></>;
}

function SalesPage({ products, mobileMoneyProviders, onCompleteSale, error }: { products: Product[]; mobileMoneyProviders: MobileMoneyProvider[]; onCompleteSale: (items: Array<{ productId: string; quantity: number }>, paymentMethod: string, providerCode?: string, phoneNumber?: string) => Promise<unknown>; error: string }) {
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [completed, setCompleted] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [providerCode, setProviderCode] = useState(mobileMoneyProviders[0]?.code ?? "mtn");
  const [phoneNumber, setPhoneNumber] = useState("");
  useEffect(() => {
    if (mobileMoneyProviders.length && !mobileMoneyProviders.some((provider) => provider.code === providerCode)) {
      setProviderCode(mobileMoneyProviders[0].code);
    }
  }, [mobileMoneyProviders, providerCode]);
  const total = cart.reduce((sum, line) => sum + (line.product.selling_price_cents ?? 0) * line.quantity, 0);
  const availableProducts = products.filter((product) => {
    if (product.stock <= 0) return false;
    const searchable = `${product.name} ${product.generic_name ?? ""} ${product.manufacturer ?? ""} ${product.sku} ${product.barcode ?? ""} ${product.batch_number ?? ""} ${product.supplier ?? ""} ${product.strength} ${product.category ?? ""} ${product.dosage_form} ${product.storage_location ?? ""}`.toLowerCase();
    return searchable.includes(searchQuery.trim().toLowerCase());
  });

  function addToSale(product: Product) {
    setCompleted(false);
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: Math.min(line.quantity + 1, product.stock) } : line);
      return [...current, { product, quantity: 1 }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) => current.map((line) => {
      if (line.product.id !== productId) return line;
      const nextQuantity = Number.isFinite(quantity) ? Math.floor(quantity) : line.quantity;
      return { ...line, quantity: Math.max(1, Math.min(nextQuantity, line.product.stock)) };
    }));
  }

  function completeSale() {
    if (!cart.length) return;
    setIsCompleting(true);
    onCompleteSale(cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })), paymentMethod, paymentMethod === "Mobile money" ? providerCode : undefined, paymentMethod === "Mobile money" ? phoneNumber : undefined)
      .then(() => {
        setCart([]);
        setCompleted(true);
        setProviderCode(mobileMoneyProviders[0]?.code ?? "mtn");
        setPhoneNumber("");
      })
      .catch(() => undefined)
      .finally(() => setIsCompleting(false));
  }

  return <><section className="pos-hero"><div><p className="eyebrow">Counter workspace</p><h2>Point of sale</h2><p>Start a sale by selecting an in-stock medicine, then review payment details before completing the transaction.</p></div><div className="sale-total"><span>Current sale</span><strong>{currency.format(total / 100)}</strong></div></section><section className="pos-section"><div className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Counter activity</h3></div><span className="section-caption">Ready for the next customer</span></div><section className="metric-grid"><MetricCard label="Current total" value={currency.format(total / 100)} detail={cart.length ? `${cart.length} line items` : "No items selected"} icon={<ShoppingCart />} accent="coral" /><MetricCard label="Products ready" value={String(availableProducts.length)} detail="In-stock products" icon={<Boxes />} accent="teal" /><MetricCard label="Payment mode" value={paymentMethod} detail="Selected for checkout" icon={<Receipt />} accent="ochre" /></section></section><section className="pos-section"><div className="section-heading"><div><p className="eyebrow">Daily workflow</p><h3>Build and complete a sale</h3></div><span className="section-caption">Search, select, review</span></div><section className="work-grid"><div className="panel sale-panel"><div className="panel-heading"><div><p className="eyebrow">Available now</p><h3>Choose a product</h3></div><button className="secondary-action scan-action" onClick={() => setIsScannerOpen(true)}><ScanLine size={15} /> Scan barcode</button></div><div className="pos-search"><PackageSearch size={17} /><input aria-label="Search products for sale" placeholder="Search by medicine, SKU, barcode, strength, or category" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div><div className="product-picker">{availableProducts.slice(0, 8).map((product) => <button className="product-option" key={product.id} onClick={() => addToSale(product)}><span><strong>{product.name}</strong><small>{product.strength} {product.dosage_form} · {product.stock} in stock</small></span><b>{currency.format((product.selling_price_cents ?? 0) / 100)}</b></button>)}{!availableProducts.length && <div className="empty-state"><ShoppingCart size={24} /><p>{searchQuery ? "No matching products found." : "No products available yet."}</p><span>{searchQuery ? "Try a different search term." : "Receive stock before starting a sale."}</span></div>}</div></div><div className="panel sale-summary"><PanelHeading eyebrow="Transaction" title="Sale summary" />{completed ? <div className="sale-confirmation"><span className="confirmation-mark">✓</span><h3>Sale recorded</h3><p>The sale was saved and today's rhythm has been updated.</p></div> : cart.length ? <div className="sale-cart">  <div className="payment-fields">
    <div className="payment-section payment-method-section">
      <div className="payment-section-heading"><span>01</span><div><strong>Payment method</strong><small>How will this sale be paid?</small></div></div>
      <label><span className="sr-only">Payment method</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Cash</option><option>Card</option><option>Mobile money</option></select></label>
    </div>
    {paymentMethod === 'Mobile money' && <div className="payment-section mobile-money-section">
      <div className="payment-section-heading"><span>02</span><div><strong>Mobile money details</strong><small>Select the network and enter the wallet number.</small></div></div>
      <div className="mobile-money-fields">
        <label>Provider<select value={providerCode} onChange={(event) => setProviderCode(event.target.value)}>{mobileMoneyProviders.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}</option>)}</select></label>
        <label>Phone number<input type="tel" inputMode="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="024 000 0000" /></label>
      </div>
    </div>}
  </div><div>{cart.map((line) => <div className="sale-line" key={line.product.id}><div><strong>{line.product.name}</strong><small>{currency.format((line.product.selling_price_cents ?? 0) / 100)} each · {line.product.stock} in stock</small></div><div className="quantity-control" aria-label={`Quantity for ${line.product.name}`}><button type="button" onClick={() => updateQuantity(line.product.id, line.quantity - 1)} disabled={line.quantity <= 1} aria-label={`Decrease ${line.product.name} quantity`}>−</button><input type="number" min="1" max={line.product.stock} value={line.quantity} onChange={(event) => updateQuantity(line.product.id, Number(event.target.value))} aria-label={`${line.product.name} quantity`} /><button type="button" onClick={() => updateQuantity(line.product.id, line.quantity + 1)} disabled={line.quantity >= line.product.stock} aria-label={`Increase ${line.product.name} quantity`}>+</button></div><span>{currency.format(((line.product.selling_price_cents ?? 0) * line.quantity) / 100)}</span><button className="remove-line-button" onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))} aria-label={`Remove ${line.product.name}`}>×</button></div>)}</div>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<div className="sale-cart-footer"><strong>Total</strong><strong>{currency.format(total / 100)}</strong><button className="primary-action" onClick={completeSale} disabled={isCompleting}>{isCompleting ? "Saving sale..." : "Complete sale"}</button></div></div> : <div className="empty-state"><Receipt size={24} /><p>Your sale is empty.</p><span>Select a product to begin.</span></div>}</div></section></section>{isScannerOpen && <BarcodeScanner products={products} onProductFound={(product) => { addToSale(product); setIsScannerOpen(false); }} onClose={() => setIsScannerOpen(false)} />}</>;
}

function BarcodeScanner({ products, onProductFound, onClose }: { products: Product[]; onProductFound: (product: Product) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scannerError, setScannerError] = useState("");
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let active = true;

    async function startScanner() {
      const BarcodeDetector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!BarcodeDetector) {
        setScannerError("Camera barcode scanning is not supported here. Enter a barcode below.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new BarcodeDetector();
        const scan = async () => {
          if (!active || !videoRef.current) return;
          const codes = await detector.detect(videoRef.current);
          const code = codes[0]?.rawValue;
          if (code) {
            const product = products.find((entry) => entry.barcode === code || entry.sku === code);
            if (product) {
              onProductFound(product);
              return;
            }
            setScannerError(`No product matches barcode ${code}. You can search for it manually.`);
          }
          timer = window.setTimeout(scan, 250);
        };
        scan();
      } catch {
        setScannerError("Unable to access the camera. Check camera permission or enter a barcode below.");
      }
    }
    startScanner();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onProductFound, products]);

  function findManualCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const product = products.find((entry) => entry.barcode === manualCode.trim() || entry.sku === manualCode.trim());
    if (product) onProductFound(product);
    else setScannerError("No product matches that barcode or SKU.");
  }

  const hasBarcodeDetector = Boolean((window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-panel scanner-panel" role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title"><div className="modal-heading"><div><p className="eyebrow">Point of sale</p><h2 id="barcode-scanner-title">Scan barcode</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button></div><div className="scanner-view">{hasBarcodeDetector ? <video ref={videoRef} muted playsInline /> : <div className="scanner-unavailable"><ScanLine size={30} /><p>Camera scanning is unavailable in this environment.</p></div>}<span className="scanner-reticle" /></div><p className="scanner-help">Point the camera at a product barcode. Matching products will be added to the current sale.</p><form className="manual-barcode-form" onSubmit={findManualCode}><label>Enter barcode or SKU<input autoFocus value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="e.g. 8901234567890" /></label><button className="primary-action" type="submit">Find product</button></form>{scannerError && <div className="login-error"><AlertTriangle size={16} />{scannerError}</div>}</section></div>;
}

function HistoryPage({ history }: { history: HistoryEntry[] }) {
  const unitsMoved = history.reduce((sum, entry) => sum + entry.quantity, 0);
  const paymentMethods = new Set(history.map((entry) => entry.payment_method)).size;
  return <><section className="history-hero"><div><p className="eyebrow">Audit trail</p><h2>Stock history</h2><p>Follow every recorded inventory movement so the counter team can understand what left the shelves and when.</p></div><div className="history-hero-note"><ClipboardList size={18} /><div><strong>Movement ledger</strong><span>Recent completed sales</span></div></div></section><section className="history-section"><div className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Inventory movement</h3></div><span className="section-caption">Saved local snapshot</span></div><section className="metric-grid"><MetricCard label="Movements" value={String(history.length)} detail="Recorded sale lines" icon={<ClipboardList />} accent="teal" /><MetricCard label="Units moved" value={String(unitsMoved)} detail="Across the ledger" icon={<Boxes />} accent="ochre" /><MetricCard label="Payment types" value={String(paymentMethods)} detail="Methods represented" icon={<Receipt />} accent="coral" /></section></section><section className="history-section"><div className="section-heading"><div><p className="eyebrow">Daily workflow</p><h3>Review the movement ledger</h3></div><span className="section-caption">Most recent first</span></div><div className="panel full-panel history-panel"><div className="panel-heading"><div><p className="eyebrow">Saved locally</p><h3>Recent stock movements</h3><span className="panel-supporting-copy">Sales recorded against medicines and their payment method.</span></div><span className="today-badge">{history.length} total</span></div><div className="table-wrap"><table><thead><tr><th>Medicine</th><th>Event</th><th>Quantity</th><th>Recorded</th><th>Payment</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td><span className="pill warning">Sale</span></td><td>-{entry.quantity}</td><td>{entry.sold_at}</td><td>{entry.payment_method}</td></tr>)}</tbody></table>{!history.length && <div className="empty-state"><ClipboardList size={24} /><p>No stock movements recorded.</p></div>}</div></div></section></>;
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
  return <><section className="expenses-hero"><div><p className="eyebrow">Operating costs</p><h2>Expenses</h2><p>Keep rent, salaries, transport, and other pharmacy costs visible, explainable, and easy to review.</p></div><div className="expenses-hero-note"><Wallet size={18} /><div><strong>Simple records, better decisions</strong><span>Capture each cost while it is fresh.</span></div></div></section><section className="expenses-section"><div className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Cost position</h3></div><span className="section-caption">Saved local snapshot</span></div><section className="metric-grid"><MetricCard label="Recorded total" value={currency.format(total)} detail="All saved expenses" icon={<Wallet />} accent="coral" /><MetricCard label="Entries" value={String(expenses.length)} detail="Saved locally" icon={<Receipt />} accent="ochre" /><MetricCard label="Average entry" value={currency.format(expenses.length ? total / expenses.length : 0)} detail="Per expense record" icon={<Activity />} accent="teal" /></section></section><section className="expenses-section"><div className="section-heading"><div><p className="eyebrow">Daily workflow</p><h3>Record and review costs</h3></div><span className="section-caption">Keep the audit trail current</span></div><section className="work-grid"><form className="panel expense-form" onSubmit={submit}><div className="panel-heading"><div><p className="eyebrow">New record</p><h3>Add expense</h3><p className="form-intro">Capture a cost with enough detail to explain it later.</p></div></div><div className="expense-section"><div className="expense-section-heading"><span>01</span><div><strong>Expense details</strong><small>Classify and describe the cost.</small></div></div><div className="expense-fields"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Supplies</option><option>Rent</option><option>Utilities</option><option>Salaries</option><option>Transport</option><option>Taxes</option><option>Other</option></select></label><label>Description<input required value={form.description} placeholder="e.g. Printer paper and receipt rolls" onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div></div><div className="expense-section"><div className="expense-section-heading"><span>02</span><div><strong>Amount and date</strong><small>Record when the expense happened.</small></div></div><div className="expense-fields expense-fields-split"><label>Amount <span className="field-hint">GHS</span><input required min="0.01" step="0.01" type="number" value={form.amount} placeholder="0.00" onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>Date<input required type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label></div></div>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-action" type="submit"><Plus size={17} /> Save expense</button></form><div className="panel full-panel expense-history-panel"><div className="panel-heading"><div><p className="eyebrow">Saved locally</p><h3>Recent expenses</h3><span className="panel-supporting-copy">A quick view of the latest operating costs.</span></div><span className="today-badge">{expenses.length} total</span></div><div className="table-wrap"><table><thead><tr><th>Category</th><th>Description</th><th>Date</th><th>Amount</th></tr></thead><tbody>{expenses.slice(0, 10).map((expense) => <tr key={expense.id}><td><span className="pill info">{expense.category}</span></td><td>{expense.description}</td><td>{expense.expense_date}</td><td><strong>{currency.format(expense.amount)}</strong></td></tr>)}</tbody></table>{!expenses.length && <div className="empty-state"><Wallet size={24} /><p>No expenses recorded for this period.</p></div>}</div>  </div></section></section></>;
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

  return <><section className="page-intro"><div><p className="eyebrow">Workspace administration</p><h2>Settings</h2><p>Manage your local account and security preferences.</p></div></section><section className="settings-grid">  <div className="panel account-panel"><PanelHeading eyebrow="Signed in account" title="Account details" /><div className="account-section"><div className="account-section-heading"><span>01</span><div><strong>Your identity</strong><small>The account currently signed in to this workspace.</small></div></div><div className="account-detail"><span className="avatar large-avatar">{user.displayName.charAt(0)}</span><div><strong>{user.displayName}</strong><span>{user.username}</span><small>{user.role} access</small></div></div></div><div className="account-section"><div className="account-section-heading"><span>02</span><div><strong>Workspace status</strong><small>How this pharmacy workspace stores and protects data.</small></div></div><div className="settings-note"><Settings2 size={18} /><p>This pharmacy workspace stores its data locally on this computer.</p></div><div className="account-status"><span className="status-dot" /><div><strong>Local database connected</strong><small>Changes are available on this device.</small></div></div></div></div>  <form className="panel password-form" onSubmit={submit}><PanelHeading eyebrow="Security" title="Change password" /><div className="security-intro">Update your password regularly to keep this pharmacy workspace protected.</div><div className="security-section"><div className="security-section-heading"><span>01</span><div><strong>Verify current access</strong><small>Confirm the password you use to sign in.</small></div></div><label>Current password<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label></div><div className="security-section"><div className="security-section-heading"><span>02</span><div><strong>Create new password</strong><small>Use at least 8 characters that are difficult to guess.</small></div></div><label>New password<input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label></div><div className="security-section"><div className="security-section-heading"><span>03</span><div><strong>Confirm change</strong><small>Enter the new password one more time.</small></div></div><label>Confirm new password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label></div>{(error || formError) && <div className="login-error"><AlertTriangle size={16} />{error || formError}</div>}{saved && <div className="save-confirmation">Password changed successfully.</div>}<button className="primary-action" type="submit">Save password</button></form>{user.role === "admin" && <div className="panel user-panel"><PanelHeading eyebrow="Access control" title="Add user" />  <form className="user-form" onSubmit={submitNewUser}><div className="access-section"><div className="access-section-heading"><span>01</span><div><strong>Identity</strong><small>Set the name used across the workspace.</small></div></div><div className="access-fields"><label>Display name<input required value={newUser.displayName} placeholder="e.g. Ama Mensah" onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} /></label><label>Username<input required value={newUser.username} placeholder="e.g. ama.mensah" onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} /></label></div></div><div className="access-section"><div className="access-section-heading"><span>02</span><div><strong>Access level</strong><small>Choose the tools and permissions this person receives.</small></div></div><label>Role<select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as User["role"] }))}><option value="admin">Admin</option><option value="pharmacist">Pharmacist</option><option value="cashier">Cashier</option></select></label></div><div className="access-section"><div className="access-section-heading"><span>03</span><div><strong>Sign-in credentials</strong><small>Use at least 8 characters and keep them private.</small></div></div><div className="access-fields"><label>Password<input required type="password" minLength={8} value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} /></label><label>Confirm password<input required type="password" minLength={8} value={newUserConfirm} onChange={(event) => setNewUserConfirm(event.target.value)} /></label></div></div>{newUserError && <div className="login-error"><AlertTriangle size={16} />{newUserError}</div>}{newUserSaved && <div className="save-confirmation">User created successfully.</div>}<button className="primary-action" type="submit">Create user</button></form>  <div className="user-list"><div className="user-list-heading"><div><p className="eyebrow">Access directory</p><h4>Current users</h4><p>Review who can access this pharmacy workspace and manage their roles.</p></div><span className="user-count">{users.length} {users.length === 1 ? "account" : "accounts"}</span></div><ul>{users.length ? users.map((entry) => <li key={entry.id}><div className="user-identity"><span className="user-avatar">{entry.displayName.charAt(0)}</span><div><span>{entry.displayName}{entry.id === user.id && <em>You</em>}</span><small>{entry.username}</small></div></div><div className="user-row-actions"><span className={`role-badge role-${entry.role}`}>{entry.role}</span>{entry.id !== user.id && <div className="row-actions"><button className="edit-button" onClick={() => startEditUser(entry)}>Edit</button><button className="remove-button" onClick={() => deleteUser(entry)}>Delete</button></div>}</div></li>) : <li className="empty-user-row">No other users yet.</li>}</ul></div>{editingUserId &&   <form className="user-form edit-user-form" onSubmit={submitEditUser}><div className="edit-user-heading"><div><p className="eyebrow">Profile maintenance</p><h4>Edit user</h4><p>Update account details and permissions without changing the rest of the directory.</p></div><button type="button" className="close-button" onClick={() => setEditingUserId(null)} aria-label="Close edit user form">×</button></div><div className="access-section"><div className="access-section-heading"><span>01</span><div><strong>Identity</strong><small>Keep the account name and sign-in handle accurate.</small></div></div><div className="access-fields"><label>Display name<input required value={editDraft.displayName} onChange={(event) => setEditDraft((current) => ({ ...current, displayName: event.target.value }))} /></label><label>Username<input required value={editDraft.username} onChange={(event) => setEditDraft((current) => ({ ...current, username: event.target.value }))} /></label></div></div><div className="access-section"><div className="access-section-heading"><span>02</span><div><strong>Access level</strong><small>Changing this role changes the tools available to the user.</small></div></div><label>Role<select value={editDraft.role} onChange={(event) => setEditDraft((current) => ({ ...current, role: event.target.value as User["role"] }))}><option value="admin">Admin</option><option value="pharmacist">Pharmacist</option><option value="cashier">Cashier</option></select></label></div><div className="access-section password-reset-section"><div className="access-section-heading"><span>03</span><div><strong>Password reset</strong><small>Optional. Leave blank to keep the current password.</small></div></div><div className="access-fields"><label>New password<input type="password" minLength={8} autoComplete="new-password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} /></label><label>Confirm password<input type="password" minLength={8} autoComplete="new-password" value={editPasswordConfirm} onChange={(event) => setEditPasswordConfirm(event.target.value)} /></label></div></div>{editUserError && <div className="login-error"><AlertTriangle size={16} />{editUserError}</div>}{editUserSaved && <div className="save-confirmation">User updated successfully.</div>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setEditingUserId(null)}>Cancel</button><button className="primary-action" type="submit">Save changes</button></div></form>}</div>}</section></>;
}

function ReportsPage({ dashboard, summary, initialSalesReport }: { dashboard: Dashboard | null; summary: ReportSummary; initialSalesReport: SalesReport }) {
  const [salesReport, setSalesReport] = useState(initialSalesReport);
  const net = summary.revenue - summary.expenses;
  const maxRevenue = Math.max(...salesReport.periods.map((entry) => entry.revenue), 1);
  const chartWidth = 900;
  const chartHeight = 280;
  const chartPadding = { top: 28, right: 24, bottom: 44, left: 64 };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const chartPoints = salesReport.periods.map((entry, index) => ({
    ...entry,
    x: chartPadding.left + (salesReport.periods.length === 1 ? plotWidth / 2 : (index / (salesReport.periods.length - 1)) * plotWidth),
    y: chartPadding.top + plotHeight - (entry.revenue / maxRevenue) * plotHeight,
  }));
  const chartLine = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const chartArea = chartPoints.length ? `${chartPadding.left},${chartPadding.top + plotHeight} ${chartLine} ${chartPoints[chartPoints.length - 1].x},${chartPadding.top + plotHeight}` : "";

  useEffect(() => {
    setSalesReport(initialSalesReport);
  }, [initialSalesReport]);

  function changePeriod(period: SalesReport["period"]) {
    const token = localStorage.getItem("apotheca_token");
    if (!token || period === salesReport.period) return;
    fetch(`http://127.0.0.1:4317/api/reports/sales?period=${period}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load sales report.");
        return response.json() as Promise<SalesReport>;
      })
      .then(setSalesReport);
  }

  function exportCsv() {
    const header = ["Period", "Revenue (GHS)", "Units sold", "Transactions"];
    const rows = salesReport.periods.map((entry) => [
      formatPeriod(entry.period),
      (entry.revenue / 100).toFixed(2),
      String(entry.unitsSold),
      String(entry.transactions),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `apotheca-sales-${salesReport.period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    window.print();
  }

  const formatPeriod = (period: string) => salesReport.period === "monthly"
    ? new Intl.DateTimeFormat("en-GH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`))
    : new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${period}T00:00:00Z`));

  return <><section className="reports-hero"><div><p className="eyebrow">Business intelligence</p><h2>Reports</h2><p>Understand revenue, operating costs, and inventory value from this local workspace.</p></div><div className="reports-hero-actions"><span className="report-period">{salesReport.period === "daily" ? "Last 14 days" : "Last 12 months"}</span><div className="report-actions"><button className="secondary-action" onClick={exportCsv} disabled={!salesReport.periods.length}><Download size={15} /> Export CSV</button><button className="secondary-action" onClick={exportPdf}><FileDown size={15} /> Export PDF</button></div></div></section><section className="reports-section"><div className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Financial and stock position</h3></div><span className="section-caption">Saved local measures</span></div><section className="metric-grid"><MetricCard label="Revenue" value={currency.format(summary.revenue / 100)} detail={`${summary.transactions} transactions`} icon={<Receipt />} accent="teal" /><MetricCard label="Expenses" value={currency.format(summary.expenses / 100)} detail="Saved operating costs" icon={<Wallet />} accent="coral" /><MetricCard label="Net position" value={currency.format(net / 100)} detail={`${summary.unitsSold} units sold`} icon={<Activity />} accent="ochre" /><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="plum" /></section>  <section className="panel sales-report-panel"><div className="panel-heading"><div><p className="eyebrow">Sales performance</p><h3>{salesReport.period === "daily" ? "Daily sales graph" : "Monthly sales graph"}</h3><span className="panel-supporting-copy">Track revenue movement, units sold, and transaction volume over time.</span></div><div className="report-toggle" role="group" aria-label="Sales report period"><button className={salesReport.period === "daily" ? "active" : ""} onClick={() => changePeriod("daily")}><CalendarDays size={15} /> Daily</button><button className={salesReport.period === "monthly" ? "active" : ""} onClick={() => changePeriod("monthly")}><BarChart3 size={15} /> Monthly</button></div></div>{salesReport.periods.length ? <><div className="sales-chart-wrap"><svg className="sales-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${salesReport.period} revenue graph`}><defs><linearGradient id="sales-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4e8b80" stopOpacity=".3" /><stop offset="100%" stopColor="#4e8b80" stopOpacity=".02" /></linearGradient></defs>{[0, .25, .5, .75, 1].map((level) => { const y = chartPadding.top + plotHeight - level * plotHeight; return <g key={level}><line className="chart-grid-line" x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} /><text className="chart-axis-label" x={chartPadding.left - 10} y={y + 4} textAnchor="end">{currency.format((maxRevenue * level) / 100)}</text></g>; })}<polygon className="sales-chart-area" points={chartArea} /><polyline className="sales-chart-line" points={chartLine} fill="none" />{chartPoints.map((point) => <g key={point.period}><circle className="sales-chart-point" cx={point.x} cy={point.y} r="5" /><text className="chart-x-label" x={point.x} y={chartHeight - 14} textAnchor="middle">{formatPeriod(point.period)}</text><title>{`${formatPeriod(point.period)}: ${currency.format(point.revenue / 100)}`}</title></g>)}</svg></div><div className="table-wrap"><table><thead><tr><th>Period</th><th>Revenue</th><th>Units sold</th><th>Transactions</th></tr></thead><tbody>{[...salesReport.periods].reverse().map((entry) => <tr key={`row-${entry.period}`}><td><strong>{formatPeriod(entry.period)}</strong></td><td>{currency.format(entry.revenue / 100)}</td><td>{entry.unitsSold}</td><td>{entry.transactions}</td></tr>)}</tbody></table></div></> :   <div className="report-placeholder"><Activity size={26} /><h3>No sales recorded yet</h3><p>Completed sales will appear here by day and month.</p></div>}</section></section></>;
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div></div>;
}

function ProductTable({ products, showCategory = false, onDeleteProduct, onEditProduct }: { products: Product[]; showCategory?: boolean; onDeleteProduct?: (product: Product) => void; onEditProduct?: (product: Product) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Medicine</th><th>SKU / barcode</th>{showCategory && <th>Category</th>}<th>Supplier / batch</th><th>On hand</th><th>Expiry</th><th>Status</th>{(onEditProduct || onDeleteProduct) && <th>Action</th>}</tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><span className="table-subtitle">{product.generic_name || product.strength} {product.dosage_form}{product.manufacturer ? ` · ${product.manufacturer}` : ""}</span></td><td>{product.sku}<span className="table-subtitle">{product.barcode || "No barcode"}</span></td>{showCategory && <td>{product.category || "General"}</td>}<td>{product.supplier || "Not recorded"}<span className="table-subtitle">{product.batch_number || "No batch number"}</span></td><td><strong>{product.stock}</strong><span className="table-subtitle">Reorder at {product.reorder_level}</span></td><td>{product.expiry_date || "No date"}<span className="table-subtitle">{product.storage_location || "No location"}</span></td><td><span className={`pill ${product.stock <= product.reorder_level ? "warning" : "info"}`}>{product.stock <= product.reorder_level ? "Low stock" : "Healthy"}</span></td>{(onEditProduct || onDeleteProduct) && <td className="row-actions">{onEditProduct && <button className="edit-button" onClick={() => onEditProduct(product)}>Edit</button>}{onDeleteProduct && <button className="remove-button" onClick={() => onDeleteProduct(product)}>Remove</button>}</td>}</tr>)}</tbody></table>{!products.length && <div className="empty-state"><PackageSearch size={24} /><p>No products found.</p></div>}</div>;
}

function ReceiveStockModal({ form, error, isEditing, onChange, onClose, onSubmit }: { form: { sku: string; name: string; genericName: string; manufacturer: string; barcode: string; batchNumber: string; dosageForm: string; strength: string; category: string; supplier: string; receivedDate: string; packSize: string; storageLocation: string; storageCondition: string; invoiceReference: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }; error: string; isEditing: boolean; onChange: (form: { sku: string; name: string; genericName: string; manufacturer: string; barcode: string; batchNumber: string; dosageForm: string; strength: string; category: string; supplier: string; receivedDate: string; packSize: string; storageLocation: string; storageCondition: string; invoiceReference: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }) => void; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const field = (name: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...form, [name]: event.target.value });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="receive-stock-title"><div className="modal-heading"><div><p className="eyebrow">{isEditing ? "Stock details" : "Inventory intake"}</p><h2 id="receive-stock-title">{isEditing ? "Edit inventory item" : "Receive stock"}</h2><p>{isEditing ? "Update the product record, batch details, and storage information." : "Create a complete inventory record so this stock is easy to find and manage later."}</p></div><button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button></div><form className="stock-form" onSubmit={onSubmit}><div className="form-section-title">Product identity</div><label>Medicine name<input required value={form.name} onChange={field("name")} /></label><label>Generic name<input value={form.genericName} onChange={field("genericName")} placeholder="e.g. Paracetamol" /></label><label>Manufacturer / brand<input value={form.manufacturer} onChange={field("manufacturer")} /></label><label>Dosage form<select value={form.dosageForm} onChange={field("dosageForm")}><option>Tablet</option><option>Capsule</option><option>Syrup</option><option>Cream</option><option>Injection</option></select></label><label>Strength<input value={form.strength} onChange={field("strength")} placeholder="e.g. 500 mg" /></label><label>Pack size<input value={form.packSize} onChange={field("packSize")} placeholder="e.g. 100 tablets" /></label><label>Category<input value={form.category} onChange={field("category")} placeholder="e.g. Antibiotics" /></label><label>SKU<input required value={form.sku} onChange={field("sku")} /></label><label>Barcode<input inputMode="numeric" value={form.barcode} onChange={field("barcode")} placeholder="Scan or enter barcode" /></label><div className="form-section-title">Batch and supplier</div><label>Batch / lot number<input value={form.batchNumber} onChange={field("batchNumber")} /></label><label>Supplier<input value={form.supplier} onChange={field("supplier")} /></label><label>Invoice reference<input value={form.invoiceReference} onChange={field("invoiceReference")} /></label><label>Date received<input type="date" value={form.receivedDate} onChange={field("receivedDate")} /></label><label>Expiry date<input type="date" value={form.expiryDate} onChange={field("expiryDate")} /></label><div className="form-section-title">Stock and storage</div><label>{isEditing ? "Quantity on hand" : "Quantity received"}<input required min="1" type="number" value={form.stock} onChange={field("stock")} /></label><label>Reorder level<input min="0" type="number" value={form.reorderLevel} onChange={field("reorderLevel")} /></label><label>Storage location<input value={form.storageLocation} onChange={field("storageLocation")} placeholder="e.g. Shelf A3" /></label><label>Storage condition<select value={form.storageCondition} onChange={field("storageCondition")}><option>Room temperature</option><option>Refrigerated</option><option>Frozen</option><option>Protected from light</option></select></label><label>Purchase price<input min="0" step="0.01" type="number" value={form.purchasePriceCents} onChange={field("purchasePriceCents")} /></label><label>Selling price<input min="0" step="0.01" type="number" value={form.sellingPriceCents} onChange={field("sellingPriceCents")} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" type="submit">{isEditing ? "Save changes" : "Save stock"}</button></div></form></section></div>;
}

function MetricCard({ label, value, detail, icon, accent }: { label: string; value: string; detail: string; icon: React.ReactNode; accent: string }) {
  return <article className={`metric-card ${accent}`}><div className="metric-card-header"><p>{label}</p><span className="metric-icon">{icon}</span></div><strong>{value}</strong><span>{detail}</span><div className="metric-card-rule" /></article>;
}
function RhythmItem({ time, title, detail }: { time: string; title: string; detail: string }) {
  return <div className="rhythm-item"><time>{time}</time><div><strong>{title}</strong><span>{detail}</span></div><span className="rhythm-line" /></div>;
}

function LoginScreen({ form, error, isSigningIn, onChange, onSubmit }: { form: { username: string; password: string }; error: string; isSigningIn: boolean; onChange: (form: { username: string; password: string }) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <main className="login-shell"><section className="login-panel"><div className="brand-lockup login-brand"><div className="brand-mark">A</div><div><strong>APOTHECA</strong><span>Retail pharmacy operations</span></div></div><div className="login-copy"><p className="eyebrow">Secure workspace</p><h1>Welcome back.</h1><p>Sign in to continue to your pharmacy workspace.</p></div><form className="login-form" onSubmit={onSubmit}><label>Username<input required autoComplete="username" value={form.username} onChange={(event) => onChange({ ...form, username: event.target.value })} /></label><label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<button className="primary-action login-submit" disabled={isSigningIn}>{isSigningIn ? "Signing in..." : "Sign in"}</button></form><p className="login-note">Use your assigned account to access the right tools for your role.</p></section></main>;
}
