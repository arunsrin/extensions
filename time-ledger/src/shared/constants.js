export const DAY_KEY_PREFIX = 'day:';
export const ACTIVE_SESSION_KEY = 'activeSession';
export const RUNTIME_STATE_KEY = 'runtimeState';
export const SETTINGS_KEY = 'settings';

export const HEARTBEAT_ALARM_NAME = 'timeledger-heartbeat';
export const HEARTBEAT_PERIOD_MINUTES = 1;

// If a single checkpoint gap exceeds 3 minutes (e.g. system sleep), cap the credited delta to 1 minute
// so closing a laptop lid overnight never fabricates hours of active browsing.
export const MAX_CHECKPOINT_DELTA_MS = 3 * 60 * 1000;
export const SLEEP_FALLBACK_DELTA_MS = 60 * 1000;

export const DEFAULT_SETTINGS = Object.freeze({
  idleTimeoutSeconds: 120,
  pauseOnIdle: true,
  keepTrackingWhenAudible: true,
  stripTrackingParams: true,
  stripHash: true,
  trackIncognito: false,
  trackingPaused: false,
  ignoredDomains: [],
});

export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024; // 10 MB standard chrome.storage.local quota

export const PAUSE_LABELS = Object.freeze({
  manual: 'Paused',
  idle: 'Paused (Idle)',
  'screen-locked': 'Paused (Locked)',
  'window-unfocused': 'Unfocused',
  'internal-page': 'Browser page',
  'ignored-domain': 'Ignored site',
  incognito: 'Incognito',
  'tab-closed': 'Idle',
  'no-active-tab': 'No tab',
});
