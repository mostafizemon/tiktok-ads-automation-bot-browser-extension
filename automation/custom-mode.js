/**
 * automation/custom-mode.js
 * Handler for TikTok Ads Manager's "Custom Mode" vs "Simplified Mode" flow.
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

      if (trafficSpan && helpers.isVisible(trafficSpan)) {
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

    /**
     * Handle the full custom mode transition flow
     * @param {number} [timeoutMs=8000]
     * @returns {Promise<boolean>}
     */
    async ensureCustomMode(timeoutMs = 8000) {
      const helpers = global.AutomationHelpers;
      this.log('Evaluating custom mode state...');

      // Immediate check: If regular creation interface is already present, proceed immediately!
      if (this.isRegularCreationInterfacePresent()) {
        this.log('Regular campaign creation interface (Traffic objective) already active.');
        return true;
      }

      const start = Date.now();
      let switchBtn = null;

      // Poll briefly for either "Switch to custom mode" button or regular page
      while (Date.now() - start < timeoutMs) {
        if (this.isRegularCreationInterfacePresent()) {
          this.log('Traffic objective interface detected.');
          return true;
        }

        switchBtn = this.findSwitchToCustomModeButton();
        if (switchBtn) {
          break;
        }

        await helpers.sleep(400);
      }

      // If button not found and regular interface didn't appear yet, check one last time
      if (!switchBtn) {
        if (this.isRegularCreationInterfacePresent()) {
          this.log('Regular campaign creation interface detected.');
          return true;
        }
        this.log('No "Switch to custom mode" prompt detected. Assuming default mode is ready.');
        return true;
      }

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

      this.log('Proceeding to next step after custom mode transition.');
      return true;
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
