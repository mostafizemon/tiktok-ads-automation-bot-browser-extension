/**
 * automation/custom-mode.js
 * Optional onboarding handler for Guided Mode, Full Version, and legacy Custom Mode.
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

      // Traffic may include a Rebate offer badge; objective metadata remains exact.
      for (const wrapper of helpers.queryShadowAll('[data-tea-objective-content="Traffic"]')) {
        const radio = helpers.queryShadow('label[role="radio"]', wrapper);
        if (wrapper.getAttribute('data-tea-objective-value') === '1' && radio && helpers.isVisible(radio)) return true;
      }

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

      const candidates = this.queryOpen('*').filter(node => node.matches('button, [role="button"], a') ||
        node.tagName?.toLowerCase().startsWith('ks-button-'));
      for (const cand of candidates) {
        const target = helpers.getClickableTarget(cand);
        if (this.normalizedText(cand) === 'Switch to custom mode' &&
            this.isEnabledAction(cand) && this.isEnabledAction(target)) {
          return target;
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
        if (current.tagName && !current.tagName.startsWith('#')) {
          const style = window.getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' ||
              current.hasAttribute?.('hidden')) return false;
        }
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

    findGuidedModeHost(text = 'Exit guided mode') {
      const candidates = this.queryOpen('*').filter(host =>
        (host.tagName?.toLowerCase().startsWith('ks-button-') || host.hasAttribute?.('ks-button')) &&
        this.normalizedText(host) === text && this.isEnabledAction(host) &&
        this.isEnabledAction(host.shadowRoot?.querySelector('button[part="self"]'))
      );
      if (candidates.length > 1) throw new Error(`[ONBOARDING] Multiple ${text} buttons found; refusing ambiguous action.`);
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
      const fullVersion = this.guidedTransition?.fullVersion ?? (this.normalizedText(host) === 'Switch to full version');
      let transition = this.guidedTransition;
      if (!transition || transition.host !== host) {
        const button = host.shadowRoot?.querySelector('button[part="self"]');
        this.checkAbort();
        if (!this.isEnabledAction(host) || !this.isEnabledAction(button)) {
          throw new Error('[ONBOARDING] Mode-switch button became unavailable before clicking.');
        }
        transition = { host, fullVersion, before: new Set(this.visibleDialogs()), dialog: null, exitClicked: false };
        this.guidedTransition = transition;
        this.checkAbort();
        console.log(fullVersion ? '[ONBOARDING] Switch to full version detected' : '[GUIDED MODE] Exit guided mode button detected');
        console.log(fullVersion ? '[ONBOARDING] Clicking Switch to full version' : '[GUIDED MODE] Clicking Exit guided mode');
        button.click();
      }
      if (!transition.exitClicked) {
        console.log(fullVersion ? '[ONBOARDING] Waiting for confirmation or standard campaign form' : '[GUIDED MODE] Waiting for confirmation popup');
        const match = await this.waitForMode(() => {
          const matches = this.visibleDialogs().filter(dialog => !transition.before.has(dialog))
            .map(dialog => {
              let button = this.findGuidedExitAction(dialog);
              const text = this.normalizedText(dialog).toLowerCase();
              if (!button && fullVersion && text.includes('stay') && text.includes('exit')) {
                button = this.findExitButtonInDialog(dialog);
                if (!this.isEnabledAction(button)) button = null;
              }
              return { dialog, button };
            }).filter(item => item.button);
          // Nested modal wrappers can refer to the same action; different actions are ambiguous.
          if (new Set(matches.map(item => item.button)).size > 1) {
            throw new Error('[GUIDED MODE] Multiple new exit dialogs found; refusing ambiguous action.');
          }
          if (!matches.length && fullVersion && this.isRegularCreationInterfacePresent() &&
              !this.visibleDialogs().some(dialog => !transition.before.has(dialog))) return { normal: true };
          return matches[0];
        }, timeoutMs, fullVersion
          ? 'Switch to full version did not produce a standard form or an enabled confirmation Exit action.'
          : 'Exit confirmation popup or enabled Exit action did not become ready.');
        if (match.normal) {
          console.log('[ONBOARDING] Full version opened directly');
          console.log('[ONBOARDING] Standard campaign form ready');
          console.log('[ONBOARDING] Continuing to Traffic objective');
          this.guidedTransition = null;
          return true;
        }
        transition.dialog = match.dialog;
        console.log(fullVersion ? '[ONBOARDING] Confirmation dialog detected' : '[GUIDED MODE] Confirmation popup detected');
        this.checkAbort();
        transition.exitClicked = true;
        console.log(fullVersion ? '[ONBOARDING] Clicking Exit' : '[GUIDED MODE] Clicking popup Exit');
        match.button.click();
      }
      await this.waitForMode(() => !global.AutomationHelpers.isVisible(transition.dialog), timeoutMs,
        'Exit confirmation popup did not close.');
      await this.waitForMode(() => this.isRegularCreationInterfacePresent(), timeoutMs,
        'Normal campaign form did not become ready after exiting Guided Mode.');
      console.log('[GUIDED MODE] Guided Mode exited');
      console.log('[GUIDED MODE] Normal campaign form ready');
      if (fullVersion) {
        console.log('[ONBOARDING] Standard campaign form ready');
        console.log('[ONBOARDING] Continuing to Traffic objective');
      }
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
      console.log('[ONBOARDING] Checking initial campaign UI');
      // A transition already clicked must finish without dispatching either action again.
      if (this.guidedTransition) return this.exitGuidedMode(this.guidedTransition.host, timeoutMs);
      const ready = await this.waitForMode(() => {
        if (this.isRegularCreationInterfacePresent()) return { normal: true };
        const fullHost = this.findGuidedModeHost('Switch to full version');
        const guidedHost = this.findGuidedModeHost();
        const switchBtn = this.findSwitchToCustomModeButton();
        if ([fullHost, guidedHost, switchBtn].filter(Boolean).length > 1) {
          throw new Error('[ONBOARDING] Multiple active mode-switch actions found; refusing ambiguous action.');
        }
        if (fullHost || guidedHost) return { guidedHost: fullHost || guidedHost };
        return switchBtn ? { switchBtn } : null;
      }, timeoutMs, 'Neither Guided Mode nor the normal campaign form became ready.');
      if (ready.guidedHost) return this.exitGuidedMode(ready.guidedHost, timeoutMs);
      if (ready.normal) {
        console.log('[GUIDED MODE] Guided Mode not present');
        console.log('[GUIDED MODE] Normal campaign form detected');
        console.log('[ONBOARDING] No mode switch required');
        console.log('[ONBOARDING] Traffic objective ready');
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
