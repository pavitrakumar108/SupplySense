import { useEffect, useMemo, useState } from 'react';
import productPhotoManifest from './product-photo-manifest.json';

async function apiEnvelope(path, options = {}) {
  const token = localStorage.getItem('supplysense_access_token');
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const raw = res.status === 204 ? '' : await res.text();
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (!res.ok) {
    const message = body?.error?.message
      ?? (typeof body?.error === 'string' ? body.error : null)
      ?? body?.message
      ?? (res.status === 429 ? 'Too many requests. Please wait a moment and try again.' : null)
      ?? 'The service is unavailable. Start the API and database, then try again.';
    const error = new Error(message);
    error.status = res.status;
    error.code = body?.error?.code;
    throw error;
  }
  return { data: body?.data, meta: body?.meta };
}

async function api(path, options = {}) {
  return (await apiEnvelope(path, options)).data;
}

const money = (value) => `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roleCodes = (user) => user?.roles?.map((role) => role.code) ?? [];
const cardOfferDiscount = (subtotal) => Math.min(Math.round(Number(subtotal ?? 0) * 10) / 100, 500);
const invoiceSeller = {
  name: import.meta.env.VITE_INVOICE_SELLER_NAME || 'SupplySence',
  address: import.meta.env.VITE_INVOICE_SELLER_ADDRESS || 'Seller address not configured',
  gstin: import.meta.env.VITE_INVOICE_SELLER_GSTIN || 'Not configured',
  state: import.meta.env.VITE_INVOICE_SELLER_STATE || 'Not configured',
  email: import.meta.env.VITE_INVOICE_SELLER_EMAIL || 'support@supplysense.com',
};

function Gate({ login, onBack, initialRole = 'customer', initialMode = 'login' }) {
  const [role, setRole] = useState(initialRole);
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      login(await api(register ? '/auth/register' : `/auth/${role}/login`, {
        method: 'POST',
        body: JSON.stringify(form),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="gate-shell">
      <section className="gate-intro">
        <a className="brand" href="/"><span className="brand-mark">S</span>SupplySence</a>
        {onBack && <button className="link-button gate-back" onClick={onBack}>← Back to the shop</button>}
        <div>
          <p className="eyebrow">CONNECTED OPERATIONS</p>
          <h1>One platform.<br />Two focused workspaces.</h1>
          <p className="hero-text">Customers shop with instant inventory tracking. Managers control warehouse operations and demand planning.</p>
        </div>
        <div className="gate-benefits">
          <span>Live inventory</span>
          <span>Secure account access</span>
          <span>Demand intelligence</span>
        </div>
      </section>
      <section className="gate-card">
        <p className="eyebrow">ACCESS SUPPLYSENSE</p>
        <div className="role-choice">
          <button className={role === 'customer' ? 'active' : ''} onClick={() => { setRole('customer'); setMode('login'); }}>
            <strong>Customer</strong><span>Products, cart & delivery</span>
          </button>
          <button className={role === 'manager' ? 'active' : ''} onClick={() => { setRole('manager'); setMode('login'); }}>
            <strong>Manager</strong><span>Warehouse & demand planning</span>
          </button>
        </div>
        <h2>{register ? 'Create customer account' : `${role === 'manager' ? 'Manager' : 'Customer'} login`}</h2>
        <form className="gate-form" onSubmit={submit}>
          {register && (
            <label>Full name<input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
          )}
          <label>Email address<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Password<input type="password" minLength="12" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : `Open ${role} workspace`}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        {role === 'customer' && (
          <button className="link-button" onClick={() => setMode(register ? 'login' : 'register')}>
            {register ? 'Already have an account? Sign in' : 'New customer? Create account'}
          </button>
        )}
      </section>
    </main>
  );
}

function Manager({ user, logout }) {
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({ dashboard: null, inventory: [], recommendations: [], forecasts: [], anomalies: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (id = warehouseId) => {
    if (!id) return;
    try {
      setBusy(true);
      const q = `warehouseId=${id}&pageSize=100`;
      const [dashboard, inventory, recommendations, forecasts, anomalies] = await Promise.all([
        api(`/dashboards/manager?warehouseId=${id}`),
        api(`/warehouses/${id}/inventory?pageSize=100`),
        api(`/recommendations?${q}`),
        api(`/analytics/forecasts?${q}`),
        api(`/anomalies?${q}`),
      ]);
      setData({ dashboard, inventory, recommendations, forecasts, anomalies });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api('/warehouses')
      .then((items) => {
        setWarehouses(items);
        setWarehouseId(items[0]?.id ?? '');
        load(items[0]?.id);
      })
      .catch((err) => setError(err.message));
  }, []);

  const run = async () => {
    try {
      setBusy(true);
      setError('');
      setNotice('');
      const result = await api('/intelligence/run', { method: 'POST', body: JSON.stringify({ warehouseId, horizonDays: 14 }) });
      await load();
      setNotice(result.message || `Generated ${result.forecastCount} forecasts${result.modelName ? ` with ${result.modelName}` : ''}.`);
    } catch (err) {
      setError(err.message);
      if (err.code === 'INSUFFICIENT_SALES_HISTORY') {
        setData((current) => ({ ...current, forecasts: [], recommendations: [], anomalies: [] }));
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id) => {
    try {
      await api(`/recommendations/${id}/approve`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: '{}' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cards = data.dashboard?.cards;

  return (
    <div className="manager-shell">
      <aside className="manager-sidebar">
        <a className="brand" href="#"><span className="brand-mark">S</span>SupplySence</a>
        <p className="sidebar-label">MANAGER WORKSPACE</p>
        {[
          ['dashboard', 'Warehouse Overview'],
          ['inventory', 'Product Distribution'],
          ['demand', 'Demand Prediction'],
          ['suppliers', 'Supplier Management'],
        ].map(([id, title]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
            {title}
          </button>
        ))}
        <div className="sidebar-user">
          <strong>{user.fullName}</strong>
          <span>Admin Manager</span>
          <button className="link-button" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="manager-main">
        <header className="manager-header">
          <div>
            <p className="eyebrow">OPERATIONS CONTROL</p>
            <h1>{view === 'dashboard' ? 'Warehouse Overview' : view === 'inventory' ? 'Product Distribution' : 'Demand Prediction'}</h1>
          </div>
          <div>
            <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); load(e.target.value); }}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
            <button className="button button-secondary" disabled={busy} onClick={() => load()}>Refresh Data</button>
          </div>
        </header>

        {error && <p className="notice error">{error}</p>}
        {notice && <p className="notice success" role="status">{notice}</p>}

        {view === 'dashboard' && (
          <>
            {cards && (
              <div className="manager-metrics">
                {[
                  ['Total Stock Value', money(cards.stockValue)],
                  ['Low Stock Items', cards.lowStockCount],
                  ['Open POs', cards.openPurchaseOrders],
                  ['Critical Alerts', cards.criticalAlerts],
                  ['Anomalies', cards.anomalyCount],
                ].map(([label, value]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
            )}
            <div className="manager-grid">
              <DataCard title="Critical Low Stock" rows={data.dashboard?.lowStock?.map((x) => [x.productName, `${x.availableQuantity} / ${x.reorderLevel}`])} empty="No critical items." />
              <DataCard title="Supply Anomalies" rows={data.dashboard?.anomalies?.map((x) => [x.productName, `${x.actualSales} · ${x.direction}`])} empty="No anomalies detected." />
            </div>
          </>
        )}

        {view === 'inventory' && (
          <section className="manager-card">
            <p className="eyebrow">STOCK ANALYSIS</p>
            <h2>Inventory Distribution</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>On Hand</th><th>Reserved</th><th>Available</th><th>Reorder Level</th></tr>
                </thead>
                <tbody>
                  {data.inventory.map((x) => (
                    <tr key={x.id}>
                      <td>{x.productName}</td><td>{x.sku}</td><td>{x.onHandQuantity}</td><td>{x.reservedQuantity}</td><td>{x.availableQuantity}</td><td>{x.reorderLevel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.inventory.length && <p className="empty-state">No inventory data found for this warehouse.</p>}
          </section>
        )}

        {view === 'suppliers' && (
          <section className="manager-card">
            <p className="eyebrow">SUPPLY CHAIN</p>
            <h2>Supplier Purchase Orders</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Order #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {data.dashboard?.openPurchaseOrdersList?.map((po) => (
                    <tr key={po.id}>
                      <td>{po.orderNumber}</td>
                      <td>{po.supplier?.name}</td>
                      <td>{money(po.totalAmount)}</td>
                      <td><span className={`status-chip ${po.status.toLowerCase()}`}>{po.status}</span></td>
                      <td>
                        {po.status === 'SUBMITTED' && (
                          <button className="table-action" onClick={() => approve(po.id)}>Approve & Receive</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.dashboard?.openPurchaseOrdersList?.length && <p className="empty-state">No pending supplier orders to approve.</p>}
          </section>
        )}

        {view === 'demand' && (
          <>
            <section className="prediction-banner">
              <div>
              <p className="eyebrow">RECENT SALES-BASED FORECASTING</p>
              <h2>Forecast Upcoming Demand</h2>
              <p>Use recent warehouse sales to forecast product demand. Each SKU needs at least seven days with sales in the 28-day lookback.</p>
              </div>
              <button className="button button-primary" disabled={busy || !warehouseId} onClick={run}>
                {busy ? 'Calculating...' : 'Run Demand Prediction'}
              </button>
            </section>
            <section className="manager-card">
              <p className="eyebrow">REORDER STRATEGY</p>
              <h2>Recommended Replenishments</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Product</th><th>Daily Forecast</th><th>Available</th><th>Recommended</th><th>Priority</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {data.recommendations.map((x) => (
                      <tr key={x.id}>
                        <td>{x.productName}<small>{x.sku}</small></td>
                        <td>{x.forecastDailyDemand}</td>
                        <td>{x.availableQuantity}</td>
                        <td>{x.recommendedQuantity}</td>
                        <td><span className="priority">{x.priority}</span></td>
                        <td>{x.status === 'PENDING' && <button className="table-action" onClick={() => approve(x.id)}>Approve</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.recommendations.length && <p className="empty-state">Run prediction to generate data.</p>}
            </section>
            <DataCard title="Forecasted Demand (14 Days)" rows={data.forecasts.map((x) => [x.productName, `${x.predictedTotal} units`])} empty="No forecast output." />
          </>
        )}
      </main>
    </div>
  );
}

function DataCard({ title, rows = [], empty }) {
  return (
    <section className="manager-card">
      <p className="eyebrow">OPERATIONS</p>
      <h2>{title}</h2>
      {rows.map(([name, value], index) => (
        <div className="data-row" key={`${name}-${index}`}><strong>{name}</strong><span>{value}</span></div>
      ))}
      {!rows.length && <p className="empty-state">{empty}</p>}
    </section>
  );
}

const productPhotoByUrl = new Map(Object.values(productPhotoManifest).flatMap((entry) => entry.listings ?? []).map((photo) => [photo.url, photo]));

function findProductEntry(name, categorySlug) {
  const normalizedName = name.toLowerCase();
  return Object.values(productPhotoManifest)
    .filter((item) => (!categorySlug || item.category === categorySlug) && (normalizedName.includes(item.productType.toLowerCase()) || normalizedName === item.productType.toLowerCase()))
    .sort((left, right) => right.productType.length - left.productType.length)[0];
}

function findProductPhoto(name, categorySlug, imageUrl) {
  const imageMatch = imageUrl ? productPhotoByUrl.get(imageUrl) : null;
  if (imageMatch) return imageMatch;
  const entry = findProductEntry(name, categorySlug);
  if (!entry?.listings?.length) return null;
  const brandIndex = entry.brands?.findIndex((brand) => name.startsWith(`${brand} `)) ?? -1;
  return entry.listings[Math.max(0, Math.min(brandIndex, entry.listings.length - 1))] ?? entry.listings[0];
}

function simpleProductName(productType) {
  const words = productType.trim().split(/\s+/);
  const last = words.at(-1);
  if (last?.toLowerCase() === 'set') return words.slice(-2).join(' ');
  const singular = { shoes: 'Shoe', sneakers: 'Sneaker', loafers: 'Loafer', boots: 'Boot', sandals: 'Sandal', slippers: 'Slipper', socks: 'Sock', gloves: 'Glove', cones: 'Cone', blocks: 'Block', rings: 'Ring', bands: 'Band', cards: 'Card', markers: 'Marker', notes: 'Note', sheets: 'Bed Sheet', trousers: 'Trousers', shorts: 'Shorts', pajamas: 'Pajamas', oats: 'Oats', nuts: 'Nuts', lentils: 'Lentils' };
  const normalizedLast = last?.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (normalizedLast === 't-shirt') return 'T-Shirt';
  return singular[normalizedLast] ?? last;
}

function displayProductName(name, categorySlug) {
  const entry = findProductEntry(name, categorySlug);
  return entry ? simpleProductName(entry.productType) : name;
}

function ProductImage({ imageUrl, alt, productName, categorySlug, className = '', onImageError }) {
  const [imageFailed, setImageFailed] = useState(false);
  const photo = findProductPhoto(productName ?? alt, categorySlug, imageUrl);
  const source = photo?.url;

  useEffect(() => setImageFailed(false), [imageUrl, alt, productName, categorySlug]);

  return (
    <div className={`product-art ${className}`}>
      {source && !imageFailed ? (
        <img src={source} alt={alt} loading="lazy" onError={() => { setImageFailed(true); onImageError?.(); }} />
      ) : (
        <div className="product-photo-unavailable" aria-label={`${alt}: photo unavailable`} role="img">
          <span aria-hidden="true">▧</span>
          <small>Product photo unavailable</small>
        </div>
      )}
    </div>
  );
}

function InvoiceDocument({ order, onClose }) {
  const address = order.shippingAddress ?? {};
  const invoiceDate = new Date(order.createdAt);
  const invoiceRef = `SS-${invoiceDate.getFullYear()}-${order.id.slice(0, 8).toUpperCase()}`;
  const gstStateCodes = { 'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14', Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30', Lakshadweep: '31', Kerala: '32', TamilNadu: '33', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38' };
  const recipientStateCode = gstStateCodes[address.state] ?? '';
  const paymentDue = order.paymentMethod === 'COD' && order.status !== 'CANCELLED' && order.payments?.some((payment) => payment.status === 'PENDING');
  const amount = (value) => money(value ?? 0);

  return (
    <div className="invoice-modal-backdrop" role="presentation">
      <div className="invoice-modal-actions">
        <button className="button button-secondary" onClick={onClose}>Close</button>
        <button className="button button-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="invoice-paper" aria-label="Order bill">
        <header className="invoice-header">
          <div><span className="invoice-brand-mark">S</span><div><strong>{invoiceSeller.name}</strong><small>Order bill</small></div></div>
          <div className="invoice-title"><p>ORDER BILL</p><h1>Purchase summary</h1><span>Bill reference {invoiceRef}</span></div>
        </header>
        <div className="invoice-notice">Order bill / payment receipt — GST registration and product tax details are not configured for this demo.</div>
        <div className="invoice-parties">
          <section><h2>Sold by</h2><strong>{invoiceSeller.name}</strong><p>{invoiceSeller.address}</p><p>State: {invoiceSeller.state}</p><p>GSTIN: {invoiceSeller.gstin}</p><p>{invoiceSeller.email}</p></section>
          <section><h2>Bill to / Ship to</h2><strong>{address.recipientName || order.customer?.fullName || 'Customer'}</strong><p>{[address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')}</p><p>Recipient GSTIN: {address.gstin || 'Not provided'}</p><p>Place of supply: {address.state || address.country || 'Not provided'}{recipientStateCode ? ` · State code ${recipientStateCode}` : ''}</p><p>Buyer email: {order.customer?.email || 'Not provided'}</p></section>
          <section><h2>Order details</h2><p>Bill date: {invoiceDate.toLocaleDateString('en-IN')}</p><p>Order reference: {order.id.slice(0, 8).toUpperCase()}</p><p>Payment: {order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod === 'CARD' ? 'Credit / Debit Card' : 'UPI'}</p><p>Payment status: {paymentDue ? 'Due on delivery' : order.payments?.some((payment) => payment.status === 'CAPTURED') ? 'Paid' : order.status}</p></section>
        </div>
        <table className="invoice-items">
          <thead><tr><th>Description</th><th>HSN/SAC</th><th>Qty (Nos.)</th><th>Unit price</th><th>Taxable value</th><th>GST</th><th>Amount</th></tr></thead>
          <tbody>{(order.items ?? []).map((item) => <tr key={item.id}><td><strong>{item.productName}</strong>{item.option && <small>{item.option}</small>}</td><td>Not configured</td><td>{item.quantity}</td><td>{amount(item.unitPrice)}</td><td>{amount(item.lineTotal)}</td><td>Not configured</td><td>{amount(item.lineTotal)}</td></tr>)}</tbody>
        </table>
        <div className="invoice-bottom">
          <section className="invoice-tax-details"><h2>Tax and delivery details</h2><p>Place of supply: {address.state || 'Not provided'}{recipientStateCode ? ` · State code ${recipientStateCode}` : ''}</p><p>GST rate / tax split: Not configured</p><p>Reverse charge: Not configured</p><p>Delivery address: {[address.line1, address.city, address.state, address.postalCode].filter(Boolean).join(', ') || 'Not provided'}</p></section>
          <section className="invoice-totals"><p><span>Items subtotal</span><strong>{amount(order.subtotalAmount)}</strong></p>{Number(order.discountAmount) > 0 && <p><span>Card offer discount</span><strong>−{amount(order.discountAmount)}</strong></p>}<p><span>Delivery</span><strong>{Number(order.shippingAmount) ? amount(order.shippingAmount) : 'FREE'}</strong></p><p><span>GST</span><strong>Not configured</strong></p><p className="invoice-grand-total"><span>{paymentDue ? 'Payable on delivery' : 'Order total'}</span><strong>{amount(order.totalAmount)}</strong></p></section>
        </div>
        <footer className="invoice-footer"><p>Thank you for shopping with {invoiceSeller.name}.</p><p>To issue a GST tax invoice, configure the seller GSTIN, HSN/SAC codes and applicable GST rates.</p><span>Authorised signatory: {invoiceSeller.name}</span></footer>
      </article>
    </div>
  );
}

function CustomerPortal({ user, logout, openLogin }) {
  const [products, setProducts] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState({ page: 1, totalPages: 1, totalItems: 0 });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState(null);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [brandFilter, setBrandFilter] = useState('');
  const [variantOption, setVariantOption] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('random');
  const [catalogPage, setCatalogPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [address, setAddress] = useState({
    recipientName: user?.fullName ?? '',
    line1: '12 Industrial Area, Sector 4',
    city: 'Mumbai',
    state: 'Maharashtra',
    gstin: '',
    postalCode: '400001',
    country: 'India',
  });
  const [payment, setPayment] = useState('upi');
  const [cardForm, setCardForm] = useState({ name: user?.fullName ?? '', number: '4242 •••• •••• 4242', exp: '12/28', cvv: '123' });
  const [page, setPage] = useState(() => location.hash.replace('#/', '') || 'shop');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeQrOrder, setActiveQrOrder] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [scanDetected, setScanDetected] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([{ sender: 'bot', text: 'Hello! Welcome to SupplySence. How can I help you today?' }]);
  const [chatInput, setChatInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [failedProductIds, setFailedProductIds] = useState(() => new Set());

  const navigate = (next) => {
    location.hash = `/${next}`;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const load = async () => {
    try {
      const c = await api('/categories');
      setCategories(c || []);
      if (!user) return;
      const [crt, o] = await Promise.all([api('/cart'), api('/orders?pageSize=20')]);
      setCart(crt);
      setOrders(o || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const sync = () => setPage(location.hash.replace('#/', '') || 'shop');
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setCatalogLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(catalogPage),
          pageSize: '24',
          sort,
          direction: sort === 'createdAt' ? 'desc' : 'asc',
        });
        if (search.trim()) {
          const normalizedSearch = search.trim().toLowerCase();
          const matchingListing = Object.values(productPhotoManifest).find((entry) =>
            entry.listings?.some((listing) => listing.title?.toLowerCase().includes(normalizedSearch))
            || entry.productType.toLowerCase().includes(normalizedSearch),
          );
          params.set('search', matchingListing?.productType ?? search.trim());
        }
        if (brandFilter) params.set('marketplaceBrand', brandFilter);
        if (category !== 'all') params.set('categoryId', category);
        if (variantOption) params.set('variantOption', variantOption);
        if (minPrice) params.set('minPrice', minPrice);
        if (maxPrice) params.set('maxPrice', maxPrice);
        const result = await apiEnvelope(`/products?${params}`);
        if (!active) return;
        setProducts(result.data ?? []);
        setCatalogMeta({
          page: result.meta?.page ?? catalogPage,
          totalPages: result.meta?.totalPages ?? 1,
          totalItems: result.meta?.totalItems ?? 0,
        });
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setCatalogLoading(false);
      }
    }, search ? 250 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, category, brandFilter, variantOption, minPrice, maxPrice, sort, catalogPage]);

  useEffect(() => {
    if (!selectedProduct) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedProduct(null);
    };
    addEventListener('keydown', closeOnEscape);
    return () => removeEventListener('keydown', closeOnEscape);
  }, [selectedProduct]);

  useEffect(() => {
    if (!activeQrOrder?.id) return;
    let settled = false;
    const interval = setInterval(async () => {
      if (settled) return;
      try {
        const orderData = await api(`/orders/${activeQrOrder.id}`);
        const scanned = orderData?.payments?.some((payment) => payment.provider === 'mock_upi_qr_scanned' || payment.status === 'CAPTURED');
        const paid = orderData?.status === 'PAID' || orderData?.status === 'CONFIRMED';
        if (scanned) setScanDetected(true);
        if (paid) {
          settled = true;
          clearInterval(interval);
          setScanDetected(true);
          setNotice(`QR scanned. Order #${orderData.id.slice(0, 8)} paid and stock committed.`);
          await load();
          setTimeout(() => {
            setActiveQrOrder(null);
            setScanDetected(false);
            navigate('orders');
          }, 1200);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [activeQrOrder?.id]);

  const filteredItems = useMemo(() => {
    const selectedCategorySlug = categories.find((item) => item.id === category)?.slug;
    return products
      .map((product) => ({
        product,
        variants: product.variants.filter((variant) => {
          const price = Number(variant.price);
          const matchesMin = !minPrice || price >= Number(minPrice);
          const matchesMax = !maxPrice || price <= Number(maxPrice);
          const matchesOption = !variantOption || variant.attributes?.option === variantOption;
          return matchesMin && matchesMax && matchesOption;
        }),
      }))
      .filter(({ product, variants }) => {
        const photo = findProductPhoto(product.name, product.category?.slug, product.images?.[0]?.imageUrl);
        const photoBrand = photo?.brand ?? '';
        return variants.length > 0
          && Boolean(photo?.url)
          && !failedProductIds.has(product.id)
          && (!brandFilter || photoBrand === brandFilter)
          && (!selectedCategorySlug || product.category?.slug === selectedCategorySlug);
      });
  }, [products, categories, category, brandFilter, minPrice, maxPrice, variantOption, failedProductIds]);

  const count = cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const cardDiscount = payment === 'card' ? cardOfferDiscount(cart?.subtotal) : 0;
  const checkoutTotal = Math.max(0, Number(cart?.subtotal ?? 0) - cardDiscount);
  const detailVariant = selectedProduct?.variants.find((variant) => variant.id === selectedVariantId);
  const selectedCategorySlug = categories.find((item) => item.id === category)?.slug;
  const availableBrands = useMemo(() => [...new Set(Object.values(productPhotoManifest)
    .filter((entry) => !selectedCategorySlug || entry.category === selectedCategorySlug)
    .flatMap((entry) => entry.listings?.map((listing) => listing.brand).filter(Boolean) ?? []))]
    .sort((left, right) => left.localeCompare(right)), [selectedCategorySlug]);
  const sizeOptions = selectedCategorySlug === 'shoes'
    ? ['UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11', 'UK 12', 'UK 13', 'UK 14']
    : selectedCategorySlug === 'fashion'
      ? ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL']
      : [];

  const openProduct = (product, variantId) => {
    setSelectedProduct(product);
    setSelectedVariantId(variantId ?? product.variants[0]?.id ?? '');
  };

  const updateCart = async (variantId, quantity, add = false) => {
    if (!user) return openLogin('customer');
    try {
      setBusy(true);
      setError('');
      setCart(await api('/cart', {
        method: add ? 'POST' : 'PATCH',
        body: JSON.stringify({ variantId, quantity }),
      }));
      if (add) setNotice('Item added to your cart.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeFromCart = async (variantId) => {
    if (!user) return openLogin('customer');
    try {
      setBusy(true);
      setError('');
      await api('/cart', { method: 'DELETE', body: JSON.stringify({ variantId }) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearCart = async () => {
    if (!user) return openLogin('customer');
    try {
      setBusy(true);
      setError('');
      await api('/cart/clear', { method: 'DELETE' });
      await load();
      setNotice('Your cart is now empty.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startUpiCheckout = async (e) => {
    e?.preventDefault?.();
    if (!user) return openLogin('customer', 'register');
    try {
      setBusy(true);
      setError('');
      const scanToken = crypto.randomUUID();
      const order = await api('/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ shippingAddress: address, paymentMethod: 'UPI' }),
      });
      setActiveQrOrder({ ...order, scanToken });
      setScanDetected(false);
      await load();
      setNotice('Scan the QR with a phone camera. The order will process automatically once the payment is detected.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkoutWithCod = async () => {
    if (!user) return openLogin('customer', 'register');
    try {
      setBusy(true);
      setError('');
      const order = await api('/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ shippingAddress: address, paymentMethod: 'COD' }),
      });
      setNotice(`Order #${order.id.slice(0, 8)} placed. Pay ${money(order.totalAmount)} in cash when it arrives.`);
      await load();
      navigate('orders');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkoutWithCard = async (e) => {
    e.preventDefault();
    if (!user) return openLogin('customer', 'register');
    try {
      setBusy(true);
      setError('');
      const order = await api('/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ shippingAddress: address, paymentMethod: 'CARD' }),
      });
      await api(`/payments/${order.id}/card`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: '{}',
      });
      setNotice('Card payment authorized. Your order has been placed.');
      await load();
      navigate('orders');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const input = chatInput.trim().toLowerCase();
    const newMsgs = [...messages, { sender: 'user', text: chatInput }];
    setMessages(newMsgs);
    setChatInput('');
    
    setTimeout(() => {
      let botResponse = 'Thanks for your message! Our support team is looking into it and will reply shortly.';
      if (input.startsWith('hi') || input.startsWith('hello') || input.startsWith('hey')) {
        botResponse = 'Hello! Welcome to SupplySence. How can I help you with your shopping today?';
      } else if (input.includes('product') || input.includes('available') || input.includes('search') || input.includes('do you have')) {
        const foundProduct = products.find(p => input.includes(p.name.toLowerCase()));
        if (foundProduct) {
          const availableVariant = foundProduct.variants.find(v => v.inStock);
          if (availableVariant) {
            botResponse = `Yes, the ${foundProduct.name} is available! You can find it in the shop.`;
          } else {
            botResponse = `I'm sorry, the ${foundProduct.name} is currently out of stock.`;
          }
        } else {
          botResponse = 'I couldn\'t find that specific product. Try searching for it in our catalog or ask me about a different item!';
        }
      } else if (input.includes('help') || input.includes('support')) {
        botResponse = 'You can contact our support team at support@supplysense.com or call +1 (234) 567-890.';
      }
      setMessages([...newMsgs, { sender: 'bot', text: botResponse }]);
    }, 1000);
  };

  const qrImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${activeQrOrder?.scanToken ?? ''}`;

  const infoPages = {
    'about': { title: 'About Us', content: 'SupplySence is a leading connected operations platform providing instant inventory tracking and demand intelligence for a seamless supply chain experience.' },
    'faq': { title: 'FAQ', content: 'Our FAQ section provides answers to common questions about shipping, returns, and account management. We strive for 100% customer satisfaction.' },
    'shipping': { title: 'Shipping Policy', content: 'We offer worldwide shipping with real-time tracking. Most orders are processed within 24 hours and delivered within 3-7 business days.' },
    'terms': { title: 'Terms of Service', content: 'Our terms of service ensure a fair and transparent marketplace for all our customers and partners. Please read them carefully.' },
  };

  return (
    <div className="customer-portal">
      <header className="portal-header">
        <div className="header-brand">
          <a className="brand" href="#"><span className="brand-mark">S</span>SupplySence</a>
          <nav className="header-nav">
            <button className={page === 'shop' ? 'active' : ''} onClick={() => navigate('shop')}>Shop</button>
            <button className={page === 'cart' ? 'active' : ''} onClick={() => navigate('cart')}>Cart ({count})</button>
            <button className={page === 'orders' ? 'active' : ''} onClick={() => navigate('orders')}>Orders</button>
          </nav>
        </div>
        <div className="header-user">
          <button className="profile-trigger" onClick={() => user ? setShowProfile(true) : openLogin('customer')}>{user ? `👤 ${user.fullName}` : 'Sign in'}</button>
          {user
            ? <button className="link-button" onClick={logout}>Sign out</button>
            : <button className="button button-primary header-signup" onClick={() => openLogin('customer', 'register')}>Create account</button>}
        </div>
      </header>

      {showProfile && user && (
        <div className="modal-overlay" onClick={() => setShowProfile(false)}>
          <div className="profile-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>My Account</h2>
              <button className="close-btn" onClick={() => setShowProfile(false)}>✕</button>
            </div>
            <div className="profile-details">
              <div className="profile-avatar">👤</div>
              <div className="profile-info">
                <label>Full Name</label>
                <p>{user.fullName}</p>
                <label>Email Address</label>
                <p>{user.email}</p>
                <label>Role</label>
                <p>Customer</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="button button-primary" onClick={() => setShowProfile(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showChat && (
        <div className="chat-window">
          <div className="chat-header">
            <strong>SupplySence Support</strong>
            <button className="close-chat" onClick={() => setShowChat(false)}>✕</button>
          </div>
          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.sender}`}>{m.text}</div>
            ))}
          </div>
          <form className="chat-input" onSubmit={sendMessage}>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." />
            <button type="submit">Send</button>
          </form>
        </div>
      )}

      <main className="portal-main">
        {error && <p className="notice error">{error}</p>}
        {notice && <p className="notice success">{notice}</p>}

        {page === 'shop' && (
          <>
            <div className="carousel-wrapper">
              <div className="carousel-content">
                <div className="carousel-text">
                  <p className="hero-kicker">Thoughtful finds, delivered</p>
                  <h1>Make room for<br /><span>the good stuff.</span></h1>
                  <p>Discover everyday essentials and little upgrades, all in one place.</p>
                  <button className="button button-primary" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>Explore the collection <span aria-hidden="true">→</span></button>
                </div>
                <div className="carousel-image-container hero-offers" aria-label="Current offers">
                  <article className="hero-offer-card hero-offer-primary">
                    <span className="hero-offer-icon" aria-hidden="true">%</span>
                    <p className="hero-offer-kicker">CARD OFFER</p>
                    <h2>10% off</h2>
                    <p>Pay by credit or debit card and save on your order.</p>
                    <span className="hero-offer-footnote">Automatically applied · up to ₹500</span>
                  </article>
                  <article className="hero-offer-card hero-offer-secondary">
                    <span className="hero-offer-icon" aria-hidden="true">✦</span>
                    <div><p className="hero-offer-kicker">EVERY ORDER</p><h3>Free delivery</h3><p>No minimum basket required.</p></div>
                  </article>
                </div>
              </div>
            </div>

            <section id="catalog" className="catalog-section">
              <div className="catalog-heading">
                <div>
                  <p className="eyebrow">THE SUPPLYSENSE EDIT</p>
                  <h2>Find your next favorite</h2>
                  <p>Good quality, useful details, and a little joy in the everyday.</p>
                </div>
                <span className="catalog-count">{Math.max(0, catalogMeta.totalItems - failedProductIds.size).toLocaleString()} products</span>
              </div>

              <div className="shop-controls">
                <div className="search-bar">
                  <input value={search} onChange={e => { setSearch(e.target.value); setCatalogPage(1); }} placeholder="Search products by name..." />
                  <span className="search-icon">🔍</span>
                </div>
                <button className="button button-secondary filter-toggle" onClick={() => setShowFilters(!showFilters)}>
                  {showFilters ? 'Hide Filters' : 'Filter & sort'} <span>⌄</span>
                </button>
              </div>

              {showFilters && (
                <div className="top-filter-bar catalog-filters">
                  <div className="filter-item">
                    <label>Category</label>
                    <select value={category} onChange={e => { setCategory(e.target.value); setBrandFilter(''); setVariantOption(''); setCatalogPage(1); }}>
                      <option value="all">All Categories</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Marketplace brand</label>
                    <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setCatalogPage(1); }}>
                      <option value="">All brands</option>
                      {availableBrands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
                    </select>
                  </div>
                  {sizeOptions.length > 0 && (
                    <div className="filter-item">
                      <label>Size</label>
                      <select value={variantOption} onChange={e => { setVariantOption(e.target.value); setCatalogPage(1); }}>
                        <option value="">All sizes</option>
                        {sizeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="filter-item">
                    <label>Sort by</label>
                    <select value={sort} onChange={e => { setSort(e.target.value); setCatalogPage(1); }}>
                      <option value="random">Recommended</option>
                      <option value="name">Name: A to Z</option>
                      <option value="createdAt">Newest first</option>
                    </select>
                  </div>
                  <div className="filter-item price-range">
                    <label>Price Range</label>
                    <div className="price-inputs">
                      <input aria-label="Minimum price" type="number" min="0" placeholder="Min" value={minPrice} onChange={e => { setMinPrice(e.target.value); setCatalogPage(1); }} />
                      <span>-</span>
                      <input aria-label="Maximum price" type="number" min="0" placeholder="Max" value={maxPrice} onChange={e => { setMaxPrice(e.target.value); setCatalogPage(1); }} />
                    </div>
                  </div>
                  <button className="link-button reset-btn" onClick={() => { setCategory('all'); setBrandFilter(''); setVariantOption(''); setMinPrice(''); setMaxPrice(''); setSort('random'); setSearch(''); setCatalogPage(1); }}>Reset filters</button>
                </div>
              )}

              <div className="store-grid">
                {filteredItems.map(({ product, variants }) => {
                  const variant = variants[0];
                  return (
                    <article className="store-product" key={product.id}>
                      <button className="product-image-button" onClick={() => openProduct(product, variant.id)} aria-label={`View ${displayProductName(product.name, product.category?.slug)}`}>
                        <ProductImage
                          imageUrl={product.images?.[0]?.imageUrl}
                          productName={product.name}
                          categorySlug={product.category?.slug}
                          alt={displayProductName(product.name, product.category?.slug)}
                          onImageError={() => setFailedProductIds((current) => new Set(current).add(product.id))}
                        />
                      </button>
                      <div className="product-info">
                        <p className="product-category">{product.category?.name ?? 'General'}</p>
                        <button className="product-title-link" title={displayProductName(product.name, product.category?.slug)} onClick={() => openProduct(product, variant.id)}>{displayProductName(product.name, product.category?.slug)}</button>
                        <div className="price-stock">
                          <strong>{money(variant.price)}</strong>
                          <span className={variant.inStock ? 'stock in-stock' : 'stock'}>{variant.inStock ? `${variant.availableQuantity} available` : 'Out of stock'}</span>
                        </div>
                        <button className="button button-primary add-button" disabled={!variant.inStock || busy} onClick={() => updateCart(variant.id, 1, true)}>Add to cart</button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {catalogLoading && <p className="catalog-status" role="status">Finding the right products…</p>}
              {!filteredItems.length && (
                <div className="empty-state">
                  {!catalogLoading && <><p>No products match your current filters.</p><button className="link-button" onClick={() => { setCategory('all'); setBrandFilter(''); setVariantOption(''); setMinPrice(''); setMaxPrice(''); setSort('random'); setSearch(''); setCatalogPage(1); }}>Clear all filters</button></>}
                </div>
              )}
              {catalogMeta.totalPages > 1 && (
                <nav className="catalog-pagination" aria-label="Product pages">
                  <button className="button button-secondary" disabled={catalogLoading || catalogPage <= 1} onClick={() => setCatalogPage((pageNumber) => pageNumber - 1)}>Previous</button>
                  <span>Page {catalogMeta.page} of {catalogMeta.totalPages}</span>
                  <button className="button button-secondary" disabled={catalogLoading || catalogPage >= catalogMeta.totalPages} onClick={() => setCatalogPage((pageNumber) => pageNumber + 1)}>Next</button>
                </nav>
              )}

              {selectedProduct && (
                <div className="product-detail-overlay" onClick={() => setSelectedProduct(null)}>
                  <section className="product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title" onClick={event => event.stopPropagation()}>
                    <button className="product-detail-close" aria-label="Close product details" onClick={() => setSelectedProduct(null)}>×</button>
                    <div className="product-detail-layout">
                      <div className="product-detail-media">
                        <ProductImage
                          imageUrl={selectedProduct.images?.[0]?.imageUrl}
                          productName={selectedProduct.name}
                          categorySlug={selectedProduct.category?.slug}
                          alt={displayProductName(selectedProduct.name, selectedProduct.category?.slug)}
                          className="product-detail-image"
                        />
                      </div>
                      <div className="product-detail-copy">
                        <p className="product-category">{selectedProduct.category?.name}</p>
                        <h2 id="product-detail-title">{displayProductName(selectedProduct.name, selectedProduct.category?.slug)}</h2>
                        <p className="product-detail-price">{detailVariant ? money(detailVariant.price) : 'Loading price…'}</p>
                        <label className="detail-option-label" htmlFor="detail-product-option">{detailVariant?.attributes?.optionLabel ?? selectedProduct.variants[0]?.attributes?.optionLabel ?? 'Choose a style'}</label>
                        <select id="detail-product-option" value={selectedVariantId} onChange={event => setSelectedVariantId(event.target.value)}>
                          {selectedProduct.variants.map(variant => (
                            <option key={variant.id} value={variant.id}>{variant.attributes?.option ?? 'Standard'}</option>
                          ))}
                        </select>
                        {detailVariant && (
                          <div className="product-detail-stock">
                            <strong className={detailVariant.inStock ? 'in-stock' : ''}>{detailVariant.inStock ? `${detailVariant.availableQuantity} in stock` : 'Out of stock'}</strong>
                          </div>
                        )}
                        <button
                          className="button button-primary product-detail-add"
                          disabled={!detailVariant?.inStock || busy}
                          onClick={() => { updateCart(detailVariant.id, 1, true); setSelectedProduct(null); }}
                        >
                          Add to cart {detailVariant ? `· ${money(detailVariant.price)}` : ''}
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </section>
          </>
        )}

        {page === 'cart' && (
          <section className="customer-page cart-page">
            <p className="eyebrow">YOUR BAG</p>
            <h1>Shopping cart</h1>
            <p className="cart-intro">Review your picks and make them yours.</p>
            <div className="cart-card page-card">
              {!user ? (
                <div className="cart-empty"><span aria-hidden="true">🛍️</span><h2>Your bag is ready when you are</h2><p>Sign in or create a free account to save items and check out.</p><button className="button button-primary" onClick={() => openLogin('customer', 'register')}>Create account</button></div>
              ) : <>
              {!!count && <div className="cart-heading">
                <span>Product</span>
                <span>Quantity</span>
                <span className="cart-heading-total"><span>Total</span><button className="cart-clear-button" disabled={busy} onClick={clearCart}>Clear cart</button></span>
              </div>}
              {cart?.items?.map((item) => (
                <div className="cart-line" key={item.id}>
                  <div className="cart-product-photo">
                    <ProductImage
                      imageUrl={item.variant.images?.[0]?.imageUrl}
                      productName={item.variant.product.name}
                      categorySlug={item.variant.product.category?.slug}
                      alt={displayProductName(item.variant.product.name, item.variant.product.category?.slug)}
                      className="cart-product-image"
                    />
                  </div>
                  <div className="cart-product-copy">
                    <strong>{displayProductName(item.variant.product.name, item.variant.product.category?.slug)}</strong>
                    <small>{item.variant.product.category?.name}</small>
                    <small className="cart-option">{item.variant.attributes?.option}</small>
                    <span className="cart-unit-price">{money(item.variant.price)} each</span>
                    <button className="cart-remove-button" disabled={busy} onClick={() => removeFromCart(item.variant.id)}>Remove</button>
                  </div>
                  <div className="line-actions">
                    <button aria-label={`Decrease ${displayProductName(item.variant.product.name, item.variant.product.category?.slug)} quantity`} disabled={busy} onClick={() => updateCart(item.variant.id, item.quantity - 1)}>−</button>
                    <span>{item.quantity}</span>
                    <button aria-label={`Increase ${displayProductName(item.variant.product.name, item.variant.product.category?.slug)} quantity`} disabled={busy || item.quantity >= item.variant.availableQuantity} onClick={() => updateCart(item.variant.id, item.quantity + 1)}>+</button>
                  </div>
                  <strong className="line-total">{money(item.lineTotal)}</strong>
                </div>
              ))}
              {!count && <div className="cart-empty"><span aria-hidden="true">🛍️</span><h2>Your bag is waiting</h2><p>Browse the collection and add something you love.</p><button className="button button-primary" onClick={() => navigate('shop')}>Explore the shop</button></div>}
              {!!count && <div className="cart-total">
                <span>Shipping</span><span className="shipping-note">Calculated at checkout</span>
              </div>}
              {!!count && <div className="cart-total cart-subtotal">
                <span>Subtotal</span>
                <strong>{money(cart?.subtotal)}</strong>
              </div>}
              {count > 0 && (
                <div className="cart-footer-actions">
                  <button className="link-button" onClick={() => navigate('shop')}>← Continue shopping</button>
                  <button className="button button-primary page-action" onClick={() => navigate('checkout')}>Continue to checkout <span aria-hidden="true">→</span></button>
                </div>
              )}
              </>}
            </div>
          </section>
        )}

        {page === 'checkout' && (
          <section className="customer-page">
             <h1>Delivery and Payment</h1>
             {!user ? (
               <div className="page-card empty-state">Sign in or create an account to save your cart and check out. <button className="button button-primary" onClick={() => openLogin('customer', 'register')}>Create account</button></div>
             ) : !count && !activeQrOrder ? (
               <div className="page-card empty-state">Your cart is empty. <button className="link-button" onClick={() => navigate('shop')}>Browse products</button></div>
             ) : activeQrOrder ? (
               <div className="qr-terminal-card">
                 <div className="qr-terminal-header">
                   <div>
                     <span className="order-chip">ORDER #{activeQrOrder.id.slice(0, 8)}</span>
                     <h2>Scan QR to Complete Payment</h2>
                     <p>Total Payable: <strong className="qr-total-amount">{money(activeQrOrder.totalAmount)}</strong></p>
                   </div>
                   <div className={`qr-radar-badge ${scanDetected ? 'verified' : 'waiting'}`}>
                     <span className="radar-dot" />
                     {scanDetected ? 'QR scanned — paying now' : 'Waiting for a phone to scan this QR'}
                   </div>
                 </div>
                 <div className="qr-scanner-body">
                   <div className="qr-image-wrapper">
                     <img src={qrImageSrc} alt="UPI Payment QR Code" className="qr-code-img" />
                     <span className="qr-caption">Scan with any mobile camera or UPI app</span>
                   </div>
                   <div className="qr-details-pane">
                     <div className="qr-instruction-box">
                       <h4>Pay by scanning</h4>
                       <ol>
                         <li>Open the camera or UPI app on another phone.</li>
                         <li>Scan this QR. Confirm on this screen will not pay the order.</li>
                         <li>When the scan is detected, payment completes automatically.</li>
                       </ol>
                     </div>
                   </div>
                 </div>
                 <div className="qr-terminal-footer">
                   <button type="button" className="link-button cancel-order-link" disabled={scanDetected} onClick={() => { setActiveQrOrder(null); setScanDetected(false); }}>← Cancel and modify order</button>
                   <small className="qr-security-note">🔒 Inventory reserved for 15 minutes.</small>
                 </div>
               </div>
             ) : (
               <div className="checkout-page">
                 <section className="delivery-card">
                   <h2>1. Delivery Address</h2>
                   <div className="address-grid">
                     {Object.entries(address).map(([key, value]) => (
                       <label key={key}>{({ recipientName: 'Recipient name', line1: 'Address line 1', line2: 'Address line 2', city: 'City', state: 'State', gstin: 'Recipient GSTIN (optional)', postalCode: 'PIN code', country: 'Country' })[key] ?? key} <input aria-label={key === 'gstin' ? 'Recipient GSTIN (optional)' : undefined} placeholder={key === 'gstin' ? '15-character GSTIN' : undefined} required={!['state', 'line2', 'gstin'].includes(key)} value={value} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} /></label>
                     ))}
                   </div>
                   <h2 style={{ marginTop: '2rem' }}>2. Payment Method</h2>
                   <fieldset className="payment-method">
                     <label className={payment === 'upi' ? 'method-choice selected' : 'method-choice'}>
                       <input type="radio" name="paymentMethod" checked={payment === 'upi'} onChange={() => setPayment('upi')} />
                       <span><strong>UPI QR Code</strong> (Automatic scan detection)</span>
                     </label>
                     <label className={payment === 'card' ? 'method-choice selected' : 'method-choice'}>
                       <input type="radio" name="paymentMethod" checked={payment === 'card'} onChange={() => setPayment('card')} />
                       <span><strong>Credit or Debit Card</strong> (Instant authorization)</span>
                     </label>
                     <label className={payment === 'cod' ? 'method-choice selected' : 'method-choice'}>
                       <input type="radio" name="paymentMethod" checked={payment === 'cod'} onChange={() => setPayment('cod')} />
                       <span><strong>Cash on Delivery</strong> (Pay when your order arrives)</span>
                     </label>
                   </fieldset>
                   {payment === 'card' && (
                     <div className="card-payment">
                       <label>Cardholder Name <input required value={cardForm.name} onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })} /></label>
                       <label>Card Number <input required value={cardForm.number} onChange={(e) => setCardForm({ ...cardForm, number: e.target.value })} /></label>
                       <div className="card-row">
                         <label>Expiry <input required value={cardForm.exp} onChange={(e) => setCardForm({ ...cardForm, exp: e.target.value })} /></label>
                         <label>CVV <input required type="password" value={cardForm.cvv} onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value })} /></label>
                       </div>
                     </div>
                   )}
                   <div className="payment-box">
                     <strong>Secure Payment Verification</strong>
                     <span>{payment === 'upi' ? 'Pay securely by scanning a UPI QR code.' : payment === 'card' ? 'Get 10% off card payments, up to ₹500.' : 'Pay the delivery partner in cash when your order arrives.'}</span>
                   </div>
                 </section>
                 <aside className="checkout-summary">
                   <p className="eyebrow">ORDER SUMMARY</p>
                   {cart?.items?.map((item) => (
                     <div key={item.id} className="summary-line">
                       <ProductImage imageUrl={item.variant.images?.[0]?.imageUrl} productName={item.variant.product.name} categorySlug={item.variant.product.category?.slug} alt={displayProductName(item.variant.product.name, item.variant.product.category?.slug)} className="summary-product-image" />
                       <span>{displayProductName(item.variant.product.name, item.variant.product.category?.slug)} × {item.quantity}<small>{item.variant.attributes?.option}</small></span>
                       <strong>{money(item.lineTotal)}</strong>
                     </div>
                   ))}
                   {payment === 'card' && <div className="checkout-offer-row"><span>Card offer · 10% off</span><strong>−{money(cardDiscount)}</strong></div>}
                   <div className="checkout-offer-row"><span>Delivery</span><strong>FREE</strong></div>
                   <div className="summary-total">
                     <span>Total</span>
                     <strong>{money(checkoutTotal)}</strong>
                   </div>
                   {payment === 'upi' ? (
                     <button className="button button-primary" disabled={busy} onClick={startUpiCheckout}>Show UPI QR · {money(checkoutTotal)}</button>
                   ) : payment === 'card' ? (
                     <button className="button button-primary" disabled={busy} onClick={checkoutWithCard}>Pay {money(checkoutTotal)} with Card</button>
                   ) : (
                     <button className="button button-primary" disabled={busy} onClick={checkoutWithCod}>Place COD order · {money(checkoutTotal)}</button>
                   )}
                 </aside>
               </div>
             )}
          </section>
        )}

        {page === 'orders' && (
          <section className="customer-page">
            <p className="eyebrow">MY ORDERS</p>
            <h1>Order and Delivery Tracking</h1>
            {!user ? (
              <div className="page-card empty-state">Sign in to see your orders and delivery updates. <button className="button button-primary" onClick={() => openLogin('customer')}>Sign in</button></div>
            ) : <div className="orders-page">
              {orders.map((order) => (
                <article className="order-row" key={order.id}>
                  <div>
                    <strong>Order #{order.id.slice(0, 8)}</strong>
                    <small>{order.warehouse?.name ?? 'Regional Warehouse Hub'} · {new Date(order.createdAt).toLocaleDateString()}</small>
                  </div>
                  <span className="order-status">{order.status}</span>
                  <div className="order-total-actions"><strong className="order-amount">{money(order.totalAmount)}</strong><button className="button button-secondary invoice-open-button" onClick={() => setInvoiceOrder(order)}>View bill</button></div>
                </article>
              ))}
              {!orders.length && <p className="empty-state">Confirmed orders and delivery updates will appear here.</p>}
            </div>}
          </section>
        )}

        {['about', 'faq', 'shipping', 'terms'].includes(page) && (
          <section className="customer-page">
            <div className="page-card" style={{padding: '3rem', textAlign: 'center'}}>
              <h1>{infoPages[page].title}</h1>
              <p style={{fontSize: '1.2rem', lineHeight: '1.6', color: '#55706a'}}>{infoPages[page].content}</p>
              <button className="button button-primary" style={{marginTop: '2rem'}} onClick={() => navigate('shop')}>Back to Shop</button>
            </div>
          </section>
        )}
      </main>

      <footer className="portal-footer">
        <div className="footer-grid">
          <div className="footer-col">
            <a className="brand" href="#"><span className="brand-mark">S</span>SupplySence</a>
            <p className="footer-desc">Your one-stop destination for all your supply needs. Quality, speed, and reliability.</p>
          </div>
          <div className="footer-col">
            <h3>Quick Links</h3>
            <ul>
              <li><button className="link-button" onClick={() => openLogin('manager')}>Manager workspace sign in</button></li>
              <li><button className="link-button" onClick={() => navigate('about')}>About Us</button></li>
              <li><button className="link-button" onClick={() => navigate('faq')}>FAQ</button></li>
              <li><button className="link-button" onClick={() => navigate('shipping')}>Shipping Policy</button></li>
              <li><button className="link-button" onClick={() => navigate('terms')}>Terms of Service</button></li>
            </ul>
          </div>
          <div className="footer-col">
            <h3>Contact Us</h3>
            <div className="footer-contact">
              <div><span>📞</span> +1 (234) 567-890</div>
              <div><span>✉️</span> support@supplysense.com</div>
              <div><span>📍</span> 123 Supply St, Commerce City</div>
            </div>
            <a className="button button-primary newsletter-btn" href="mailto:support@supplysense.com">Email our team <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="footer-bottom">&copy; 2026 SupplySence Inc. All rights reserved.</div>
      </footer>

      {invoiceOrder && <InvoiceDocument order={invoiceOrder} onClose={() => setInvoiceOrder(null)} />}

      <div className="floating-chat" onClick={() => setShowChat(!showChat)} title="Chat with us">
        <span>💬</span>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    if (!localStorage.getItem('supplysense_access_token')) return null;
    try { return JSON.parse(localStorage.getItem('supplysense_user') || 'null'); }
    catch { return null; }
  });
  const [sessionReady, setSessionReady] = useState(() => !localStorage.getItem('supplysense_access_token'));
  const [gate, setGate] = useState(null);

  useEffect(() => {
    if (!user) {
      setSessionReady(true);
      return;
    }
    api('/auth/me')
      .then((currentUser) => {
        localStorage.setItem('supplysense_user', JSON.stringify(currentUser));
        setUser(currentUser);
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          localStorage.removeItem('supplysense_access_token');
          localStorage.removeItem('supplysense_user');
        }
        setUser(null);
      })
      .finally(() => setSessionReady(true));
  }, []);

  const login = (data) => {
    localStorage.setItem('supplysense_access_token', data.accessToken);
    localStorage.setItem('supplysense_user', JSON.stringify(data.user));
    setUser(data.user);
    setGate(null);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } catch {}
    localStorage.removeItem('supplysense_access_token');
    localStorage.removeItem('supplysense_user');
    setUser(null);
  };

  if (!sessionReady) return <main className="session-loading" role="status">Restoring your SupplySence workspace…</main>;
  if (gate) return <Gate login={login} initialRole={gate.role} initialMode={gate.mode} onBack={() => setGate(null)} />;

  if (user && roleCodes(user).some((role) => ['WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR'].includes(role))) {
    return <Manager user={user} logout={logout} />;
  }
  return <CustomerPortal user={user} logout={logout} openLogin={(role = 'customer', mode = 'login') => setGate({ role, mode })} />;
}
