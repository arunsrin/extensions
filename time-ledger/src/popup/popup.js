import { aggregateBuckets, resolveDateRange } from '../shared/aggregator.js';
import { createStorageClient } from '../shared/storage.js';
import { formatDuration } from '../shared/time.js';
import { domainColor, domainInitial } from '../shared/url.js';

const storage = createStorageClient(chrome.storage.local);

const state = {
  range: 'today',
  tab: 'sites',
  status: null,
};

const PAUSE_LABELS = {
  manual: 'Paused',
  idle: 'Paused (Idle)',
  'screen-locked': 'Paused (Locked)',
  'window-unfocused': 'Unfocused',
  'internal-page': 'Browser page',
  'ignored-domain': 'Ignored site',
  incognito: 'Incognito',
  'tab-closed': 'Idle',
  'no-active-tab': 'No tab',
};

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

function renderStatus(status) {
  const pill = document.getElementById('status-pill');
  const toggleBtn = document.getElementById('toggle-pause-btn');
  const ignoreBtn = document.getElementById('ignore-active-btn');

  pill.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  pill.appendChild(dot);

  const label = document.createElement('span');

  if (status?.isTracking && status.activeSession) {
    pill.className = 'status-pill tracking';
    label.textContent = status.activeSession.domain;
    ignoreBtn.classList.remove('hidden');
    ignoreBtn.dataset.domain = status.activeSession.domain;
  } else if (status?.settings?.trackingPaused) {
    pill.className = 'status-pill paused';
    label.textContent = 'Paused';
    ignoreBtn.classList.add('hidden');
  } else {
    pill.className = 'status-pill';
    label.textContent = PAUSE_LABELS[status?.pauseReason] || 'Standby';
    ignoreBtn.classList.add('hidden');
  }

  pill.appendChild(label);
  toggleBtn.textContent = status?.settings?.trackingPaused ? 'Resume' : 'Pause';
}

function createEmptyState(text) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
}

function openDashboard(hash = '') {
  const url = chrome.runtime.getURL(`src/dashboard/dashboard.html${hash}`);
  chrome.tabs.create({ url });
}

function renderLists(agg) {
  const sitesList = document.getElementById('sites-list');
  const pagesList = document.getElementById('pages-list');
  sitesList.textContent = '';
  pagesList.textContent = '';

  const topSites = agg.domains.slice(0, 12);
  if (topSites.length === 0) {
    sitesList.appendChild(createEmptyState('No browsing time recorded yet for this range.'));
  } else {
    const maxMs = topSites[0].totalMs || 1;
    for (const site of topSites) {
      const row = document.createElement('div');
      row.className = 'row-card';
      row.title = `View pages on ${site.domain}`;

      const fill = document.createElement('div');
      fill.className = 'row-fill';
      fill.style.width = `${Math.max(2, Math.round((site.totalMs / maxMs) * 100))}%`;
      row.appendChild(fill);

      const left = document.createElement('div');
      left.className = 'row-left';

      const badge = document.createElement('span');
      badge.className = 'domain-badge';
      badge.style.backgroundColor = domainColor(site.domain);
      badge.textContent = domainInitial(site.domain);

      const text = document.createElement('div');
      text.className = 'row-text';
      const title = document.createElement('div');
      title.className = 'row-title';
      title.textContent = site.domain;
      const sub = document.createElement('div');
      sub.className = 'row-sub';
      sub.textContent = `${site.pageCount} page${site.pageCount === 1 ? '' : 's'} • ${site.visits} visit${site.visits === 1 ? '' : 's'}`;
      text.append(title, sub);
      left.append(badge, text);

      const right = document.createElement('div');
      right.className = 'row-right';
      const time = document.createElement('div');
      time.className = 'row-time mono';
      time.textContent = formatDuration(site.totalMs);
      const pct = document.createElement('div');
      pct.className = 'row-pct mono';
      pct.textContent = `${site.sharePct.toFixed(0)}%`;
      right.append(time, pct);

      row.append(left, right);
      row.addEventListener('click', () => {
        openDashboard(`#pages?domain=${encodeURIComponent(site.domain)}`);
      });
      sitesList.appendChild(row);
    }
  }

  const topPages = agg.pages.slice(0, 12);
  if (topPages.length === 0) {
    pagesList.appendChild(createEmptyState('No pages recorded yet for this range.'));
  } else {
    const maxMs = topPages[0].totalMs || 1;
    for (const page of topPages) {
      const row = document.createElement('div');
      row.className = 'row-card';
      row.title = page.url;

      const fill = document.createElement('div');
      fill.className = 'row-fill';
      fill.style.width = `${Math.max(2, Math.round((page.totalMs / maxMs) * 100))}%`;
      row.appendChild(fill);

      const left = document.createElement('div');
      left.className = 'row-left';

      const badge = document.createElement('span');
      badge.className = 'domain-badge';
      badge.style.backgroundColor = domainColor(page.domain);
      badge.textContent = domainInitial(page.domain);

      const text = document.createElement('div');
      text.className = 'row-text';
      const title = document.createElement('div');
      title.className = 'row-title';
      title.textContent = page.title || page.url;
      const sub = document.createElement('div');
      sub.className = 'row-sub';
      sub.textContent = page.domain;
      text.append(title, sub);
      left.append(badge, text);

      const right = document.createElement('div');
      right.className = 'row-right';
      const time = document.createElement('div');
      time.className = 'row-time mono';
      time.textContent = formatDuration(page.totalMs);
      const pct = document.createElement('div');
      pct.className = 'row-pct mono';
      pct.textContent = `${page.visits}v`;
      right.append(time, pct);

      row.append(left, right);
      row.addEventListener('click', () => {
        chrome.tabs.create({ url: page.url });
      });
      pagesList.appendChild(row);
    }
  }
}

async function refresh() {
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

  const buckets = await storage.getAllDayBuckets();
  const { startDate, endDate } = resolveDateRange(state.range);
  const agg = aggregateBuckets(buckets, { startDate, endDate });

  document.getElementById('range-label').textContent =
    state.range === 'today' ? "Today's Active Time" : 'Last 7 Days Active Time';
  document.getElementById('total-time').textContent = formatDuration(agg.totalMs);
  document.getElementById('sites-count').textContent = `${agg.uniqueDomainsCount} site${agg.uniqueDomainsCount === 1 ? '' : 's'}`;
  document.getElementById('pages-count').textContent = `${agg.uniquePagesCount} page${agg.uniquePagesCount === 1 ? '' : 's'}`;

  renderLists(agg);
}

function setupTheme() {
  try {
    const saved = localStorage.getItem('timeledger-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch {
    // Ignore storage access issues
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      document.querySelectorAll('.range-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      refresh();
    });
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      document.querySelectorAll('.view-tab').forEach((t) =>
        t.classList.toggle('active', t === tab)
      );
      document.getElementById('sites-list').classList.toggle('hidden', state.tab !== 'sites');
      document.getElementById('pages-list').classList.toggle('hidden', state.tab !== 'pages');
    });
  });

  document.getElementById('toggle-pause-btn').addEventListener('click', async () => {
    const nextPaused = !state.status?.settings?.trackingPaused;
    await sendMessage({ type: 'SET_PAUSED', paused: nextPaused });
    await refresh();
  });

  document.getElementById('ignore-active-btn').addEventListener('click', async (e) => {
    const domain = e.currentTarget.dataset.domain;
    if (!domain) return;
    await sendMessage({ type: 'IGNORE_DOMAIN', domain, purgeExisting: false });
    await refresh();
  });

  document.getElementById('open-dashboard-btn').addEventListener('click', () => {
    openDashboard('');
  });

  document.getElementById('open-settings-btn').addEventListener('click', () => {
    openDashboard('#settings');
  });

  refresh();
});
