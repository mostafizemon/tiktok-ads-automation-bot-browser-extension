/**
 * automation/popup-handler.js
 * Architecture for continuous global popup detection and handling using MutationObserver
 * and open Shadow DOM traversal.
 *
 * Special features:
 * - Dedicated handler for known TikTok Ads Manager tutorial popup:
 *   Modal containing "Got it" and "Take a tour", closed via:
 *   [part="closeIcon"][data-testid="ks-modal-index-qPKzsp"] -> shadowRoot -> button[part="base"]
 * - Pierces open shadow roots to detect modals that document-level observers cannot reach.
 * - Strict blocklist protecting workflow-critical dialogs:
 *   Stay/Exit confirmation, Spark Ads authorization, Add TikTok posts,
 *   Creative Assets drawer, Publish confirmation, Error dialogs, and Security checks.
 * - Unknown blocking dialogs pause automation.
 */

(function (global) {
  'use strict';

  const POPUP_TYPES = {
    INFORMATIONAL: 'INFORMATIONAL',         // e.g., Onboarding tips, "What's new" hints
    KNOWN_TUTORIAL: 'KNOWN_TUTORIAL',       // Specifically "Got it" + "Take a tour" tutorial popup
    WORKFLOW_CRITICAL: 'WORKFLOW_CRITICAL', // e.g., Custom mode Stay/Exit, Spark Ads modal, drawer
    CONFIRMATION: 'CONFIRMATION',           // Other confirmation flows
    ERROR: 'ERROR',                         // e.g., Invalid auth code, budget too low
    SECURITY_OR_PAYMENT: 'SECURITY'         // e.g., 2FA, CAPTCHA, Identity check, Billing
  };

  class GlobalPopupObserver {
    constructor() {
      this.observer = null;
      this.pollTimer = null;
      this.isMonitoring = false;
      this.isDismissing = false;
      this.dismissedCount = 0;
      this.onPopupDetectedCallback = null;
      this.processedNodes = new WeakSet();

      // Safe informational rules
      this.safeInformationalRules = [];
      this.initDefaultRules();
    }

    get helpers() {
      return global.AutomationHelpers;
    }

    /**
     * Initialize pattern definitions for dialog classification
     */
    initDefaultRules() {
      this.safeInformationalRules = [
        {
          id: 'onboarding-tour-tooltip',
          type: POPUP_TYPES.INFORMATIONAL,
          description: 'Onboarding guide / product tour tooltip',
          selector: '.byted-tour, .byted-popover-tour, [data-guide-step], .byted-intro-step',
          closeButtonSelector: '.byted-tour-close, .byted-popover-tour-close, button[aria-label="Close guide"]',
          autoDismiss: true
        },
        {
          id: 'feature-announcement-modal',
          type: POPUP_TYPES.INFORMATIONAL,
          description: 'Feature announcement or marketing banner',
          selector: '.byted-modal-announcement, [data-testid="feature-announcement-modal"]',
          closeButtonSelector: '.byted-modal-close, button[aria-label="Close"]',
          autoDismiss: true
        }
      ];
    }

    /**
     * Start observing DOM mutations for popups
     * @param {Function} [onPopupDetected] Callback for critical or blocking popups
     */
    startObserving(onPopupDetected = null) {
      if (this.isMonitoring) return;

      this.onPopupDetectedCallback = onPopupDetected;
      this.observer = new MutationObserver(this.handleMutations.bind(this));

      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true
        });
        this.isMonitoring = true;
        this.log('Global popup MutationObserver active.');

        // Periodic check to inspect popups inside open shadow roots
        // that document-level MutationObserver cannot observe directly
        if (!this.pollTimer) {
          this.pollTimer = setInterval(() => {
            this.checkForKnownTutorialPopup();
          }, 1200);
        }

        // Run an immediate check for any existing popup
        this.checkForKnownTutorialPopup();
      } else {
        window.addEventListener('DOMContentLoaded', () => this.startObserving(onPopupDetected), {
          once: true
        });
      }
    }

    /**
     * Stop observing DOM mutations
     */
    stopObserving() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.isMonitoring = false;
      this.log('Global popup observer stopped.');
    }

    /**
     * Process batch of DOM mutations
     * @param {MutationRecord[]} mutations
     */
    handleMutations(mutations) {
      for (const mutation of mutations) {
        if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.inspectAddedElement(/** @type {HTMLElement} */ (node));
          }
        }
      }
    }

    /**
     * Inspect newly inserted DOM element for dialogs/popups
     * @param {HTMLElement} element
     */
    inspectAddedElement(element) {
      if (this.processedNodes.has(element)) return;

      // First Priority: Check if this node is or contains the known Tutorial Popup
      if (this.isTutorialModalElement(element)) {
        this.findAndDismissTutorialPopup(element);
        return;
      }

      const isDialogRole = element.getAttribute('role') === 'dialog' ||
                           element.classList?.contains('byted-modal') ||
                           element.classList?.contains('arco-modal') ||
                           element.classList?.contains('modal') ||
                           element.querySelector?.('[role="dialog"]') !== null;

      if (!isDialogRole) return;

      this.processedNodes.add(element);

      // Check if child contains tutorial popup
      if (this.isTutorialModalElement(element)) {
        this.findAndDismissTutorialPopup(element);
        return;
      }

      const classification = this.classifyDialog(element);

      // Workflow dialogs: Hands off! Never dismiss automatically
      if (classification.type === POPUP_TYPES.WORKFLOW_CRITICAL) {
        this.log(`Workflow dialog detected: ${classification.reason}. Leaving for workflow handler.`);
        return;
      }

      // Security / 2FA / CAPTCHA: Halt automation & notify user
      if (classification.type === POPUP_TYPES.SECURITY_OR_PAYMENT) {
        this.warn(`Security or payment challenge detected: ${classification.reason}`);
        if (this.onPopupDetectedCallback) {
          this.onPopupDetectedCallback({
            type: POPUP_TYPES.SECURITY_OR_PAYMENT,
            reason: classification.reason,
            element
          });
        }
        return;
      }

      // Explicit error modal
      if (classification.type === POPUP_TYPES.ERROR) {
        this.warn(`Error dialog detected: ${classification.reason}`);
        if (this.onPopupDetectedCallback) {
          this.onPopupDetectedCallback({
            type: POPUP_TYPES.ERROR,
            reason: classification.reason,
            element
          });
        }
        return;
      }

      // Safe informational popup
      if (classification.type === POPUP_TYPES.INFORMATIONAL && classification.rule?.autoDismiss) {
        this.attemptAutoDismiss(element, classification.rule);
      }
    }

    /**
     * Test whether an element represents the known tutorial popup
     * (Contains both "Got it" and "Take a tour", without workflow keywords)
     * @param {HTMLElement} element
     * @returns {boolean}
     */
    isTutorialModalElement(element) {
      if (!element || !(element instanceof Element)) return false;

      const text = (element.innerText || element.textContent || '').toLowerCase();
      if (text.includes('guided mode') || global.CustomModeHandler?.ownsGuidedDialog(element)) return false;

      // Must contain BOTH "Got it" and "Take a tour"
      const hasGotIt = text.includes('got it');
      const hasTakeTour = text.includes('take a tour');

      if (!hasGotIt || !hasTakeTour) return false;

      // Safety check: verify it's NOT a critical workflow or security dialog
      const isCritical = text.includes('switch to custom mode') ||
                         (text.includes('stay') && text.includes('exit')) ||
                         text.includes('tiktok post') ||
                         text.includes('authorization code') ||
                         text.includes('batch authorize') ||
                         text.includes('publish all') ||
                         text.includes('verification') ||
                         text.includes('captcha') ||
                         text.includes('credit card') ||
                         text.includes('payment');

      return !isCritical;
    }

    /**
     * Actively scan document and open shadow roots for the known tutorial popup.
     * Can be called during ANY automation step.
     * @returns {boolean} True if a popup was found and dismissed
     */
    checkForKnownTutorialPopup() {
      if (this.isDismissing) return false;

      const h = this.helpers;
      if (!h) return false;

      // Find all candidates matching modal wrappers across normal and shadow DOM
      const candidates = h.queryShadowAll('.modal, [part="base"].modal, .modal__wrapper, [role="dialog"], [class*="modal"]');

      for (const cand of candidates) {
        if (!h.isVisible(cand)) continue;

        if (this.isTutorialModalElement(cand)) {
          this.log('Known tutorial popup ("Got it" / "Take a tour") detected in active scan.');
          return this.findAndDismissTutorialPopup(cand);
        }
      }

      return false;
    }

    /**
     * Dedicated dismissal handler for the known tutorial popup
     * 1. Finds modal close button host: [part="closeIcon"][data-testid="ks-modal-index-qPKzsp"]
     * 2. Accesses its open Shadow DOM: shadowRoot.querySelector('button[part="base"]')
     * 3. Dispatches safe click on real button
     * 4. Verifies modal disappears
     * @param {HTMLElement} modal
     * @returns {boolean}
     */
    findAndDismissTutorialPopup(modal) {
      if (this.isDismissing) return false;
      this.isDismissing = true;

      const h = this.helpers;

      try {
        this.log('Initiating safe dismissal of tutorial popup...');

        // 1. Locate close button host within modal:
        // Tag name can change (ks-icon-button-1-1-1o, ks-icon-button-923, etc.)
        // Rely on part="closeIcon", data-testid, and modal structure
        let closeBtnHost = null;

        // Primary verified selector: [part="closeIcon"][data-testid="ks-modal-index-qPKzsp"]
        if (modal.querySelector) {
          closeBtnHost = modal.querySelector('[part="closeIcon"][data-testid="ks-modal-index-qPKzsp"]') ||
                         modal.querySelector('[part="closeIcon"][data-testid*="ks-modal-index"]') ||
                         modal.querySelector('.modal__close [part="closeIcon"]') ||
                         modal.querySelector('.modal__close ks-icon-button-1-1-1o, .modal__close [class*="ks-icon-button"]');
        }

        // Fallback: search within shadow roots inside the modal
        if (!closeBtnHost && h) {
          const shadowHosts = h.queryShadowAll('[part="closeIcon"][data-testid="ks-modal-index-qPKzsp"], [part="closeIcon"][data-testid*="ks-modal-index"]', modal);
          if (shadowHosts.length > 0) {
            closeBtnHost = shadowHosts[0];
          }
        }

        if (!closeBtnHost) {
          // Additional fallback within modal__close container
          const closeContainers = modal.querySelectorAll ? modal.querySelectorAll('.modal__close, [class*="modal__close"]') : [];
          for (const c of closeContainers) {
            const host = c.querySelector('[part="closeIcon"]') || c.firstElementChild;
            if (host) {
              closeBtnHost = host;
              break;
            }
          }
        }

        if (!closeBtnHost) {
          this.warn('Could not locate close button host inside tutorial modal.');
          this.isDismissing = false;
          return false;
        }

        // 2. Access its open Shadow DOM and find the real button:
        // <template shadowrootmode="open"><button type="button" part="base"></button></template>
        let realButton = null;
        if (closeBtnHost.shadowRoot) {
          realButton = closeBtnHost.shadowRoot.querySelector('button[part="base"]') ||
                       closeBtnHost.shadowRoot.querySelector('button');
        }

        if (!realButton) {
          realButton = closeBtnHost.querySelector('button[part="base"]') ||
                       closeBtnHost.querySelector('button') ||
                       closeBtnHost;
        }

        if (!realButton) {
          this.warn('Could not access real button inside close button host shadow DOM.');
          this.isDismissing = false;
          return false;
        }

        // 3. Click the real button
        this.log('Clicking real button inside tutorial closeIcon open Shadow DOM...');
        if (h && typeof h.safeClick === 'function') {
          h.safeClick(realButton, 'Tutorial popup shadow close button');
        } else {
          realButton.click();
        }

        this.dismissedCount++;

        // 4. Verify popup disappears
        setTimeout(() => {
          const stillVisible = h ? h.isVisible(modal) : false;
          if (stillVisible) {
            this.warn('Tutorial popup still visible after close click. Attempting fallback click...');
            // Fallback: direct click on host
            closeBtnHost.click();
          } else {
            this.log('Tutorial popup confirmed closed. Resuming current automation step.');
          }
          this.isDismissing = false;
        }, 500);

        return true;

      } catch (err) {
        this.warn('Error while dismissing tutorial popup:', err);
        this.isDismissing = false;
        return false;
      }
    }

    /**
     * Classify dialog into safe informational, workflow-critical, error, or security
     * @param {HTMLElement} element
     * @returns {{ type: string, reason: string, rule?: object }}
     */
    classifyDialog(element) {
      const text = (element.innerText || element.textContent || '').toLowerCase();

      if (text.includes('guided mode') || global.CustomModeHandler?.ownsGuidedDialog(element)) {
        return { type: POPUP_TYPES.WORKFLOW_CRITICAL, reason: 'Guided Mode exit confirmation' };
      }

      // Check for known tutorial popup first
      if (this.isTutorialModalElement(element)) {
        return {
          type: POPUP_TYPES.KNOWN_TUTORIAL,
          reason: 'Known tutorial popup ("Got it" / "Take a tour")'
        };
      }

      if (text.includes('link tiktok account') || text.includes('link existing tiktok account') ||
          text.includes('link with qr code')) {
        return { type: POPUP_TYPES.WORKFLOW_CRITICAL, reason: 'TikTok account linking workflow' };
      }

      // 1. Workflow-critical dialogs (MUST NOT BE AUTO-DISMISSED)
      // Custom mode Stay/Exit confirmation
      if (text.includes('custom mode') || (text.includes('stay') && text.includes('exit'))) {
        return {
          type: POPUP_TYPES.WORKFLOW_CRITICAL,
          reason: 'Custom mode Stay/Exit dialog'
        };
      }

      // Spark Ads post authorization modals & drawer
      if (text.includes('tiktok post') || text.includes('authorization code') ||
          text.includes('batch authorize') || text.includes('add post') ||
          text.includes('hybrid-drawer') || text.includes('creative assets')) {
        return {
          type: POPUP_TYPES.WORKFLOW_CRITICAL,
          reason: 'Spark Ads or Creative Asset drawer/modal'
        };
      }

      // Campaign Publish confirmation
      if (text.includes('publish all') || text.includes('confirm to publish')) {
        return {
          type: POPUP_TYPES.WORKFLOW_CRITICAL,
          reason: 'Publish confirmation dialog'
        };
      }

      // 2. High-priority security and verification checks
      const securityKeywords = [
        'verification', 'security check', 'captcha', 'credit card',
        'payment method', 'identity', 'phone verification', 'two-factor', 'otp'
      ];
      if (securityKeywords.some(kw => text.includes(kw))) {
        return {
          type: POPUP_TYPES.SECURITY_OR_PAYMENT,
          reason: 'Matches security or billing challenge'
        };
      }

      // 3. Error dialogs
      const errorKeywords = [
        'failed to authorize', 'invalid code', 'code expired',
        'account suspended', 'insufficient balance', 'system error'
      ];
      if (errorKeywords.some(kw => text.includes(kw))) {
        return {
          type: POPUP_TYPES.ERROR,
          reason: 'Error message banner or modal'
        };
      }

      // 4. Safe informational rules
      for (const rule of this.safeInformationalRules) {
        if (rule.selector && (element.matches?.(rule.selector) || element.querySelector?.(rule.selector))) {
          return {
            type: POPUP_TYPES.INFORMATIONAL,
            reason: rule.description,
            rule
          };
        }
      }

      return {
        type: POPUP_TYPES.CONFIRMATION,
        reason: 'Unregistered dialog'
      };
    }

    /**
     * Dismiss recognized informational popup safely
     * @param {HTMLElement} element
     * @param {object} rule
     */
    attemptAutoDismiss(element, rule) {
      if (!rule.closeButtonSelector) return;
      const closeBtn = element.querySelector(rule.closeButtonSelector);
      if (closeBtn && global.AutomationHelpers?.isVisible(closeBtn)) {
        this.log(`Auto-dismissing safe informational popup: ${rule.description}`);
        closeBtn.click();
        this.dismissedCount++;
      }
    }

    log(message) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.info('PopupHandler', message);
      } else {
        console.log(`[TikTokAdsBot:PopupHandler] ${message}`);
      }
    }

    warn(message) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.warn('PopupHandler', message);
      } else {
        console.warn(`[TikTokAdsBot:PopupHandler] ⚠️ ${message}`);
      }
    }
  }

  // Create singleton instance
  const popupObserverInstance = new GlobalPopupObserver();

  global.GlobalPopupObserver = GlobalPopupObserver;
  global.PopupHandler = popupObserverInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GlobalPopupObserver, PopupHandler: popupObserverInstance, POPUP_TYPES };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
