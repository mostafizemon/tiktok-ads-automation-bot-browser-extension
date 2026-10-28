/** Optional TikTok identity linking, with a QR wait followed by popup dismissal. */
(function (global) {
  'use strict';
  const AccountLinkAutomation = {
    async prepareQrLink() {
      const h = global.AutomationHelpers;
      const storage = global.StorageService;
      const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
      const deep = (selector, root = document) => [...new Set([
        ...h.queryShadowAll(selector, root),
        ...(root.shadowRoot ? h.queryShadowAll(selector, root.shadowRoot) : [])
      ])];
      const parent = node => node?.assignedSlot || node?.parentElement || node?.getRootNode?.().host;
      const enabled = node => {
        if (!node || !h.isVisible(node)) return false;
        for (let current = node; current; current = parent(current)) {
          const style = window.getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' ||
              current.hasAttribute?.('hidden') || current.disabled || current.getAttribute?.('aria-disabled') === 'true' ||
              (current.hasAttribute?.('disabled') && current.getAttribute('disabled') !== 'false')) return false;
        }
        return true;
      };
      const guard = () => { if (h.isAborted()) throw new Error('Automation aborted or paused by user'); };
      const wait = async (check, message, timeout = 15000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          guard();
          const result = check();
          if (result) return result;
          await h.sleep(250);
        }
        if (message) throw new Error('[ACCOUNT LINK] ' + message);
        return null;
      };
      const unique = (items, description) => {
        const matches = [...new Set(items)];
        if (matches.length > 1) throw new Error('[ACCOUNT LINK] Multiple ' + description + '; refusing ambiguous action.');
        return matches[0];
      };
      const click = node => { guard(); if (!enabled(node)) throw new Error('[ACCOUNT LINK] Action became unavailable.'); node.click(); };
      const save = async (step, description) => {
        guard();
        await storage.updateJobState({ currentStep: step, stepDescription: description });
        guard();
      };
      const button = host => host?.shadowRoot?.querySelector('button[part="base"], button[part="self"]') ||
        (host?.tagName?.toLowerCase() === 'button' ? host : null);
      const trigger = await wait(() => unique(deep('[data-testid="components-IdentityEmptyStatus-cTfGZe"]')
        .filter(host => text(host) === 'Link TikTok account').map(button).filter(enabled), 'Link TikTok account buttons'), null, 3000);
      if (!trigger) return { skipped: true };

      await save('LINK_TIKTOK_ACCOUNT', 'Opening Link TikTok account');
      click(trigger);
      const tileSurface = node => node?.shadowRoot?.querySelector('[data-testid="ks-tile-index-3TTQAz"]');
      const tileTitle = node => {
        const titles = deep('[slot="title"]', node).map(text);
        for (const slot of deep('slot[name="title"]', node)) {
          const assigned = slot.assignedElements?.({ flatten: true }) || [];
          titles.push(assigned.length ? assigned.map(text).join(' ').trim() : text(slot));
        }
        return titles;
      };
      const tile = (label, root = document) => unique(deep('*', root).filter(node =>
        node.tagName?.toLowerCase().startsWith('ks-tile-') && tileTitle(node).includes(label) &&
        enabled(tileSurface(node))), label + ' tiles');
      const existing = await wait(() => tile('Link existing TikTok account'), 'Existing-account selector did not appear.');
      // Resolve the owning modal, including light children assigned into shadow slots.
      let dialog = null;
      for (let node = parent(existing); node; node = parent(node)) {
        if (node.tagName?.toLowerCase().startsWith('ks-modal-')) { dialog = node; break; }
        if (!dialog && (node.getAttribute?.('role') === 'dialog' || node.getAttribute?.('aria-modal') === 'true')) dialog = node;
      }
      if (!dialog) throw new Error('[ACCOUNT LINK] Could not identify the account-selection popup.');
      const select = async label => {
        const host = await wait(() => tile(label, dialog), label + ' unavailable in account popup.');
        const selected = node => {
          if (!node) return false;
          // Native radio.checked can change without TikTok accepting the tile
          // selection. Require the component's selected state instead.
          return tileSurface(node)?.classList.contains('tile--checked') ||
            node.getAttribute('aria-checked') === 'true';
        };
        if (!selected(host)) {
          // The current tile nests its actual radio in a second shadow root.
          // Click that control rather than relying on the decorative tile div.
          const target = await wait(() => {
            const current = tile(label, dialog);
            if (!current) return null;
            const radios = deep('input[type="radio"]', current);
            return radios.length ? unique(radios.filter(enabled), label + ' radio inputs') : tileSurface(current);
          }, label + ' radio did not become enabled.');
          console.log('[ACCOUNT LINK] Selecting ' + label + ' via ' + target.tagName.toLowerCase());
          click(target);
          if (target.tagName.toLowerCase() === 'input' &&
              !await wait(() => selected(tile(label, dialog)), null, 1500)) {
            // Some versions handle selection on the action tile rather than
            // the nested radio. Reacquire and dispatch one bounded fallback.
            const current = tile(label, dialog);
            if (!current) throw new Error('[ACCOUNT LINK] ' + label + ' disappeared after radio click.');
            const radios = deep('input[type="radio"]', current);
            if (radios.some(radio => !enabled(radio))) throw new Error('[ACCOUNT LINK] ' + label + ' became disabled.');
            if (!selected(current)) {
              console.log('[ACCOUNT LINK] Radio did not update tile; clicking action tile once: ' + label);
              click(tileSurface(current));
            }
          }
        }
        await wait(() => selected(tile(label, dialog)), label + ' selection could not be verified.');
        console.log('[ACCOUNT LINK] Selected and verified: ' + label);
      };
      await select('Link existing TikTok account');
      await save('LINK_ACCOUNT_SELECT_QR', 'Existing TikTok account selected. Waiting for QR creation method.');
      await wait(() => tile('Link with QR code', dialog), 'QR creation method did not appear after selecting existing account.');
      await select('Link with QR code');
      const confirm = await wait(() => unique(deep('*', dialog).filter(node =>
        (node.tagName?.toLowerCase().startsWith('ks-button-') || node.tagName?.toLowerCase() === 'button') &&
        text(node) === 'Confirm').map(button).filter(enabled), 'Confirm buttons'), 'Enabled Confirm button missing in account popup.');
      const dialogs = () => deep('*').filter(node => node.tagName?.toLowerCase().startsWith('ks-modal-') ||
        node.getAttribute?.('role') === 'dialog' || node.tagName?.toLowerCase() === 'dialog');
      const visible = node => enabled(node) || deep('button, [part="wrapper"], [part="content"]', node).some(enabled);
      const before = new Map(dialogs().filter(visible).map(node => [node, text(node)]));
      await save('LINK_ACCOUNT_CONFIRM', 'Confirming Link with QR code');
      click(confirm);
      const next = await wait(() => {
        const candidates = dialogs().filter(node => visible(node) && !tile('Link existing TikTok account', node) &&
          (!before.has(node) || before.get(node) !== text(node)));
        // A native dialog can be nested in the same custom modal. Count it once.
        const roots = candidates.filter(node => {
          for (let ancestor = parent(node); ancestor; ancestor = parent(ancestor)) if (candidates.includes(ancestor)) return false;
          return true;
        });
        return unique(roots, 'new account-link popups');
      }, 'The popup after Confirm was not detected. Its HTML is needed to identify it.');
      await save('LINK_ACCOUNT_QR_WAIT', 'Scrolling account-link popup, then waiting 40 seconds');
      await h.sleep(500);
      guard();
      // Scroll only popup-owned content, including assigned light-DOM content.
      const nodes = new Set([next, ...deep('*', next)]);
      for (const node of [...nodes]) {
        if (node.tagName?.toLowerCase() === 'slot') {
          for (const assigned of node.assignedElements?.({ flatten: true }) || []) {
            nodes.add(assigned);
            for (const child of deep('*', assigned)) nodes.add(child);
          }
        }
      }
      for (const node of nodes) {
        guard();
        if (node.scrollHeight > node.clientHeight && node.clientHeight > 0) {
          const style = window.getComputedStyle(node);
          if (['auto', 'scroll', 'overlay'].includes(style.overflowY)) node.scrollTop = node.scrollHeight;
        }
      }
      await h.sleep(40000);
      guard();
      const gotIt = await wait(() => {
        const footers = new Set(deep('[slot="footer"]', next));
        for (const slot of deep('slot[name="footer"]', next)) {
          for (const assigned of slot.assignedElements?.({ flatten: true }) || []) footers.add(assigned);
        }
        const actions = [...footers].flatMap(footer => deep('*', footer).filter(node =>
          (node.tagName?.toLowerCase().startsWith('ks-button-') || node.tagName?.toLowerCase() === 'button') &&
          text(node) === 'Got it').map(button).filter(enabled));
        return unique(actions, 'QR popup Got it buttons');
      }, 'Enabled Got it button missing in QR popup footer.');
      await save('LINK_ACCOUNT_DISMISS_QR', '40-second wait complete. Clicking Got it');
      click(gotIt);
      await wait(() => next.isConnected === false || !visible(next), 'QR popup did not close after Got it.');
      await save('LINK_ACCOUNT_QR_COMPLETE', 'QR popup dismissed. Continuing to Call to Action.');
      return { completed: true };
    }
  };
  global.AccountLinkAutomation = AccountLinkAutomation;
  if (typeof module !== 'undefined' && module.exports) module.exports = AccountLinkAutomation;
})(typeof globalThis !== 'undefined' ? globalThis : self);
