/**
 * content.js
 * Injected content script for TikTok Ads Manager (https://ads.tiktok.com/*).
 *
 * Coordinates between Background Service Worker / Popup and Page Automation modules.
 */

(function () {
  'use strict';

  // Guard against multiple injection passes in same frame
  if (window.__TIKTOK_ADS_BOT_INITIALIZED__) {
    console.log('[TikTokAdsBot:Content] Script already active on this window. Skipping duplicate injection.');
    return;
  }
  window.__TIKTOK_ADS_BOT_INITIALIZED__ = true;

  const MODULE_NAME = 'Content';

  function log(message, data = null) {
    if (window.AutomationHelpers?.Logger) {
      window.AutomationHelpers.Logger.info(MODULE_NAME, message, data);
    } else {
      console.log(`[TikTokAdsBot:${MODULE_NAME}] ${message}`, data || '');
    }
  }

  function error(message, err = null) {
    if (window.AutomationHelpers?.Logger) {
      window.AutomationHelpers.Logger.error(MODULE_NAME, message, err);
    } else {
      console.error(`[TikTokAdsBot:${MODULE_NAME}] ❌ ${message}`, err || '');
    }
  }

  window.__TIKTOK_ADS_BOT_INJECTED__ = true;

  log(`Content script successfully initialized on: ${window.location.href}`);

  /**
   * Initialize content script components
   */
  async function init() {
    try {
      // 1. Initialize Runner state from storage (and handle post-reload/navigation resume)
      if (window.AutomationRunner) {
        await window.AutomationRunner.initialize();
      }

      // 2. Start safe continuous popup observation
      if (window.PopupHandler) {
        window.PopupHandler.startObserving((alert) => {
          log('Critical dialog spotted by PopupHandler:', alert);

          if (alert.type === 'SECURITY' || alert.type === 'ERROR') {
            if (window.AutomationRunner && window.AutomationRunner.currentState === 'RUNNING') {
              log('Pausing automation due to critical modal...');
              window.AutomationRunner.pause();
              window.StorageService?.updateJobState({
                status: 'NEEDS_ATTENTION',
                lastError: alert.reason,
                stepDescription: `Paused: ${alert.reason}`
              });
            }
          }
        });
      }

      log('Content script ready and listening for commands.');
    } catch (err) {
      error('Failed during content script initialization:', err);
    }
  }

  /**
   * Runtime message listener for coordination with Popup and Background
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Message received: ${request?.action}`, request);

    switch (request?.action) {
      case 'PING': {
        sendResponse({
          status: 'PONG',
          ready: true,
          href: window.location.href,
          title: document.title,
          readyState: document.readyState
        });
        return true;
      }

      case 'CHECK_PAGE_STATE': {
        sendResponse({
          url: window.location.href,
          title: document.title,
          isAdsManager: window.location.href.includes('ads.tiktok.com'),
          isCampaignsPage: window.location.href.includes('/manage/campaign') || window.location.href.includes('/campaign'),
          isLoggedIn: !window.location.href.includes('/login'),
          runnerState: window.AutomationRunner ? window.AutomationRunner.getStatus() : null
        });
        return true;
      }

      case 'START_AUTOMATION': {
        console.log('[CONTENT] Automation start received');
        const safeConfig = {
          ...request?.config,
          authCode: request?.config?.authCode ? '***' + request.config.authCode.slice(-4) : ''
        };
        log('Start automation request received in content script:', safeConfig);
        if (window.AutomationRunner) {
          window.AutomationRunner.start(request.config || {})
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
          return true;
        }
        sendResponse({ success: false, error: 'AutomationRunner not initialized on this page' });
        return true;
      }

      case 'PAUSE_AUTOMATION': {
        if (window.AutomationRunner) {
          window.AutomationRunner.pause().then(res => sendResponse(res));
          return true;
        }
        sendResponse({ success: false });
        return true;
      }

      case 'RESUME_AUTOMATION': {
        if (window.AutomationRunner) {
          window.AutomationRunner.resume().then(res => sendResponse(res));
          return true;
        }
        sendResponse({ success: false });
        return true;
      }

      case 'STOP_AUTOMATION': {
        if (window.AutomationRunner) {
          window.AutomationRunner.stop().then(res => sendResponse(res));
          return true;
        }
        sendResponse({ success: false });
        return true;
      }

      case 'GET_STATUS': {
        sendResponse({
          url: window.location.href,
          runner: window.AutomationRunner ? window.AutomationRunner.getStatus() : null,
          popupsDismissed: window.PopupHandler ? window.PopupHandler.dismissedCount : 0
        });
        return true;
      }

      default:
        sendResponse({ status: 'UNKNOWN_ACTION' });
        return true;
    }
  });

  // Run initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
