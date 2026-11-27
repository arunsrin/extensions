import {
  aggregateBuckets,
  fillDailySeries,
  resolveDateRange,
  toCsv,
} from '../shared/aggregator.js';
import { PAUSE_LABELS } from '../shared/constants.js';
import { createStorageClient } from '../shared/storage.js';
import {
  formatCompactDuration,
  formatDuration,
  formatRelativeTime,
  getLocalDateKey,
} from '../shared/time.js';
import { domainColor, domainInitial, isSafeHttpUrl, normalizeDomain } from '../shared/url.js';
import { PAGE_ACTIONS } from './actions.js';

function bindActivate(el, handler) {
  el.tabIndex = 0;
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  });
}

const storage = createStorageClient(chrome.storage.local);

const state = {
  section: 'overview',
  range: '7d',
  customStart: getLocalDateKey(),
  customEnd: getLocalDateKey(),
  domainFilter: '',
  searchQuery: '',
  minPageMs: 0,
  pagesSort: 'time',
  status: null,
  buckets: [],
  agg: null,
};

let toastTimer = null;

function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('hidden');
  }, 2400);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseHashRoute() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return;
  const [section, queryStr] = raw.split('?');
  if (['overview', 'pages', 'daily', 'settings'].includes(section)) {
    state.section = section;
  }
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    const domain = params.get('domain');
    if (domain) {
      state.domainFilter = normalizeDomain(domain);
    }
  }
}

function renderStatus(status) {
  const pill = document.getElementById('status-pill');
  const toggleBtn = document.getElementById('toggle-pause-btn');

  pill.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  pill.appendChild(dot);

  const label = document.createElement('span');
  if (status?.isTracking && status.activeSession) {
    pill.className = 'status-pill tracking';
    label.textContent = `Tracking: ${status.activeSession.domain}`;
  } else if (status?.settings?.trackingPaused) {
    pill.className = 'status-pill paused';
    label.textContent = 'Tracking Paused';
  } else {
    pill.className = 'status-pill';
    label.textContent = PAUSE_LABELS[status?.pauseReason] || 'Standby';
  }
  pill.appendChild(label);
  toggleBtn.textContent = status?.settings?.trackingPaused ? 'Resume Tracking' : 'Pause Tracking';
}

function switchSection(section) {
  state.section = section;
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const active = tab.dataset.section === section;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ['overview', 'pages', 'daily', 'settings'].forEach((name) => {
    document
      .getElementById(`section-${name}`)
      .classList.toggle('hidden', name !== section);
  });
  document.getElementById('filter-bar').classList.toggle('hidden', section === 'settings');
  renderCurrentView();
}

function renderKpis(agg, startDate, endDate) {
  document.getElementById('kpi-total').textContent = formatDuration(agg.totalMs);
  document.getElementById('kpi-range-text').textContent =
    startDate && endDate ? `${startDate} → ${endDate}` : 'All recorded days';

  document.getElementById('kpi-avg').textContent = formatDuration(agg.avgPerDayMs);
  document.getElementById('kpi-days-text').textContent =
    `${agg.activeDaysCount} active day${agg.activeDaysCount === 1 ? '' : 's'}`;

  document.getElementById('kpi-domains').textContent = String(agg.uniqueDomainsCount);
  const topSite = agg.domains[0];
  document.getElementById('kpi-top-site').textContent = topSite
    ? `Top: ${topSite.domain} (${formatDuration(topSite.totalMs)})`
    : 'Top: —';

  document.getElementById('kpi-pages').textContent = String(agg.uniquePagesCount);
  const topPage = agg.pages[0];
  document.getElementById('kpi-top-page').textContent = topPage
    ? `Longest: ${topPage.title || topPage.url}`
    : 'Longest: —';
}

function renderChart(agg, startDate, endDate) {
  const chart = document.getElementById('daily-chart');
  const meta = document.getElementById('chart-meta');
  chart.textContent = '';

  const series =
    startDate && endDate
      ? fillDailySeries(agg.dailySeries, startDate, endDate)
      : agg.dailySeries.slice(-30);

  if (series.length === 0) {
    meta.textContent = 'No data';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Browse some websites to see your daily activity chart.';
    chart.appendChild(empty);
    return;
  }

  const maxMs = Math.max(1, ...series.map((d) => d.totalMs));
  meta.textContent = `Peak day: ${formatDuration(maxMs)}`;

  for (const day of series) {
    const col = document.createElement('div');
    col.className = 'chart-col';
    col.title = `${day.date}: ${formatDuration(day.totalMs)}${day.topDomain ? ` (Top: ${day.topDomain})` : ''}`;

    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const bar = document.createElement('div');
    bar.className = day.totalMs > 0 ? 'chart-bar' : 'chart-bar empty';
    const pct = day.totalMs > 0 ? Math.max(4, Math.round((day.totalMs / maxMs) * 100)) : 3;
    bar.style.height = `${pct}%`;

    wrap.appendChild(bar);

    const lbl = document.createElement('div');
    lbl.className = 'chart-label mono';
    lbl.textContent = series.length <= 14 ? day.date.slice(5) : day.date.slice(8);

    col.append(wrap, lbl);
    col.setAttribute('role', 'button');
    bindActivate(col, () => {
      state.range = 'custom';
      state.customStart = day.date;
      state.customEnd = day.date;
      document.getElementById('custom-start').value = day.date;
      document.getElementById('custom-end').value = day.date;
      syncRangePills();
      recomputeAndRender();
    });
    chart.appendChild(col);
  }
}

function renderDomainsTable(agg) {
  const tbody = document.getElementById('domains-tbody');
  tbody.textContent = '';

  if (agg.domains.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'empty-state';
    td.textContent = 'No website activity matches the current filter.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const dom of agg.domains) {
    const tr = document.createElement('tr');

    // Website
    const tdSite = document.createElement('td');
    const siteWrap = document.createElement('div');
    siteWrap.className = 'cell-site';
    const badge = document.createElement('span');
    badge.className = 'domain-badge';
    badge.style.backgroundColor = domainColor(dom.domain);
    badge.textContent = domainInitial(dom.domain);
    const name = document.createElement('strong');
    name.textContent = dom.domain;
    siteWrap.append(badge, name);
    tdSite.appendChild(siteWrap);

    // Time
    const tdTime = document.createElement('td');
    tdTime.className = 'mono';
    tdTime.textContent = formatDuration(dom.totalMs);

    // Share
    const tdShare = document.createElement('td');
    const shareCell = document.createElement('div');
    shareCell.className = 'share-cell';
    const track = document.createElement('div');
    track.className = 'share-track';
    const fill = document.createElement('div');
    fill.className = 'share-fill';
    fill.style.width = `${Math.max(1, Math.min(100, dom.sharePct))}%`;
    track.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'mono';
    pct.textContent = `${dom.sharePct.toFixed(1)}%`;
    shareCell.append(track, pct);
    tdShare.appendChild(shareCell);

    // Visits
    const tdVisits = document.createElement('td');
    tdVisits.className = 'mono';
    tdVisits.textContent = String(dom.visits);

    // Pages
    const tdPages = document.createElement('td');
    tdPages.className = 'mono';
    tdPages.textContent = String(dom.pageCount);

    // Last visited
    const tdLast = document.createElement('td');
    tdLast.textContent = formatRelativeTime(dom.lastVisitedAt);
    tdLast.title = dom.lastVisitedAt ? new Date(dom.lastVisitedAt).toLocaleString() : '';

    // Actions
    const tdActions = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'row-actions';

    const viewPagesBtn = document.createElement('button');
    viewPagesBtn.type = 'button';
    viewPagesBtn.className = 'btn btn-sm';
    viewPagesBtn.textContent = 'Pages';
    viewPagesBtn.addEventListener('click', () => {
      state.domainFilter = dom.domain;
      switchSection('pages');
      recomputeAndRender();
    });

    const ignoreBtn = document.createElement('button');
    ignoreBtn.type = 'button';
    ignoreBtn.className = 'btn btn-sm';
    ignoreBtn.textContent = 'Ignore';
    ignoreBtn.title = `Add ${dom.domain} to ignored domains`;
    ignoreBtn.addEventListener('click', async () => {
      await sendMessage({ type: 'IGNORE_DOMAIN', domain: dom.domain, purgeExisting: false });
      showToast(`Ignored ${dom.domain}`);
      await loadAndRender();
    });

    actionsWrap.append(viewPagesBtn, ignoreBtn);
    tdActions.appendChild(actionsWrap);

    tr.append(tdSite, tdTime, tdShare, tdVisits, tdPages, tdLast, tdActions);
    tbody.appendChild(tr);
  }
}

function renderPagesTable(agg) {
  const tbody = document.getElementById('pages-tbody');
  tbody.textContent = '';

  const pages = [...agg.pages];
  if (state.pagesSort === 'recent') {
    pages.sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0));
  } else if (state.pagesSort === 'visits') {
    pages.sort((a, b) => (b.visits || 0) - (a.visits || 0));
  } else {
    pages.sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0));
  }

  document.getElementById('pages-count-meta').textContent =
    `${pages.length} page${pages.length === 1 ? '' : 's'}`;

  if (pages.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-state';
    td.textContent = 'No pages match the current filter.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const helpers = {
    copyText,
    formatDuration,
    showToast,
  };

  for (const page of pages.slice(0, 500)) {
    const tr = document.createElement('tr');

    const tdPage = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'cell-page';

    const badge = document.createElement('span');
    badge.className = 'domain-badge';
    badge.style.backgroundColor = domainColor(page.domain);
    badge.textContent = domainInitial(page.domain);

    const text = document.createElement('div');
    text.className = 'cell-page-text';
    const link = document.createElement('a');
    link.className = 'page-title-link';
    if (isSafeHttpUrl(page.url)) {
      link.href = page.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.textContent = page.title || page.url;

    const sub = document.createElement('div');
    sub.className = 'page-url-sub';
    sub.textContent = page.url;

    text.append(link, sub);
    wrap.append(badge, text);
    tdPage.appendChild(wrap);

    const tdTime = document.createElement('td');
    tdTime.className = 'mono';
    tdTime.textContent = formatDuration(page.totalMs);

    const tdVisits = document.createElement('td');
    tdVisits.className = 'mono';
    tdVisits.textContent = String(page.visits);

    const tdLast = document.createElement('td');
    tdLast.textContent = formatRelativeTime(page.lastVisitedAt);
    tdLast.title = page.lastVisitedAt ? new Date(page.lastVisitedAt).toLocaleString() : '';

    const tdActions = document.createElement('td');
    const actionWrap = document.createElement('div');
    actionWrap.className = 'row-actions';
    for (const action of PAGE_ACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.textContent = action.label;
      btn.title = action.title || action.label;
      btn.addEventListener('click', async () => {
        try {
          await action.run({ page, helpers });
        } catch (err) {
          showToast(err?.message || 'Action failed');
        }
      });
      actionWrap.appendChild(btn);
    }
    tdActions.appendChild(actionWrap);

    tr.append(tdPage, tdTime, tdVisits, tdLast, tdActions);
    tbody.appendChild(tr);
  }
}

function renderDailyTable(agg) {
  const tbody = document.getElementById('daily-tbody');
  tbody.textContent = '';

  const rows = [...agg.dailySeries].sort((a, b) => b.date.localeCompare(a.date));
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-state';
    td.textContent = 'No daily records in this date range.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const tdDate = document.createElement('td');
    tdDate.className = 'mono';
    tdDate.textContent = row.date;

    const tdTotal = document.createElement('td');
    tdTotal.className = 'mono';
    tdTotal.textContent = formatDuration(row.totalMs);

    const tdTop = document.createElement('td');
    tdTop.textContent = row.topDomain
      ? `${row.topDomain} (${formatCompactDuration(row.topDomainMs)})`
      : '—';

    const tdDom = document.createElement('td');
    tdDom.className = 'mono';
    tdDom.textContent = String(row.domainCount);

    const tdPages = document.createElement('td');
    tdPages.className = 'mono';
    tdPages.textContent = String(row.pageCount);

    bindActivate(tr, () => {
      state.range = 'custom';
      state.customStart = row.date;
      state.customEnd = row.date;
      document.getElementById('custom-start').value = row.date;
      document.getElementById('custom-end').value = row.date;
      syncRangePills();
      switchSection('overview');
      recomputeAndRender();
    });

    tr.append(tdDate, tdTotal, tdTop, tdDom, tdPages);
    tbody.appendChild(tr);
  }
}

async function renderSettings() {
  const [settings, stats] = await Promise.all([
    storage.getSettings(),
    storage.getStorageStats(),
  ]);

  document.getElementById('setting-pause-idle').checked = Boolean(settings.pauseOnIdle);
  document.getElementById('setting-idle-seconds').value = String(settings.idleTimeoutSeconds || 120);
  document.getElementById('setting-keep-audible').checked = Boolean(settings.keepTrackingWhenAudible);
  document.getElementById('setting-strip-tracking').checked = settings.stripTrackingParams !== false;
  document.getElementById('setting-strip-hash').checked = settings.stripHash !== false;
  document.getElementById('setting-track-incognito').checked = Boolean(settings.trackIncognito);

  const ignoredList = document.getElementById('ignored-domains-list');
  ignoredList.textContent = '';
  if (!settings.ignoredDomains || settings.ignoredDomains.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'setting-desc';
    empty.textContent = 'No ignored domains configured.';
    ignoredList.appendChild(empty);
  } else {
    for (const dom of settings.ignoredDomains) {
      const chip = document.createElement('span');
      chip.className = 'ignored-chip';
      const txt = document.createElement('span');
      txt.textContent = dom;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.title = `Remove ${dom}`;
      removeBtn.addEventListener('click', async () => {
        try {
          const next = settings.ignoredDomains.filter((d) => d !== dom);
          await storage.saveSettings({ ignoredDomains: next });
          const res = await sendMessage({ type: 'SETTINGS_UPDATED' });
          if (res?.ok && res.status) {
            state.status = res.status;
            renderStatus(state.status);
          }
          await renderSettings();
          showToast(`Removed ${dom}`);
        } catch (err) {
          showToast(err?.message || 'Failed to update ignored domains');
        }
      });
      chip.append(txt, removeBtn);
      ignoredList.appendChild(chip);
    }
  }

  const kb = (stats.bytesUsed / 1024).toFixed(1);
  const mbQuota = (stats.quotaBytes / (1024 * 1024)).toFixed(0);
  const pct = Math.min(100, (stats.bytesUsed / stats.quotaBytes) * 100);
  document.getElementById('storage-meter-fill').style.width = `${pct.toFixed(2)}%`;
  document.getElementById('storage-stats-text').textContent =
    `${kb} KB / ${mbQuota} MB used • ${stats.dayCount} days • ${stats.uniqueDomains} sites • ${stats.uniquePages} pages`;
}

function syncRangePills() {
  document.querySelectorAll('.range-pills .pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === state.range);
  });
  document
    .getElementById('custom-dates')
    .classList.toggle('hidden', state.range !== 'custom');
}

function syncDomainChip() {
  const chip = document.getElementById('domain-chip');
  if (state.domainFilter) {
    chip.classList.remove('hidden');
    document.getElementById('domain-chip-label').textContent = `Site: ${state.domainFilter}`;
  } else {
    chip.classList.add('hidden');
  }
}

function renderCurrentView() {
  if (!state.agg) return;
  const { startDate, endDate } = resolveDateRange(
    state.range,
    Date.now(),
    state.customStart,
    state.customEnd
  );

  if (state.section === 'overview') {
    renderKpis(state.agg, startDate, endDate);
    renderChart(state.agg, startDate, endDate);
    renderDomainsTable(state.agg);
  } else if (state.section === 'pages') {
    renderPagesTable(state.agg);
  } else if (state.section === 'daily') {
    renderDailyTable(state.agg);
  } else if (state.section === 'settings') {
    renderSettings();
  }
}

function recomputeAndRender() {
  syncDomainChip();
  const { startDate, endDate } = resolveDateRange(
    state.range,
    Date.now(),
    state.customStart,
    state.customEnd
  );
  state.agg = aggregateBuckets(state.buckets, {
    startDate,
    endDate,
    domainFilter: state.domainFilter,
    searchQuery: state.searchQuery,
    minPageMs: state.minPageMs,
  });
  renderCurrentView();
}

async function loadAndRender() {
  const res = await sendMessage({ type: 'GET_STATUS_AND_FLUSH' });
  if (res?.ok && res.status) {
    state.status = res.status;
  } else {
    state.status = {
      isTracking: false,
      settings: await storage.getSettings(),
    };
  }
  renderStatus(state.status);
  state.buckets = await storage.getAllDayBuckets();
  recomputeAndRender();
}

function setupTheme() {
  const btn = document.getElementById('theme-btn');
  const modes = ['auto', 'light', 'dark'];
  let current = 'auto';
  try {
    const saved = localStorage.getItem('timeledger-theme');
    if (modes.includes(saved)) current = saved;
  } catch {
    // ignore
  }

  function apply(mode) {
    current = mode;
    if (mode === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
    btn.textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
    try {
      localStorage.setItem('timeledger-theme', mode);
    } catch {
      // ignore
    }
  }

  apply(current);
  btn.addEventListener('click', () => {
    const next = modes[(modes.indexOf(current) + 1) % modes.length];
    apply(next);
  });
}

function bindEvents() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchSection(tab.dataset.section);
    });
  });

  document.querySelectorAll('.range-pills .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      syncRangePills();
      recomputeAndRender();
    });
  });

  document.getElementById('custom-start').addEventListener('change', (e) => {
    state.customStart = e.target.value;
    recomputeAndRender();
  });

  document.getElementById('custom-end').addEventListener('change', (e) => {
    state.customEnd = e.target.value;
    recomputeAndRender();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    recomputeAndRender();
  });

  document.getElementById('clear-domain-btn').addEventListener('click', () => {
    state.domainFilter = '';
    recomputeAndRender();
  });

  document.querySelectorAll('.min-duration-pills .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.minPageMs = Number(btn.dataset.minms) || 0;
      document.querySelectorAll('.min-duration-pills .pill-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      recomputeAndRender();
    });
  });

  document.getElementById('pages-sort').addEventListener('change', (e) => {
    state.pagesSort = e.target.value;
    renderPagesTable(state.agg);
  });

  document.getElementById('toggle-pause-btn').addEventListener('click', async () => {
    const nextPaused = !state.status?.settings?.trackingPaused;
    await sendMessage({ type: 'SET_PAUSED', paused: nextPaused });
    await loadAndRender();
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await loadAndRender();
    showToast('Refreshed');
  });

  document.getElementById('export-domains-csv-btn').addEventListener('click', () => {
    if (!state.agg) return;
    downloadFile(
      `timeledger-websites-${getLocalDateKey()}.csv`,
      toCsv(state.agg.domains, 'domains'),
      'text/csv;charset=utf-8'
    );
  });

  document.getElementById('export-pages-csv-btn').addEventListener('click', () => {
    if (!state.agg) return;
    downloadFile(
      `timeledger-pages-${getLocalDateKey()}.csv`,
      toCsv(state.agg.pages, 'pages'),
      'text/csv;charset=utf-8'
    );
  });

  // Settings listeners
  const savePref = async (patch) => {
    try {
      await storage.saveSettings(patch);
      const res = await sendMessage({ type: 'SETTINGS_UPDATED' });
      if (res?.ok && res.status) {
        state.status = res.status;
        renderStatus(state.status);
      }
      showToast('Settings saved');
    } catch (err) {
      showToast(err?.message || 'Failed to save settings');
    }
  };

  document.getElementById('setting-pause-idle').addEventListener('change', (e) => {
    savePref({ pauseOnIdle: e.target.checked });
  });

  document.getElementById('setting-idle-seconds').addEventListener('change', (e) => {
    savePref({ idleTimeoutSeconds: Number(e.target.value) || 120 });
  });

  document.getElementById('setting-keep-audible').addEventListener('change', (e) => {
    savePref({ keepTrackingWhenAudible: e.target.checked });
  });

  document.getElementById('setting-strip-tracking').addEventListener('change', (e) => {
    savePref({ stripTrackingParams: e.target.checked });
  });

  document.getElementById('setting-strip-hash').addEventListener('change', (e) => {
    savePref({ stripHash: e.target.checked });
  });

  document.getElementById('setting-track-incognito').addEventListener('change', (e) => {
    savePref({ trackIncognito: e.target.checked });
  });

  document.getElementById('ignore-domain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ignore-domain-input');
    const domain = normalizeDomain(input.value);
    if (!domain) return;
    try {
      const settings = await storage.getSettings();
      await storage.saveSettings({
        ignoredDomains: [...(settings.ignoredDomains || []), domain],
      });
      input.value = '';
      const res = await sendMessage({ type: 'SETTINGS_UPDATED' });
      if (res?.ok && res.status) {
        state.status = res.status;
        renderStatus(state.status);
      }
      await renderSettings();
      showToast(`Added ${domain} to ignored domains`);
    } catch (err) {
      showToast(err?.message || 'Failed to add ignored domain');
    }
  });

  document.getElementById('export-json-btn').addEventListener('click', async () => {
    const payload = await storage.exportAllData();
    downloadFile(
      `timeledger-backup-${getLocalDateKey()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  });

  document.getElementById('clear-data-btn').addEventListener('click', () => {
    document.getElementById('clear-confirm-box').classList.remove('hidden');
  });

  document.getElementById('cancel-clear-btn').addEventListener('click', () => {
    document.getElementById('clear-confirm-box').classList.add('hidden');
  });

  document.getElementById('confirm-clear-btn').addEventListener('click', async () => {
    try {
      const res = await sendMessage({ type: 'CLEAR_ALL_DATA' });
      if (!res?.ok) {
        await storage.setActiveSession(null);
        await storage.clearAllDayBuckets();
      }
      document.getElementById('clear-confirm-box').classList.add('hidden');
      await loadAndRender();
      await renderSettings();
      showToast('All tracked history deleted');
    } catch (err) {
      showToast(err?.message || 'Failed to clear data');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  parseHashRoute();
  document.getElementById('custom-start').value = state.customStart;
  document.getElementById('custom-end').value = state.customEnd;
  bindEvents();
  syncRangePills();
  switchSection(state.section);
  loadAndRender();
});
