import { createStorageClient } from '../shared/storage.js';
import { TrackerEngine } from './tracker.js';

const storage = createStorageClient(chrome.storage.local);

const engine = new TrackerEngine({
  storage,
  tabs: chrome.tabs,
  windows: chrome.windows,
  idle: chrome.idle,
  alarms: chrome.alarms,
});

chrome.runtime.onInstalled.addListener(() => {
  engine.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  engine.initialize();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  engine.handleTabActivated(activeInfo);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  engine.handleTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  engine.handleTabRemoved(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  engine.handleWindowFocusChanged(windowId);
});

chrome.idle.onStateChanged.addListener((newState) => {
  engine.handleIdleStateChanged(newState);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  engine.handleAlarm(alarm);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    switch (message.type) {
      case 'GET_STATUS_AND_FLUSH': {
        const status = await engine.checkpointAndGetStatus();
        sendResponse({ ok: true, status });
        break;
      }
      case 'SET_PAUSED': {
        await engine.setManualPaused(Boolean(message.paused));
        const status = await engine.checkpointAndGetStatus();
        sendResponse({ ok: true, status });
        break;
      }
      case 'SETTINGS_UPDATED': {
        await engine.applySettingsUpdate();
        const status = await engine.checkpointAndGetStatus();
        sendResponse({ ok: true, status });
        break;
      }
      case 'IGNORE_DOMAIN': {
        const domain = message.domain;
        const settings = await storage.getSettings();
        const nextDomains = [...(settings.ignoredDomains || []), domain];
        await storage.saveSettings({ ignoredDomains: nextDomains });
        if (message.purgeExisting) {
          await storage.purgeDomain(domain);
        }
        await engine.applySettingsUpdate();
        const status = await engine.checkpointAndGetStatus();
        sendResponse({ ok: true, status });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true; // keep message channel open for async response
});
