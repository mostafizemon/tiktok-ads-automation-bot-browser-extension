/**
 * automation/custom-mode.js
 * Optional onboarding handler for Guided Mode and the legacy Simplified/Custom Mode flow.
 * Guided Mode uses the host's open shadow button and a scoped cancel-btn Exit slot.
 *
 * Requirements:
 * Case A:
 * 1. Check for visible button with text "Switch to custom mode".
 * 2. If present, click "Switch to custom mode".
 * 3. Wait for confirmation popup containing "Stay" and "Exit".
 * 4. Click "Exit" strictly within that confirmation popup.
 * 5. Wait for regular campaign creation interface.
 *
 * Case B:
 * 1. Custom mode button is absent, or regular Traffic objective is already present.
 * 2. Proceed immediately without unnecessary waiting.
 */

(function (global) {
  'use strict';

  class CustomModeHandler {
    constructor() {
      this.name = 'CustomModeHandler';
    }

    /**
     * Check if regular campaign creation interface (Traffic objective) is already present
     * @returns {boolean}
     */
    isRegularCreationInterfacePresent() {
      const helpers = global.AutomationHelpers;
      if (!helpers) return false;

      // Look for Traffic objective title span or text
      const trafficSpan = helpers.queryShadow('.index_title_Nvlf1') ||
                          helpers.findButtonByExactText('Traffic') ||
                          document.querySelector('.index_title_Nvlf1');

      if (trafficSpan && this.normalizedText(trafficSpan) === 'Traffic' && helpers.isVisible(trafficSpan)) {
        return true;
      }

      // Check text in document
      const headings = helpers.queryShadowAll('span, div, p');
      for (const h of headings) {
        if ((h.innerText || h.textContent || '').trim() === 'Traffic' && helpers.isVisible(h)) {
          return true;
        }
      }

      return false;
    }

    /**
     * Locate visible button with text "Switch to custom mode"
     * @returns {HTMLElement|null}
     */
    findSwitchToCustomModeButton() {
      const helpers = global.AutomationHelpers;
      if (!helpers) return null;

      const candidates = helpers.queryShadowAll('button, [role="button"], ks-button-923, a');
      for (const cand of candidates) {
        const text = (cand.innerText || cand.textContent || '').trim().toLowerCase();
        if (text.includes('switch to custom mode') && helpers.isVisible(cand)) {
          return helpers.getClickableTarget(cand);
        }
      }
      return null;
    }

    normalizedText(element) {
      return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    queryOpen(selector, root = document) {
      const h = global.AutomationHelpers;
      return [...new Set([
        ...h.queryShadowAll(selector, root),
        ...(root.shadowRoot ? h.queryShadowAll(selector, root.shadowRoot) : [])
      ])];
    }

    composedParent(element) {
      return element.assignedSlot || element.parentElement || element.getRootNode?.().host || null;
    }

    isWithin(element, root) {
      for (let current = element; current; current = this.composedParent(current)) {
        if (current === root) return true;
      }
      return false;
    }

    isEnabledAction(element) {
      const h = global.AutomationHelpers;
      if (!element || !h.isVisible(element)) return false;
      for (let current = element; current; current = this.composedParent(current)) {
        const disabled = current.getAttribute?.('disabled');
        const nativeButton = current.tagName?.toLowerCase() === 'button';
        if (current.disabled === true || (disabled !== null && disabled !== undefined &&
            (nativeButton || disabled !== 'false')) || current.getAttribute?.('aria-disabled') === 'true' ||
            current.getAttribute?.('loading') === 'true' || current.classList?.contains('is-disabled')) return false;
      }
      return true;
    }

    checkAbort() {
      if (global.AutomationHelpers.isAborted()) throw new Error('Automation aborted or paused by user');
    }

    async waitForMode(check, timeoutMs, message) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        this.checkAbort();
        const result = check();
        if (result) return result;
        await global.AutomationHelpers.sleep(250);
      }
      throw new Error(`[GUIDED MODE] ${message}`);
    }

    findGuidedModeHost() {
      const candidates = this.queryOpen('*').filter(host =>
        (host.tagName?.toLowerCase().startsWith('ks-button-') || host.hasAttribute?.('ks-button')) &&
        this.normalizedText(host) === 'Exit guided mode' && this.isEnabledAction(host) &&
        this.isEnabledAction(host.shadowRoot?.querySelector('button[part="self"]'))
      );
      if (candidates.length > 1) throw new Error('[GUIDED MODE] Multiple Exit guided mode buttons found; refusing ambiguous action.');
      return candidates[0] || null;
    }

    visibleDialogs() {
      return this.queryOpen('[role="dialog"], [aria-modal="true"], .byted-modal, .arco-modal, .modal, [ks-modal], [class*="modal-content"]')
        .filter(dialog => global.AutomationHelpers.isVisible(dialog));
    }

    findGuidedExitAction(dialog) {
      const actions = new Set();
      for (const slot of this.queryOpen('slot[name="cancel-btn"]', dialog)) {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const label = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        if (label !== 'Exit') continue;
        for (const source of assigned.length ? assigned : [slot]) {
          // Walk the slot's actual button/host structure, never click the slot itself.
          let current = source;
          while (current && current !== dialog && this.isWithin(current, dialog)) {
            let button = null;
            if (current.tagName?.toLowerCase() === 'button' || current.getAttribute?.('role') === 'button') {
              button = current;
            } else if (current.tagName?.toLowerCase().startsWith('ks-button-') || current.hasAttribute?.('ks-button')) {
              button = current.shadowRoot?.querySelector('button[part="self"], button[part="base"], button');
            }
            if (button) {
              if (this.isEnabledAction(button)) actions.add(button);
              break;
            }
            current = this.composedParent(current);
          }
          // Assigned wrappers can contain the actual labeled button.
          for (const button of this.queryOpen('button, [role="button"]', source)) {
            if (this.normalizedText(button) === 'Exit' && this.isWithin(button, dialog) && this.isEnabledAction(button)) actions.add(button);
          }
        }
      }
      if (actions.size > 1) throw new Error('[GUIDED MODE] Multiple popup Exit actions found; refusing ambiguous action.');
      return [...actions][0] || null;
    }

    // Also used by the popup observer to protect the transition before dialog text has rendered.
    ownsGuidedDialog(element) {
      const transition = this.guidedTransition;
      if (!transition) return false;
      if (transition.dialog && (this.isWithin(element, transition.dialog) || this.isWithin(transition.dialog, element))) return true;
      return this.queryOpen('slot[name="cancel-btn"]', element).some(slot =>
        this.normalizedText(slot) === 'Exit' || (slot.assignedElements?.({ flatten: true }) || []).some(el => this.normalizedText(el) === 'Exit')
      );
    }

    async exitGuidedMode(host, timeoutMs) {
      let transition = this.guidedTransition;
      if (!transition || transition.host !== host) {
        transition = { host, before: new Set(this.visibleDialogs()), dialog: null, exitClicked: false };
        this.guidedTransition = transition;
        this.checkAbort();
        console.log('[GUIDED MODE] Exit guided mode button detected');
        console.log('[GUIDED MODE] Clicking Exit guided mode');
        host.shadowRoot.querySelector('button[part="self"]').click();
      }
      if (!transition.exitClicked) {
        console.log('[GUIDED MODE] Waiting for confirmation popup');
        const match = await this.waitForMode(() => {
          const matches = this.visibleDialogs().filter(dialog => !transition.before.has(dialog))
            .map(dialog => ({ dialog, button: this.findGuidedExitAction(dialog) })).filter(item => item.button);
          // Nested modal wrappers can refer to the same action; different actions are ambiguous.
          if (new Set(matches.map(item => item.button)).size > 1) {
            throw new Error('[GUIDED MODE] Multiple new exit dialogs found; refusing ambiguous action.');
          }
          return matches[0];
        }, timeoutMs, 'Exit confirmation popup or enabled Exit action did not become ready.');
        transition.dialog = match.dialog;
        console.log('[GUIDED MODE] Confirmation popup detected');
        this.checkAbort();
        transition.exitClicked = true;
        console.log('[GUIDED MODE] Clicking popup Exit');
        match.button.click();
      }
      await this.waitForMode(() => !global.AutomationHelpers.isVisible(transition.dialog), timeoutMs,
        'Exit confirmation popup did not close.');
      await this.waitForMode(() => this.isRegularCreationInterfacePresent(), timeoutMs,
        'Normal campaign form did not become ready after exiting Guided Mode.');
      console.log('[GUIDED MODE] Guided Mode exited');
      console.log('[GUIDED MODE] Normal campaign form ready');
      this.guidedTransition = null;
      return true;
    }

    /**
     * Handle the full custom mode transition flow
     * @param {number} [timeoutMs=8000]
     * @returns {Promise<boolean>}
     */
    async ensureCustomMode(timeoutMs = 8000) {
      if (this.modeTransitionPromise) return this.modeTransitionPromise;
      this.modeTransitionPromise = this.ensureCustomModeTransition(timeoutMs);
      try {
        return await this.modeTransitionPromise;
      } finally {
        this.modeTransitionPromise = null;
      }
    }

    async ensureCustomModeTransition(timeoutMs) {
      const helpers = global.AutomationHelpers;
      this.log('Evaluating custom mode state...');

      console.log('[GUIDED MODE] Checking page');
      // A transition already clicked must finish without dispatching either action again.
      if (this.guidedTransition) return this.exitGuidedMode(this.guidedTransition.host, timeoutMs);
      const ready = await this.waitForMode(() => {
        const guidedHost = this.findGuidedModeHost();
        if (guidedHost) return { guidedHost };
        if (this.isRegularCreationInterfacePresent()) return { normal: true };
        const switchBtn = this.findSwitchToCustomModeButton();
        return switchBtn ? { switchBtn } : null;
      }, timeoutMs, 'Neither Guided Mode nor the normal campaign form became ready.');
      if (ready.guidedHost) return this.exitGuidedMode(ready.guidedHost, timeoutMs);
      if (ready.normal) {
        console.log('[GUIDED MODE] Guided Mode not present');
        console.log('[GUIDED MODE] Normal campaign form detected');
        return true;
      }
      const switchBtn = ready.switchBtn;

      // Case A: Found "Switch to custom mode" button
      this.log('Clicking "Switch to custom mode" button...');
      helpers.safeClick(switchBtn, 'Switch to custom mode button');

      // Wait for confirmation dialog containing "Stay" and "Exit"
      this.log('Waiting for confirmation modal (Stay / Exit)...');
      const dialog = await this.waitForCustomModeConfirmationDialog(6000);

      if (dialog) {
        this.log('Confirmation dialog detected. Locating "Exit" button...');
        const exitBtn = this.findExitButtonInDialog(dialog);
        if (exitBtn) {
          this.log('Clicking "Exit" button in confirmation dialog...');
          helpers.safeClick(exitBtn, 'Exit confirmation button');
        } else {
          this.warn('Could not locate specific "Exit" button inside dialog. Searching globally in modal...');
          const globalExit = helpers.findButtonByExactText('Exit', dialog);
          if (globalExit) {
            helpers.safeClick(globalExit, 'Exit button fallback');
          }
        }
      } else {
        this.log('No Stay/Exit modal appeared; transitioned directly.');
      }

      // Wait for regular creation interface to become ready
      this.log('Waiting for regular creation interface after mode switch...');
      const readyStart = Date.now();
      while (Date.now() - readyStart < 8000) {
        if (this.isRegularCreationInterfacePresent()) {
          this.log('Regular campaign creation interface successfully loaded.');
          return true;
        }
        await helpers.sleep(400);
      }

      throw new Error('Normal campaign form did not become ready after custom mode transition.');
    }

    /**
     * Wait for dialog element that contains "Stay" and "Exit"
     * @param {number} [timeoutMs=6000]
     * @returns {Promise<HTMLElement|null>}
     */
    async waitForCustomModeConfirmationDialog(timeoutMs = 6000) {
      const helpers = global.AutomationHelpers;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const dialogs = helpers.queryShadowAll('[role="dialog"], .byted-modal, .arco-modal, [class*="modal"]');
        for (const dlg of dialogs) {
          if (!helpers.isVisible(dlg)) continue;
          const text = (dlg.innerText || dlg.textContent || '').toLowerCase();
          if (text.includes('stay') && text.includes('exit')) {
            return dlg;
          }
        }
        await helpers.sleep(300);
      }

      return null;
    }

    /**
     * Find Exit button specifically inside dialog
     * @param {HTMLElement} dialog
     * @returns {HTMLElement|null}
     */
    findExitButtonInDialog(dialog) {
      const helpers = global.AutomationHelpers;
      const candidates = helpers.queryShadowAll('button, [role="button"], ks-button-923', dialog);

      for (const cand of candidates) {
        const text = (cand.innerText || cand.textContent || '').trim();
        if (text === 'Exit' && helpers.isVisible(cand)) {
          return helpers.getClickableTarget(cand);
        }
      }

      return null;
    }

    log(message) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.info(this.name, message);
      } else {
        console.log(`[TikTokAdsBot:${this.name}] ${message}`);
      }
    }

    warn(message) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.warn(this.name, message);
      } else {
        console.warn(`[TikTokAdsBot:${this.name}] ⚠️ ${message}`);
      }
    }
  }

  const customModeHandlerInstance = new CustomModeHandler();

  global.CustomModeHandler = customModeHandlerInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CustomModeHandler: customModeHandlerInstance };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
