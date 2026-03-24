/* ============================================================
   ENTRUPY — Price Monitor  |  app.js
   Vanilla JS — ES2020, no frameworks
   ============================================================ */

'use strict';

/* ─── Configuration ─────────────────────────────────────── */
const CONFIG = {
  get BASE_URL() {
    return (sessionStorage.getItem('entrupy_base_url') || 'http://127.0.0.1:8000').replace(/\/$/, '');
  },
  set BASE_URL(v) {
    sessionStorage.setItem('entrupy_base_url', v.replace(/\/$/, ''));
  },
  PAGE_SIZE: 20,
};

/* ─── State ──────────────────────────────────────────────── */
const state = {
  apiKey:           '',
  products:         [],
  filtered:         [],
  currentPage:      1,
  sortCol:          'name',
  sortDir:          'asc',
  search:           '',
  filterMin:        null,
  filterMax:        null,
  filterCategory:   '',
  currentProductId: null,
};

/* ─── DOM Helpers ────────────────────────────────────────── */
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

function showLoading(msg = 'Fetching data…') {
  $('#loadingOverlay').classList.add('active');
  const st = $('.spinner-text');
  if (st) st.textContent = msg;
}
function hideLoading() { $('#loadingOverlay').classList.remove('active'); }

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmtPrice(val) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val);
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
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── API Client ─────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const url = CONFIG.BASE_URL + path;
  const headers = { 'Content-Type': 'application/json' };
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (netErr) {
    throw new Error(
      `Cannot reach backend at ${CONFIG.BASE_URL}. ` +
      `Ensure the server is running and CORS is enabled. ` +
      `(${netErr.message})`
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

/* ─── Setup / Connection Modal ───────────────────────────── */
function showSetupModal() {
  const existing = $('#setupModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'setupModal';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box">
      <div class="modal-header">
        <span style="font-size:22px;color:var(--gold)">◈</span>
        <h2 class="modal-title">Connect to Backend</h2>
      </div>
      <p class="modal-desc">
        Enter your backend URL and API key to get started.
        No key yet? Generate one below — it only takes a second.
      </p>

      <div class="setup-step">
        <label class="field-label">Backend URL</label>
        <div class="setup-row">
          <input id="setupUrl" class="setup-input" type="url"
            value="${escHtml(CONFIG.BASE_URL)}"
            placeholder="http://127.0.0.1:8000" />
          <button class="setup-test-btn" id="setupTestBtn">Test ↗</button>
        </div>
        <p class="setup-hint" id="urlHint"></p>
      </div>

      <div class="setup-step">
        <label class="field-label">API Key</label>
        <input id="setupKeyInput" class="setup-input" type="text"
          placeholder="Paste an existing key…"
          value="${escHtml(sessionStorage.getItem('entrupy_api_key') || '')}"
          style="width:100%;margin-bottom:14px" />

        <div class="setup-divider"><span>or generate a new key</span></div>

        <div class="setup-row" style="margin-top:10px">
          <input id="setupKeyName" class="setup-input" type="text"
            placeholder="Key label  (e.g. dashboard-dev)" style="flex:1" />
          <button class="setup-gen-btn" id="setupGenBtn">Generate Key</button>
        </div>
        <p class="setup-hint" id="keyHint"></p>
        <div id="generatedKeyBox" style="display:none" class="generated-key-box"></div>
      </div>

      <div class="modal-footer">
        <button class="modal-connect-btn" id="modalConnectBtn">Connect →</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  injectModalStyles();
  bindModalEvents(modal);
}

function injectModalStyles() {
  if ($('#modalStyles')) return;
  const s = document.createElement('style');
  s.id = 'modalStyles';
  s.textContent = `
    #setupModal{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center}
    .modal-backdrop{position:absolute;inset:0;background:rgba(8,8,16,.88);backdrop-filter:blur(8px)}
    .modal-box{
      position:relative;z-index:1;background:var(--card);
      border:1px solid var(--border-mid);border-radius:16px;
      padding:36px;width:min(520px,94vw);
      box-shadow:0 28px 72px rgba(0,0,0,.65);
      animation:fadeUp .28s ease;
    }
    .modal-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
    .modal-title{font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text)}
    .modal-desc{font-size:13px;color:var(--text-mid);margin-bottom:26px;line-height:1.65}
    .setup-step{margin-bottom:24px}
    .setup-step .field-label{display:block;margin-bottom:8px}
    .setup-row{display:flex;gap:8px;align-items:center}
    .setup-input{
      background:var(--surface);border:1px solid var(--border-mid);
      border-radius:8px;padding:10px 14px;font-size:13px;color:var(--text);
      outline:none;font-family:var(--font-mono);transition:border-color .2s;
    }
    .setup-input:focus{border-color:var(--gold-dim)}
    .setup-input::placeholder{color:var(--text-dim)}
    .setup-test-btn,.setup-gen-btn{
      background:var(--surface);border:1px solid var(--border-mid);
      border-radius:8px;padding:10px 16px;font-size:12px;color:var(--text-mid);
      cursor:pointer;white-space:nowrap;transition:all .2s;font-family:var(--font-mono);
    }
    .setup-test-btn:hover,.setup-gen-btn:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--gold-glow)}
    .setup-hint{font-size:11.5px;font-family:var(--font-mono);margin-top:8px;min-height:16px;transition:all .2s}
    .setup-hint.ok{color:var(--green)} .setup-hint.err{color:var(--red)}
    .setup-divider{display:flex;align-items:center;gap:12px;margin:4px 0}
    .setup-divider::before,.setup-divider::after{content:'';flex:1;height:1px;background:var(--border)}
    .setup-divider span{font-size:11px;color:var(--text-dim);white-space:nowrap}
    .generated-key-box{
      background:var(--surface);border:1px solid var(--green);border-radius:8px;
      padding:12px 14px;font-family:var(--font-mono);font-size:12px;color:var(--green);
      word-break:break-all;margin-top:10px;cursor:pointer;position:relative;
    }
    .generated-key-box:hover{background:rgba(76,175,135,.08)}
    .generated-key-box::after{
      content:'Click to copy';position:absolute;top:6px;right:10px;
      font-size:10px;color:var(--text-dim);pointer-events:none;
    }
    .modal-footer{margin-top:30px;display:flex;justify-content:flex-end}
    .modal-connect-btn{
      background:var(--gold);color:var(--bg);font-size:13px;font-weight:700;
      letter-spacing:.06em;padding:12px 30px;border-radius:8px;
      transition:opacity .2s;cursor:pointer;font-family:var(--font-body);
    }
    .modal-connect-btn:hover{opacity:.85}
  `;
  document.head.appendChild(s);
}

function bindModalEvents(modal) {
  // Test URL button
  $('#setupTestBtn', modal).addEventListener('click', async () => {
    const rawUrl = $('#setupUrl', modal).value.trim().replace(/\/$/, '');
    const hint   = $('#urlHint', modal);
    hint.textContent = 'Testing connection…'; hint.className = 'setup-hint';
    try {
      const res = await fetch(rawUrl + '/health');
      if (res.ok) {
        hint.textContent = '● Server is reachable ✓';
        hint.className   = 'setup-hint ok';
        CONFIG.BASE_URL  = rawUrl;
      } else {
        hint.textContent = `● Server replied ${res.status} — is it running?`;
        hint.className   = 'setup-hint err';
      }
    } catch (e) {
      hint.textContent = `● Cannot connect — ${e.message}`;
      hint.className   = 'setup-hint err';
    }
  });

  // Generate key button
  $('#setupGenBtn', modal).addEventListener('click', async () => {
    const rawUrl = ($('#setupUrl', modal).value.trim() || CONFIG.BASE_URL).replace(/\/$/, '');
    const name   = ($('#setupKeyName', modal).value.trim() || 'dashboard-ui');
    const hint   = $('#keyHint', modal);
    const box    = $('#generatedKeyBox', modal);
    hint.textContent = 'Generating…'; hint.className = 'setup-hint';
    box.style.display = 'none';

    CONFIG.BASE_URL = rawUrl;
    try {
      const res = await fetch(`${rawUrl}/api-keys?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data  = await res.json();
      const keyVal = data.key;

      // Show & fill
      box.textContent   = keyVal;
      box.style.display = 'block';
      box.onclick = () => {
        navigator.clipboard.writeText(keyVal).catch(() => {});
        toast('Key copied ✓', 'success');
      };
      $('#setupKeyInput', modal).value = keyVal;
      sessionStorage.setItem('entrupy_api_key', keyVal);

      hint.textContent = `● Key "${name}" created ✓`;
      hint.className   = 'setup-hint ok';
      toast(`Key "${name}" created ✓`, 'success');
    } catch (e) {
      hint.textContent = `● ${e.message}`;
      hint.className   = 'setup-hint err';
      toast(e.message, 'error');
    }
  });

  // Connect button
  $('#modalConnectBtn', modal).addEventListener('click', async () => {
    const rawUrl = ($('#setupUrl', modal).value.trim()).replace(/\/$/, '');
    const key    = $('#setupKeyInput', modal).value.trim();
    if (!rawUrl) { toast('Enter the backend URL', 'error'); return; }
    if (!key)    { toast('Enter or generate an API key', 'error'); return; }

    CONFIG.BASE_URL = rawUrl;
    state.apiKey    = key;
    sessionStorage.setItem('entrupy_api_key', key);

    showLoading('Verifying connection…');
    try {
      await apiFetch('/health');
      modal.remove();
      setKeyStatus('ok', '● Connected');
      $('#apiKeyInput').value = key;
      toast('Connected ✓', 'success');
      await loadView('dashboard');
    } catch (e) {
      state.apiKey = '';
      toast(e.message, 'error');
    } finally {
      hideLoading();
    }
  });
}

/* ─── API Key (sidebar shortcut) ────────────────────────── */
function setKeyStatus(type, msg) {
  const el = $('#keyStatus');
  el.textContent = msg;
  el.className   = `key-status ${type}`;
}

async function applyApiKey() {
  const key = $('#apiKeyInput').value.trim();
  if (!key) { toast('Please enter an API key', 'error'); return; }
  state.apiKey = key;
  sessionStorage.setItem('entrupy_api_key', key);
  setKeyStatus('', 'Checking…');
  try {
    await apiFetch('/health');
    setKeyStatus('ok', '● Connected');
    toast('API key accepted ✓', 'success');
    await loadCurrentView();
  } catch (e) {
    state.apiKey = '';
    setKeyStatus('err', '● ' + e.message);
    toast(e.message, 'error');
  }
}

/* ─── Dashboard ──────────────────────────────────────────── */
async function loadDashboard() {
  showLoading('Loading analytics…');
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
  $('#statTotalProducts').textContent = (data.total_products          ?? 0).toLocaleString();
  $('#statTotalRecords').textContent  = (data.total_price_records     ?? 0).toLocaleString();
  $('#statAvgPrice').textContent      = fmtPrice(data.average_price);
  $('#statChanges').textContent       = (data.products_with_price_changes ?? 0).toLocaleString();
}

function renderCategoryChart(categories) {
  $('#categoryCount').textContent = categories.length + ' categories';
  const canvas  = $('#categoryChart');
  const ctx     = canvas.getContext('2d');
  const dpr     = window.devicePixelRatio || 1;
  const COLOURS = ['#c9a84c','#4caf87','#5a8ae0','#e05a5a','#a04ce0','#4cc9c9','#e07a4c','#7ae04c'];
  const maxCount = Math.max(...categories.map(c => c.product_count), 1);

  function draw() {
    const W = canvas.offsetWidth || 400, H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);

    if (!categories.length) {
      ctx.fillStyle = '#6a6478'; ctx.font = '13px IBM Plex Mono';
      ctx.textAlign = 'center';
      ctx.fillText('No data — run /refresh to ingest products', W / 2, H / 2);
      return;
    }

    const PAD_L = 8, PAD_R = 8, PAD_TOP = 10, PAD_BOT = 32;
    const n = categories.length, availW = W - PAD_L - PAD_R;
    const barW = Math.max(20, (availW / n) - 8), step = availW / n;
    const chartH = H - PAD_TOP - PAD_BOT;

    categories.forEach((cat, i) => {
      const x   = PAD_L + i * step + (step - barW) / 2;
      const pct = cat.product_count / maxCount;
      const bH  = Math.max(4, pct * chartH);
      const y   = PAD_TOP + chartH - bH;
      const col = COLOURS[i % COLOURS.length];

      ctx.fillStyle = col + '33'; roundRect(ctx, x, y, barW, bH, 4); ctx.fill();
      ctx.fillStyle = col;        roundRect(ctx, x, y, barW, 4, 2); ctx.fill();

      ctx.fillStyle = col; ctx.font = 'bold 11px IBM Plex Mono'; ctx.textAlign = 'center';
      ctx.fillText(cat.product_count, x + barW / 2, y - 5);

      ctx.fillStyle = '#a09898'; ctx.font = '11px Instrument Sans';
      ctx.fillText(cat.category.length > 10 ? cat.category.slice(0,9)+'…' : cat.category,
        x + barW / 2, H - PAD_BOT + 16);
    });
  }

  $('#chartLegend').innerHTML = categories.map((c, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${COLOURS[i%COLOURS.length]}"></span>
      <span>${escHtml(c.category)}</span>
      <span class="legend-count">${c.product_count}</span>
    </div>`).join('');

  draw();
  // Debounced resize
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 80); }, { passive: true });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);   ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);     ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

/* ─── Products ───────────────────────────────────────────── */
async function loadProducts() {
  showLoading('Loading products…');
  try {
    const params = new URLSearchParams({ limit: 500, offset: 0 });
    if (state.filterCategory) params.set('category', state.filterCategory);
    if (state.filterMin != null) params.set('min_price', state.filterMin);
    if (state.filterMax != null) params.set('max_price', state.filterMax);

    const data = await apiFetch('/products?' + params);
    state.products = data.products || [];
    populateCategoryFilter(state.products);
    state.currentPage = 1;
    applyLocalFilter();
  } catch (e) {
    toast(e.message, 'error');
    $('#productTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <span class="empty-icon">✕</span><p>${escHtml(e.message)}</p></div></td></tr>`;
  } finally { hideLoading(); }
}

function populateCategoryFilter(products) {
  const cats = [...new Set(products.map(p => p.category))].filter(Boolean).sort();
  const sel  = $('#filterCategory');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${escHtml(c)}"${c===prev?' selected':''}>${escHtml(c)}</option>`).join('');
}

function applyLocalFilter() {
  const q = state.search.toLowerCase().trim();
  state.filtered = state.products.filter(p =>
    !q || `${p.name} ${p.brand} ${p.category} ${p.original_source}`.toLowerCase().includes(q)
  );
  state.filtered.sort((a, b) => {
    let av = a[state.sortCol], bv = b[state.sortCol];
    if (av == null) av = state.sortDir === 'asc' ?  Infinity : -Infinity;
    if (bv == null) bv = state.sortDir === 'asc' ?  Infinity : -Infinity;
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return av < bv ? (state.sortDir === 'asc' ? -1 :  1) :
           av > bv ? (state.sortDir === 'asc' ?  1 : -1) : 0;
  });
  renderProductTable();
  renderPagination();
}

function renderProductTable() {
  const tbody = $('#productTableBody');
  const start = (state.currentPage - 1) * CONFIG.PAGE_SIZE;
  const page  = state.filtered.slice(start, start + CONFIG.PAGE_SIZE);
  $('#resultCount').textContent = `${state.filtered.length} product${state.filtered.length !== 1 ? 's' : ''}`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <span class="empty-icon">◈</span><p>No products match your search</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = page.map(p => `
    <tr>
      <td class="name-cell">${escHtml(truncate(p.name, 42))}</td>
      <td>${escHtml(p.brand || '—')}</td>
      <td>${escHtml(p.category || '—')}</td>
      <td><span class="source-tag" title="${escHtml(p.original_source)}">${escHtml(truncate(p.original_source, 22))}</span></td>
      <td class="price-cell">${fmtPrice(p.latest_price)}</td>
      <td class="date-cell">${fmtDate(p.updated_at)}</td>
      <td><button class="view-btn" data-id="${p.id}">History →</button></td>
    </tr>`).join('');

  $$('.view-btn', tbody).forEach(btn =>
    btn.addEventListener('click', () => openProductDetail(+btn.dataset.id))
  );
}

function renderPagination() {
  const total = Math.ceil(state.filtered.length / CONFIG.PAGE_SIZE);
  const pg = $('#pagination');
  if (total <= 1) { pg.innerHTML = ''; return; }

  const pages = [];
  if (state.currentPage > 1) pages.push({ label: '‹', page: state.currentPage - 1 });
  let lo = Math.max(1, state.currentPage - 2), hi = Math.min(total, lo + 4);
  if (hi - lo < 4) lo = Math.max(1, hi - 4);
  for (let i = lo; i <= hi; i++) pages.push({ label: String(i), page: i, active: i === state.currentPage });
  if (state.currentPage < total) pages.push({ label: '›', page: state.currentPage + 1 });

  pg.innerHTML = pages.map(p =>
    `<button class="page-btn ${p.active ? 'active' : ''}" data-page="${p.page}">${p.label}</button>`
  ).join('');
  $$('.page-btn', pg).forEach(btn => btn.addEventListener('click', () => {
    state.currentPage = +btn.dataset.page;
    renderProductTable(); renderPagination();
  }));
}

/* ─── Product Detail ─────────────────────────────────────── */
async function openProductDetail(id) {
  state.currentProductId = id;
  const p = state.products.find(x => x.id === id);
  if (p) {
    $('#detailName').textContent         = p.name;
    $('#detailBrand').textContent        = p.brand || '—';
    $('#detailCategory').textContent     = p.category || '—';
    $('#detailCurrentPrice').textContent = fmtPrice(p.latest_price);
    $('#detailSource').textContent       = truncate(p.original_source, 38);
    $('#detailCreated').textContent      = fmtDate(p.created_at);
    $('#detailUpdated').textContent      = fmtDate(p.updated_at);
  }
  switchView('detail');
  await loadProductHistory(id);
}

async function loadProductHistory(id) {
  $('#historyTableBody').innerHTML = `<tr><td colspan="5" class="loading-cell">Loading history…</td></tr>`;
  showLoading('Loading price history…');
  try {
    const data    = await apiFetch(`/products/${id}/history?limit=100`);
    const history = data.history || [];
    $('#historyCount').textContent = `${history.length} record${history.length !== 1 ? 's' : ''}`;

    if (history.length >= 2) {
      const newest = history[0].price, oldest = history[history.length - 1].price;
      const delta  = newest - oldest;
      const pct    = oldest ? ((delta / oldest) * 100).toFixed(1) : 0;
      const el = $('#priceDelta');
      el.textContent = delta === 0 ? 'No change'
        : `${delta > 0 ? '+' : ''}${fmtPrice(delta)} (${delta > 0 ? '+' : ''}${pct}%)`;
      el.className = `delta-value ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`;
    } else {
      $('#priceDelta').textContent = history.length === 1 ? 'Single record' : '—';
      $('#priceDelta').className   = 'delta-value';
    }

    renderSparkline(history);
    renderHistoryTable(history);
  } catch (e) {
    toast(e.message, 'error');
    $('#historyTableBody').innerHTML = `<tr><td colspan="5" class="loading-cell">${escHtml(e.message)}</td></tr>`;
  } finally { hideLoading(); }
}

function renderHistoryTable(history) {
  const tbody = $('#historyTableBody');
  if (!history.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">No price history recorded yet</td></tr>`;
    return;
  }
  tbody.innerHTML = history.map((h, i) => {
    const prev = history[i + 1];
    let changeTd = `<td class="change-none">—</td>`;
    if (prev) {
      const diff = h.price - prev.price;
      const pct  = prev.price ? ((diff / prev.price) * 100).toFixed(1) : 0;
      if      (diff > 0) changeTd = `<td class="change-up">▲ ${fmtPrice(diff)} (+${pct}%)</td>`;
      else if (diff < 0) changeTd = `<td class="change-down">▼ ${fmtPrice(Math.abs(diff))} (${pct}%)</td>`;
      else               changeTd = `<td class="change-none">No change</td>`;
    }
    return `<tr>
      <td class="date-cell">${history.length - i}</td>
      <td class="price-cell">${fmtPrice(h.price)}</td>
      <td><span class="source-tag" title="${escHtml(h.source)}">${escHtml(truncate(h.source, 24))}</span></td>
      <td class="date-cell">${fmtDateTime(h.timestamp)}</td>
      ${changeTd}
    </tr>`;
  }).join('');
}

function renderSparkline(history) {
  const canvas = $('#sparklineChart'), ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 600, H = 140;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);

  if (history.length < 2) {
    ctx.fillStyle = '#6a6478'; ctx.font = '12px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Insufficient data for trend chart', W / 2, H / 2);
    return;
  }

  const pts    = [...history].reverse();
  const prices = pts.map(h => h.price);
  const minP   = Math.min(...prices), maxP = Math.max(...prices), range = maxP - minP || 1;
  const PAD    = 16, plotW = W - PAD * 2, plotH = H - PAD * 2;
  const toX = i => PAD + (i / (pts.length - 1)) * plotW;
  const toY = v => PAD + (1 - (v - minP) / range) * plotH;

  const grad = ctx.createLinearGradient(0, PAD, 0, H - PAD);
  grad.addColorStop(0, 'rgba(201,168,76,0.25)');
  grad.addColorStop(1, 'rgba(201,168,76,0)');

  ctx.beginPath(); ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < pts.length; i++) {
    const cpx = (toX(i - 1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(prices[i-1]), cpx, toY(prices[i]), toX(i), toY(prices[i]));
  }
  ctx.lineTo(toX(pts.length - 1), H); ctx.lineTo(toX(0), H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < pts.length; i++) {
    const cpx = (toX(i - 1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(prices[i-1]), cpx, toY(prices[i]), toX(i), toY(prices[i]));
  }
  ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2; ctx.stroke();

  const lx = toX(pts.length-1), ly = toY(prices[prices.length-1]);
  ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#c9a84c'; ctx.fill();
  ctx.strokeStyle = '#080810'; ctx.lineWidth = 2; ctx.stroke();

  ctx.fillStyle = '#6a6478'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'right';
  ctx.fillText(fmtPrice(maxP), W - 4, PAD + 10);
  ctx.fillText(fmtPrice(minP), W - 4, H - 6);
}

/* ─── Webhooks ───────────────────────────────────────────── */
async function loadWebhooks() {
  showLoading('Loading webhooks…');
  try {
    const data = await apiFetch('/webhooks');
    renderWebhooksTable(data.webhooks || []);
  } catch (e) { toast(e.message, 'error'); }
  finally     { hideLoading(); }
}

function renderWebhooksTable(webhooks) {
  const tbody = $('#webhookTableBody');
  if (!webhooks.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <span class="empty-icon">⊕</span><p>No webhooks registered yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = webhooks.map(wh => `
    <tr>
      <td class="date-cell">#${wh.id}</td>
      <td style="word-break:break-all;font-size:12px">${escHtml(wh.url)}</td>
      <td><span class="${wh.is_active ? 'status-active' : 'status-inactive'}">${wh.is_active ? '● Active' : '● Inactive'}</span></td>
      <td class="date-cell">${fmtDate(wh.created_at)}</td>
      <td><button class="delete-btn" data-id="${wh.id}">Delete</button></td>
    </tr>`).join('');
  $$('.delete-btn', tbody).forEach(btn =>
    btn.addEventListener('click', () => deleteWebhook(+btn.dataset.id))
  );
}

async function registerWebhook() {
  const url = $('#webhookUrlInput').value.trim();
  const err = $('#webhookError');
  if (!url) { err.textContent = 'Please enter a valid URL.'; return; }
  err.textContent = '';
  showLoading('Registering webhook…');
  try {
    await apiFetch(`/webhooks?url=${encodeURIComponent(url)}`, { method: 'POST' });
    $('#webhookUrlInput').value = '';
    toast('Webhook registered ✓', 'success');
    await loadWebhooks();
  } catch (e) {
    err.textContent = e.message;
    toast(e.message, 'error');
  } finally { hideLoading(); }
}

async function deleteWebhook(id) {
  if (!confirm(`Delete webhook #${id}?`)) return;
  showLoading();
  try {
    await apiFetch(`/webhooks/${id}`, { method: 'DELETE' });
    toast(`Webhook #${id} deleted`, 'success');
    await loadWebhooks();
  } catch (e) { toast(e.message, 'error'); }
  finally     { hideLoading(); }
}

/* ─── View Switching ─────────────────────────────────────── */
function switchView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const target = $(`#view-${name}`);
  if (target) target.classList.add('active');
  const btn = $(`.nav-item[data-view="${name}"]`);
  if (btn) btn.classList.add('active');
  $('#sidebar').classList.remove('open');
}

async function loadCurrentView() {
  const active = $$('.nav-item').find(n => n.classList.contains('active'))?.dataset.view || 'dashboard';
  await loadView(active);
}

async function loadView(name) {
  if (!state.apiKey) { showSetupModal(); return; }
  switchView(name);
  if      (name === 'dashboard') await loadDashboard();
  else if (name === 'products')  await loadProducts();
  else if (name === 'webhooks')  await loadWebhooks();
}

/* ─── Event Bindings ─────────────────────────────────────── */
function bindEvents() {
  $('#applyKeyBtn').addEventListener('click', applyApiKey);
  $('#apiKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyApiKey(); });

  $$('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => loadView(btn.dataset.view))
  );

  $('#dashRefreshBtn').addEventListener('click', loadDashboard);
  $('#prodRefreshBtn').addEventListener('click', () => { state.currentPage = 1; loadProducts(); });

  const searchInput = $('#productSearch');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    $('#clearSearch').style.display = state.search ? 'block' : 'none';
    state.currentPage = 1;
    applyLocalFilter();
  });
  $('#clearSearch').addEventListener('click', () => {
    searchInput.value = ''; state.search = '';
    $('#clearSearch').style.display = 'none';
    state.currentPage = 1; applyLocalFilter();
  });

  $('#applyFiltersBtn').addEventListener('click', () => {
    const min = parseFloat($('#filterMinPrice').value);
    const max = parseFloat($('#filterMaxPrice').value);
    state.filterMin = isNaN(min) ? null : min;
    state.filterMax = isNaN(max) ? null : max;
    state.filterCategory = $('#filterCategory').value;
    state.currentPage = 1;
    loadProducts();
  });
  $('#clearFiltersBtn').addEventListener('click', () => {
    $('#filterMinPrice').value = ''; $('#filterMaxPrice').value = '';
    $('#filterCategory').value = '';
    state.filterMin = state.filterMax = null; state.filterCategory = '';
    state.currentPage = 1; loadProducts();
  });

  $$('.sortable').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    state.sortDir = (state.sortCol === col && state.sortDir === 'asc') ? 'desc' : 'asc';
    state.sortCol = col;
    $$('.sortable .sort-icon').forEach(ic => ic.textContent = '↕');
    th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓';
    applyLocalFilter();
  }));

  $('#backToProducts').addEventListener('click', () => switchView('products'));
  $('#detailRefreshBtn').addEventListener('click', () => {
    if (state.currentProductId) loadProductHistory(state.currentProductId);
  });

  $('#whRefreshBtn').addEventListener('click', loadWebhooks);
  $('#registerWebhookBtn').addEventListener('click', registerWebhook);
  $('#webhookUrlInput').addEventListener('keydown', e => { if (e.key === 'Enter') registerWebhook(); });

  $('#hamburger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#mainContent').addEventListener('click', () => {
    if (window.innerWidth < 768) $('#sidebar').classList.remove('open');
  });
}

/* ─── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();

  const savedKey = sessionStorage.getItem('entrupy_api_key');
  const savedUrl = sessionStorage.getItem('entrupy_base_url');
  if (savedUrl) CONFIG.BASE_URL = savedUrl;

  if (savedKey) {
    state.apiKey = savedKey;
    $('#apiKeyInput').value = savedKey;
    setKeyStatus('ok', '● Key restored');
    loadView('dashboard');
  } else {
    // First visit — show setup modal
    showSetupModal();
  }

  $('#apiKeyInput').addEventListener('change', () => {
    const v = $('#apiKeyInput').value.trim();
    if (v) sessionStorage.setItem('entrupy_api_key', v);
  });
});
