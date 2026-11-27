import {
  ACTIVE_SESSION_KEY,
  DAY_KEY_PREFIX,
  DEFAULT_SETTINGS,
  RUNTIME_STATE_KEY,
  SETTINGS_KEY,
  STORAGE_QUOTA_BYTES,
} from './constants.js';
import { normalizeDomain } from './url.js';

export function createEmptyDayBucket(dateKey) {
  return {
    date: dateKey,
    totalMs: 0,
    domains: {},
    pages: {},
  };
}

/**
 * Create a storage client wrapping chrome.storage.local (or an in-memory mock for tests).
 */
export function createStorageClient(storageArea = globalThis.chrome?.storage?.local) {
  if (!storageArea) {
    throw new Error('Storage area is unavailable');
  }

  async function get(keys) {
    return storageArea.get(keys);
  }

  async function set(items) {
    return storageArea.set(items);
  }

  async function remove(keys) {
    return storageArea.remove(keys);
  }

  async function getSettings() {
    const res = await get(SETTINGS_KEY);
    return {
      ...DEFAULT_SETTINGS,
      ...(res?.[SETTINGS_KEY] || {}),
    };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = {
      ...current,
      ...partial,
    };
    if (Array.isArray(next.ignoredDomains)) {
      next.ignoredDomains = Array.from(
        new Set(next.ignoredDomains.map(normalizeDomain).filter(Boolean))
      );
    }
    await set({ [SETTINGS_KEY]: next });
    return next;
  }

  async function getActiveSession() {
    const res = await get(ACTIVE_SESSION_KEY);
    return res?.[ACTIVE_SESSION_KEY] || null;
  }

  async function setActiveSession(session) {
    if (!session) {
      await remove(ACTIVE_SESSION_KEY);
      return null;
    }
    await set({ [ACTIVE_SESSION_KEY]: session });
    return session;
  }

  async function getRuntimeState() {
    const res = await get(RUNTIME_STATE_KEY);
    return res?.[RUNTIME_STATE_KEY] || { pauseReason: null, updatedAt: 0 };
  }

  async function setRuntimeState(state) {
    await set({ [RUNTIME_STATE_KEY]: state });
    return state;
  }

  async function getDayBucket(dateKey) {
    const key = `${DAY_KEY_PREFIX}${dateKey}`;
    const res = await get(key);
    return res?.[key] || createEmptyDayBucket(dateKey);
  }

  async function saveDayBucket(dateKey, bucket) {
    const key = `${DAY_KEY_PREFIX}${dateKey}`;
    await set({ [key]: bucket });
    return bucket;
  }

  async function getAllDayBuckets() {
    const all = await get(null);
    const buckets = [];
    for (const [key, value] of Object.entries(all || {})) {
      if (key.startsWith(DAY_KEY_PREFIX) && value && value.date) {
        buckets.push(value);
      }
    }
    buckets.sort((a, b) => a.date.localeCompare(b.date));
    return buckets;
  }

  async function purgeDomain(domainToRemove) {
    const target = normalizeDomain(domainToRemove);
    if (!target) return 0;

    const buckets = await getAllDayBuckets();
    const updates = {};
    const removals = [];
    let removedBuckets = 0;

    for (const bucket of buckets) {
      let modified = false;
      let removedMs = 0;

      for (const dom of Object.keys(bucket.domains || {})) {
        if (dom === target || dom.endsWith(`.${target}`)) {
          removedMs += bucket.domains[dom].totalMs || 0;
          delete bucket.domains[dom];
          modified = true;
        }
      }

      for (const url of Object.keys(bucket.pages || {})) {
        const page = bucket.pages[url];
        const dom = page?.domain || '';
        if (dom === target || dom.endsWith(`.${target}`)) {
          delete bucket.pages[url];
          modified = true;
        }
      }

      if (modified) {
        bucket.totalMs = Math.max(0, (bucket.totalMs || 0) - removedMs);
        const key = `${DAY_KEY_PREFIX}${bucket.date}`;
        if (Object.keys(bucket.domains).length === 0 && Object.keys(bucket.pages).length === 0) {
          removals.push(key);
          removedBuckets += 1;
        } else {
          updates[key] = bucket;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await set(updates);
    }
    if (removals.length > 0) {
      await remove(removals);
    }
    return removedBuckets;
  }

  async function clearAllDayBuckets() {
    const all = await get(null);
    const keysToRemove = Object.keys(all || {}).filter((k) =>
      k.startsWith(DAY_KEY_PREFIX)
    );
    if (keysToRemove.length > 0) {
      await remove(keysToRemove);
    }
    return keysToRemove.length;
  }

  async function getStorageStats() {
    let bytesUsed = 0;
    if (typeof storageArea.getBytesInUse === 'function') {
      bytesUsed = await storageArea.getBytesInUse(null);
    } else {
      const all = await get(null);
      bytesUsed = new TextEncoder().encode(JSON.stringify(all || {})).length;
    }

    const buckets = await getAllDayBuckets();
    const uniqueDomains = new Set();
    const uniquePages = new Set();
    let totalMs = 0;

    for (const bucket of buckets) {
      totalMs += bucket.totalMs || 0;
      for (const dom of Object.keys(bucket.domains || {})) {
        uniqueDomains.add(dom);
      }
      for (const url of Object.keys(bucket.pages || {})) {
        uniquePages.add(url);
      }
    }

    return {
      bytesUsed,
      quotaBytes: STORAGE_QUOTA_BYTES,
      dayCount: buckets.length,
      uniqueDomains: uniqueDomains.size,
      uniquePages: uniquePages.size,
      totalMs,
    };
  }

  async function exportAllData() {
    const [settings, days] = await Promise.all([getSettings(), getAllDayBuckets()]);
    return {
      schemaVersion: 1,
      app: 'TimeLedger',
      exportedAt: new Date().toISOString(),
      settings,
      days,
    };
  }

  return {
    getSettings,
    saveSettings,
    getActiveSession,
    setActiveSession,
    getRuntimeState,
    setRuntimeState,
    getDayBucket,
    saveDayBucket,
    getAllDayBuckets,
    purgeDomain,
    clearAllDayBuckets,
    getStorageStats,
    exportAllData,
  };
}
