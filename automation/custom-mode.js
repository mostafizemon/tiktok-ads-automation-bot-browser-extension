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

      // 1. Guard against active mode-switch actions or confirmation modals
      if (this.findCustomModeConfirmModal()) return false;
      if (this.findFullVersionConfirmModal()) return false;
      if (this.findLegacyStayExitDialog()) return false;
      if (this.findGuidedModeHost('Switch to full version')) return false;
      if (this.findGuidedModeHost('Exit guided mode')) return false;
      if (this.findSwitchToCustomModeButton()) return false;

      // 2. Traffic with Rebate metadata
      for (const wrapper of helpers.queryShadowAll('[data-tea-objective-content="Traffic"]')) {
        const radio = helpers.queryShadow('label[role="radio"], [role="radio"]', wrapper);
        if (wrapper.getAttribute('data-tea-objective-value') === '1' && radio && helpers.isVisible(radio)) return true;
      }

      // 3. Standard radio label control containing Traffic
      const radioLabels = helpers.queryShadowAll('label[role="radio"], [role="radio"]');
      for (const label of radioLabels) {
        if (!helpers.isVisible(label)) continue;
        const titleSpan = label.querySelector?.('.index_title_Nvlf1, .index_objectiveTitle_hK5BW, .vi-radio__label');
        let text = titleSpan ? (titleSpan.innerText || titleSpan.textContent || '').trim() : '';
        if (!text) {
          const spans = label.querySelectorAll?.('span, div') || [];
          for (const s of spans) {
            if ((s.innerText || s.textContent || '').trim() === 'Traffic') {
              text = 'Traffic';
              break;
            }
          }
        }
        if (text === 'Traffic') return true;
      }

      // 4. Standard Traffic objective title span
      const trafficSpans = [
        ...helpers.queryShadowAll('.index_title_Nvlf1'),
        ...(document.querySelectorAll ? Array.from(document.querySelectorAll('.index_title_Nvlf1')) : [])
      ];
      for (const span of trafficSpans) {
        if (this.normalizedText(span) === 'Traffic' && helpers.isVisible(span)) {
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
        const loading = current.getAttribute?.('loading');
        if (current.disabled === true || (disabled !== null && disabled !== undefined &&
            (nativeButton || disabled !== 'false')) || current.getAttribute?.('aria-disabled') === 'true' ||
            (loading !== null && loading !== undefined && loading !== 'false') ||
            current.classList?.contains('is-disabled')) return false;
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
      if (message.startsWith('[ONBOARDING ERROR]') || message.startsWith('[ONBOARDING]')) {
        console.error(message);
        throw new Error(message);
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
      return this.queryOpen('[role="dialog"], [aria-modal="true"], [part="wrapper"], .byted-modal, .arco-modal, [class*="modal"], [ks-modal], [class*="modal-content"]')
        .filter(dialog => global.AutomationHelpers.isVisible(dialog));
    }

    isModalHeaderMatching(dialog, expectedText = 'Switch to full version?') {
      if (!dialog) return false;
      const headers = [
        ...this.queryOpen('slot[name="header"]', dialog),
        ...this.queryOpen('.modal__header-title, [class*="header-title"]', dialog),
        ...this.queryOpen('[part="header"]', dialog),
        ...this.queryOpen('.modal__header, [class*="modal__header"]', dialog),
        ...this.queryOpen('[role="heading"], h1, h2, h3, h4', dialog)
      ];
      for (const h of headers) {
        const assigned = h.assignedElements?.({ flatten: true }) || [];
        const text = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(h);
        if (text === expectedText) return true;
      }
      for (const el of this.queryOpen('*', dialog)) {
        if (this.normalizedText(el) === expectedText) {
          const inFooter = el.closest?.('[part="footer"], .modal__footer, [class*="footer"]') ||
                           this.composedParent(el)?.closest?.('[part="footer"], .modal__footer, [class*="footer"]');
          if (!inFooter) return true;
        }
      }
      return false;
    }

    findLegacyStayExitDialog() {
      const candidates = this.visibleDialogs();
      for (const cand of candidates) {
        const text = (cand.innerText || cand.textContent || '').toLowerCase();
        if (text.includes('stay') && text.includes('exit')) {
          return cand;
        }
      }
      return null;
    }

    findCustomModeConfirmModal() {
      const candidates = this.visibleDialogs();
      for (const cand of candidates) {
        if (this.isModalHeaderMatching(cand, 'Exit guided mode and switch to custom mode?')) {
          return cand;
        }
      }
      const headerSlots = this.queryOpen('slot[name="header"]');
      for (const slot of headerSlots) {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const text = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        if (text === 'Exit guided mode and switch to custom mode?' && global.AutomationHelpers?.isVisible(slot)) {
          let current = slot;
          while (current && current !== document.body) {
            if (current.matches?.('[part="wrapper"], [role="dialog"], [aria-modal="true"], [class*="modal"]') ||
                current.tagName?.toLowerCase().startsWith('ks-modal-')) {
              if (global.AutomationHelpers?.isVisible(current)) return current;
            }
            current = this.composedParent(current);
          }
        }
      }
      return null;
    }

    resolveCustomModeExit(modal) {
      if (!modal || !global.AutomationHelpers?.isVisible(modal)) {
        return { action: null, exitSlotFound: false, hostFound: false, innerFound: false };
      }

      const footers = this.queryOpen('[part="footer"], .modal__footer, [class*="modal__footer"]', modal);
      const footer = footers[0] || modal;

      const cancelSlots = this.queryOpen('slot[name="cancel-btn"]', footer);
      if (!cancelSlots.length) {
        cancelSlots.push(...this.queryOpen('slot[name="cancel-btn"]', modal));
      }

      const exitSlots = cancelSlots.filter(slot => {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const label = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        return label === 'Exit';
      });

      const exitSlotFound = exitSlots.length > 0;
      let hostFound = false;
      let innerFound = false;
      const actions = new Set();

      for (const slot of exitSlots) {
        let host = null;
        let current = slot;
        while (current && current !== modal) {
          if (current.tagName?.toLowerCase().startsWith('ks-button-') || current.hasAttribute?.('ks-button')) {
            host = current;
            break;
          }
          current = this.composedParent(current);
        }

        if (!host) {
          const assigned = slot.assignedElements?.({ flatten: true }) || [];
          for (const el of assigned) {
            let cur = el;
            while (cur && cur !== modal) {
              if (cur.tagName?.toLowerCase().startsWith('ks-button-') || cur.hasAttribute?.('ks-button')) {
                host = cur;
                break;
              }
              cur = this.composedParent(cur);
            }
            if (host) break;
          }
        }

        if (host) {
          hostFound = true;
          const button = host.shadowRoot?.querySelector('button[part="self"], button[part="base"], button');
          if (button) {
            innerFound = true;
            if (this.isEnabledAction(host) && this.isEnabledAction(button)) {
              actions.add(button);
            }
          }
        }
      }

      // Fallback 1: Look for ks-button host with text 'Exit' inside footer
      if (!actions.size) {
        const buttonHosts = this.queryOpen('*', footer).filter(el =>
          (el.tagName?.toLowerCase().startsWith('ks-button-') || el.hasAttribute?.('ks-button')) &&
          this.normalizedText(el) === 'Exit'
        );
        for (const host of buttonHosts) {
          hostFound = true;
          const button = host.shadowRoot?.querySelector('button[part="self"], button[part="base"], button');
          if (button) {
            innerFound = true;
            if (this.isEnabledAction(host) && this.isEnabledAction(button)) {
              actions.add(button);
            }
          }
        }
      }

      // Fallback 2: Standard button elements with text 'Exit' inside footer (e.g. legacy mocks)
      if (!actions.size) {
        const standardButtons = this.queryOpen('button, [role="button"]', footer).filter(el =>
          this.normalizedText(el) === 'Exit'
        );
        for (const btn of standardButtons) {
          hostFound = true;
          innerFound = true;
          if (this.isEnabledAction(btn)) {
            actions.add(btn);
          }
        }
      }

      if (actions.size > 1) {
        throw new Error('[ONBOARDING] Multiple Exit actions found in modal; refusing ambiguous action.');
      }

      return {
        action: [...actions][0] || null,
        exitSlotFound,
        hostFound,
        innerFound
      };
    }

    findCustomModeExitAction(modal) {
      return this.resolveCustomModeExit(modal).action;
    }

    logCustomModeExitDiagnostics(modal) {
      const details = this.resolveCustomModeExit(modal);
      console.log(`[ONBOARDING] Exit slot found: ${details.exitSlotFound}`);
      console.log(`[ONBOARDING] Exit button host found: ${details.hostFound}`);
      console.log(`[ONBOARDING] Exit inner button found: ${details.innerFound}`);
      return details;
    }

    findFullVersionConfirmModal() {
      const candidates = this.visibleDialogs();
      for (const cand of candidates) {
        if (this.isModalHeaderMatching(cand, 'Switch to full version?')) {
          return cand;
        }
      }
      const headerSlots = this.queryOpen('slot[name="header"]');
      for (const slot of headerSlots) {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const text = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        if (text === 'Switch to full version?' && global.AutomationHelpers.isVisible(slot)) {
          let current = slot;
          while (current && current !== document.body) {
            if (current.matches?.('[part="wrapper"], [role="dialog"], [aria-modal="true"], [class*="modal"]') ||
                current.tagName?.toLowerCase().startsWith('ks-modal-')) {
              if (global.AutomationHelpers.isVisible(current)) return current;
            }
            current = this.composedParent(current);
          }
        }
      }
      return null;
    }

    findFullVersionConfirmAction(modal) {
      if (!modal || !global.AutomationHelpers.isVisible(modal)) return null;

      if (!this.isModalHeaderMatching(modal, 'Switch to full version?')) {
        return null;
      }

      const footers = this.queryOpen('[part="footer"], .modal__footer, [class*="modal__footer"]', modal);
      const footer = footers[0] || modal;

      const confirmSlots = this.queryOpen('slot[name="confirm-btn"]', footer);
      if (!confirmSlots.length) {
        confirmSlots.push(...this.queryOpen('slot[name="confirm-btn"]', modal));
      }

      const actions = new Set();

      for (const slot of confirmSlots) {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const label = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        if (label !== 'Confirm') continue;

        let host = null;
        let current = slot;
        while (current && current !== modal) {
          if (current.tagName?.toLowerCase().startsWith('ks-button-') || current.hasAttribute?.('ks-button')) {
            host = current;
            break;
          }
          current = this.composedParent(current);
        }

        if (!host && assigned.length) {
          for (const el of assigned) {
            if (el.tagName?.toLowerCase().startsWith('ks-button-') || el.hasAttribute?.('ks-button')) {
              host = el;
              break;
            }
          }
        }

        if (host && this.isEnabledAction(host)) {
          const button = host.shadowRoot?.querySelector('button[part="self"], button[part="base"], button');
          if (button && this.isEnabledAction(button) && !this.isCancelOrCloseButton(button, host)) {
            actions.add(button);
          }
        }
      }

      if (!actions.size) {
        const buttonHosts = this.queryOpen('*', footer).filter(el =>
          (el.tagName?.toLowerCase().startsWith('ks-button-') || el.hasAttribute?.('ks-button')) &&
          this.normalizedText(el) === 'Confirm' &&
          this.isEnabledAction(el)
        );
        for (const host of buttonHosts) {
          const button = host.shadowRoot?.querySelector('button[part="self"], button[part="base"], button');
          if (button && this.isEnabledAction(button) && !this.isCancelOrCloseButton(button, host)) {
            actions.add(button);
          }
        }
      }

      if (actions.size > 1) {
        throw new Error('[ONBOARDING] Multiple Confirm actions found in modal; refusing ambiguous action.');
      }

      return [...actions][0] || null;
    }

    isCancelOrCloseButton(button, host) {
      const owningHost = host?.host || host;
      if (this.normalizedText(button) === 'Cancel' || this.normalizedText(owningHost) === 'Cancel') return true;
      const cancelSlot = button?.closest?.('slot[name="cancel-btn"]') ||
                         owningHost?.closest?.('slot[name="cancel-btn"]') ||
                         owningHost?.querySelector?.('slot[name="cancel-btn"]');
      if (cancelSlot && this.normalizedText(cancelSlot) === 'Cancel') return true;
      if (button?.getAttribute?.('part') === 'closeIcon' || owningHost?.getAttribute?.('part') === 'closeIcon') return true;
      if (button?.classList?.contains('modal__close') || owningHost?.classList?.contains('modal__close')) return true;
      return false;
    }

    findGuidedExitAction(dialog) {
      const actions = new Set();
      for (const slot of this.queryOpen('slot[name="cancel-btn"]', dialog)) {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const label = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        if (label !== 'Exit') continue;
        for (const source of assigned.length ? assigned : [slot]) {
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
          for (const button of this.queryOpen('button, [role="button"]', source)) {
            if (this.normalizedText(button) === 'Exit' && this.isWithin(button, dialog) && this.isEnabledAction(button)) actions.add(button);
          }
        }
      }
      if (actions.size > 1) throw new Error('[GUIDED MODE] Multiple popup Exit actions found; refusing ambiguous action.');
      return [...actions][0] || null;
    }

    ownsGuidedDialog(element) {
      if (!element) return false;
      if (this.isModalHeaderMatching(element, 'Exit guided mode and switch to custom mode?')) return true;
      if (this.isModalHeaderMatching(element, 'Switch to full version?')) return true;
      if (this.queryOpen('slot[name="confirm-btn"]', element).some(slot => {
        const assigned = slot.assignedElements?.({ flatten: true }) || [];
        const label = assigned.length ? assigned.map(el => this.normalizedText(el)).join(' ').trim() : this.normalizedText(slot);
        return label === 'Confirm';
      })) return true;
      const transition = this.guidedTransition;
      if (transition) {
        if (transition.dialog && (this.isWithin(element, transition.dialog) || this.isWithin(transition.dialog, element))) return true;
      }
      return this.queryOpen('slot[name="cancel-btn"]', element).some(slot =>
        this.normalizedText(slot) === 'Exit' || (slot.assignedElements?.({ flatten: true }) || []).some(el => this.normalizedText(el) === 'Exit')
      );
    }

    async handleSwitchToFullVersion(host, timeoutMs) {
      this.checkAbort();

      let transition = this.guidedTransition;
      if (!transition || !transition.fullVersion) {
        transition = {
          fullVersion: true,
          host: host || null,
          clickedSwitch: host ? false : true,
          confirmClicked: false,
          dialog: null
        };
        this.guidedTransition = transition;
      }

      if (!transition.clickedSwitch) {
        const activeHost = this.findGuidedModeHost('Switch to full version') || host;
        const button = activeHost?.shadowRoot?.querySelector('button[part="self"]');

        this.checkAbort();
        if (!activeHost || !button || !this.isEnabledAction(activeHost) || !this.isEnabledAction(button)) {
          console.error('[ONBOARDING ERROR] Switch button not clickable');
          throw new Error('[ONBOARDING ERROR] Switch button not clickable');
        }

        console.log('[ONBOARDING] Switch to full version detected');
        console.log('[ONBOARDING] Clicking switch button');
        console.log('[ONBOARDING] Clicking Switch to full version');
        transition.clickedSwitch = true;
        transition.host = activeHost;
        button.click();
      }

      if (!transition.confirmClicked) {
        console.log('[ONBOARDING] Waiting for confirmation modal');

        const stateMatch = await this.waitForMode(() => {
          const modal = this.findFullVersionConfirmModal();
          if (modal) {
            const confirmBtn = this.findFullVersionConfirmAction(modal);
            return { modal, confirmBtn };
          }
          if (this.isRegularCreationInterfacePresent()) {
            return { direct: true };
          }
          return null;
        }, timeoutMs, '[ONBOARDING ERROR] Confirmation modal not found');

        if (stateMatch.direct) {
          console.log('[ONBOARDING] Full version opened directly');
          console.log('[ONBOARDING] Standard form ready');
          console.log('[ONBOARDING] Standard campaign form ready');
          console.log('[ONBOARDING] Continuing to Traffic objective');
          this.guidedTransition = null;
          return true;
        }

        const modal = stateMatch.modal;
        transition.dialog = modal;
        console.log('[ONBOARDING] Confirm modal detected');
        console.log('[ONBOARDING] Switch to full version modal detected');

        let confirmBtn = stateMatch.confirmBtn;
        if (!confirmBtn) {
          confirmBtn = await this.waitForMode(() => {
            const currentModal = this.findFullVersionConfirmModal() || modal;
            return this.findFullVersionConfirmAction(currentModal);
          }, Math.min(timeoutMs, 4000), '[ONBOARDING ERROR] Confirm button not found');
        }

        console.log('[ONBOARDING] Confirm button detected');
        this.checkAbort();

        console.log('[ONBOARDING] Clicking Confirm');
        transition.confirmClicked = true;

        try {
          confirmBtn.click();
        } catch (err) {
          console.error('[ONBOARDING ERROR] Confirmation click failed', err);
          throw new Error('[ONBOARDING ERROR] Confirmation click failed');
        }
      }

      await this.waitForMode(() => {
        const activeModal = this.findFullVersionConfirmModal();
        if (activeModal && global.AutomationHelpers.isVisible(activeModal)) return false;
        if (transition.dialog && global.AutomationHelpers.isVisible(transition.dialog)) return false;
        return true;
      }, timeoutMs, '[ONBOARDING ERROR] Confirmation modal did not close');

      console.log('[ONBOARDING] Modal closed');
      console.log('[ONBOARDING] Confirmation modal closed');

      await this.waitForMode(() => this.isRegularCreationInterfacePresent(), timeoutMs,
        '[ONBOARDING ERROR] Standard campaign form not ready');

      console.log('[ONBOARDING] Standard form ready');
      console.log('[ONBOARDING] Standard campaign form ready');
      console.log('[ONBOARDING] Continuing to Traffic objective');
      this.guidedTransition = null;
      return true;
    }

    async handleSwitchToCustomMode(switchBtn, timeoutMs = 8000) {
      this.checkAbort();

      let transition = this.guidedTransition;
      if (!transition || !transition.customMode) {
        transition = {
          customMode: true,
          switchBtn: switchBtn || null,
          clickedSwitch: switchBtn ? false : true,
          exitClicked: false,
          dialog: null
        };
        this.guidedTransition = transition;
      }

      if (!transition.clickedSwitch) {
        const activeBtn = this.findSwitchToCustomModeButton() || switchBtn;
        this.checkAbort();
        if (!activeBtn || !this.isEnabledAction(activeBtn)) {
          console.error('[ONBOARDING ERROR] Switch button not clickable');
          throw new Error('[ONBOARDING ERROR] Switch button not clickable');
        }

        console.log('[ONBOARDING] Switch to custom mode detected');
        console.log('[ONBOARDING] Clicking switch button');
        console.log('[ONBOARDING] Clicking Switch to custom mode');
        transition.clickedSwitch = true;
        transition.switchBtn = activeBtn;
        global.AutomationHelpers.safeClick(activeBtn, 'Switch to custom mode button');
        console.log('[ONBOARDING] Switch to custom mode clicked');
      }

      if (!transition.exitClicked) {
        console.log('[ONBOARDING] Waiting for custom-mode modal');

        const stateMatch = await this.waitForMode(() => {
          const modal = this.findCustomModeConfirmModal() || this.findLegacyStayExitDialog();
          if (modal) {
            const exitBtn = this.findCustomModeExitAction(modal) || this.findExitButtonInDialog(modal);
            return { modal, exitBtn };
          }
          if (this.isRegularCreationInterfacePresent()) {
            return { direct: true };
          }
          return null;
        }, timeoutMs, '[ONBOARDING ERROR] Custom-mode modal not detected');

        if (stateMatch.direct) {
          console.log('[ONBOARDING] Custom mode opened directly');
          console.log('[ONBOARDING] Standard form ready');
          console.log('[ONBOARDING] Standard creation form ready');
          console.log('[ONBOARDING] Continuing to Traffic objective');
          this.guidedTransition = null;
          return true;
        }

        const modal = stateMatch.modal;
        transition.dialog = modal;
        console.log('[ONBOARDING] Modal title detected: Exit guided mode and switch to custom mode?');

        let exitBtn = stateMatch.exitBtn;
        if (!exitBtn) {
          exitBtn = await this.waitForMode(() => {
            const currentModal = this.findCustomModeConfirmModal() || this.findLegacyStayExitDialog() || modal;
            return this.findCustomModeExitAction(currentModal) || this.findExitButtonInDialog(currentModal);
          }, Math.min(timeoutMs, 4000), '[ONBOARDING ERROR] Exit inner button not found');
        }

        this.logCustomModeExitDiagnostics(modal);

        if (!exitBtn) {
          throw new Error('[ONBOARDING ERROR] Exit inner button not found');
        }

        if (!this.isEnabledAction(exitBtn)) {
          throw new Error('[ONBOARDING ERROR] Exit button disabled');
        }

        this.checkAbort();

        console.log('[ONBOARDING] Clicking Exit');
        transition.exitClicked = true;

        try {
          exitBtn.click();
          console.log('[ONBOARDING] Exit clicked');
        } catch (err) {
          console.error('[ONBOARDING ERROR] Exit click unsuccessful', err);
          throw new Error('[ONBOARDING ERROR] Exit click unsuccessful');
        }
      }

      await this.waitForMode(() => {
        const activeModal = this.findCustomModeConfirmModal() || this.findLegacyStayExitDialog();
        if (activeModal && global.AutomationHelpers.isVisible(activeModal)) return false;
        if (transition.dialog && global.AutomationHelpers.isVisible(transition.dialog)) return false;
        return true;
      }, timeoutMs, '[ONBOARDING ERROR] Modal remained open');

      console.log('[ONBOARDING] Modal closed');

      await this.waitForMode(() => this.isRegularCreationInterfacePresent(), timeoutMs,
        '[ONBOARDING ERROR] Standard form did not become ready');

      console.log('[ONBOARDING] Standard creation form ready');
      console.log('[ONBOARDING] Continuing to Traffic objective');
      this.guidedTransition = null;
      return true;
    }

    async exitGuidedMode(host, timeoutMs) {
      if (this.normalizedText(host) === 'Switch to full version' || this.guidedTransition?.fullVersion) {
        return this.handleSwitchToFullVersion(host, timeoutMs);
      }
      if (this.normalizedText(host) === 'Switch to custom mode' || this.guidedTransition?.customMode) {
        return this.handleSwitchToCustomMode(host, timeoutMs);
      }
      let transition = this.guidedTransition;
      if (!transition || transition.host !== host) {
        const button = host.shadowRoot?.querySelector('button[part="self"]');
        this.checkAbort();
        if (!this.isEnabledAction(host) || !this.isEnabledAction(button)) {
          throw new Error('[ONBOARDING] Mode-switch button became unavailable before clicking.');
        }
        transition = { host, fullVersion: false, before: new Set(this.visibleDialogs()), dialog: null, exitClicked: false };
        this.guidedTransition = transition;
        this.checkAbort();
        console.log('[GUIDED MODE] Exit guided mode button detected');
        console.log('[GUIDED MODE] Clicking Exit guided mode');
        button.click();
      }
      if (!transition.exitClicked) {
        console.log('[GUIDED MODE] Waiting for confirmation popup');
        const match = await this.waitForMode(() => {
          const matches = this.visibleDialogs().filter(dialog => !transition.before.has(dialog))
            .map(dialog => ({ dialog, button: this.findGuidedExitAction(dialog) }))
            .filter(item => item.button);
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

      const route = (typeof window !== 'undefined' && window.location?.pathname)
        ? window.location.pathname
        : ((typeof window !== 'undefined' && window.location?.href)
          ? new URL(window.location.href, 'https://ads.tiktok.com').pathname
          : '/i18n/manage/campaign');

      console.log(`[ONBOARDING] Route: ${route}`);
      console.log('[ONBOARDING] Handler invoked before Traffic: true');

      const fullHostInitial = this.findGuidedModeHost('Switch to full version');
      const isFullVersionVisible = !!(fullHostInitial && this.isEnabledAction(fullHostInitial));
      console.log(`[ONBOARDING] Full version button visible: ${isFullVersionVisible}`);

      const standardFormReadyBefore = this.isRegularCreationInterfacePresent();
      console.log(`[ONBOARDING] Standard form ready before switch: ${standardFormReadyBefore}`);

      console.log('[GUIDED MODE] Checking page');
      console.log('[ONBOARDING] Checking campaign creation UI');

      // Priority 1: Check for an active workflow-critical modal or pending transition
      if (this.guidedTransition) {
        if (this.guidedTransition.fullVersion) {
          return this.handleSwitchToFullVersion(this.guidedTransition.host, timeoutMs);
        }
        if (this.guidedTransition.customMode) {
          return this.handleSwitchToCustomMode(this.guidedTransition.switchBtn, timeoutMs);
        }
        return this.exitGuidedMode(this.guidedTransition.host, timeoutMs);
      }

      const activeConfirmModal = this.findFullVersionConfirmModal();
      if (activeConfirmModal) {
        console.log('[ONBOARDING] Confirm modal detected');
        console.log('[ONBOARDING] Switch to full version modal detected');
        return this.handleSwitchToFullVersion(null, timeoutMs);
      }

      const activeCustomModal = this.findCustomModeConfirmModal() || this.findLegacyStayExitDialog();
      if (activeCustomModal) {
        return this.handleSwitchToCustomMode(null, timeoutMs);
      }

      const ready = await this.waitForMode(() => {
        // Priority 1: Check for active workflow-critical modal
        const confirmModal = this.findFullVersionConfirmModal();
        if (confirmModal) return { confirmModal };
        const customModal = this.findCustomModeConfirmModal() || this.findLegacyStayExitDialog();
        if (customModal) return { customModal };

        // Priority 2: Check for active supported mode-switch action
        const fullHost = this.findGuidedModeHost('Switch to full version');
        const guidedHost = this.findGuidedModeHost();
        const switchBtn = this.findSwitchToCustomModeButton();
        if ([fullHost, guidedHost, switchBtn].filter(Boolean).length > 1) {
          throw new Error('[ONBOARDING] Multiple active mode-switch actions found; refusing ambiguous action.');
        }
        if (fullHost) return { fullHost };
        if (guidedHost) return { guidedHost };
        if (switchBtn) return { switchBtn };

        // Priority 3: Only then check if standard creation form is ready
        if (this.isRegularCreationInterfacePresent()) return { normal: true };

        return null;
      }, timeoutMs, 'Neither Guided Mode nor the normal campaign form became ready.');

      if (ready.confirmModal) return this.handleSwitchToFullVersion(null, timeoutMs);
      if (ready.customModal) return this.handleSwitchToCustomMode(null, timeoutMs);
      if (ready.fullHost) return this.handleSwitchToFullVersion(ready.fullHost, timeoutMs);
      if (ready.guidedHost) return this.exitGuidedMode(ready.guidedHost, timeoutMs);
      if (ready.normal) {
        console.log('[GUIDED MODE] Guided Mode not present');
        console.log('[GUIDED MODE] Normal campaign form detected');
        console.log('[ONBOARDING] No mode switch required');
        console.log('[ONBOARDING] Traffic objective ready');
        console.log('[ONBOARDING] Skipped because: Standard campaign form already ready without onboarding button');
        return true;
      }
      return this.handleSwitchToCustomMode(ready.switchBtn, timeoutMs);
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
      const customExit = this.findCustomModeExitAction(dialog);
      if (customExit) return customExit;

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
