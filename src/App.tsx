import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Boxes, ClipboardList, LayoutDashboard, PackageSearch, Plus, Receipt, Settings2, ShoppingCart, Wallet } from "lucide-react";

type Dashboard = {
  metrics: {
    inventory_value_cents: number;
    product_count: number;
    low_stock_count: number;
    expiring_count: number;
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

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "pharmacist" | "cashier";
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
  const [activeNav, setActiveNav] = useState("Overview");
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveError, setReceiveError] = useState("");
  const [receiveForm, setReceiveForm] = useState({ sku: "", name: "", dosageForm: "Tablet", strength: "", category: "", stock: "", reorderLevel: "5", purchasePriceCents: "", sellingPriceCents: "", expiryDate: "" });

  const loadDashboard = (token: string) => {
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
        loadDashboard(token);
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
        loadDashboard(token);
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
          {user.role === "admin" && <button className="nav-item"><Settings2 size={18} strokeWidth={1.8} /><span>Settings</span></button>}
          <div className="sync-status"><span className="status-dot" />Local database connected<span className="sync-detail">Sync ready</span></div>
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <div><p className="eyebrow">Monday, 18 September 2026</p><h1>{activeNav}</h1></div>
          <div className="account-actions"><div className="user-chip"><span className="avatar">{user.displayName.charAt(0)}</span><span><strong>{user.displayName}</strong><small>{user.role}</small></span></div><button className="sign-out" onClick={handleLogout}>Sign out</button>{canManageInventory && <button className="primary-action" onClick={() => setIsReceiveOpen(true)}><Plus size={17} /> Receive stock</button>}</div>
        </header>
        {error ? <div className="error-banner"><AlertTriangle size={18} />{error}</div> : null}
        <div className="content-scroll"><PageContent activeNav={activeNav} dashboard={dashboard} products={products} /></div>
      </section>
      {isReceiveOpen && <ReceiveStockModal form={receiveForm} error={receiveError} onChange={setReceiveForm} onClose={() => setIsReceiveOpen(false)} onSubmit={handleReceiveStock} />}
    </main>
  );
}

function PageContent({ activeNav, dashboard, products }: { activeNav: string; dashboard: Dashboard | null; products: Product[] }) {
  if (activeNav === "Inventory") return <InventoryPage products={products} />;
  if (activeNav === "Point of sale") return <SalesPage products={products} />;
  if (activeNav === "Stock history") return <HistoryPage products={products} />;
  if (activeNav === "Expenses") return <ExpensesPage />;
  if (activeNav === "Reports") return <ReportsPage dashboard={dashboard} />;
  return <OverviewPage dashboard={dashboard} />;
}

function OverviewPage({ dashboard }: { dashboard: Dashboard | null }) {
  return <><section className="intro-row"><div><h2>Good morning, operator.</h2><p>Here is the pulse of your pharmacy today.</p></div><div className="quick-search"><PackageSearch size={18} /><input aria-label="Search inventory" placeholder="Search inventory" /></div></section><section className="metric-grid"><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="teal" /><MetricCard label="Products tracked" value={(dashboard?.metrics.product_count ?? 0).toString()} detail="Across all categories" icon={<Activity />} accent="ochre" /><MetricCard label="Low stock" value={(dashboard?.metrics.low_stock_count ?? 0).toString()} detail="Need your attention" icon={<AlertTriangle />} accent="coral" /><MetricCard label="Expiring soon" value={(dashboard?.metrics.expiring_count ?? 0).toString()} detail="Within 30 days" icon={<Receipt />} accent="plum" /></section><section className="work-grid"><div className="panel attention-panel"><PanelHeading eyebrow="Needs attention" title="Inventory watchlist" /><ProductTable products={dashboard?.products ?? []} /></div><div className="panel activity-panel"><PanelHeading eyebrow="Coming next" title="Daily rhythm" /><div className="rhythm-list"><RhythmItem time="08:00" title="Opening stock check" detail="Inventory review" /><RhythmItem time="11:30" title="Peak sales window" detail="Monitor point of sale" /><RhythmItem time="16:00" title="Expiry review" detail="Check priority batches" /></div><div className="tip-card"><span>FIELD NOTE</span><p>Keep batch receiving and sales in one continuous audit trail.</p></div></div></section></>;
}

function InventoryPage({ products }: { products: Product[] }) {
  return <><section className="page-intro"><div><p className="eyebrow">Stock control</p><h2>Inventory catalogue</h2><p>Track quantities, reorder points, and expiry dates across every medicine.</p></div><div className="metric-inline"><strong>{products.length}</strong><span>Products listed</span></div></section><div className="panel full-panel"><ProductTable products={products} showCategory /></div></>;
}

function SalesPage({ products }: { products: Product[] }) {
  return <><section className="page-intro"><div><p className="eyebrow">Counter workspace</p><h2>Point of sale</h2><p>Start a sale by selecting an in-stock medicine.</p></div><div className="sale-total"><span>Current sale</span><strong>{currency.format(0)}</strong></div></section><section className="work-grid"><div className="panel sale-panel"><PanelHeading eyebrow="Available now" title="Choose a product" /><div className="product-picker">{products.filter((product) => product.stock > 0).slice(0, 8).map((product) => <button className="product-option" key={product.id}><span><strong>{product.name}</strong><small>{product.strength} {product.dosage_form} · {product.stock} in stock</small></span><b>{currency.format((product.selling_price_cents ?? 0) / 100)}</b></button>)}{!products.length && <div className="empty-state"><ShoppingCart size={24} /><p>No products available yet.</p></div>}</div></div><div className="panel sale-summary"><PanelHeading eyebrow="Transaction" title="Sale summary" /><div className="empty-state"><Receipt size={24} /><p>Your sale is empty.</p><button className="primary-action" disabled>Complete sale</button></div></div></section></>;
}

function HistoryPage({ products }: { products: Product[] }) {
  return <><section className="page-intro"><div><p className="eyebrow">Audit trail</p><h2>Stock history</h2><p>Recent receiving activity and stock changes are recorded here.</p></div></section><div className="panel full-panel"><div className="table-wrap"><table><thead><tr><th>Medicine</th><th>Event</th><th>Quantity</th><th>Recorded</th><th>By</th></tr></thead><tbody>{products.slice(0, 8).map((product) => <tr key={product.id}><td><strong>{product.name}</strong><span className="table-subtitle">{product.sku}</span></td><td><span className="pill info">Opening balance</span></td><td>+{product.stock}</td><td>Today</td><td>System import</td></tr>)}</tbody></table>{!products.length && <div className="empty-state"><ClipboardList size={24} /><p>No stock movements recorded.</p></div>}</div></div></>;
}

function ExpensesPage() {
  return <><section className="page-intro"><div><p className="eyebrow">Operating costs</p><h2>Expenses</h2><p>Keep rent, salaries, transport, and other pharmacy costs in view.</p></div><button className="primary-action"><Plus size={17} /> Add expense</button></section><div className="metric-grid"><MetricCard label="This month" value={currency.format(0)} detail="Operating expenses" icon={<Wallet />} accent="coral" /><MetricCard label="Entries" value="0" detail="Recorded this month" icon={<Receipt />} accent="ochre" /></div><div className="panel full-panel"><div className="empty-state"><Wallet size={24} /><p>No expenses recorded for this period.</p></div></div></>;
}

function ReportsPage({ dashboard }: { dashboard: Dashboard | null }) {
  return <><section className="page-intro"><div><p className="eyebrow">Business intelligence</p><h2>Reports</h2><p>A quick view of the measures that guide today's decisions.</p></div><button className="secondary-action">This month <span>⌄</span></button></section><section className="metric-grid"><MetricCard label="Inventory value" value={currency.format((dashboard?.metrics.inventory_value_cents ?? 0) / 100)} detail="At purchase cost" icon={<Boxes />} accent="teal" /><MetricCard label="Low stock" value={`${dashboard?.metrics.low_stock_count ?? 0}`} detail="Products to review" icon={<AlertTriangle />} accent="coral" /><MetricCard label="Expiring soon" value={`${dashboard?.metrics.expiring_count ?? 0}`} detail="Within 30 days" icon={<Receipt />} accent="plum" /></section><div className="panel full-panel report-placeholder"><Activity size={26} /><h3>Sales performance will appear here</h3><p>Complete point-of-sale transactions to build your revenue and profit report.</p></div></>;
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div></div>;
}

function ProductTable({ products, showCategory = false }: { products: Product[]; showCategory?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Medicine</th><th>SKU</th>{showCategory && <th>Category</th>}<th>On hand</th><th>Expiry</th><th>Status</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><span className="table-subtitle">{product.strength} {product.dosage_form}</span></td><td>{product.sku}</td>{showCategory && <td>{product.category || "General"}</td>}<td><strong>{product.stock}</strong><span className="table-subtitle">Reorder at {product.reorder_level}</span></td><td>{product.expiry_date || "No date"}</td><td><span className={`pill ${product.stock <= product.reorder_level ? "warning" : "info"}`}>{product.stock <= product.reorder_level ? "Low stock" : "Healthy"}</span></td></tr>)}</tbody></table>{!products.length && <div className="empty-state"><PackageSearch size={24} /><p>No products found.</p></div>}</div>;
}

function ReceiveStockModal({ form, error, onChange, onClose, onSubmit }: { form: { sku: string; name: string; dosageForm: string; strength: string; category: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }; error: string; onChange: (form: { sku: string; name: string; dosageForm: string; strength: string; category: string; stock: string; reorderLevel: string; purchasePriceCents: string; sellingPriceCents: string; expiryDate: string }) => void; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const field = (name: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...form, [name]: event.target.value });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="receive-stock-title"><div className="modal-heading"><div><p className="eyebrow">Inventory intake</p><h2 id="receive-stock-title">Receive stock</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button></div><form className="stock-form" onSubmit={onSubmit}><label>Medicine name<input required value={form.name} onChange={field("name")} /></label><label>SKU<input required value={form.sku} onChange={field("sku")} /></label><label>Dosage form<select value={form.dosageForm} onChange={field("dosageForm")}><option>Tablet</option><option>Capsule</option><option>Syrup</option><option>Cream</option><option>Injection</option></select></label><label>Strength<input value={form.strength} onChange={field("strength")} placeholder="e.g. 500 mg" /></label><label>Category<input value={form.category} onChange={field("category")} placeholder="e.g. Antibiotics" /></label><label>Quantity received<input required min="1" type="number" value={form.stock} onChange={field("stock")} /></label><label>Reorder level<input min="0" type="number" value={form.reorderLevel} onChange={field("reorderLevel")} /></label><label>Purchase price<input min="0" step="0.01" type="number" value={form.purchasePriceCents} onChange={field("purchasePriceCents")} /></label><label>Selling price<input min="0" step="0.01" type="number" value={form.sellingPriceCents} onChange={field("sellingPriceCents")} /></label><label>Expiry date<input type="date" value={form.expiryDate} onChange={field("expiryDate")} /></label>{error && <div className="login-error"><AlertTriangle size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" type="submit">Save stock</button></div></form></section></div>;
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
