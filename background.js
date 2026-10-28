/**
 * background.js
 * Manifest V3 Service Worker for TikTok Ads Automation Bot.
 *
 * Responsibilities:
 * - Coordinates message passing between extension popup and content scripts.
 * - Manages storage lifecycle and state persistence.
 * - Handles MV3 service worker wake/sleep cycles without state loss.
 */

try {
  importScripts('storage.js');
} catch (e) {
  console.error('[TikTokAdsBot:Background] Failed to importScripts storage.js:', e);
}

const MODULE_NAME = 'Background';

function log(message, data = null) {
  const time = new Date().toLocaleTimeString();
  if (data !== null) {
    console.log(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ${message}`, data);
  } else {
    console.log(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ${message}`);
  }
}

function error(message, err = null) {
  const time = new Date().toLocaleTimeString();
  if (err !== null) {
    console.error(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ❌ ${message}`, err);
  } else {
    console.error(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ❌ ${message}`);
  }
}

/**
 * Extension installation / update lifecycle
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  log(`Extension installed / updated. Reason: ${details.reason}`);

  if (self.StorageService) {
    // Check if configuration already exists before overwriting
    const existing = await self.StorageService.getConfig();
    if (!existing || !existing.websiteUrl) {
      log('Setting default configuration...');
      await self.StorageService.saveConfig(self.StorageService.DEFAULT_CONFIG);
    }

    // Only reset job state if not actively running
    const jobState = await self.StorageService.getJobState();
    if (!jobState || jobState.status === 'IDLE' || jobState.status === 'COMPLETED') {
      await self.StorageService.resetJobState();
      log('Job state initialized to IDLE.');
    }
  }
});

/**
 * Find the active TikTok Ads Manager tab across windows, supporting any query parameters & advertiser IDs
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findActiveTikTokTab() {
  try {
    // 1. Check active tab in last-focused window (the window the user clicked from)
    const focusedActiveTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (focusedActiveTabs && focusedActiveTabs.length > 0) {
      const tab = focusedActiveTabs[0];
      if (tab.url && tab.url.includes('ads.tiktok.com')) {
        return tab;
      }
    }

    // 2. Check active tab in ANY window
    const anyActiveTabs = await chrome.tabs.query({ active: true });
    for (const tab of anyActiveTabs) {
      if (tab.url && tab.url.includes('ads.tiktok.com')) {
        return tab;
      }
    }

    // 3. Check all tabs in last-focused window
    const focusedTabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const focusedTikTokTabs = focusedTabs.filter(t => t.url && t.url.includes('ads.tiktok.com'));
    if (focusedTikTokTabs.length > 0) {
      const campaignTab = focusedTikTokTabs.find(t => t.url.includes('/manage/campaign') || t.url.includes('/campaign'));
      return campaignTab || focusedTikTokTabs[0];
    }

    // 4. Fallback: all tabs across all windows
    const allTabs = await chrome.tabs.query({});
    const allTikTokTabs = allTabs.filter(t => t.url && t.url.includes('ads.tiktok.com'));
    if (allTikTokTabs.length > 0) {
      const campaignTab = allTikTokTabs.find(t => t.url.includes('/manage/campaign') || t.url.includes('/campaign'));
      return campaignTab || allTikTokTabs[0];
    }

    return null;
  } catch (err) {
    error('Error searching for TikTok tabs:', err);
    return null;
  }
}

/**
 * Ensure content scripts are injected and responsive in the target TikTok tab
 * Handles tabs that were opened before the extension was installed/reloaded
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function ensureContentScriptInjected(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    if (ping && ping.ready) {
      return true;
    }
  } catch (e) {
    log(`Content script not responsive on tab ${tabId}. Attempting programmatic injection...`);
  }

  if (chrome.scripting) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'storage.js',
          'automation/helpers.js',
          'automation/popup-handler.js',
          'automation/custom-mode.js',
          'automation/campaign.js',
          'automation/account-link.js',
          'automation/ad-text.js',
          'automation/runner.js',
          'content.js'
        ]
      });
      log(`Successfully injected automation scripts into tab ${tabId}.`);
      await new Promise(r => setTimeout(r, 250));
      return true;
    } catch (err) {
      error(`Failed to inject automation scripts into tab ${tabId}:`, err);
      return false;
    }
  }

  return false;
}

/**
 * Master message routing listener
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log(`Service Worker received action: ${message?.action}`, { message, senderId: sender?.id });

  if (!message || !message.action) {
    sendResponse({ error: 'Missing message action' });
    return false;
  }

  (async () => {
    try {
      switch (message.action) {
        case 'PING_WORKER': {
          sendResponse({
            status: 'PONG',
            serviceWorkerActive: true,
            timestamp: new Date().toISOString()
          });
          break;
        }

        case 'CHECK_TIKTOK_TAB': {
          const tab = await findActiveTikTokTab();
          if (!tab) {
            sendResponse({
              found: false,
              message: 'No open TikTok Ads Manager tab detected.'
            });
            break;
          }

          // Check if content script is injected
          const injected = await ensureContentScriptInjected(tab.id);

          try {
            const pageState = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE_STATE' });
            sendResponse({
              found: true,
              tabId: tab.id,
              url: tab.url,
              title: tab.title,
              contentScriptActive: true,
              isCampaignsPage: pageState?.isCampaignsPage || false,
              details: pageState
            });
          } catch (e) {
            sendResponse({
              found: true,
              tabId: tab.id,
              url: tab.url,
              title: tab.title,
              contentScriptActive: injected,
              isCampaignsPage: tab.url.includes('/manage/campaign') || tab.url.includes('/campaign'),
              message: injected
                ? 'Connected to TikTok Ads tab.'
                : 'TikTok Ads tab found, but content script not responding. Refresh tab if needed.'
            });
          }
          break;
        }

        case 'START_AUTOMATION': {
          console.log('[BACKGROUND] Start message received');

          const tab = await findActiveTikTokTab();
          if (!tab) {
            console.warn('[BACKGROUND] TikTok tab detection failed: No open TikTok Ads Manager tab found.');
            sendResponse({
              success: false,
              error: 'No TikTok Ads Manager tab detected. Please open TikTok Ads Manager (https://ads.tiktok.com/i18n/manage/campaign).'
            });
            break;
          }

          console.log('[BACKGROUND] TikTok tab detected');
          log(`Target TikTok tab: ID ${tab.id} URL: ${tab.url}`);

          // Ensure scripts are loaded in tab
          const isInjected = await ensureContentScriptInjected(tab.id);
          if (!isInjected) {
            sendResponse({
              success: false,
              error: 'Could not connect to TikTok Ads tab content script. Please refresh the TikTok page and try again.'
            });
            break;
          }

          try {
            const tabResponse = await chrome.tabs.sendMessage(tab.id, message);
            if (!tabResponse || !tabResponse.success) {
              const errMsg = tabResponse?.error || tabResponse?.reason || 'Automation runner initialization failed';
              console.error('[BACKGROUND] Runner initialization rejected:', errMsg);
              sendResponse({ success: false, error: errMsg, tabResponse });
            } else {
              console.log('[BACKGROUND] Automation successfully dispatched to tab runner:', tabResponse);
              sendResponse({ success: true, tabResponse });
            }
          } catch (err) {
            console.error('[BACKGROUND] Error communicating with tab:', err);
            sendResponse({ success: false, error: err.message });
          }
          break;
        }

        case 'FORWARD_TO_TIKTOK_TAB':
        case 'PAUSE_AUTOMATION':
        case 'RESUME_AUTOMATION':
        case 'STOP_AUTOMATION': {
          const tab = await findActiveTikTokTab();
          if (!tab) {
            sendResponse({ success: false, error: 'No TikTok Ads Manager tab available.' });
            break;
          }

          try {
            const tabResponse = await chrome.tabs.sendMessage(tab.id, message);
            sendResponse({ success: true, tabResponse });
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
          break;
        }

        case 'GET_STATUS': {
          const jobState = self.StorageService
            ? await self.StorageService.getJobState()
            : null;
          const config = self.StorageService
            ? await self.StorageService.getConfig()
            : null;

          sendResponse({
            serviceWorkerAlive: true,
            jobState,
            config
          });
          break;
        }

        default:
          sendResponse({ status: 'UNHANDLED_BACKGROUND_ACTION' });
          break;
      }
    } catch (err) {
      error(`Error handling message [${message.action}]:`, err);
      sendResponse({ error: err.message });
    }
  })();

  return true;
});

log('Service Worker started and ready.');
