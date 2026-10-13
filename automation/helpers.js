/**
 * automation/helpers.js
 * Core automation utilities and helper functions for TikTok Ads Automation Bot.
 * Includes open Shadow DOM traversal, React-safe synthetic input setting,
 * abort-aware bounded polling, and structured diagnostic logging.
 */

(function (global) {
  'use strict';

  const AutomationHelpers = {
    /**
     * Check if current automation run has been aborted or paused
     * @returns {boolean}
     */
    isAborted() {
      return !!(global.AutomationRunner && global.AutomationRunner.shouldAbort);
    },

    /**
     * Pause execution for specified milliseconds (abort-aware)
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
          if (AutomationHelpers.isAborted()) {
            clearInterval(interval);
            reject(new Error('Automation aborted or paused by user'));
            return;
          }
          if (Date.now() - start >= ms) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });
    },

    /**
     * Logger utility with standard bot formatting, sensitive data masking, and structured diagnostics
     */
    Logger: {
      prefix: '[TikTokAdsBot]',

      maskCode(str) {
        if (!str || typeof str !== 'string') return '';
        if (str.length <= 6) return '***';
        return str.slice(0, 3) + '***' + str.slice(-3);
      },

      log(moduleName, message, data = null) {
        const time = new Date().toLocaleTimeString();
        if (data !== null) {
          console.log(`${this.prefix}[${moduleName}] [${time}] ${message}`, data);
        } else {
          console.log(`${this.prefix}[${moduleName}] [${time}] ${message}`);
        }
      },

      info(moduleName, message, data = null) {
        const time = new Date().toLocaleTimeString();
        if (data !== null) {
          console.info(`${this.prefix}[${moduleName}] [${time}] ℹ️ ${message}`, data);
        } else {
          console.info(`${this.prefix}[${moduleName}] [${time}] ℹ️ ${message}`);
        }
      },

      warn(moduleName, message, data = null) {
        const time = new Date().toLocaleTimeString();
        if (data !== null) {
          console.warn(`${this.prefix}[${moduleName}] [${time}] ⚠️ ${message}`, data);
        } else {
          console.warn(`${this.prefix}[${moduleName}] [${time}] ⚠️ ${message}`);
        }
      },

      error(moduleName, message, error = null) {
        const time = new Date().toLocaleTimeString();
        if (error !== null) {
          console.error(`${this.prefix}[${moduleName}] [${time}] ❌ ${message}`, error);
        } else {
          console.error(`${this.prefix}[${moduleName}] [${time}] ❌ ${message}`);
        }
      },

      /**
       * Structured diagnostic logging for each automation step
       * Records: Step name, Current URL, Element found/missing, Action attempted, Verification result, Error
       * @param {string} stepName
       * @param {string} actionAttempted
       * @param {object} details
       */
      diagnostic(stepName, actionAttempted, details = {}) {
        const time = new Date().toLocaleTimeString();
        const url = (typeof window !== 'undefined' && window.location) ? window.location.href : 'N/A';

        const entry = {
          timestamp: new Date().toISOString(),
          step: stepName,
          url: url,
          action: actionAttempted,
          elementFound: details.elementFound || null,
          elementMissing: details.elementMissing || null,
          verification: details.verification || null,
          error: details.error || null
        };

        const summary = `${this.prefix}[Diagnostic] [${time}] Step: [${stepName}] | Action: "${actionAttempted}" | ` +
          `Found: ${entry.elementFound || 'N/A'} | Verification: ${entry.verification || 'N/A'}` +
          (entry.error ? ` | Error: ${entry.error}` : '');

        if (entry.error) {
          console.error(summary);
        } else {
          console.log(summary);
        }

        // Persist structured diagnostic log into local storage if available
        if (global.StorageService && typeof global.StorageService.addLog === 'function') {
          global.StorageService.addLog(
            entry.error ? 'ERROR' : 'INFO',
            `[${stepName}] ${actionAttempted} -> ${entry.verification || 'Done'}`,
            entry
          );
        }
      }
    },

    /**
     * Check if an element is currently visible to user
     * @param {Element} element
     * @returns {boolean}
     */
    isVisible(element) {
      if (!element) return false;
      if (typeof Element !== 'undefined' && !(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    /**
     * Deeply search an open Shadow DOM tree for a single element matching selector
     * @param {string} selector
     * @param {Document|Element|ShadowRoot} [root=document]
     * @returns {Element|null}
     */
    queryShadow(selector, root = document) {
      if (!root) return null;

      // 1. Check in root
      if (root.querySelector) {
        const direct = root.querySelector(selector);
        if (direct) return direct;
      }

      // 2. Iterate all elements and pierce open shadowRoots
      const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of allElements) {
        if (el.shadowRoot) {
          const shadowMatch = this.queryShadow(selector, el.shadowRoot);
          if (shadowMatch) return shadowMatch;
        }
      }

      return null;
    },

    /**
     * Deeply search open Shadow DOM tree for all elements matching selector
     * @param {string} selector
     * @param {Document|Element|ShadowRoot} [root=document]
     * @returns {Element[]}
     */
    queryShadowAll(selector, root = document) {
      const results = [];
      if (!root) return results;

      if (root.querySelectorAll) {
        results.push(...Array.from(root.querySelectorAll(selector)));
      }

      const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of allElements) {
        if (el.shadowRoot) {
          results.push(...this.queryShadowAll(selector, el.shadowRoot));
        }
      }

      return results;
    },

    /**
     * If element has an open shadowRoot (e.g. <ks-button-923>), get the clickable inner button
     * @param {HTMLElement} hostElement
     * @returns {HTMLElement}
     */
    getClickableTarget(hostElement) {
      if (!hostElement) return hostElement;

      if (hostElement.shadowRoot) {
        const innerBtn = hostElement.shadowRoot.querySelector('button[part="base"]') ||
                         hostElement.shadowRoot.querySelector('button') ||
                         hostElement.shadowRoot.querySelector('[part="base"]');
        if (innerBtn) {
          return innerBtn;
        }
      }

      const childBtn = hostElement.querySelector('button');
      if (childBtn) return childBtn;

      return hostElement;
    },

    /**
     * Find a button or custom button component matching exact or trimmed text
     * Pierces Shadow DOM to return the actual inner clickable button
     * @param {string} text Exact text to match
     * @param {Document|Element} [root=document]
     * @returns {HTMLElement|null}
     */
    findButtonByExactText(text, root = document) {
      const targetText = text.trim();

      const candidates = this.queryShadowAll('button, [role="button"], [class*="KsButton"], [class*="ks-button"], ks-button-923', root);

      for (const candidate of candidates) {
        const candText = (candidate.innerText || candidate.textContent || '').trim();
        if (candText === targetText && this.isVisible(candidate)) {
          return this.getClickableTarget(candidate);
        }
      }

      const allTextNodes = this.queryShadowAll('*', root);
      for (const el of allTextNodes) {
        if (el.children.length === 0 || el.tagName === 'SPAN' || el.tagName === 'P') {
          if ((el.innerText || el.textContent || '').trim() === targetText && this.isVisible(el)) {
            const clickable = el.closest('button, [role="button"], ks-button-923, a') || el;
            return this.getClickableTarget(clickable);
          }
        }
      }

      return null;
    },

    /**
     * Wait for an element to exist and be visible in DOM (with Shadow DOM piercing and abort-awareness)
     * @param {string} selector
     * @param {number} [timeoutMs=10000]
     * @param {Document|Element} [context=document]
     * @returns {Promise<Element|null>}
     */
    async waitForVisibleElement(selector, timeoutMs = 10000, context = document) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }
        if (global.PopupHandler && typeof global.PopupHandler.checkForKnownTutorialPopup === 'function') {
          global.PopupHandler.checkForKnownTutorialPopup();
        }
        const el = this.queryShadow(selector, context);
        if (el && this.isVisible(el)) {
          return el;
        }
        await this.sleep(200);
      }
      return null;
    },

    /**
     * Wait for an element matching selector (abort-aware)
     * @param {string} selector
     * @param {number} [timeoutMs=10000]
     * @param {Document|Element} [context=document]
     * @returns {Promise<Element|null>}
     */
    async waitForElement(selector, timeoutMs = 10000, context = document) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }
        if (global.PopupHandler && typeof global.PopupHandler.checkForKnownTutorialPopup === 'function') {
          global.PopupHandler.checkForKnownTutorialPopup();
        }
        const el = this.queryShadow(selector, context);
        if (el) return el;
        await this.sleep(200);
      }
      return null;
    },

    /**
     * Wait for a button matching text to become visible (abort-aware)
     * @param {string} text
     * @param {number} [timeoutMs=10000]
     * @param {Document|Element} [context=document]
     * @returns {Promise<HTMLElement|null>}
     */
    async waitForButtonByText(text, timeoutMs = 10000, context = document) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }
        if (global.PopupHandler && typeof global.PopupHandler.checkForKnownTutorialPopup === 'function') {
          global.PopupHandler.checkForKnownTutorialPopup();
        }
        const btn = this.findButtonByExactText(text, context);
        if (btn && this.isVisible(btn)) {
          return btn;
        }
        await this.sleep(200);
      }
      return null;
    },

    /**
     * Wait for an element to disappear from the DOM (abort-aware)
     * @param {string} selector
     * @param {number} [timeoutMs=10000]
     * @param {Document|Element} [context=document]
     * @returns {Promise<boolean>}
     */
    async waitForElementToDisappear(selector, timeoutMs = 10000, context = document) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }
        const el = this.queryShadow(selector, context);
        if (!el || !this.isVisible(el)) {
          return true;
        }
        await this.sleep(200);
      }
      return false;
    },

    /**
     * Safely dispatch click events matching real user behavior, handling Shadow DOM buttons
     * @param {HTMLElement} element
     * @param {string} [description='element']
     */
    safeClick(element, description = 'element') {
      if (!element) {
        throw new Error(`[AutomationHelpers] Cannot click nonexistent element: ${description}`);
      }

      const target = this.getClickableTarget(element);

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();

      this.Logger.info('Helpers', `Dispatched safe click on: ${description}`);
    },

    /**
     * Safely fill an input element with React synthetic event support
     * @param {HTMLInputElement} element
     * @param {string} value
     */
    setNativeInputValue(element, value) {
      if (!element) {
        throw new Error('[AutomationHelpers] Target input element not provided');
      }

      element.focus();

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      element.blur();
    },

    /**
     * Safely fill a textarea element with React synthetic event support
     * @param {HTMLTextAreaElement} element
     * @param {string} value
     */
    setNativeTextareaValue(element, value) {
      if (!element) {
        throw new Error('[AutomationHelpers] Target textarea element not provided');
      }

      element.focus();

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      element.blur();
    },

    /**
     * Validation helper for website URL
     * @param {string} urlString
     * @returns {boolean}
     */
    isValidWebsiteUrl(urlString) {
      if (!urlString || typeof urlString !== 'string') return false;
      const trimmed = urlString.trim();
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },

    /**
     * Validation helper for budget
     * @param {number|string} budget
     * @returns {boolean}
     */
    isValidBudget(budget) {
      const num = Number(budget);
      return !isNaN(num) && num > 0 && num <= 1000000;
    },

    /**
     * Validation helper for campaign count
     * @param {number|string} count
     * @returns {boolean}
     */
    isValidCampaignCount(count) {
      const num = parseInt(count, 10);
      return !isNaN(num) && num >= 1 && num <= 100;
    },

    /**
     * Validation helper for country array
     * @param {Array<string>} countries
     * @returns {boolean}
     */
    isValidCountries(countries) {
      return Array.isArray(countries) && countries.length > 0 && countries.every(c => typeof c === 'string' && c.trim().length > 0);
    },

    /**
     * Check if given URL (or current location) is on the Campaigns management route
     * Matches patterns like: https://ads.tiktok.com/i18n/manage/campaign?aadvid=...
     * Excludes creation or editing sub-routes (/create, /edit).
     * @param {string} [url]
     * @returns {boolean}
     */
    isCampaignsManagementUrl(url = null) {
      const currentUrl = url || (typeof window !== 'undefined' && window.location ? window.location.href : '');
      if (!currentUrl || typeof currentUrl !== 'string') return false;
      const lower = currentUrl.toLowerCase();
      const hasCampaignManage = lower.includes('/manage/campaign') || lower.includes('/i18n/manage/campaign');
      const isSubRoute = lower.includes('/manage/campaign/create') ||
                         lower.includes('/manage/campaign/edit') ||
                         lower.includes('/campaign/create') ||
                         lower.includes('/campaign/edit');
      return hasCampaignManage && !isSubRoute;
    },

    /**
     * Detect Campaigns management UI elements (Create button or campaign table)
     * A route change alone is not sufficient; the actual UI must be interactive.
     * @param {Document|Element} [context=document]
     * @returns {HTMLElement|null}
     */
    findCampaignsManagementUI(context = document) {
      // 1. Check for Create button
      const ksButtons = this.queryShadowAll('ks-button-923, [class*="KsButton"], button, [data-testid*="campaign_create"], [data-testid*="create_campaign"]', context);
      for (const btn of ksButtons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if ((text === 'Create' || text.startsWith('Create')) && this.isVisible(btn)) {
          return this.getClickableTarget(btn);
        }
      }

      // 2. Check for Campaign table
      const tables = this.queryShadowAll('[data-testid*="table"], .byted-table, .arco-table, [class*="table_wrapper"], [role="table"]', context);
      for (const tbl of tables) {
        if (this.isVisible(tbl)) {
          return tbl;
        }
      }

      return null;
    },

    /**
     * Wait for both Campaigns management route and Campaigns management UI to become available
     * @param {number} [timeoutMs=60000]
     * @returns {Promise<boolean>}
     */
    async waitForCampaignsPage(timeoutMs = 60000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (this.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }
        if (this.isCampaignsManagementUrl() && this.findCampaignsManagementUI()) {
          return true;
        }
        await this.sleep(500);
      }
      return false;
    },

    /**
     * Detect visible loading indicators (spinners, loading overlays)
     * @param {Document|Element} [context=document]
     * @returns {HTMLElement|null}
     */
    findLoadingIndicator(context = document) {
      const candidates = this.queryShadowAll('.byted-spin, .arco-spin, .vi-loading, ks-loading, [part*="loading"], .is-loading, [data-testid*="loading"]', context);
      for (const el of candidates) {
        if (this.isVisible(el)) {
          return el;
        }
      }
      return null;
    },

    /**
     * Detect visible TikTok error banners, error dialogs, or inline form validation errors
     * @param {Document|Element} [context=document]
     * @returns {{ hasError: boolean, errorText: string }|null}
     */
    findSubmissionError(context = document) {
      // Check error dialogs and toasts
      const errorElements = this.queryShadowAll('.byted-message-error, .arco-message-error, [class*="error-dialog"], [class*="modal-error"], [role="alert"]', context);
      for (const el of errorElements) {
        if (this.isVisible(el)) {
          const text = (el.innerText || el.textContent || '').trim();
          if (text.length > 0) {
            return { hasError: true, errorText: text };
          }
        }
      }

      // Check inline form errors
      const formErrors = this.queryShadowAll('.vi-form-item__error, .ant-form-item-explain-error, [class*="form-item-explain-error"]', context);
      for (const el of formErrors) {
        if (this.isVisible(el)) {
          const text = (el.innerText || el.textContent || '').trim();
          if (text.length > 0) {
            return { hasError: true, errorText: `Form error: ${text}` };
          }
        }
      }

      return null;
    },

    /**
     * Detect explicit submission confirmation evidence (success modal, toast, or campaign ID)
     * @param {Document|Element} [context=document]
     * @returns {{ confirmed: boolean, type: string, text: string, campaignId?: string }|null}
     */
    findSubmissionEvidence(context = document) {
      // 1. Success dialogs / modals
      const dialogs = this.queryShadowAll('.byted-modal, .arco-modal, [role="dialog"], [data-testid*="success"]', context);
      for (const dlg of dialogs) {
        if (!this.isVisible(dlg)) continue;
        const text = (dlg.innerText || dlg.textContent || '').toLowerCase();
        const hasSuccessTitle = text.includes('campaign created') ||
                                text.includes('congratulations') ||
                                text.includes('under review') ||
                                text.includes('submit successfully') ||
                                text.includes('created successfully');
        if (hasSuccessTitle) {
          const rawText = (dlg.innerText || dlg.textContent || '').trim();
          const idMatch = rawText.match(/campaign id[:\s]+(\d+)/i) || rawText.match(/\b(18\d{14,18})\b/);
          const campaignId = idMatch ? idMatch[1] : null;
          return {
            confirmed: true,
            type: 'MODAL',
            text: rawText.slice(0, 300),
            campaignId
          };
        }
      }

      // 2. Success toasts / alerts
      const toasts = this.queryShadowAll('.byted-message-success, .ant-message-success, .arco-message-success, [class*="message-success"]', context);
      for (const toast of toasts) {
        if (!this.isVisible(toast)) continue;
        const toastText = (toast.innerText || toast.textContent || '').trim();
        const lower = toastText.toLowerCase();
        if (lower.includes('success') || lower.includes('created') || lower.includes('submitted')) {
          const idMatch = toastText.match(/campaign id[:\s]+(\d+)/i) || toastText.match(/\b(18\d{14,18})\b/);
          const campaignId = idMatch ? idMatch[1] : null;
          return {
            confirmed: true,
            type: 'TOAST',
            text: toastText,
            campaignId
          };
        }
      }

      return null;
    }
  };

  // Expose globally
  global.AutomationHelpers = AutomationHelpers;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutomationHelpers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
