/* ============================================================
    Price Monitor  |  app.js (Updated for CSV/JSON structure)
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
  products:         [],      // Will hold the direct array from API
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

function showLoading(msg = 'Fetching data...') {
  $('#loadingOverlay').classList.add('active');
  $('.spinner-text').textContent = msg;
}

function hideLoading() {
  $('#loadingOverlay').classList.remove('active');
}

function showToast(msg, type = 'info') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

const fmtPrice = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);

/* ─── API Layer ──────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const url = `${CONFIG.BASE_URL}${path}`;
  const headers = {
    'X-API-Key': state.apiKey,
    'Content-Type': 'application/json',
    ...options.headers
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (res.status === 403) {
      showToast('Session expired or invalid key.', 'error');
      showSetupModal();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
    throw err;
  }
}

/* ─── View Management ────────────────────────────────────── */
function switchView(viewId) {
  $$('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  $$('.view-section').forEach(el => {
    el.classList.toggle('active', el.id === `${viewId}View`);
  });
  
  if (viewId === 'dashboard') loadDashboard();
  if (viewId === 'products') loadProducts();
  if (viewId === 'webhooks') loadWebhooks();
}

function loadView(viewId) {
  $('#setupModal').classList.remove('active');
  switchView(viewId);
}

/* ─── Logic: Dashboard ───────────────────────────────────── */
async function loadDashboard() {
  showLoading('Loading analytics...');
  try {
    const data = await apiFetch('/analytics');
    $('#statTotalProducts').textContent = data.total_products || 0;
    $('#statTotalChanges').textContent = data.total_price_changes || 0;
    $('#statAvgPrice').textContent = fmtPrice(data.avg_price);
    
    renderCategoryChart(data.category_distribution || {});
  } catch (e) {
  } finally {
    hideLoading();
  }
}

function renderCategoryChart(dist) {
  const canvas = $('#categoryChart');
  const ctx = canvas.getContext('2d');
  const entries = Object.entries(dist);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!entries.length) return;

  const max = Math.max(...entries.map(e => e[1]));
  const barW = 40;
  const gap = 20;

  entries.forEach(([label, val], i) => {
    const h = (val / max) * (canvas.height - 40);
    const x = i * (barW + gap) + 40;
    const y = canvas.height - h - 20;

    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x, y, barW, h);
    
    ctx.fillStyle = '#64748b';
    ctx.font = '10px IBM Plex Mono';
    ctx.fillText(label.substring(0, 6), x, canvas.height - 5);
    ctx.fillText(val, x + 10, y - 5);
  });
}

/* ─── Logic: Products ────────────────────────────────────── */
async function loadProducts() {
  showLoading('Fetching product list...');
  try {
    // The updated backend returns the array directly
    const data = await apiFetch('/products');
    state.products = Array.isArray(data) ? data : (data.products || []);
    applyLocalFilter();
  } catch (e) {
  } finally {
    hideLoading();
  }
}

function applyLocalFilter() {
  let filtered = state.products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(state.search.toLowerCase()) || 
                        p.brand.toLowerCase().includes(state.search.toLowerCase());
    return matchSearch;
  });

  filtered.sort((a, b) => {
    let vA = a[state.sortCol];
    let vB = b[state.sortCol];
    if (typeof vA === 'string') {
      vA = vA.toLowerCase();
      vB = vB.toLowerCase();
    }
    if (vA < vB) return state.sortDir === 'asc' ? -1 : 1;
    if (vA > vB) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  state.filtered = filtered;
  renderProducts();
}

function renderProducts() {
  const container = $('#productTableBody');
  if (state.filtered.length === 0) {
    container.innerHTML = '<tr><td colspan="4" class="empty-state">No products found.</td></tr>';
    return;
  }

  container.innerHTML = state.filtered.map(p => {
    // Handle the new 'images' JSON structure from output2.csv
    const imgUrl = (p.images && p.images.length > 0) 
      ? p.images[0].url 
      : 'https://via.placeholder.com/150?text=No+Image';

    return `
      <tr>
        <td>
          <div class="product-cell">
            <img src="${imgUrl}" alt="${p.name}" class="product-img-tiny" onerror="this.src='https://via.placeholder.com/50'">
            <div class="product-info">
              <div class="product-name-text" title="${p.name}">${p.name}</div>
              <div class="product-brand-sub">${p.brand}</div>
            </div>
          </div>
        </td>
        <td class="mono">${fmtPrice(p.price)}</td>
        <td class="text-sub mono">${new Date(p.updated_at).toLocaleDateString()}</td>
        <td class="text-right">
          <div class="action-group">
            <a href="${p.url}" target="_blank" class="btn-icon" title="View Original Source">↗</a>
            <button onclick="viewProductDetail(${p.id})" class="btn-sm">History</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ─── Logic: Details ─────────────────────────────────────── */
async function viewProductDetail(id) {
  state.currentProductId = id;
  const product = state.products.find(p => p.id === id);
  if (!product) return;

  $('#detailName').textContent = product.name;
  $('#detailBrand').textContent = product.brand;
  switchView('details');
  loadProductHistory(id);
}

async function loadProductHistory(id) {
  try {
    const history = await apiFetch(`/products/${id}/history`);
    renderHistoryTable(history);
    renderPriceChart(history);
  } catch (e) {}
}

function renderHistoryTable(history) {
  const container = $('#historyTableBody');
  container.innerHTML = history.map(h => `
    <tr>
      <td class="mono">${fmtPrice(h.price)}</td>
      <td class="text-sub mono">${new Date(h.timestamp).toLocaleString()}</td>
    </tr>
  `).join('');
}

function renderPriceChart(history) {
  const canvas = $('#priceHistoryChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (history.length < 2) return;

  const prices = history.map(h => h.price);
  const min = Math.min(...prices) * 0.95;
  const max = Math.max(...prices) * 1.05;
  const range = max - min;

  ctx.beginPath();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;

  history.forEach((h, i) => {
    const x = (i / (history.length - 1)) * canvas.width;
    const y = canvas.height - ((h.price - min) / range) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ─── Logic: Webhooks ────────────────────────────────────── */
async function loadWebhooks() {
  try {
    const data = await apiFetch('/webhooks');
    const container = $('#webhookTableBody');
    const list = data.webhooks || [];
    
    container.innerHTML = list.length 
      ? list.map(w => `
          <tr>
            <td class="mono">${w.id}</td>
            <td class="mono text-truncate" style="max-width:200px">${w.url}</td>
            <td><span class="status-tag ${w.is_active ? 'tag-ok' : 'tag-err'}">${w.is_active ? 'Active' : 'Paused'}</span></td>
            <td class="text-sub">${new Date(w.created_at).toLocaleDateString()}</td>
            <td><button onclick="deleteWebhook(${w.id})" class="btn-danger-sm">Delete</button></td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="empty-state">No webhooks registered.</td></tr>';
  } catch (e) {}
}

async function registerWebhook() {
  const url = $('#webhookUrlInput').value.trim();
  if (!url) return;

  try {
    await apiFetch('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
    $('#webhookUrlInput').value = '';
    showToast('Webhook registered successfully', 'success');
    loadWebhooks();
  } catch (e) {}
}

async function deleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  try {
    await apiFetch(`/webhooks/${id}`, { method: 'DELETE' });
    loadWebhooks();
  } catch (e) {}
}

/* ─── Initialization & Events ─────────────────────────────── */
function showSetupModal() {
  $('#setupModal').classList.add('active');
}

function bindEvents() {
  // Navigation
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Setup / Auth
  $('#connectBtn').addEventListener('click', () => {
    const key = $('#apiKeyInput').value.trim();
    const url = $('#baseUrlInput').value.trim();
    if (!key) return showToast('API Key is required', 'error');

    state.apiKey = key;
    if (url) CONFIG.BASE_URL = url;
    
    sessionStorage.setItem('entrupy_api_key', key);
    loadView('dashboard');
  });

  // Search & Filter
  $('#productSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    applyLocalFilter();
  });

  // Table Sort
  $$('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = 'asc';
    }
    
    $$('th[data-sort]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    applyLocalFilter();
  }));

  // Detail View Back
  $('#backToProducts').addEventListener('click', () => switchView('products'));
  
  // Webhooks
  $('#registerWebhookBtn').addEventListener('click', registerWebhook);

  // Sidebar Toggle (Mobile)
  $('#hamburger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();

  const savedKey = sessionStorage.getItem('entrupy_api_key');
  const savedUrl = sessionStorage.getItem('entrupy_base_url');
  
  if (savedUrl) {
    CONFIG.BASE_URL = savedUrl;
    $('#baseUrlInput').value = savedUrl;
  }

  if (savedKey) {
    state.apiKey = savedKey;
    $('#apiKeyInput').value = savedKey;
    loadView('dashboard');
  } else {
    showSetupModal();
  }
});