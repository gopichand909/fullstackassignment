/* ============================================================
   ENTRUPY — Price Monitor  |  app.js
   Vanilla JS — ES2020, no frameworks
   ============================================================ */

'use strict';

/* ─── Configuration ─────────────────────────────────────── */
const CONFIG = {
  BASE_URL:    'http://127.0.0.1:8000',   // Change to your backend URL
  PAGE_SIZE:   20,
};

/* ─── State ──────────────────────────────────────────────── */
const state = {
  apiKey:          '',
  products:        [],     // raw products from last fetch
  filtered:        [],     // after local search+filter
  currentPage:     1,
  sortCol:         'name',
  sortDir:         'asc',
  search:          '',
  filterMin:       null,
  filterMax:       null,
  filterCategory:  '',
  currentProductId: null,
  sparklineChart:  null,
  categoryChart:   null,
};

/* ─── DOM Helpers ────────────────────────────────────────── */
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

function showLoading() { $('#loadingOverlay').classList.add('active'); }
function hideLoading() { $('#loadingOverlay').classList.remove('active'); }

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtPrice(val) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str, n = 30) {
  return str && str.length > n ? str.slice(0, n) + '…' : (str || '—');
}

/* ─── API Client ─────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  if (!state.apiKey && path !== '/health') {
    throw new Error('No API key set. Enter your X-API-Key in the sidebar.');
  }
  const url = CONFIG.BASE_URL + path;
  const headers = {
    'Content-Type': 'application/json',
    ...(state.apiKey ? { 'X-API-Key': state.apiKey } : {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Health / Key Check ─────────────────────────────────── */
async function checkHealth() {
  try {
    await apiFetch('/health');
    const status = $('#keyStatus');
    status.textContent = '● Connected';
    status.className = 'key-status ok';
    toast('API key accepted ✓', 'success');
    await loadCurrentView();
  } catch (e) {
    const status = $('#keyStatus');
    status.textContent = '● ' + e.message;
    status.className = 'key-status err';
    toast(e.message, 'error');
  }
}

/* ─── Dashboard ──────────────────────────────────────────── */
async function loadDashboard() {
  showLoading();
  try {
    const data = await apiFetch('/analytics');
    renderStats(data);
    renderCategoryChart(data.categories || []);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderStats(data) {
  $('#statTotalProducts').textContent = (data.total_products ?? '—').toLocaleString();
  $('#statTotalRecords').textContent  = (data.total_price_records ?? '—').toLocaleString();
  $('#statAvgPrice').textContent      = fmtPrice(data.average_price);
  $('#statChanges').textContent       = (data.products_with_price_changes ?? '—').toLocaleString();
}

function renderCategoryChart(categories) {
  $('#categoryCount').textContent = categories.length + ' categories';

  const canvas = $('#categoryChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Colour palette
  const COLOURS = ['#c9a84c','#4caf87','#5a8ae0','#e05a5a','#a04ce0','#4cc9c9','#e07a4c','#7ae04c'];

  const maxCount = Math.max(...categories.map(c => c.product_count), 1);

  function draw() {
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight || 220;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD_L = 8;
    const PAD_R = 8;
    const PAD_TOP = 10;
    const PAD_BOT = 32;
    const n    = categories.length;
    if (n === 0) {
      ctx.fillStyle = '#6a6478';
      ctx.font = '13px IBM Plex Mono';
      ctx.textAlign = 'center';
      ctx.fillText('No data — run /refresh to ingest', W / 2, H / 2);
      return;
    }

    const availW = W - PAD_L - PAD_R;
    const barW   = Math.max(24, (availW / n) - 10);
    const step   = availW / n;
    const chartH = H - PAD_TOP - PAD_BOT;

    categories.forEach((cat, i) => {
      const x    = PAD_L + i * step + (step - barW) / 2;
      const pct  = cat.product_count / maxCount;
      const bH   = Math.max(4, pct * chartH);
      const y    = PAD_TOP + chartH - bH;
      const col  = COLOURS[i % COLOURS.length];

      // Bar
      ctx.fillStyle = col + '33';
      roundRect(ctx, x, y, barW, bH, 4);
      ctx.fill();

      ctx.fillStyle = col;
      roundRect(ctx, x, y, barW, 4, 2);
      ctx.fill();

      // Count
      ctx.fillStyle = col;
      ctx.font = `bold 12px IBM Plex Mono`;
      ctx.textAlign = 'center';
      ctx.fillText(cat.product_count, x + barW / 2, y - 6);

      // Label
      ctx.fillStyle = '#a09898';
      ctx.font = '11px Instrument Sans';
      ctx.textAlign = 'center';
      const label = cat.category.length > 10 ? cat.category.slice(0, 9) + '…' : cat.category;
      ctx.fillText(label, x + barW / 2, H - PAD_BOT + 16);
    });
  }

  // Legend
  const legend = $('#chartLegend');
  legend.innerHTML = categories.map((c, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${COLOURS[i % COLOURS.length]}"></span>
      <span>${c.category}</span>
      <span class="legend-count">${c.product_count}</span>
    </div>
  `).join('');

  draw();
  window.addEventListener('resize', draw, { passive: true });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ─── Products ───────────────────────────────────────────── */
async function loadProducts() {
  showLoading();
  try {
    const params = new URLSearchParams({ limit: 500, offset: 0 });
    if (state.filterCategory)       params.set('category', state.filterCategory);
    if (state.filterMin != null)     params.set('min_price', state.filterMin);
    if (state.filterMax != null)     params.set('max_price', state.filterMax);

    const data = await apiFetch('/products?' + params);
    state.products = data.products || [];
    populateCategoryFilter(state.products);
    state.currentPage = 1;
    applyLocalFilter();
  } catch (e) {
    toast(e.message, 'error');
    $('#productTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">✕</span><p>${e.message}</p></div></td></tr>`;
  } finally {
    hideLoading();
  }
}

function populateCategoryFilter(products) {
  const cats = [...new Set(products.map(p => p.category))].filter(Boolean).sort();
  const sel = $('#filterCategory');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${c}" ${c === prev ? 'selected' : ''}>${c}</option>`).join('');
}

function applyLocalFilter() {
  const q = state.search.toLowerCase().trim();
  state.filtered = state.products.filter(p => {
    if (q) {
      const haystack = `${p.name} ${p.brand} ${p.category} ${p.original_source}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Sort
  state.filtered.sort((a, b) => {
    let av = a[state.sortCol];
    let bv = b[state.sortCol];
    if (av == null) av = state.sortDir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = state.sortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
    if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  renderProductTable();
  renderPagination();
}

function renderProductTable() {
  const tbody = $('#productTableBody');
  const start = (state.currentPage - 1) * CONFIG.PAGE_SIZE;
  const page  = state.filtered.slice(start, start + CONFIG.PAGE_SIZE);

  $('#resultCount').textContent = `${state.filtered.length} product${state.filtered.length !== 1 ? 's' : ''}`;

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <span class="empty-icon">◈</span>
      <p>No products match your search</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(p => `
    <tr>
      <td class="name-cell">${escHtml(truncate(p.name, 40))}</td>
      <td>${escHtml(p.brand || '—')}</td>
      <td>${escHtml(p.category || '—')}</td>
      <td><span class="source-tag" title="${escHtml(p.original_source)}">${escHtml(truncate(p.original_source, 20))}</span></td>
      <td class="price-cell">${fmtPrice(p.latest_price)}</td>
      <td class="date-cell">${fmtDate(p.updated_at)}</td>
      <td><button class="view-btn" data-id="${p.id}" data-name="${escHtml(p.name)}">History →</button></td>
    </tr>
  `).join('');

  // Attach click handlers for "History" buttons
  $$('.view-btn', tbody).forEach(btn => {
    btn.addEventListener('click', () => openProductDetail(
      parseInt(btn.dataset.id),
      btn.dataset.name,
    ));
  });
}

function renderPagination() {
  const total = Math.ceil(state.filtered.length / CONFIG.PAGE_SIZE);
  const pg = $('#pagination');
  if (total <= 1) { pg.innerHTML = ''; return; }

  const pages = [];
  if (state.currentPage > 1) pages.push({ label: '‹', page: state.currentPage - 1 });

  let lo = Math.max(1, state.currentPage - 2);
  let hi = Math.min(total, lo + 4);
  if (hi - lo < 4) lo = Math.max(1, hi - 4);

  for (let i = lo; i <= hi; i++) {
    pages.push({ label: String(i), page: i, active: i === state.currentPage });
  }
  if (state.currentPage < total) pages.push({ label: '›', page: state.currentPage + 1 });

  pg.innerHTML = pages.map(p =>
    `<button class="page-btn ${p.active ? 'active' : ''}" data-page="${p.page}">${p.label}</button>`
  ).join('');

  $$('.page-btn', pg).forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = parseInt(btn.dataset.page);
      renderProductTable();
      renderPagination();
    });
  });
}

/* ─── Product Detail ─────────────────────────────────────── */
async function openProductDetail(id) {
  state.currentProductId = id;

  // Find cached product
  const p = state.products.find(x => x.id === id);
  if (p) {
    $('#detailName').textContent     = p.name;
    $('#detailBrand').textContent    = p.brand || '—';
    $('#detailCategory').textContent = p.category || '—';
    $('#detailCurrentPrice').textContent = fmtPrice(p.latest_price);
    $('#detailSource').textContent   = truncate(p.original_source, 35);
    $('#detailCreated').textContent  = fmtDate(p.created_at);
    $('#detailUpdated').textContent  = fmtDate(p.updated_at);
  }

  switchView('detail');
  await loadProductHistory(id);
}

async function loadProductHistory(id) {
  $('#historyTableBody').innerHTML = `<tr><td colspan="5" class="loading-cell">Loading history…</td></tr>`;
  showLoading();
  try {
    const data = await apiFetch(`/products/${id}/history?limit=100`);
    const history = data.history || [];

    $('#historyCount').textContent = `${history.length} records`;

    // Price delta
    if (history.length >= 2) {
      const newest = history[0].price;
      const oldest = history[history.length - 1].price;
      const delta  = newest - oldest;
      const pct    = oldest ? ((delta / oldest) * 100).toFixed(1) : 0;
      const el     = $('#priceDelta');
      if (delta === 0) {
        el.textContent = 'No change';
        el.className   = 'delta-value';
      } else {
        el.textContent = `${delta > 0 ? '+' : ''}${fmtPrice(delta)} (${delta > 0 ? '+' : ''}${pct}%)`;
        el.className   = `delta-value ${delta > 0 ? 'up' : 'down'}`;
      }
    } else {
      $('#priceDelta').textContent = history.length === 1 ? 'Single record' : '—';
      $('#priceDelta').className   = 'delta-value';
    }

    renderSparkline(history);
    renderHistoryTable(history);
  } catch (e) {
    toast(e.message, 'error');
    $('#historyTableBody').innerHTML = `<tr><td colspan="5" class="loading-cell">${e.message}</td></tr>`;
  } finally {
    hideLoading();
  }
}

function renderHistoryTable(history) {
  const tbody = $('#historyTableBody');
  if (history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">No price history recorded</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map((h, i) => {
    const prev  = history[i + 1];
    let changeTd = '<td class="change-none">—</td>';
    if (prev) {
      const diff = h.price - prev.price;
      const pct  = prev.price ? ((diff / prev.price) * 100).toFixed(1) : 0;
      if (diff > 0)      changeTd = `<td class="change-up">▲ ${fmtPrice(diff)} (+${pct}%)</td>`;
      else if (diff < 0) changeTd = `<td class="change-down">▼ ${fmtPrice(Math.abs(diff))} (${pct}%)</td>`;
      else               changeTd = `<td class="change-none">No change</td>`;
    }
    return `
      <tr>
        <td class="date-cell">${history.length - i}</td>
        <td class="price-cell">${fmtPrice(h.price)}</td>
        <td><span class="source-tag" title="${escHtml(h.source)}">${escHtml(truncate(h.source, 22))}</span></td>
        <td class="date-cell">${fmtDateTime(h.timestamp)}</td>
        ${changeTd}
      </tr>
    `;
  }).join('');
}

function renderSparkline(history) {
  const canvas = $('#sparklineChart');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;

  const W = canvas.offsetWidth || 600;
  const H = 140;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (history.length < 2) {
    ctx.fillStyle = '#6a6478';
    ctx.font = '12px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Insufficient data for trend chart', W / 2, H / 2);
    return;
  }

  // Reverse so oldest is left
  const pts  = [...history].reverse();
  const prices = pts.map(h => h.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const PAD = 16;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  const toX = i  => PAD + (i / (pts.length - 1)) * plotW;
  const toY = v  => PAD + (1 - (v - minP) / range) * plotH;

  // Gradient fill
  const grad = ctx.createLinearGradient(0, PAD, 0, H - PAD);
  grad.addColorStop(0, 'rgba(201,168,76,0.25)');
  grad.addColorStop(1, 'rgba(201,168,76,0)');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < pts.length; i++) {
    // Smooth curve
    const cpx = (toX(i - 1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(prices[i - 1]), cpx, toY(prices[i]), toX(i), toY(prices[i]));
  }
  ctx.lineTo(toX(pts.length - 1), H);
  ctx.lineTo(toX(0), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < pts.length; i++) {
    const cpx = (toX(i - 1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(prices[i - 1]), cpx, toY(prices[i]), toX(i), toY(prices[i]));
  }
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Endpoint dot
  const lastX = toX(pts.length - 1);
  const lastY = toY(prices[prices.length - 1]);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#c9a84c';
  ctx.fill();
  ctx.strokeStyle = '#080810';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Min/Max labels
  ctx.fillStyle = '#6a6478';
  ctx.font = '10px IBM Plex Mono';
  ctx.textAlign = 'right';
  ctx.fillText(fmtPrice(maxP), W - 4, PAD + 10);
  ctx.fillText(fmtPrice(minP), W - 4, H - 6);
}

/* ─── Webhooks ───────────────────────────────────────────── */
async function loadWebhooks() {
  showLoading();
  try {
    const data = await apiFetch('/webhooks');
    renderWebhooksTable(data.webhooks || []);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderWebhooksTable(webhooks) {
  const tbody = $('#webhookTableBody');
  if (webhooks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <span class="empty-icon">⊕</span>
      <p>No webhooks registered yet</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = webhooks.map(wh => `
    <tr>
      <td class="date-cell">#${wh.id}</td>
      <td style="word-break:break-all;font-size:12px;">${escHtml(wh.url)}</td>
      <td><span class="${wh.is_active ? 'status-active' : 'status-inactive'}">${wh.is_active ? '● Active' : '● Inactive'}</span></td>
      <td class="date-cell">${fmtDate(wh.created_at)}</td>
      <td><button class="delete-btn" data-id="${wh.id}">Delete</button></td>
    </tr>
  `).join('');

  $$('.delete-btn', tbody).forEach(btn => {
    btn.addEventListener('click', () => deleteWebhook(parseInt(btn.dataset.id)));
  });
}

async function registerWebhook() {
  const url = $('#webhookUrlInput').value.trim();
  const err = $('#webhookError');
  if (!url) { err.textContent = 'Please enter a valid URL.'; return; }
  err.textContent = '';
  showLoading();
  try {
    await apiFetch(`/webhooks?url=${encodeURIComponent(url)}`, { method: 'POST' });
    $('#webhookUrlInput').value = '';
    toast('Webhook registered ✓', 'success');
    await loadWebhooks();
  } catch (e) {
    err.textContent = e.message;
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

async function deleteWebhook(id) {
  if (!confirm(`Delete webhook #${id}?`)) return;
  showLoading();
  try {
    await apiFetch(`/webhooks/${id}`, { method: 'DELETE' });
    toast(`Webhook #${id} deleted`, 'success');
    await loadWebhooks();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ─── View Switching ─────────────────────────────────────── */
function switchView(viewName) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));

  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  const navBtn = $(`.nav-item[data-view="${viewName}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Close mobile sidebar
  $('#sidebar').classList.remove('open');
}

async function loadCurrentView() {
  const activeView = $$('.nav-item').find(n => n.classList.contains('active'))?.dataset.view || 'dashboard';
  await loadView(activeView);
}

async function loadView(viewName) {
  switchView(viewName);
  switch (viewName) {
    case 'dashboard': await loadDashboard(); break;
    case 'products':  await loadProducts();  break;
    case 'webhooks':  await loadWebhooks();  break;
  }
}

/* ─── Utility ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Event Bindings ─────────────────────────────────────── */
function bindEvents() {

  // API Key
  $('#applyKeyBtn').addEventListener('click', () => {
    const key = $('#apiKeyInput').value.trim();
    if (!key) { toast('Please enter an API key', 'error'); return; }
    state.apiKey = key;
    checkHealth();
  });
  $('#apiKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#applyKeyBtn').click();
  });

  // Nav
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.apiKey) {
        toast('Enter your API key first', 'error');
        return;
      }
      loadView(btn.dataset.view);
    });
  });

  // Dashboard refresh
  $('#dashRefreshBtn').addEventListener('click', loadDashboard);

  // Products refresh
  $('#prodRefreshBtn').addEventListener('click', () => {
    state.currentPage = 1;
    loadProducts();
  });

  // Search — local filter on input
  const searchInput = $('#productSearch');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    const clearBtn = $('#clearSearch');
    clearBtn.style.display = state.search ? 'block' : 'none';
    state.currentPage = 1;
    applyLocalFilter();
  });

  $('#clearSearch').addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    $('#clearSearch').style.display = 'none';
    state.currentPage = 1;
    applyLocalFilter();
  });

  // Server-side filters
  $('#applyFiltersBtn').addEventListener('click', () => {
    const min = parseFloat($('#filterMinPrice').value);
    const max = parseFloat($('#filterMaxPrice').value);
    state.filterMin      = isNaN(min) ? null : min;
    state.filterMax      = isNaN(max) ? null : max;
    state.filterCategory = $('#filterCategory').value;
    state.currentPage    = 1;
    loadProducts();
  });

  $('#clearFiltersBtn').addEventListener('click', () => {
    $('#filterMinPrice').value  = '';
    $('#filterMaxPrice').value  = '';
    $('#filterCategory').value  = '';
    state.filterMin      = null;
    state.filterMax      = null;
    state.filterCategory = '';
    state.currentPage    = 1;
    loadProducts();
  });

  // Column sorting
  $$('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = 'asc';
      }
      // Update sort icons
      $$('.sortable .sort-icon').forEach(ic => ic.textContent = '↕');
      th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓';
      applyLocalFilter();
    });
  });

  // Back button from detail
  $('#backToProducts').addEventListener('click', () => switchView('products'));

  // Detail refresh
  $('#detailRefreshBtn').addEventListener('click', () => {
    if (state.currentProductId) loadProductHistory(state.currentProductId);
  });

  // Webhooks
  $('#whRefreshBtn').addEventListener('click', loadWebhooks);
  $('#registerWebhookBtn').addEventListener('click', registerWebhook);
  $('#webhookUrlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') registerWebhook();
  });

  // Mobile hamburger
  $('#hamburger').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });
  // Close sidebar when clicking outside on mobile
  $('#mainContent').addEventListener('click', () => {
    if (window.innerWidth < 768) $('#sidebar').classList.remove('open');
  });
}

/* ─── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();

  // Restore API key from sessionStorage if present
  const saved = sessionStorage.getItem('entrupy_api_key');
  if (saved) {
    $('#apiKeyInput').value = saved;
    state.apiKey = saved;
    const status = $('#keyStatus');
    status.textContent = '● Key loaded';
    status.className = 'key-status ok';
  }

  // Save key to session when it changes
  $('#apiKeyInput').addEventListener('change', () => {
    const v = $('#apiKeyInput').value.trim();
    if (v) sessionStorage.setItem('entrupy_api_key', v);
  });
});
