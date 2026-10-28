/** Fill ad text and accept a TikTok-generated suggestion before CTA. */
(function (global) {
  'use strict';
  const AdTextAutomation = {
    async configure({ resume = false } = {}) {
      const h = global.AutomationHelpers;
      const storage = global.StorageService;
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const guard = () => { if (h.isAborted()) throw new Error('Automation aborted or paused by user'); };
      const usable = node => {
        if (!node || node.isConnected === false || !h.isVisible(node)) return false;
        for (let current = node; current; current = current.assignedSlot || current.parentElement || current.getRootNode?.().host) {
          if (!current.tagName || current.tagName.startsWith('#')) continue;
          const style = window.getComputedStyle(current);
          if (current.disabled || current.readOnly || current.getAttribute('aria-disabled') === 'true' ||
              current.getAttribute('aria-hidden') === 'true' || current.hasAttribute('hidden') ||
              style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        }
        return true;
      };
      const wait = async (check, message) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          guard();
          const result = check();
          if (result) return result;
          await h.sleep(250);
        }
        throw new Error('[AD TEXT] ' + message);
      };
      const field = () => {
        // The URL textarea shares this test ID. The exact placeholder is essential.
        const fields = h.queryShadowAll('textarea').filter(node =>
          node.getAttribute('data-testid') === 'ks-text-field-index-aZM5M2' &&
          node.getAttribute('placeholder') === 'Enter text' && usable(node));
        // TikTok appends empty alternative-text fields after accepting a
        // suggestion. Only the first rendered ad-text field belongs to this
        // workflow, including verification and CTA refresh recovery.
        return fields[0];
      };
      const input = await wait(field, 'Enter text field did not become ready.');
      const job = await storage.getJobState();
      if (resume) {
        const saved = job.adTextSelection;
        if (!saved || saved.runId !== job.runId || saved.campaignIndex !== job.currentCampaignIndex ||
            normalize(input.value) !== saved.value) {
          throw new Error('[AD TEXT] Saved AI suggestion was not retained after CTA refresh.');
        }
        return { value: saved.value, retained: true };
      }
      await storage.updateJobState({ currentStep: 'CONFIGURE_AD_TEXT', stepDescription: 'Typing Virul Video and waiting for TikTok AI suggestions' });
      guard();
      const prefix = 'ks-menu-item-item-xb3yLe-';
      const suggestions = () => h.queryShadowAll('li').filter(node =>
        (node.getAttribute('data-testid') || '').startsWith(prefix) && usable(node));
      const before = new Map(suggestions().map(node => [node, node.getAttribute('data-testid')]));
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(input, 'Virul Video'); else input.value = 'Virul Video';
      // Keep focus: blurring here can dismiss the suggestion dropdown.
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      const option = await wait(() => {
        const candidates = suggestions().filter(node => !before.has(node) || before.get(node) !== node.getAttribute('data-testid'));
        const lists = new Set(candidates.map(node => node.closest('ul')));
        if (lists.size > 1) throw new Error('[AD TEXT] Multiple AI suggestion lists; refusing ambiguous selection.');
        return candidates[0];
      }, 'No fresh TikTok AI suggestion appeared after typing Virul Video.');
      const expected = normalize(option.getAttribute('data-testid').slice(prefix.length));
      if (!expected || expected.length > 100) throw new Error('[AD TEXT] AI suggestion label is empty or exceeds 100 characters.');
      guard();
      h.safeClick(option, 'First TikTok AI ad-text suggestion');
      await wait(() => {
        const live = field();
        return live && normalize(live.value) === expected;
      }, 'Selected AI suggestion did not update the ad text.');
      guard();
      await storage.updateJobState({ adTextSelection: { runId: job.runId, campaignIndex: job.currentCampaignIndex, value: expected },
        stepDescription: 'TikTok AI text selected. Continuing to Call to Action.' });
      return { value: expected };
    }
  };
  global.AdTextAutomation = AdTextAutomation;
  if (typeof module !== 'undefined' && module.exports) module.exports = AdTextAutomation;
})(typeof globalThis !== 'undefined' ? globalThis : self);
