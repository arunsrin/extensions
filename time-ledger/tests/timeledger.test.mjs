import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { aggregateBuckets, fillDailySeries, toCsv } from '../src/shared/aggregator.js';
import { HEARTBEAT_ALARM_NAME, SLEEP_FALLBACK_DELTA_MS } from '../src/shared/constants.js';
import { createStorageClient } from '../src/shared/storage.js';
import { formatDuration, getLocalDateKey, splitIntervalByLocalDay } from '../src/shared/time.js';
import { isDomainIgnored, normalizeDomain, parseTrackableUrl } from '../src/shared/url.js';
import { TrackerEngine } from '../src/background/tracker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createMockStorageArea(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(keys) {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(store.entries());
      }
      if (typeof keys === 'string') {
        return store.has(keys) ? { [keys]: structuredClone(store.get(keys)) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) {
          if (store.has(k)) out[k] = structuredClone(store.get(k));
        }
        return out;
      }
      return {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, structuredClone(v));
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) store.delete(k);
    },
    async getBytesInUse() {
      return JSON.stringify(Object.fromEntries(store.entries())).length;
    },
  };
}

function createHarness(initialNow = new Date(2026, 10, 27, 10, 0, 0).getTime()) {
  let currentNow = initialNow;
  let focusedWindow = { id: 1, focused: true };
  let idleState = 'active';
  const tabsMap = new Map();
  const alarmsMap = new Map();
  const storageArea = createMockStorageArea();
  const storage = createStorageClient(storageArea);

  const engine = new TrackerEngine({
    storage,
    now: () => currentNow,
    tabs: {
      async get(tabId) {
        if (!tabsMap.has(tabId)) throw new Error('No tab');
        return tabsMap.get(tabId);
      },
      async query({ active, windowId }) {
        return Array.from(tabsMap.values()).filter(
          (t) => (!active || t.active) && (!windowId || t.windowId === windowId)
        );
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async getLastFocused() {
        return focusedWindow;
      },
    },
    idle: {
      setDetectionInterval() {},
      async queryState() {
        return idleState;
      },
    },
    alarms: {
      async get(name) {
        return alarmsMap.get(name) || null;
      },
      async create(name, info) {
        alarmsMap.set(name, { name, ...info });
      },
    },
  });

  return {
    engine,
    storage,
    alarmsMap,
    setNow(ms) {
      currentNow = ms;
    },
    advanceMs(ms) {
      currentNow += ms;
      return currentNow;
    },
    setWindowFocused(focused, id = 1) {
      focusedWindow = { id, focused };
    },
    setIdleState(state) {
      idleState = state;
    },
    putTab(tab) {
      tabsMap.set(tab.id, tab);
    },
    removeTab(tabId) {
      tabsMap.delete(tabId);
    },
  };
}

test('URL parsing ignores browser internal schemes and strips tracking params', () => {
  assert.equal(parseTrackableUrl('chrome://extensions'), null);
  assert.equal(parseTrackableUrl('about:blank'), null);
  assert.equal(parseTrackableUrl('chrome-extension://abcdef/popup.html'), null);

  const parsed = parseTrackableUrl(
    'https://www.Example.com/articles/deep-dive?utm_source=hn&id=42&fbclid=xyz#comments'
  );
  assert.deepEqual(parsed, {
    url: 'https://www.example.com/articles/deep-dive?id=42',
    domain: 'example.com',
    protocol: 'https:',
  });

  assert.equal(
    parseTrackableUrl('https://sub.example.com/page', { ignoredDomains: ['example.com'] }),
    null
  );
  assert.equal(isDomainIgnored('mail.google.com', ['google.com']), true);
  assert.equal(isDomainIgnored('notgoogle.com', ['google.com']), false);
  assert.equal(normalizeDomain('WWW.GitHub.COM.'), 'github.com');
});

test('Time utilities split midnight-spanning intervals across local calendar days', () => {
  const start = new Date(2026, 10, 27, 23, 55, 0).getTime();
  const end = new Date(2026, 10, 28, 0, 10, 0).getTime();
  const slices = splitIntervalByLocalDay(start, end);

  assert.equal(slices.length, 2);
  assert.equal(slices[0].dateKey, '2026-11-27');
  assert.equal(slices[0].durationMs, 5 * 60 * 1000);
  assert.equal(slices[1].dateKey, '2026-11-28');
  assert.equal(slices[1].durationMs, 10 * 60 * 1000);

  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(135000), '2m 15s');
  assert.equal(formatDuration(7500000), '2h 5m');
});

test('TrackerEngine records active tab switches, SPA URL updates, and window unfocus accurately', async () => {
  const h = createHarness();
  const tab1 = {
    id: 1,
    windowId: 1,
    active: true,
    url: 'https://news.ycombinator.com/item?id=1',
    title: 'HN Discussion',
  };
  h.putTab(tab1);
  await h.engine.initialize();

  // Heartbeat alarm registered
  assert.ok(h.alarmsMap.has(HEARTBEAT_ALARM_NAME));

  // Stay 45 seconds on HN
  h.advanceMs(45_000);
  await h.engine.handleAlarm({ name: HEARTBEAT_ALARM_NAME });

  // Title update on same URL should NOT increment visits
  h.advanceMs(15_000);
  const updatedSameUrl = { ...tab1, title: 'HN Discussion (Updated)' };
  h.putTab(updatedSameUrl);
  await h.engine.handleTabUpdated(1, { title: updatedSameUrl.title }, updatedSameUrl);

  // Switch to GitHub tab 2
  const tab2 = {
    id: 2,
    windowId: 1,
    active: true,
    url: 'https://github.com/user/repo',
    title: 'GitHub Repo',
  };
  h.putTab({ ...updatedSameUrl, active: false });
  h.putTab(tab2);
  await h.engine.handleTabActivated({ tabId: 2, windowId: 1 });

  // Stay 30 seconds, then Chrome loses OS focus
  h.advanceMs(30_000);
  h.setWindowFocused(false);
  await h.engine.handleWindowFocusChanged(-1);

  // Elapsed time while unfocused (10 minutes) must NOT be counted
  h.advanceMs(10 * 60 * 1000);
  h.setWindowFocused(true);
  await h.engine.handleWindowFocusChanged(1);

  const buckets = await h.storage.getAllDayBuckets();
  assert.equal(buckets.length, 1);
  const day = buckets[0];
  assert.equal(day.totalMs, 90_000);
  assert.equal(day.domains['news.ycombinator.com'].totalMs, 60_000);
  assert.equal(day.domains['news.ycombinator.com'].visits, 1);
  assert.equal(
    day.pages['https://news.ycombinator.com/item?id=1'].title,
    'HN Discussion (Updated)'
  );
  assert.equal(day.domains['github.com'].totalMs, 30_000);
  assert.equal(day.domains['github.com'].visits, 2); // initial + refocus
});

test('TrackerEngine caps sleep gaps and respects audible idle override', async () => {
  const h = createHarness();
  const tab = {
    id: 1,
    windowId: 1,
    active: true,
    audible: true,
    url: 'https://www.youtube.com/watch?v=abc',
    title: 'Long Talk',
  };
  h.putTab(tab);
  await h.engine.initialize();

  // User goes idle while video is audible -> should keep tracking
  h.advanceMs(40_000);
  await h.engine.handleIdleStateChanged('idle');
  let status = await h.engine.checkpointAndGetStatus();
  assert.equal(status.isTracking, true);

  // Audio stops while user is still idle -> next heartbeat pauses cleanly
  h.putTab({ ...tab, audible: false });
  h.setIdleState('idle');
  h.advanceMs(20_000);
  await h.engine.handleAlarm({ name: HEARTBEAT_ALARM_NAME });
  status = await h.engine.checkpointAndGetStatus();
  assert.equal(status.isTracking, false);
  assert.equal(status.pauseReason, 'idle');

  // Resume active, then simulate 8-hour laptop sleep without alarms
  h.setIdleState('active');
  await h.engine.handleIdleStateChanged('active');
  h.advanceMs(8 * 60 * 60 * 1000);
  status = await h.engine.checkpointAndGetStatus();

  const buckets = await h.storage.getAllDayBuckets();
  const total = buckets.reduce((sum, b) => sum + b.totalMs, 0);
  assert.equal(total, 60_000 + SLEEP_FALLBACK_DELTA_MS);
});

test('Aggregator filters, sorts, fills series, and exports RFC-4180 CSV', () => {
  const buckets = [
    {
      date: '2026-11-26',
      totalMs: 120_000,
      domains: {
        'example.com': { domain: 'example.com', totalMs: 120_000, visits: 2, lastVisitedAt: 1000 },
      },
      pages: {
        'https://example.com/short': {
          url: 'https://example.com/short',
          domain: 'example.com',
          title: 'Short Note',
          totalMs: 20_000,
          visits: 1,
          lastVisitedAt: 900,
        },
        'https://example.com/essay': {
          url: 'https://example.com/essay',
          domain: 'example.com',
          title: 'Deep Essay, Part "1"',
          totalMs: 100_000,
          visits: 1,
          lastVisitedAt: 1000,
        },
      },
    },
    {
      date: '2026-11-27',
      totalMs: 60_000,
      domains: {
        'github.com': { domain: 'github.com', totalMs: 60_000, visits: 1, lastVisitedAt: 2000 },
      },
      pages: {
        'https://github.com/a/b': {
          url: 'https://github.com/a/b',
          domain: 'github.com',
          title: 'Repo',
          totalMs: 60_000,
          visits: 1,
          lastVisitedAt: 2000,
        },
      },
    },
  ];

  const agg = aggregateBuckets(buckets, { minPageMs: 30_000 });
  assert.equal(agg.totalMs, 180_000);
  assert.equal(agg.domains[0].domain, 'example.com');
  assert.equal(agg.pages.length, 2); // 20_000ms short note filtered out
  assert.equal(agg.pages[0].url, 'https://example.com/essay');

  const filled = fillDailySeries(agg.dailySeries, '2026-11-25', '2026-11-27');
  assert.equal(filled.length, 3);
  assert.equal(filled[0].totalMs, 0);

  const csv = toCsv(agg.pages, 'pages');
  assert.match(csv, /"Deep Essay, Part ""1"""/);
});

test('Manifest V3, CSP compliance, and local-only privacy audit', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['tabs', 'storage', 'idle', 'alarms']);
  assert.equal(manifest.host_permissions, undefined);

  // Verify icons and entrypoints exist
  for (const iconPath of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(ROOT, iconPath)), `Missing icon: ${iconPath}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, manifest.background.service_worker)));
  assert.ok(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));

  // Ensure zero inline event handlers or inline scripts in HTML (MV3 CSP strictness)
  for (const htmlRel of ['src/popup/popup.html', 'src/dashboard/dashboard.html']) {
    const html = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `Inline handler found in ${htmlRel}`);
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, `Inline script found in ${htmlRel}`);
  }

  // Ensure zero fetch/XHR/WebSocket calls in src/
  const scanDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scanDir(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        assert.equal(/\bfetch\s*\(/.test(src), false, `Unexpected fetch() in ${full}`);
        assert.equal(/\bXMLHttpRequest\b/.test(src), false, `Unexpected XHR in ${full}`);
        assert.equal(/\bWebSocket\b/.test(src), false, `Unexpected WebSocket in ${full}`);
      }
    }
  };
  scanDir(path.join(ROOT, 'src'));
});

test('Negative inputs, incognito isolation, and domain purge boundaries', async () => {
  assert.equal(parseTrackableUrl(null), null);
  assert.equal(parseTrackableUrl(''), null);
  assert.equal(parseTrackableUrl('not-a-valid-url'), null);
  assert.equal(parseTrackableUrl('javascript:alert(1)'), null);
  assert.equal(parseTrackableUrl('data:text/html,<h1>Hi</h1>'), null);

  const h = createHarness();
  const incognitoTab = {
    id: 9,
    windowId: 1,
    active: true,
    incognito: true,
    url: 'https://private.example.org/secret',
    title: 'Private',
  };
  h.putTab(incognitoTab);
  await h.engine.initialize();
  h.advanceMs(30_000);
  const status = await h.engine.checkpointAndGetStatus();
  assert.equal(status.isTracking, false);
  assert.equal(status.pauseReason, 'incognito');
  assert.equal((await h.storage.getAllDayBuckets()).length, 0);

  // Switch to normal tab, accrue time, then purge domain
  const normalTab = {
    id: 10,
    windowId: 1,
    active: true,
    incognito: false,
    url: 'https://docs.example.com/guide',
    title: 'Guide',
  };
  h.putTab(normalTab);
  await h.engine.handleTabActivated({ tabId: 10, windowId: 1 });
  h.advanceMs(25_000);
  await h.engine.handleTabRemoved(10);

  const beforePurge = await h.storage.getAllDayBuckets();
  assert.equal(beforePurge[0].totalMs, 25_000);

  await h.storage.purgeDomain('example.com');
  const afterPurge = await h.storage.getAllDayBuckets();
  assert.equal(afterPurge.length, 0);
});
