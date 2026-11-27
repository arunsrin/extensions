import {
  HEARTBEAT_ALARM_NAME,
  HEARTBEAT_PERIOD_MINUTES,
  MAX_CHECKPOINT_DELTA_MS,
  SLEEP_FALLBACK_DELTA_MS,
} from '../shared/constants.js';
import { getLocalDateKey, splitIntervalByLocalDay } from '../shared/time.js';
import { parseTrackableUrl } from '../shared/url.js';

/**
 * MV3-resilient active tab time tracker engine.
 * All state transitions are serialized via an internal promise queue and persisted to storage
 * so service worker suspension never drops elapsed time.
 */
export class TrackerEngine {
  constructor({ storage, tabs, windows, idle, alarms, now = () => Date.now() }) {
    this.storage = storage;
    this.tabs = tabs;
    this.windows = windows;
    this.idle = idle;
    this.alarms = alarms;
    this.now = now;
    this._queue = Promise.resolve();
    this._runtimeConfigured = false;
  }

  _enqueue(task) {
    const run = async () => {
      await this._ensureConfiguredUnlocked();
      return task();
    };
    const next = this._queue.then(run, run);
    this._queue = next.catch(() => {});
    return next;
  }

  async _ensureConfiguredUnlocked() {
    if (this._runtimeConfigured) return;
    this._runtimeConfigured = true;
    const settings = await this.storage.getSettings();
    this.configureIdleDetection(settings);
    await this.ensureHeartbeatAlarm();
  }

  /**
   * Credit [fromMs, toMs) to local-day buckets for the given session.
   */
  async _creditSessionInterval(session, fromMs, toMs, { countVisit = false } = {}) {
    if (!session || !session.url || !session.domain) return;

    const rawDelta = toMs - fromMs;
    let effectiveEndMs = toMs;
    if (rawDelta > MAX_CHECKPOINT_DELTA_MS) {
      // Cap runaway sleep/crash gaps so overnight lid-close doesn't inflate time.
      effectiveEndMs = fromMs + SLEEP_FALLBACK_DELTA_MS;
    }

    const slices = effectiveEndMs > fromMs ? splitIntervalByLocalDay(fromMs, effectiveEndMs) : [];

    if (slices.length === 0 && !countVisit) {
      return;
    }

    if (slices.length === 0 && countVisit) {
      // Initial visit record with 0ms duration so visits count is recorded even before first flush
      const todayKey = getLocalDateKey(toMs);
      const bucket = await this.storage.getDayBucket(todayKey);
      this._applyToBucket(bucket, session, 0, toMs, true);
      await this.storage.saveDayBucket(todayKey, bucket);
      return;
    }

    for (let i = 0; i < slices.length; i += 1) {
      const slice = slices[i];
      const bucket = await this.storage.getDayBucket(slice.dateKey);
      this._applyToBucket(
        bucket,
        session,
        slice.durationMs,
        slice.endMs,
        countVisit && i === 0
      );
      await this.storage.saveDayBucket(slice.dateKey, bucket);
    }
  }

  _applyToBucket(bucket, session, durationMs, visitedAtMs, incrementVisit) {
    bucket.totalMs = (bucket.totalMs || 0) + durationMs;

    const existingDom = bucket.domains[session.domain] || {
      domain: session.domain,
      totalMs: 0,
      visits: 0,
      lastVisitedAt: 0,
    };
    existingDom.totalMs += durationMs;
    if (incrementVisit) existingDom.visits += 1;
    existingDom.lastVisitedAt = Math.max(existingDom.lastVisitedAt || 0, visitedAtMs);
    bucket.domains[session.domain] = existingDom;

    const existingPage = bucket.pages[session.url] || {
      url: session.url,
      domain: session.domain,
      title: session.title || session.url,
      totalMs: 0,
      visits: 0,
      firstVisitedAt: visitedAtMs,
      lastVisitedAt: 0,
    };
    existingPage.totalMs += durationMs;
    if (incrementVisit) existingPage.visits += 1;
    if (session.title) {
      existingPage.title = session.title;
    }
    existingPage.firstVisitedAt = existingPage.firstVisitedAt
      ? Math.min(existingPage.firstVisitedAt, visitedAtMs)
      : visitedAtMs;
    existingPage.lastVisitedAt = Math.max(existingPage.lastVisitedAt || 0, visitedAtMs);
    bucket.pages[session.url] = existingPage;
  }

  async _flushActiveSessionUnlocked(atMs = this.now()) {
    const session = await this.storage.getActiveSession();
    if (!session) return null;

    if (atMs > session.lastCheckpointAt) {
      await this._creditSessionInterval(session, session.lastCheckpointAt, atMs, {
        countVisit: false,
      });
      // Advance checkpoint to actual current time so capped sleep gaps are never re-credited on later flushes.
      session.lastCheckpointAt = atMs;
      await this.storage.setActiveSession(session);
    }
    return session;
  }

  async _pauseUnlocked(reason, atMs = this.now()) {
    await this._flushActiveSessionUnlocked(atMs);
    await this.storage.setActiveSession(null);
    await this.storage.setRuntimeState({ pauseReason: reason, updatedAt: atMs });
  }

  async _switchToTabUnlocked(tab, settings, atMs = this.now()) {
    if (settings.trackingPaused) {
      await this._pauseUnlocked('manual', atMs);
      return;
    }

    if (!tab || !tab.active) {
      await this._pauseUnlocked('no-active-tab', atMs);
      return;
    }

    if (tab.incognito && !settings.trackIncognito) {
      await this._pauseUnlocked('incognito', atMs);
      return;
    }

    const rawUrl = tab.url || tab.pendingUrl || '';
    const parsed = parseTrackableUrl(rawUrl, {
      ignoredDomains: settings.ignoredDomains,
      stripTrackingParams: settings.stripTrackingParams,
      stripHash: settings.stripHash,
    });

    if (!parsed) {
      const reason = rawUrl.startsWith('http') ? 'ignored-domain' : 'internal-page';
      await this._pauseUnlocked(reason, atMs);
      return;
    }

    const current = await this.storage.getActiveSession();

    // Same normalized URL in active session: update title & flush elapsed without extra visit
    if (current && current.url === parsed.url) {
      const titleChanged = Boolean(tab.title && tab.title !== current.title);
      if (titleChanged) {
        current.title = tab.title;
      }

      if (atMs > current.lastCheckpointAt) {
        await this._creditSessionInterval(current, current.lastCheckpointAt, atMs, {
          countVisit: false,
        });
      } else if (titleChanged) {
        const todayKey = getLocalDateKey(atMs);
        const bucket = await this.storage.getDayBucket(todayKey);
        this._applyToBucket(bucket, current, 0, atMs, false);
        await this.storage.saveDayBucket(todayKey, bucket);
      }

      current.lastCheckpointAt = atMs;
      current.tabId = tab.id;
      current.windowId = tab.windowId;
      current.audible = Boolean(tab.audible);
      await this.storage.setActiveSession(current);
      await this.storage.setRuntimeState({ pauseReason: null, updatedAt: atMs });
      return;
    }

    // Switching to a different URL: flush old session, start new session
    await this._flushActiveSessionUnlocked(atMs);

    const newSession = {
      tabId: tab.id,
      windowId: tab.windowId,
      url: parsed.url,
      domain: parsed.domain,
      title: tab.title || parsed.domain,
      audible: Boolean(tab.audible),
      startedAt: atMs,
      lastCheckpointAt: atMs,
    };

    await this.storage.setActiveSession(newSession);
    await this.storage.setRuntimeState({ pauseReason: null, updatedAt: atMs });
    await this._creditSessionInterval(newSession, atMs, atMs, { countVisit: true });
  }

  async _syncWithBrowserUnlocked(atMs = this.now()) {
    const settings = await this.storage.getSettings();
    if (settings.trackingPaused) {
      await this._pauseUnlocked('manual', atMs);
      return;
    }

    let focusedWindow = null;
    try {
      focusedWindow = await this.windows.getLastFocused({ populate: false });
    } catch {
      focusedWindow = null;
    }

    if (!focusedWindow || !focusedWindow.focused) {
      await this._pauseUnlocked('window-unfocused', atMs);
      return;
    }

    let activeTabs = [];
    try {
      activeTabs = await this.tabs.query({ active: true, windowId: focusedWindow.id });
    } catch {
      activeTabs = [];
    }

    const activeTab = activeTabs[0] || null;
    const idlePauseReason = await this._getIdlePauseReason(settings, activeTab);
    if (idlePauseReason) {
      await this._pauseUnlocked(idlePauseReason, atMs);
      return;
    }

    await this._switchToTabUnlocked(activeTab, settings, atMs);
  }

  async _getIdlePauseReason(settings, tab) {
    if (!this.idle?.queryState) return null;
    const interval = Math.max(15, Number(settings.idleTimeoutSeconds) || 120);
    let idleState;
    try {
      idleState = await this.idle.queryState(interval);
    } catch {
      return null;
    }

    if (idleState === 'locked') {
      return 'screen-locked';
    }
    if (idleState === 'idle' && settings.pauseOnIdle) {
      const allowAudible = settings.keepTrackingWhenAudible && Boolean(tab?.audible);
      if (!allowAudible) {
        return 'idle';
      }
    }
    return null;
  }

  async ensureHeartbeatAlarm() {
    if (!this.alarms?.get || !this.alarms?.create) return;
    const existing = await this.alarms.get(HEARTBEAT_ALARM_NAME);
    if (!existing) {
      await this.alarms.create(HEARTBEAT_ALARM_NAME, {
        periodInMinutes: HEARTBEAT_PERIOD_MINUTES,
      });
    }
  }

  configureIdleDetection(settings) {
    if (this.idle?.setDetectionInterval && settings.idleTimeoutSeconds >= 15) {
      try {
        this.idle.setDetectionInterval(settings.idleTimeoutSeconds);
      } catch {
        // Ignore invalid interval edge cases
      }
    }
  }

  initialize() {
    this._runtimeConfigured = false;
    return this._enqueue(async () => {
      // Reconcile any leftover session from a previous browser run cleanly
      const atMs = this.now();
      await this._flushActiveSessionUnlocked(atMs);
      await this._syncWithBrowserUnlocked(atMs);
    });
  }

  handleTabActivated(activeInfo) {
    return this._enqueue(async () => {
      const atMs = this.now();
      const settings = await this.storage.getSettings();
      if (settings.trackingPaused) {
        await this._pauseUnlocked('manual', atMs);
        return;
      }

      let focusedWindow = null;
      try {
        focusedWindow = await this.windows.getLastFocused({ populate: false });
      } catch {
        focusedWindow = null;
      }

      if (focusedWindow && !focusedWindow.focused) {
        return;
      }
      if (focusedWindow && activeInfo.windowId !== focusedWindow.id) {
        return;
      }

      let tab = null;
      try {
        tab = await this.tabs.get(activeInfo.tabId);
      } catch {
        tab = null;
      }

      const idlePauseReason = await this._getIdlePauseReason(settings, tab);
      if (idlePauseReason) {
        await this._pauseUnlocked(idlePauseReason, atMs);
        return;
      }

      await this._switchToTabUnlocked(tab, settings, atMs);
    });
  }

  handleTabUpdated(tabId, changeInfo, tab) {
    return this._enqueue(async () => {
      if (!tab?.active) return;
      if (!changeInfo.url && !changeInfo.title && changeInfo.audible === undefined && changeInfo.status !== 'complete') {
        return;
      }

      const atMs = this.now();
      const settings = await this.storage.getSettings();
      if (settings.trackingPaused) {
        await this._pauseUnlocked('manual', atMs);
        return;
      }

      let focusedWindow = null;
      try {
        focusedWindow = await this.windows.getLastFocused({ populate: false });
      } catch {
        focusedWindow = null;
      }
      if (focusedWindow && (!focusedWindow.focused || focusedWindow.id !== tab.windowId)) {
        return;
      }

      const idlePauseReason = await this._getIdlePauseReason(settings, tab);
      if (idlePauseReason) {
        await this._pauseUnlocked(idlePauseReason, atMs);
        return;
      }

      await this._switchToTabUnlocked(tab, settings, atMs);
    });
  }

  handleTabRemoved(tabId) {
    return this._enqueue(async () => {
      const current = await this.storage.getActiveSession();
      if (current && current.tabId === tabId) {
        await this._pauseUnlocked('tab-closed', this.now());
      }
    });
  }

  handleWindowFocusChanged(windowId) {
    return this._enqueue(async () => {
      const atMs = this.now();
      // WINDOW_ID_NONE (-1) means browser lost OS focus
      if (windowId === -1 || windowId === this.windows?.WINDOW_ID_NONE) {
        await this._pauseUnlocked('window-unfocused', atMs);
        return;
      }
      await this._syncWithBrowserUnlocked(atMs);
    });
  }

  handleIdleStateChanged(newState) {
    return this._enqueue(async () => {
      const atMs = this.now();
      const settings = await this.storage.getSettings();
      if (settings.trackingPaused) return;
      if (!settings.pauseOnIdle && newState === 'idle') return;

      if (newState === 'idle' || newState === 'locked') {
        const current = await this.storage.getActiveSession();
        if (
          newState === 'idle' &&
          settings.keepTrackingWhenAudible &&
          current?.audible
        ) {
          await this._flushActiveSessionUnlocked(atMs);
          return;
        }
        await this._pauseUnlocked(newState === 'locked' ? 'screen-locked' : 'idle', atMs);
        return;
      }

      if (newState === 'active') {
        await this._syncWithBrowserUnlocked(atMs);
      }
    });
  }

  handleAlarm(alarm) {
    if (alarm?.name !== HEARTBEAT_ALARM_NAME) return Promise.resolve();
    return this._enqueue(async () => {
      const atMs = this.now();
      await this._syncWithBrowserUnlocked(atMs);
    });
  }

  checkpointAndGetStatus() {
    return this._enqueue(async () => {
      const atMs = this.now();
      const session = await this._flushActiveSessionUnlocked(atMs);
      const [runtime, settings] = await Promise.all([
        this.storage.getRuntimeState(),
        this.storage.getSettings(),
      ]);
      return {
        isTracking: Boolean(session) && !settings.trackingPaused,
        pauseReason: settings.trackingPaused ? 'manual' : runtime.pauseReason,
        activeSession: session,
        settings,
        timestamp: atMs,
      };
    });
  }

  setManualPaused(paused) {
    return this._enqueue(async () => {
      const atMs = this.now();
      const settings = await this.storage.saveSettings({ trackingPaused: Boolean(paused) });
      if (settings.trackingPaused) {
        await this._pauseUnlocked('manual', atMs);
      } else {
        await this._syncWithBrowserUnlocked(atMs);
      }
      return this.storage.getRuntimeState();
    });
  }

  applySettingsUpdate() {
    return this._enqueue(async () => {
      const settings = await this.storage.getSettings();
      this.configureIdleDetection(settings);
      await this._syncWithBrowserUnlocked(this.now());
    });
  }

  ignoreDomain(domain, purgeExisting = false) {
    return this._enqueue(async () => {
      const settings = await this.storage.getSettings();
      const nextDomains = [...(settings.ignoredDomains || []), domain];
      await this.storage.saveSettings({ ignoredDomains: nextDomains });
      if (purgeExisting) {
        await this.storage.purgeDomain(domain);
      }
      await this._syncWithBrowserUnlocked(this.now());
    });
  }

  clearAllData() {
    return this._enqueue(async () => {
      const atMs = this.now();
      await this.storage.setActiveSession(null);
      await this.storage.clearAllDayBuckets();
      await this._syncWithBrowserUnlocked(atMs);
    });
  }
}
