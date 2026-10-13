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
     * Classify a notification or error message by severity:
     * - 'INFO': Informational notification (e.g. "We auto-added 4 UTM parameters to your URL.")
     *           Never sets submission to FAILED, never interrupts publishing, never counts as SUCCESS.
     * - 'ERROR': Genuine publishing or validation error (submission failure, invalid URL/UTM, insufficient balance, etc.)
     * - 'AMBIGUOUS': Unclear severity (e.g. neutral alert without error or info indicators).
     *
     * @param {Element|string} target
     * @returns {{ severity: 'INFO'|'ERROR'|'AMBIGUOUS', text: string, isInformationalUtm: boolean, isActualError: boolean }}
     */
    classifyNotification(target) {
      if (!target) {
        return { severity: 'AMBIGUOUS', text: '', isInformationalUtm: false, isActualError: false };
      }

      const text = (typeof target === 'string'
        ? target
        : (target.innerText || target.textContent || '')).trim();

      const lower = text.toLowerCase();
      if (!text) {
        return { severity: 'AMBIGUOUS', text: '', isInformationalUtm: false, isActualError: false };
      }

      // Check element container metadata if available
      let hasErrorClass = false;
      let hasInfoClass = false;
      let hasFormErrorClass = false;

      if (typeof target === 'object' && target !== null) {
        const classStr = (target.className || (target.getAttribute && target.getAttribute('class')) || '').toLowerCase();
        hasFormErrorClass = classStr.includes('vi-form-item__error') ||
                            classStr.includes('ant-form-item-explain-error') ||
                            classStr.includes('form-item-explain-error');
        hasErrorClass = hasFormErrorClass ||
                        classStr.includes('message-error') ||
                        classStr.includes('modal-error') ||
                        classStr.includes('error-dialog') ||
                        classStr.includes('toast-error') ||
                        classStr.includes('alert-error');
        hasInfoClass = classStr.includes('message-info') ||
                       classStr.includes('modal-info') ||
                       classStr.includes('toast-info') ||
                       classStr.includes('alert-info') ||
                       classStr.includes('notification-info') ||
                       classStr.includes('message-warning') ||
                       classStr.includes('alert-warning');
      }

      // 1. Check for explicit error patterns in text
      const hasExplicitErrorKeyword = (
        /\b(failed|failure|rejected|cannot|unable|error|invalid|exceed|exceeded|unsupported|illegal|missing)\b/i.test(text)
      );

      const isPublishSubmissionError = (
        /\b(failed\s+to\s+publish|publication\s+failed|publishing\s+failed|campaign\s+creation\s+failed|creation\s+failed|submission\s+failed|cannot\s+publish|unable\s+to\s+publish|failed\s+to\s+submit|submission\s+error|publishing\s+error|cannot\s+create\s+campaign)\b/i.test(text)
      );

      const isAccountOrAuthError = (
        /\b(account\s+suspended|account\s+disabled|authorization\s+code\s+invalid|authorization\s+code\s+expired|auth\s+code\s+expired|auth\s+code\s+invalid|post\s+authorization\s+failed|insufficient|top\s+up)\b/i.test(text)
      );

      const isBudgetError = (
        /\b(budget\s+must\s+be|budget\s+is\s+invalid|minimum\s+budget|daily\s+budget\s+must\s+be|budget\s+cannot\s+be)\b/i.test(text)
      );

      const isFormRequirementError = (
        /\b(required\s+field|field\s+is\s+required|please\s+complete\s+all\s+required|fill\s+in\s+the\s+required)\b/i.test(text)
      );

      // Real URL or UTM parameter errors:
      // Examples: "Invalid UTM parameter", "UTM parameter error", "Failed to add UTM parameters",
      // "Invalid URL", "Invalid website URL", "URL is invalid", "Please enter a valid URL"
      const isUrlOrUtmError = (
        /\b(invalid\s+url|url\s+is\s+invalid|please\s+enter\s+a\s+valid\s+url|invalid\s+website\s+url|destination\s+url\s+is\s+invalid)\b/i.test(text) ||
        (lower.includes('utm') && hasExplicitErrorKeyword) ||
        (lower.includes('url') && hasExplicitErrorKeyword && !lower.includes('auto-added'))
      );

      const isSystemError = (
        /\b(system\s+error|internal\s+server\s+error|network\s+error|something\s+went\s+wrong)\b/i.test(text)
      );

      const isActualError = (
        isPublishSubmissionError ||
        isAccountOrAuthError ||
        isBudgetError ||
        isFormRequirementError ||
        isUrlOrUtmError ||
        isSystemError
      );

      // 2. Check for informational UTM notifications
      // Observed exact TikTok text: "We auto-added 4 UTM parameters to your URL."
      const isInformationalUtm = (
        (/auto-added\s+\d*\s*utm\s+parameters?/i.test(text) ||
         /we\s+auto-added.*utm/i.test(text) ||
         /auto-added.*to\s+your\s+url/i.test(text) ||
         /utm\s+parameters?\s+(?:have\s+been\s+)?auto-added/i.test(text) ||
         /utm\s+parameters?\s+(?:have\s+been\s+)?automatically\s+added/i.test(text)) &&
        !hasExplicitErrorKeyword
      );

      // If it's an informational UTM notification, classify as INFO
      if (isInformationalUtm) {
        return {
          severity: 'INFO',
          text,
          isInformationalUtm: true,
          isActualError: false
        };
      }

      // If text contains an explicit real error
      if (isActualError) {
        return {
          severity: 'ERROR',
          text,
          isInformationalUtm: false,
          isActualError: true
        };
      }

      // If element is explicitly an inline form error container with content
      if (hasFormErrorClass && text.length > 0) {
        return {
          severity: 'ERROR',
          text,
          isInformationalUtm: false,
          isActualError: true
        };
      }

      // If container has explicit error class and text has some error-like word
      if (hasErrorClass && hasExplicitErrorKeyword) {
        return {
          severity: 'ERROR',
          text,
          isInformationalUtm: false,
          isActualError: true
        };
      }

      // If container has explicit error class and does not look like info/warning
      if (hasErrorClass && !hasInfoClass) {
        return {
          severity: 'ERROR',
          text,
          isInformationalUtm: false,
          isActualError: true
        };
      }

      // If container has explicit info/warning class
      if (hasInfoClass && !hasExplicitErrorKeyword) {
        return {
          severity: 'INFO',
          text,
          isInformationalUtm: false,
          isActualError: false
        };
      }

      // Other general informational / tips text without error words
      if (/^(tips?|note):/i.test(text) && !hasExplicitErrorKeyword) {
        return {
          severity: 'INFO',
          text,
          isInformationalUtm: false,
          isActualError: false
        };
      }

      // Otherwise, the message is ambiguous (neutral alert / toast)
      // Do not assume every alert is an error!
      return {
        severity: 'AMBIGUOUS',
        text,
        isInformationalUtm: false,
        isActualError: false
      };
    },

    /**
     * Detect visible TikTok error banners, error dialogs, or inline form validation errors
     * Accurately distinguishes genuine publishing failures from informational notices (e.g. UTM tracking notifications).
     * @param {Document|Element} [context=document]
     * @returns {{ hasError: boolean, errorText: string }|null}
     */
    findSubmissionError(context = document) {
      // 1. Check inline form errors (highest confidence of form validation failure)
      const formErrors = this.queryShadowAll('.vi-form-item__error, .ant-form-item-explain-error, [class*="form-item-explain-error"]', context);
      for (const el of formErrors) {
        if (this.isVisible(el)) {
          const classification = this.classifyNotification(el);
          if (classification.severity === 'ERROR') {
            return { hasError: true, errorText: `Form error: ${classification.text}` };
          }
        }
      }

      // 2. Check error dialogs and modal error containers
      const dialogErrors = this.queryShadowAll('[class*="error-dialog"], [class*="modal-error"], .byted-modal-error, .arco-modal-error', context);
      for (const el of dialogErrors) {
        if (this.isVisible(el)) {
          const classification = this.classifyNotification(el);
          if (classification.severity === 'ERROR') {
            return { hasError: true, errorText: classification.text };
          }
        }
      }

      // 3. Check explicit error message / toast banners
      const messageErrors = this.queryShadowAll('.byted-message-error, .arco-message-error, .semi-toast-error, .ant-message-error, [class*="message-error"], [class*="toast-error"], [class*="alert-error"]', context);
      for (const el of messageErrors) {
        if (this.isVisible(el)) {
          const classification = this.classifyNotification(el);
          if (classification.severity === 'ERROR') {
            return { hasError: true, errorText: classification.text };
          }
        }
      }

      // 4. Check generic alerts / toasts for EXPLICIT error text
      // Generic selectors like [role="alert"], .byted-message, .arco-message are only considered errors
      // IF their text content explicitly classifies as severity === 'ERROR'.
      // Informational notifications (like UTM auto-added) or ambiguous notices are strictly excluded.
      const genericAlerts = this.queryShadowAll('[role="alert"], .byted-message, .arco-message, .semi-toast', context);
      for (const el of genericAlerts) {
        if (this.isVisible(el)) {
          const classification = this.classifyNotification(el);
          if (classification.severity === 'ERROR') {
            return { hasError: true, errorText: classification.text };
          }
        }
      }

      return null;
    },

    /**
     * Detect visible informational TikTok notifications (such as UTM auto-add tracking notices)
     * @param {Document|Element} [context=document]
     * @returns {{ hasInfo: boolean, infoText: string, isUtm: boolean }|null}
     */
    findSubmissionInfo(context = document) {
      const candidates = this.queryShadowAll(
        '.byted-message-info, .arco-message-info, .semi-toast-info, .ant-message-info, [class*="message-info"], [class*="toast-info"], [class*="alert-info"], [class*="notification-info"], [role="alert"], .byted-message, .arco-message, .semi-toast',
        context
      );
      for (const el of candidates) {
        if (this.isVisible(el)) {
          const classification = this.classifyNotification(el);
          if (classification.severity === 'INFO') {
            return {
              hasInfo: true,
              infoText: classification.text,
              isUtm: classification.isInformationalUtm
            };
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
    },

    /**
     * Check if extension context is valid
     * @returns {boolean}
     */
    isExtensionValid() {
      try {
        return typeof chrome !== 'undefined' &&
               !!chrome.runtime &&
               !!chrome.runtime.id;
      } catch (e) {
        return false;
      }
    },

    /**
     * Read actual campaign name from the page (e.g. Traffic20261013161035)
     * Checks form inputs, headers, breadcrumbs, or review panels.
     * @param {Document|Element} [context=document]
     * @returns {string|null}
     */
    extractCampaignNameFromPage(context = document) {
      // 1. Direct campaign name input fields
      const inputs = this.queryShadowAll('input[data-testid*="campaign" i], input[placeholder*="campaign name" i], input[name*="campaignName" i], #campaignName, input.vi-input__original', context);
      for (const input of inputs) {
        if (this.isVisible(input) && input.value && typeof input.value === 'string') {
          const val = input.value.trim();
          if (val.length > 2 && (/^Traffic\d+/i.test(val) || /^Campaign\d+/i.test(val) || val.toLowerCase().includes('traffic'))) {
            return val;
          }
        }
      }

      // 2. Generic text inputs whose value matches Traffic pattern
      const allInputs = this.queryShadowAll('input[type="text"], input:not([type])', context);
      for (const input of allInputs) {
        if (this.isVisible(input) && input.value) {
          const val = String(input.value).trim();
          if (/^Traffic\d{10,18}$/i.test(val)) {
            return val;
          }
        }
      }

      // 3. Breadcrumbs, header, summary drawer or title elements
      const candidates = this.queryShadowAll('[class*="breadcrumb"], [class*="campaign-name"], [class*="header"], [class*="title"], h1, h2, h3, span', context);
      for (const el of candidates) {
        if (!this.isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        const match = text.match(/\b(Traffic\d{10,18})\b/i);
        if (match) {
          return match[1];
        }
      }

      return null;
    },

    /**
     * Extract advertiser ID (aadvid) from current URL or string
     * @param {string} [url]
     * @returns {string|null}
     */
    extractAdvertiserIdFromUrl(url = (typeof window !== 'undefined' && window.location ? window.location.href : '')) {
      if (!url) return null;
      const match = url.match(/[?&]aadvid=(\d+)/i) || url.match(/\/advertiser\/(\d+)/i) || url.match(/\baadvid[:=](\d+)/i);
      return match ? match[1] : null;
    },

    /**
     * Extract baseline of pre-existing campaign IDs and names from Campaigns management table
     * @param {Document|Element} [context=document]
     * @returns {{ ids: string[], names: string[] }}
     */
    extractCampaignBaselineFromTable(context = document) {
      const ids = new Set();
      const names = new Set();
      const rows = this.queryShadowAll('tbody tr, [role="row"], tr[data-row-key], .byted-table-row, .arco-table-row, .semi-table-row', context);
      for (const row of rows) {
        if (!this.isVisible(row)) continue;
        const rowText = (row.innerText || row.textContent || '').trim();
        const lower = rowText.toLowerCase();
        if (row.tagName === 'TH' || (typeof row.closest === 'function' && row.closest('thead')) || (lower.includes('campaign name') && lower.includes('budget'))) {
          continue;
        }

        // Extract ID from attributes or text
        const rowKey = row.getAttribute('data-row-key') || row.getAttribute('data-id') || row.getAttribute('id') || '';
        const idFromKey = rowKey.match(/\b(18\d{14,18})\b/) || rowKey.match(/\b(\d{16,19})\b/);
        if (idFromKey) ids.add(idFromKey[1]);

        const textMatches = rowText.match(/\b(18\d{14,18})\b/g) || rowText.match(/\b(\d{16,19})\b/g);
        if (textMatches) textMatches.forEach(id => ids.add(id));

        // Child links
        const links = row.querySelectorAll ? row.querySelectorAll('a[href]') : [];
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/campaign_id=(\d+)/) || href.match(/\/campaign\/(\d+)/);
          if (m) ids.add(m[1]);
        }

        // Child checkboxes
        const inputs = row.querySelectorAll ? row.querySelectorAll('input') : [];
        for (const inp of inputs) {
          const val = inp.getAttribute('value') || inp.value || '';
          const m = val.match(/\b(18\d{14,18})\b/) || val.match(/\b(\d{16,19})\b/);
          if (m) ids.add(m[1]);
        }

        // Extract Campaign Name pattern (e.g. Traffic20261013161035)
        const nameMatch = rowText.match(/\b(Traffic\d{10,18})\b/i);
        if (nameMatch) {
          names.add(nameMatch[1].toLowerCase());
        }
      }
      return { ids: Array.from(ids), names: Array.from(names) };
    },

    /**
     * Extract all visible campaign IDs from the campaigns management table
     * @param {Document|Element} [context=document]
     * @returns {string[]}
     */
    extractCampaignIdsFromTable(context = document) {
      const baseline = this.extractCampaignBaselineFromTable(context);
      return baseline.ids;
    }
  };

  // Expose globally
  global.AutomationHelpers = AutomationHelpers;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutomationHelpers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
