/** Local DOM/Shadow DOM regression tests; no browser, accounts, or network calls. */
const assert = require('assert');
class Node {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.text = text;
    this.children = []; this.parentElement = null; this.shadowRoot = null;
    this.visible = true; this.clicks = 0;
    this.classList = { contains: name => (this.attrs.class || '').split(/\s+/).includes(name) };
  }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(' '); }
  get innerText() { return this.textContent; }
  get disabled() { return this.tagName === 'BUTTON' && this.hasAttribute('disabled'); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  shadow() { this.shadowRoot = new Node('#shadow-root'); this.shadowRoot.host = this; return this.shadowRoot; }
  getRootNode() { let node = this; while (node.parentElement) node = node.parentElement; return node; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part === '*') return true;
      const attr = part.match(/\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/);
      if (attr && (!this.hasAttribute(attr[1]) || (attr[2] === '=' && this.getAttribute(attr[1]) !== attr[3]) ||
          (attr[2] === '*=' && !this.getAttribute(attr[1]).includes(attr[3])))) return false;
      const prefix = part.replace(/\[[^\]]+\]/g, '');
      if (prefix.startsWith('.')) return this.classList.contains(prefix.slice(1));
      if (prefix.startsWith('#')) return this.getAttribute('id') === prefix.slice(1);
      return !prefix || this.tagName.toLowerCase() === prefix.toLowerCase();
    });
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  getBoundingClientRect() {
    let node = this;
    while (node) {
      if (!node.visible) return { width: 0, height: 0 };
      const parent = node.parentElement || node.host;
      if (!parent) return { width: node.tagName === '#DOCUMENT' ? 100 : 0, height: node.tagName === '#DOCUMENT' ? 30 : 0 };
      node = parent;
    }
  }
  scrollIntoView() {}
  dispatchEvent() {}
  click() { if (!this.disabled) { this.clicks++; this.onClick?.(); } }
}

function setup() {
  const document = new Node('#document'); document.body = document.appendChild(new Node('body'));
  global.document = document; global.Element = Node;
  global.window = { location: { href: 'https://ads.tiktok.com/i18n/manage/campaign' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  global.MouseEvent = function () {}; global.StorageService = null;
  global.AutomationRunner = { shouldAbort: false };
  for (const file of ['helpers', 'custom-mode', 'campaign', 'popup-handler']) {
    delete require.cache[require.resolve(`../automation/${file}.js`)];
    require(`../automation/${file}.js`);
  }
  let now = 1000; const timers = [];
  const env = { document, handler: global.CustomModeHandler, campaign: global.CampaignAutomation, sleeps: 0,
    later(delay, fn) { timers.push({ at: now + delay, fn }); } };
  env.now = () => now;
  global.AutomationHelpers.sleep = async ms => {
    if (global.AutomationRunner.shouldAbort) throw new Error('Automation aborted or paused by user');
    env.sleeps++; now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
    if (global.AutomationRunner.shouldAbort) throw new Error('Automation aborted or paused by user');
  };
  env.normal = () => document.body.appendChild(new Node('span', { class: 'index_title_Nvlf1' }, 'Traffic'));
  return env;
}

function guided(env, { suffix = '6xhh7t2y', delay = 0, assigned = false, close = true, noForm = false, disabledDelay = 0 } = {}) {
  const host = env.document.body.appendChild(new Node(`ks-button-${suffix}`, {
    variant: 'default', loading: 'false', disabled: 'false', 'data-btm': 'c2209.d05205', 'ks-button': '', class: ''
  }, '  Exit   guided mode  '));
  const inner = host.shadow().appendChild(new Node('button', { type: 'button', class: 'button button--md button--angle', part: 'self' }));
  inner.appendChild(new Node('slot'));
  const state = { host, inner, dialog: null, exit: null, slot: null };
  inner.onClick = () => {
    const show = () => {
      const modalHost = env.document.body.appendChild(new Node('ks-modal-changing'));
      const dialog = modalHost.shadow().appendChild(new Node('div', { role: 'dialog' }));
      state.dialog = dialog;
      const actionHost = dialog.appendChild(new Node('ks-button-dynamic', { 'ks-button': '', disabled: 'false' }));
      const actionRoot = actionHost.shadow();
      const exit = new Node('button', { part: 'self', ...(disabledDelay ? { disabled: 'disabled' } : {}) });
      const slot = new Node('slot', { name: 'cancel-btn', elementtiming: 'element-timing' }, assigned ? '' : 'Exit');
      if (assigned) {
        actionRoot.appendChild(slot);
        actionHost.appendChild(exit); exit.text = 'Exit'; exit.assignedSlot = slot;
        slot.assignedElements = options => { assert.deepStrictEqual(options, { flatten: true }); return [exit]; };
      } else {
        actionRoot.appendChild(exit); exit.appendChild(slot); slot.assignedElements = () => [];
      }
      state.exit = exit; state.slot = slot;
      exit.onClick = () => {
        if (close) modalHost.visible = false;
        host.visible = false;
        if (!noForm) env.normal();
      };
      if (disabledDelay) env.later(disabledDelay, () => delete exit.attrs.disabled);
      // Verify observer classification even when only the slotted action identifies the new popup.
      assert.strictEqual(global.PopupHandler.classifyDialog(dialog).type, 'WORKFLOW_CRITICAL');
    };
    if (delay) env.later(delay, show); else show();
  };
  return state;
}

// Mirrors the supplied ks-button-1-1-1o markup: base button, nested tooltip,
// pre-mounted modal and light-DOM footer overriding default Cancel / Confirm.
function currentGuided(env) {
  const host = env.document.body.appendChild(new Node('ks-button-1-1-1o', { class: 'KsButton' }, 'Exit guided mode'));
  const inner = host.shadow().appendChild(new Node('button', { part: 'base' }));
  inner.appendChild(new Node('slot'));
  const tooltip = host.appendChild(new Node('ks-tooltip-1-1-1o'));
  tooltip.appendChild(new Node('div', { slot: 'content' }, "You're in a guided setup designed for new advertisers. Learn more"));
  // Exercise native text-node traversal as well as the fixture's textContent.
  host.childNodes = [{ nodeType: 3, textContent: 'Exit guided mode' }, tooltip];
  const modal = env.document.body.appendChild(new Node('ks-modal-1-1-1o', { class: 'KsModal' }));
  modal.visible = false;
  const wrapper = modal.shadow().appendChild(new Node('div', { part: 'wrapper', class: 'modal__wrapper' }));
  const header = wrapper.appendChild(new Node('div', { class: 'modal__header-title' }));
  header.appendChild(new Node('slot', { name: 'title' }, 'Are you sure you want to exit?'));
  const defaultFooter = wrapper.appendChild(new Node('div', { part: 'footer' }));
  const footerSlot = defaultFooter.appendChild(new Node('slot', { name: 'footer' }));
  const fallback = footerSlot.appendChild(new Node('button', {}, 'Confirm'));
  const footer = modal.appendChild(new Node('div', { slot: 'footer' }));
  footer.assignedSlot = footerSlot;
  footerSlot.assignedElements = () => [footer];
  const exitHost = footer.appendChild(new Node('ks-button-1-1-1o', {}, 'Exit'));
  const exit = exitHost.shadow().appendChild(new Node('button', { part: 'base' }));
  const stayHost = footer.appendChild(new Node('ks-button-1-1-1o', {}, 'Stay'));
  const stay = stayHost.shadow().appendChild(new Node('button', { part: 'base' }));
  inner.onClick = () => { modal.visible = true; };
  exit.onClick = () => { modal.visible = false; host.visible = false; env.normal(); };
  return { host, inner, modal, exit, stay, fallback, header, footer };
}

function fullVersion(env, {
  suffix = 'pz4ceaj9',
  modalSuffix = 'zskw9xpt',
  delay = 0,
  assigned = false,
  close = true,
  noForm = false,
  disabledDelay = 0,
  rerenderModal = false,
  direct = false
} = {}) {
  const host = env.document.body.appendChild(new Node(`ks-button-${suffix}`, {
    variant: 'default', loading: 'false', disabled: 'false', 'ks-button': '', class: ''
  }, '  Switch   to full version  '));
  const inner = host.shadow().appendChild(new Node('button', {
    type: 'button',
    class: 'button button--md button--angle',
    part: 'self'
  }));
  inner.appendChild(new Node('slot'));

  const state = {
    host,
    inner,
    modal: null,
    confirm: null,
    cancel: null,
    closeBtn: null,
    confirmSlot: null,
    cancelSlot: null
  };

  inner.onClick = () => {
    if (direct) {
      host.visible = false;
      if (!noForm) env.normal();
      return;
    }

    const show = () => {
      const modalHost = env.document.body.appendChild(new Node('ks-modal-host'));
      const wrapper = modalHost.shadow().appendChild(new Node('div', {
        class: 'modal__wrapper modal__wrapper--md',
        part: 'wrapper',
        style: 'transform: scale(1); opacity: 1;'
      }));
      state.modal = wrapper;

      const header = wrapper.appendChild(new Node('div', { class: 'modal__header', part: 'header' }));
      const headerTitle = header.appendChild(new Node('div', { class: 'modal__header-title' }));
      const headerSlot = headerTitle.appendChild(new Node('slot', { name: 'header' }, assigned ? '' : 'Switch to full version?'));
      if (assigned) {
        const headerText = new Node('span', {}, 'Switch to full version?');
        headerTitle.appendChild(headerText);
        headerText.assignedSlot = headerSlot;
        headerSlot.assignedElements = () => [headerText];
      } else {
        headerSlot.assignedElements = () => [];
      }

      const closeBtn = header.appendChild(new Node('button', { part: 'closeIcon', class: 'modal__close' }, 'x'));
      state.closeBtn = closeBtn;

      const footer = wrapper.appendChild(new Node('div', { class: 'modal__footer', part: 'footer' }));
      const btns = footer.appendChild(new Node('div', { class: 'modal__footer__btns' }));

      const cancelHost = btns.appendChild(new Node(`ks-button-${modalSuffix}`, {
        'ks-button': '',
        disabled: 'false'
      }));
      const cancelInner = cancelHost.shadow().appendChild(new Node('button', { part: 'self' }));
      const cancelSlot = cancelHost.appendChild(new Node('slot', { name: 'cancel-btn' }, assigned ? '' : 'Cancel'));
      if (assigned) {
        const cancelText = new Node('span', {}, 'Cancel');
        cancelHost.appendChild(cancelText);
        cancelText.assignedSlot = cancelSlot;
        cancelSlot.assignedElements = () => [cancelText];
      } else {
        cancelSlot.assignedElements = () => [];
      }
      state.cancel = cancelInner;
      state.cancelSlot = cancelSlot;

      const confirmHost = btns.appendChild(new Node(`ks-button-${modalSuffix}`, {
        'ks-button': '',
        disabled: 'false'
      }));
      const confirmInner = confirmHost.shadow().appendChild(new Node('button', {
        type: 'button',
        class: 'button button--md button--angle button--type-contained button--color-primary',
        part: 'self',
        ...(disabledDelay ? { disabled: 'disabled' } : {})
      }));
      const confirmSlot = confirmHost.appendChild(new Node('slot', { name: 'confirm-btn' }, assigned ? '' : 'Confirm'));
      if (assigned) {
        const confirmText = new Node('span', {}, 'Confirm');
        confirmHost.appendChild(confirmText);
        confirmText.assignedSlot = confirmSlot;
        confirmSlot.assignedElements = () => [confirmText];
      } else {
        confirmSlot.assignedElements = () => [];
      }
      state.confirm = confirmInner;
      state.confirmSlot = confirmSlot;

      confirmInner.onClick = () => {
        if (close) {
          modalHost.visible = false;
          wrapper.visible = false;
        }
        host.visible = false;
        if (!noForm) env.normal();
      };

      if (disabledDelay) {
        env.later(disabledDelay, () => delete confirmInner.attrs.disabled);
      }

      if (rerenderModal) {
        env.later(200, () => {
          modalHost.visible = false;
          wrapper.visible = false;
          const newHost = env.document.body.appendChild(new Node('ks-modal-host-rerendered'));
          const newWrapper = newHost.shadow().appendChild(new Node('div', {
            class: 'modal__wrapper modal__wrapper--md',
            part: 'wrapper',
            style: 'transform: scale(1); opacity: 1;'
          }));
          const newHeader = newWrapper.appendChild(new Node('div', { class: 'modal__header', part: 'header' }));
          const newTitle = newHeader.appendChild(new Node('div', { class: 'modal__header-title' }));
          newTitle.appendChild(new Node('slot', { name: 'header' }, 'Switch to full version?'));
          const newClose = newHeader.appendChild(new Node('button', { part: 'closeIcon' }, 'x'));
          const newFooter = newWrapper.appendChild(new Node('div', { class: 'modal__footer', part: 'footer' }));
          const newBtns = newFooter.appendChild(new Node('div', { class: 'modal__footer__btns' }));
          const newCancelHost = newBtns.appendChild(new Node(`ks-button-${modalSuffix}`, { 'ks-button': '', disabled: 'false' }));
          const newCancelInner = newCancelHost.shadow().appendChild(new Node('button', { part: 'self' }));
          newCancelHost.appendChild(new Node('slot', { name: 'cancel-btn' }, 'Cancel'));
          const newConfirmHost = newBtns.appendChild(new Node(`ks-button-${modalSuffix}`, { 'ks-button': '', disabled: 'false' }));
          const newConfirmInner = newConfirmHost.shadow().appendChild(new Node('button', {
            type: 'button',
            class: 'button button--md button--angle button--type-contained button--color-primary',
            part: 'self'
          }));
          newConfirmHost.appendChild(new Node('slot', { name: 'confirm-btn' }, 'Confirm'));
          newConfirmInner.onClick = () => {
            if (close) {
              newHost.visible = false;
              newWrapper.visible = false;
            }
            host.visible = false;
            if (!noForm) env.normal();
          };
          state.confirm = newConfirmInner;
          state.cancel = newCancelInner;
          state.closeBtn = newClose;
          state.modal = newWrapper;
        });
      }

      assert.strictEqual(global.PopupHandler.classifyDialog(wrapper).type, 'WORKFLOW_CRITICAL');
    };

    if (delay) env.later(delay, show); else show();
  };

  return state;
}

function customMode(env, {
  suffix = 'q37k4f39',
  modalSuffix = 'q37k4f39',
  delay = 0,
  assigned = false,
  close = true,
  noForm = false,
  disabledDelay = 0,
  rerenderModal = false,
  direct = false,
  hasNoDataBody = true
} = {}) {
  const switchHost = env.document.body.appendChild(new Node(`ks-button-${suffix}`, {
    variant: 'default', loading: 'false', disabled: 'false', 'ks-button': '', class: ''
  }, '  Switch   to custom mode  '));
  const inner = switchHost.shadow().appendChild(new Node('button', {
    type: 'button',
    class: 'button button--md button--angle',
    part: 'self'
  }));
  inner.appendChild(new Node('slot'));

  const state = {
    host: switchHost,
    inner,
    modal: null,
    exit: null,
    stay: null,
    exitHost: null,
    stayHost: null,
    exitSlot: null,
    staySlot: null,
    headerSlot: null
  };

  const show = () => {
    const modalHost = env.document.body.appendChild(new Node('ks-modal-custom'));
    const wrapper = modalHost.shadow().appendChild(new Node('div', {
      class: 'modal__wrapper modal__wrapper--md',
      part: 'wrapper',
      style: 'transform: scale(1); opacity: 1;'
    }));
    state.modal = wrapper;

    const header = wrapper.appendChild(new Node('div', { class: 'modal__header', part: 'header' }));
    const headerTitle = header.appendChild(new Node('div', { class: 'modal__header-title' }));
    const headerSlot = headerTitle.appendChild(new Node('slot', { name: 'header' }, assigned ? '' : 'Exit guided mode and switch to custom mode?'));
    if (assigned) {
      const headerText = new Node('span', {}, 'Exit guided mode and switch to custom mode?');
      headerTitle.appendChild(headerText);
      headerText.assignedSlot = headerSlot;
      headerSlot.assignedElements = () => [headerText];
    } else {
      headerSlot.assignedElements = () => [];
    }
    state.headerSlot = headerSlot;

    if (hasNoDataBody) {
      const body = wrapper.appendChild(new Node('div', { class: 'modal__body-contener' }));
      body.appendChild(new Node('slot', {}, 'No Data'));
    }

    const footer = wrapper.appendChild(new Node('div', { class: 'modal__footer', part: 'footer' }));
    const btns = footer.appendChild(new Node('div', { class: 'modal__footer__btns' }));

    // Exit in cancel-btn slot
    const exitHost = btns.appendChild(new Node(`ks-button-${modalSuffix}`, {
      'ks-button': '',
      disabled: 'false'
    }));
    state.exitHost = exitHost;
    const exitInner = exitHost.shadow().appendChild(new Node('button', {
      type: 'button',
      part: 'self',
      ...(disabledDelay ? { disabled: 'disabled' } : {})
    }));
    exitInner.appendChild(new Node('slot'));
    const exitSlot = exitHost.appendChild(new Node('slot', { name: 'cancel-btn' }, assigned ? '' : 'Exit'));
    if (assigned) {
      const exitText = new Node('span', {}, 'Exit');
      exitHost.appendChild(exitText);
      exitText.assignedSlot = exitSlot;
      exitSlot.assignedElements = () => [exitText];
    } else {
      exitSlot.assignedElements = () => [];
    }
    state.exit = exitInner;
    state.exitSlot = exitSlot;

    // Stay in confirm-btn slot
    const stayHost = btns.appendChild(new Node(`ks-button-${modalSuffix}`, {
      'ks-button': '',
      disabled: 'false'
    }));
    state.stayHost = stayHost;
    const stayInner = stayHost.shadow().appendChild(new Node('button', {
      type: 'button',
      class: 'button--type-contained button--color-primary',
      part: 'self'
    }));
    stayInner.appendChild(new Node('slot'));
    const staySlot = stayHost.appendChild(new Node('slot', { name: 'confirm-btn' }, assigned ? '' : 'Stay'));
    if (assigned) {
      const stayText = new Node('span', {}, 'Stay');
      stayHost.appendChild(stayText);
      stayText.assignedSlot = staySlot;
      staySlot.assignedElements = () => [stayText];
    } else {
      staySlot.assignedElements = () => [];
    }
    state.stay = stayInner;
    state.staySlot = staySlot;

    exitInner.onClick = () => {
      if (close) {
        modalHost.visible = false;
        wrapper.visible = false;
      }
      switchHost.visible = false;
      if (!noForm) env.normal();
    };

    if (disabledDelay) {
      env.later(disabledDelay, () => delete exitInner.attrs.disabled);
    }

    if (rerenderModal) {
      env.later(200, () => {
        modalHost.visible = false;
        wrapper.visible = false;
        const newHost = env.document.body.appendChild(new Node('ks-modal-custom-rerendered'));
        const newWrapper = newHost.shadow().appendChild(new Node('div', {
          class: 'modal__wrapper modal__wrapper--md',
          part: 'wrapper',
          style: 'transform: scale(1); opacity: 1;'
        }));
        const newHeader = newWrapper.appendChild(new Node('div', { class: 'modal__header', part: 'header' }));
        const newTitle = newHeader.appendChild(new Node('div', { class: 'modal__header-title' }));
        newTitle.appendChild(new Node('slot', { name: 'header' }, 'Exit guided mode and switch to custom mode?'));

        const newFooter = newWrapper.appendChild(new Node('div', { class: 'modal__footer', part: 'footer' }));
        const newBtns = newFooter.appendChild(new Node('div', { class: 'modal__footer__btns' }));

        const newExitHost = newBtns.appendChild(new Node(`ks-button-${modalSuffix}`, { 'ks-button': '', disabled: 'false' }));
        const newExitInner = newExitHost.shadow().appendChild(new Node('button', { type: 'button', part: 'self' }));
        newExitHost.appendChild(new Node('slot', { name: 'cancel-btn' }, 'Exit'));

        const newStayHost = newBtns.appendChild(new Node(`ks-button-${modalSuffix}`, { 'ks-button': '', disabled: 'false' }));
        const newStayInner = newStayHost.shadow().appendChild(new Node('button', {
          type: 'button',
          class: 'button--type-contained button--color-primary',
          part: 'self'
        }));
        newStayHost.appendChild(new Node('slot', { name: 'confirm-btn' }, 'Stay'));

        newExitInner.onClick = () => {
          if (close) {
            newHost.visible = false;
            newWrapper.visible = false;
          }
          switchHost.visible = false;
          if (!noForm) env.normal();
        };

        state.exit = newExitInner;
        state.stay = newStayInner;
        state.modal = newWrapper;
      });
    }

    assert.strictEqual(global.PopupHandler.classifyDialog(wrapper).type, 'WORKFLOW_CRITICAL');
  };

  inner.onClick = () => {
    if (direct) {
      switchHost.visible = false;
      if (!noForm) env.normal();
      return;
    }
    if (delay) env.later(delay, show); else show();
  };

  return state;
}

(async () => {
  let passed = 0; let failed = 0;
  const realNow = Date.now;
  async function test(name, fn) {
    const env = setup(); Date.now = env.now;
    try { await fn(env); passed++; console.log(`PASS: ${name}`); }
    catch (error) { failed++; console.error(`FAIL: ${name}`, error.stack); }
    finally { Date.now = realNow; }
  }
  await test('Current base-part guided button ignores tooltip and exits through slotted footer once', async env => {
    const state = currentGuided(env);
    const unrelated = env.document.body.appendChild(new Node('button', {}, 'Exit'));
    env.normal(); // Guided action must take priority even with Traffic already mounted.
    assert.strictEqual(env.handler.findGuidedModeHost(), state.host);
    await env.campaign.handleCustomModeFlow();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.host.clicks, 0);
    assert.strictEqual(state.stay.clicks, 0);
    assert.strictEqual(state.fallback.clicks, 0);
    assert.strictEqual(unrelated.clicks, 0);
  });
  await test('Display-contents modal resolves assigned footer from visible shadow wrapper', async env => {
    const state = currentGuided(env);
    // Real custom-element hosts can have no layout box while their shadow
    // wrapper and slotted footer buttons are visibly rendered.
    state.modal.getBoundingClientRect = () => ({ width: 0, height: 0 });
    await env.handler.ensureCustomMode(2000);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
    assert.strictEqual(state.fallback.clicks, 0);
  });
  await test('Current guided mode waits for enabled footer Exit without repeating initial click', async env => {
    const state = currentGuided(env);
    state.exit.attrs.disabled = '';
    env.later(750, () => delete state.exit.attrs.disabled);
    await env.handler.ensureCustomMode(2000);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });
  await test('Current guided mode ignores footer Exit under unrelated modal title', async env => {
    const state = currentGuided(env);
    state.header.children[0].text = 'Delete campaign?';
    await assert.rejects(env.handler.ensureCustomMode(1000), /Exit confirmation popup/);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 0);
    assert.strictEqual(state.stay.clicks, 0);
  });
  await test('Disabled current base-part guided button is never clicked', async env => {
    const state = currentGuided(env);
    state.inner.attrs.disabled = '';
    assert.strictEqual(env.handler.findGuidedModeHost(), null);
    await assert.rejects(env.handler.ensureCustomMode(1000), /Neither Guided Mode/);
    assert.strictEqual(state.inner.clicks, 0);
  });
  for (const suffix of ['6xhh7t2y', 'new-session-2026']) {
    await test(`Create -> Guided Mode -> shadow Exit -> slot Exit -> normal (${suffix})`, async env => {
      let state;
      const create = env.document.body.appendChild(new Node('button', {}, 'Create'));
      create.onClick = () => { state = guided(env, { suffix }); };
      await env.campaign.clickCreateCampaign();
      await env.campaign.handleCustomModeFlow();
      assert.strictEqual(create.clicks, 1); assert.strictEqual(state.inner.clicks, 1);
      assert.strictEqual(state.host.clicks, 0); assert.strictEqual(state.exit.clicks, 1);
      assert.strictEqual(state.slot.clicks, 0); assert.ok(env.handler.isRegularCreationInterfacePresent());
    });
  }
  await test('Assigned cancel slot resolves the actual button', async env => {
    const state = guided(env, { assigned: true }); await env.handler.ensureCustomMode();
    assert.strictEqual(state.exit.clicks, 1); assert.strictEqual(state.slot.clicks, 0);
  });
  await test('Normal form immediately ready: no waiting or unrelated Exit click', async env => {
    env.normal(); const exit = env.document.body.appendChild(new Node('button', {}, 'Exit'));
    await env.handler.ensureCustomMode(); assert.strictEqual(env.sleeps, 0); assert.strictEqual(exit.clicks, 0);
  });
  await test('Delayed initial Guided Mode rendering', async env => {
    let state; env.later(750, () => { state = guided(env); });
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Delayed popup and disabled Exit become ready without duplicate clicks', async env => {
    const state = guided(env, { delay: 1000, disabledDelay: 750 });
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Existing unrelated Exit dialog is never clicked', async env => {
    const dialog = env.document.body.appendChild(new Node('div', { role: 'dialog' }));
    const other = dialog.appendChild(new Node('button')); other.appendChild(new Node('slot', { name: 'cancel-btn' }, 'Exit'));
    const state = guided(env); await env.handler.ensureCustomMode();
    assert.strictEqual(other.clicks, 0); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Concurrent handler calls share one transition', async env => {
    const state = guided(env, { delay: 500 });
    await Promise.all([env.handler.ensureCustomMode(), env.handler.ensureCustomMode()]);
    assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Popup failing to close stops; re-entry never repeats Exit', async env => {
    const state = guided(env, { close: false });
    await assert.rejects(env.handler.ensureCustomMode(1000), /popup did not close/);
    await assert.rejects(env.handler.ensureCustomMode(1000), /popup did not close/);
    assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Missing normal form after exit stops with a diagnostic', async env => {
    guided(env, { noForm: true }); await assert.rejects(env.handler.ensureCustomMode(1000), /Normal campaign form did not become ready/);
  });
  await test('Unrecognized page times out without arbitrary clicks', async env => {
    const unrelated = env.document.body.appendChild(new Node('button', {}, 'Exit'));
    env.document.body.appendChild(new Node('span', { class: 'index_title_Nvlf1' }, 'Reach'));
    await assert.rejects(env.handler.ensureCustomMode(750), /Neither Guided Mode nor/);
    assert.strictEqual(unrelated.clicks, 0);
  });
  await test('Stop before Guided Mode click', async env => {
    const state = guided(env); global.AutomationRunner.shouldAbort = true;
    await assert.rejects(env.handler.ensureCustomMode(), /aborted or paused/); assert.strictEqual(state.inner.clicks, 0);
  });
  await test('Pause while waiting for popup prevents popup Exit', async env => {
    const state = guided(env, { delay: 1000 }); env.later(250, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(env.handler.ensureCustomMode(), /aborted or paused/);
    assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit, null);
  });
  await test('Legacy Switch to custom mode Stay/Exit remains working', async env => {
    const switchBtn = env.document.body.appendChild(new Node('button', {}, 'Switch to custom mode'));
    let exit;
    switchBtn.onClick = () => {
      switchBtn.visible = false;
      const dlg = env.document.body.appendChild(new Node('div', { role: 'dialog' }, 'Stay '));
      exit = dlg.appendChild(new Node('button', {}, 'Exit'));
      exit.onClick = () => { dlg.visible = false; env.normal(); };
    };
    await env.handler.ensureCustomMode(); assert.strictEqual(switchBtn.clicks, 1); assert.strictEqual(exit.clicks, 1);
  });
  await test('Disabled guided host is never clicked', async env => {
    const state = guided(env); state.host.attrs.disabled = 'true';
    await assert.rejects(env.handler.ensureCustomMode(750), /Neither Guided Mode nor/);
    assert.strictEqual(state.inner.clicks, 0);
  });
  await test('Missing popup stops without a second guided-mode click', async env => {
    const state = guided(env); state.inner.onClick = () => {};
    await assert.rejects(env.handler.ensureCustomMode(750), /confirmation popup/);
    await assert.rejects(env.handler.ensureCustomMode(750), /confirmation popup/);
    assert.strictEqual(state.inner.clicks, 1);
  });
  await test('Popup observer protects slot-only Exit even alongside tutorial text', async env => {
    const state = guided(env);
    const original = state.inner.onClick;
    state.inner.onClick = () => {
      original(); state.dialog.text = 'Got it Take a tour';
      assert.strictEqual(global.PopupHandler.isTutorialModalElement(state.dialog), false);
      assert.strictEqual(global.PopupHandler.classifyDialog(state.dialog).type, 'WORKFLOW_CRITICAL');
      global.PopupHandler.inspectAddedElement(state.dialog);
      assert.strictEqual(state.exit.clicks, 0);
    };
    await env.handler.ensureCustomMode(); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Multiple new Exit popups stop rather than choosing an arbitrary action', async env => {
    const state = guided(env);
    const original = state.inner.onClick;
    let other;
    state.inner.onClick = () => {
      original();
      const dialog = env.document.body.appendChild(new Node('div', { role: 'dialog' }));
      other = dialog.appendChild(new Node('button')); other.appendChild(new Node('slot', { name: 'cancel-btn' }, 'Exit'));
    };
    await assert.rejects(env.handler.ensureCustomMode(), /Multiple new exit dialogs/);
    assert.strictEqual(state.exit.clicks, 0); assert.strictEqual(other.clicks, 0);
  });
  await test('Separate campaign transitions each exit once', async env => {
    const first = guided(env); await env.handler.ensureCustomMode();
    for (const node of env.document.body.children) node.visible = false;
    const second = guided(env, { suffix: 'next-campaign' }); await env.handler.ensureCustomMode();
    assert.strictEqual(first.exit.clicks, 1); assert.strictEqual(second.exit.clicks, 1);
  });
  for (const suffix of ['pz4ceaj9', 'zskw9xpt', 'next-build-2026']) {
    await test(`Create -> Switch to full version -> shadow button -> modal -> Confirm -> normal (${suffix})`, async env => {
      let state;
      const create = env.document.body.appendChild(new Node('button', {}, 'Create'));
      create.onClick = () => { state = fullVersion(env, { suffix, delay: 500 }); };
      await env.campaign.clickCreateCampaign();
      await env.campaign.handleCustomModeFlow();
      assert.strictEqual(create.clicks, 1);
      assert.strictEqual(state.host.clicks, 0);
      assert.strictEqual(state.inner.clicks, 1);
      assert.strictEqual(state.confirm.clicks, 1);
      assert.strictEqual(state.cancel.clicks, 0);
      assert.strictEqual(state.closeBtn.clicks, 0);
      assert.strictEqual(state.confirmSlot.clicks, 0);
      assert.ok(env.handler.isRegularCreationInterfacePresent());
    });
  }

  await test('Assigned header and confirm slots resolve accurately', async env => {
    const state = fullVersion(env, { assigned: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
    assert.strictEqual(state.cancel.clicks, 0);
    assert.strictEqual(state.closeBtn.clicks, 0);
  });

  await test('Unrelated Confirm and Cancel buttons elsewhere on the page are ignored', async env => {
    const unrelatedConfirm = env.document.body.appendChild(new Node('button', {}, 'Confirm'));
    const unrelatedCancel = env.document.body.appendChild(new Node('button', {}, 'Cancel'));
    const unrelatedExit = env.document.body.appendChild(new Node('button', {}, 'Exit'));
    const state = fullVersion(env);
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.confirm.clicks, 1);
    assert.strictEqual(unrelatedConfirm.clicks, 0);
    assert.strictEqual(unrelatedCancel.clicks, 0);
    assert.strictEqual(unrelatedExit.clicks, 0);
  });

  await test('Delayed confirmation modal rendering', async env => {
    const state = fullVersion(env, { delay: 750 });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Delayed and initially disabled Confirm button becomes ready without duplicate clicks', async env => {
    const state = fullVersion(env, { delay: 500, disabledDelay: 750 });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Modal rerenders after opening without stale DOM references or duplicate clicks', async env => {
    const state = fullVersion(env, { rerenderModal: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
    assert.strictEqual(state.cancel.clicks, 0);
  });

  await test('Concurrent or subsequent handler calls share transition without duplicate clicks', async env => {
    const state = fullVersion(env, { delay: 500 });
    await Promise.all([env.handler.ensureCustomMode(), env.handler.ensureCustomMode()]);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Direct transition without modal opens form directly', async env => {
    const state = fullVersion(env, { direct: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(env.sleeps, 0);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm, null);
    assert.ok(env.handler.isRegularCreationInterfacePresent());
  });

  await test('Visible Switch to full version has priority over creation page content', async env => {
    const state = fullVersion(env);
    env.normal();
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Rebate Traffic metadata skips onboarding without delay when no switch button', async env => {
    const wrapper = env.document.body.appendChild(new Node('div', { 'data-tea-objective-content': 'Traffic', 'data-tea-objective-value': '1' }));
    wrapper.appendChild(new Node('label', { role: 'radio' }, 'Traffic Rebate offer'));
    await env.handler.ensureCustomMode();
    assert.strictEqual(env.sleeps, 0);
  });

  await test('Full version disabled host waits then clicks once when enabled', async env => {
    const state = fullVersion(env);
    state.host.attrs.disabled = 'true';
    env.later(750, () => { state.host.attrs.disabled = 'false'; });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Permanently disabled full version never clicks', async env => {
    const state = fullVersion(env);
    state.inner.attrs.disabled = 'disabled';
    await assert.rejects(env.handler.ensureCustomMode(750), /Neither Guided Mode nor/);
    assert.strictEqual(state.inner.clicks, 0);
  });

  await test('Full version appears asynchronously after Create', async env => {
    let state;
    env.later(750, () => { state = fullVersion(env); });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Stop before Switch to full version click', async env => {
    const state = fullVersion(env);
    global.AutomationRunner.shouldAbort = true;
    await assert.rejects(env.handler.ensureCustomMode(), /aborted or paused/);
    assert.strictEqual(state.inner.clicks, 0);
  });

  await test('Pause while waiting for confirmation modal prevents Confirm click', async env => {
    const state = fullVersion(env, { delay: 1000 });
    env.later(250, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(env.handler.ensureCustomMode(), /aborted or paused/);
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.confirm, null);
  });

  await test('Full version missing modal stops with diagnostic', async env => {
    const state = fullVersion(env);
    state.inner.onClick = () => {};
    await assert.rejects(env.handler.ensureCustomMode(750), /Confirmation modal not found/);
    assert.strictEqual(state.inner.clicks, 1);
  });

  await test('Confirmation modal failing to close stops with diagnostic', async env => {
    const state = fullVersion(env, { close: false });
    await assert.rejects(env.handler.ensureCustomMode(750), /Confirmation modal did not close/);
    assert.strictEqual(state.confirm.clicks, 1);
  });

  await test('Missing normal form after modal closes stops with diagnostic', async env => {
    fullVersion(env, { noForm: true });
    await assert.rejects(env.handler.ensureCustomMode(750), /Standard campaign form not ready/);
  });

  await test('Multiple visible onboarding variants stop without blind clicks', async env => {
    const guidedState = guided(env);
    const fullState = fullVersion(env);
    await assert.rejects(env.handler.ensureCustomMode(), /Multiple active mode-switch actions/);
    assert.strictEqual(guidedState.inner.clicks, 0);
    assert.strictEqual(fullState.inner.clicks, 0);
  });

  await test('Hidden obsolete full version host is ignored', async env => {
    const obsolete = fullVersion(env);
    obsolete.host.visible = false;
    const current = guided(env);
    await env.handler.ensureCustomMode();
    assert.strictEqual(obsolete.inner.clicks, 0);
    assert.strictEqual(current.inner.clicks, 1);
  });

  await test('Sequential multi-campaigns each switch to full version and confirm once', async env => {
    const first = fullVersion(env, { suffix: 'camp-1', modalSuffix: 'modal-1' });
    await env.handler.ensureCustomMode();
    assert.strictEqual(first.inner.clicks, 1);
    assert.strictEqual(first.confirm.clicks, 1);

    for (const node of env.document.body.children) node.visible = false;

    const second = fullVersion(env, { suffix: 'camp-2', modalSuffix: 'modal-2' });
    await env.handler.ensureCustomMode();
    assert.strictEqual(second.inner.clicks, 1);
    assert.strictEqual(second.confirm.clicks, 1);
  });

  await test('Create -> Switch to custom mode -> Exit guided mode and switch to custom mode? -> Exit clicked, Stay never clicked (q37k4f39)', async env => {
    let state;
    const create = env.document.body.appendChild(new Node('button', {}, 'Create'));
    create.onClick = () => { state = customMode(env, { suffix: 'q37k4f39', modalSuffix: 'q37k4f39' }); };
    await env.campaign.clickCreateCampaign();
    await env.campaign.handleCustomModeFlow();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Switch to custom mode -> Exit with assigned elements in header and cancel-btn slots', async env => {
    const state = customMode(env, { assigned: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Dynamic ks-button suffix supported in custom mode confirmation modal', async env => {
    const state = customMode(env, { suffix: 'btn-dyn-1234', modalSuffix: 'btn-modal-5678' });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Body containing "No Data" does not reject modal or trigger CTA recovery', async env => {
    const state = customMode(env, { hasNoDataBody: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Stay button with primary style in confirm-btn slot is never clicked', async env => {
    const state = customMode(env);
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.stay.clicks, 0);
    assert.strictEqual(state.exit.clicks, 1);
  });

  await test('Delayed rendering of custom mode confirmation modal', async env => {
    const state = customMode(env, { delay: 600 });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Exit button initially disabled, waits until enabled, then clicked', async env => {
    const state = customMode(env, { disabledDelay: 500 });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Modal rerenders after switch click and resolves to reacquired Exit button', async env => {
    const state = customMode(env, { rerenderModal: true });
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Modal failing to close stops with [ONBOARDING ERROR] Modal remained open', async env => {
    const state = customMode(env, { close: false });
    await assert.rejects(env.handler.ensureCustomMode(750), /Modal remained open/);
    assert.strictEqual(state.exit.clicks, 1);
  });

  await test('Standard creation form missing after modal closes stops with [ONBOARDING ERROR]', async env => {
    customMode(env, { noForm: true });
    await assert.rejects(env.handler.ensureCustomMode(750), /Standard form did not become ready/);
  });

  await test('Unrelated Exit button outside modal is ignored', async env => {
    const state = customMode(env);
    const outsideHost = env.document.body.appendChild(new Node('ks-button-unrelated', { 'ks-button': '', disabled: 'false' }));
    const outsideBtn = outsideHost.shadow().appendChild(new Node('button', { part: 'self' }, 'Exit'));
    await env.handler.ensureCustomMode();
    assert.strictEqual(outsideBtn.clicks, 0);
    assert.strictEqual(state.exit.clicks, 1);
  });

  await test('Unrelated Confirm button outside modal is ignored', async env => {
    const state = customMode(env);
    const outsideConfirm = env.document.body.appendChild(new Node('button', {}, 'Confirm'));
    await env.handler.ensureCustomMode();
    assert.strictEqual(outsideConfirm.clicks, 0);
    assert.strictEqual(state.exit.clicks, 1);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('PopupHandler classifies custom-mode modal as WORKFLOW_CRITICAL and does not auto-dismiss', async env => {
    const state = customMode(env);
    state.inner.click();
    assert.ok(state.modal);
    assert.strictEqual(global.PopupHandler.classifyDialog(state.modal).type, 'WORKFLOW_CRITICAL');
    assert.strictEqual(global.PopupHandler.isTutorialModalElement(state.modal), false);
    global.PopupHandler.checkForKnownTutorialPopup();
    assert.strictEqual(state.exit.clicks, 0);
    assert.strictEqual(state.stay.clicks, 0);
  });

  await test('Traffic selection does not proceed while custom-mode modal is still open', async env => {
    const state = customMode(env, { delay: 0 });
    state.inner.click();
    assert.ok(state.modal);
    env.normal();
    assert.strictEqual(env.handler.isRegularCreationInterfacePresent(), false);
    state.exit.click();
    assert.strictEqual(env.handler.isRegularCreationInterfacePresent(), true);
  });

  await test('Repeated handler invocation is idempotent for custom mode', async env => {
    const state = customMode(env);
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
    await env.handler.ensureCustomMode();
    assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit.clicks, 1);
  });

  await test('Cancel safety filter permits Exit for custom-mode modal while continuing to block Cancel for full-version modal', async env => {
    // 1. Verify custom-mode Exit is permitted
    const customState = customMode(env);
    customState.inner.click();
    const customExit = env.handler.findCustomModeExitAction(customState.modal);
    assert.strictEqual(customExit, customState.exit);
    assert.strictEqual(env.handler.isCancelOrCloseButton(customState.exit, customState.exitHost), false);

    // 2. Verify full-version Cancel is blocked
    for (const node of env.document.body.children) node.visible = false;
    const fullState = fullVersion(env);
    fullState.inner.click();
    assert.strictEqual(env.handler.isCancelOrCloseButton(fullState.cancel, fullState.cancel.parentElement), true);
    const fullConfirm = env.handler.findFullVersionConfirmAction(fullState.modal);
    assert.strictEqual(fullConfirm, fullState.confirm);
  });

  await test('Sequential multi-campaigns each switch to custom mode and exit once', async env => {
    const first = customMode(env, { suffix: 'custom-camp-1', modalSuffix: 'custom-modal-1' });
    await env.handler.ensureCustomMode();
    assert.strictEqual(first.inner.clicks, 1);
    assert.strictEqual(first.exit.clicks, 1);
    assert.strictEqual(first.stay.clicks, 0);

    for (const node of env.document.body.children) node.visible = false;

    const second = customMode(env, { suffix: 'custom-camp-2', modalSuffix: 'custom-modal-2' });
    await env.handler.ensureCustomMode();
    assert.strictEqual(second.inner.clicks, 1);
    assert.strictEqual(second.exit.clicks, 1);
    assert.strictEqual(second.stay.clicks, 0);
  });
  console.log(`GUIDED MODE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exitCode = 1;
})();
