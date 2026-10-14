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

(async () => {
  let passed = 0; let failed = 0;
  const realNow = Date.now;
  async function test(name, fn) {
    const env = setup(); Date.now = env.now;
    try { await fn(env); passed++; console.log(`PASS: ${name}`); }
    catch (error) { failed++; console.error(`FAIL: ${name}`, error.stack); }
    finally { Date.now = realNow; }
  }
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
  for (const suffix of ['nyfkz08e', 'next-build']) {
    await test(`Full version inner shadow button then scoped popup Exit (${suffix})`, async env => {
      const state = guided(env, { suffix, delay: 750 });
      state.host.text = '  Switch   to full version  ';
      const unrelated = env.document.body.appendChild(new Node('button', {}, 'Exit'));
      await env.handler.ensureCustomMode();
      assert.strictEqual(state.host.clicks, 0); assert.strictEqual(state.inner.clicks, 1);
      assert.strictEqual(state.exit.clicks, 1); assert.strictEqual(unrelated.clicks, 0);
      await env.handler.ensureCustomMode();
      assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
    });
  }
  await test('Full version opens form directly without waiting for a popup', async env => {
    const state = guided(env); state.host.text = 'Switch to full version';
    state.inner.onClick = () => { state.host.visible = false; env.normal(); };
    await env.handler.ensureCustomMode();
    assert.strictEqual(env.sleeps, 0); assert.strictEqual(state.inner.clicks, 1);
    assert.strictEqual(state.exit, null);
  });
  await test('Normal form has priority over leftover onboarding buttons', async env => {
    const state = guided(env); state.host.text = 'Switch to full version'; env.normal();
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 0); assert.strictEqual(env.sleeps, 0);
  });
  await test('Rebate Traffic metadata skips onboarding without delay', async env => {
    const wrapper = env.document.body.appendChild(new Node('div', { 'data-tea-objective-content': 'Traffic', 'data-tea-objective-value': '1' }));
    wrapper.appendChild(new Node('label', { role: 'radio' }, 'Traffic Rebate offer'));
    const state = guided(env); state.host.text = 'Switch to full version';
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 0); assert.strictEqual(env.sleeps, 0);
  });
  await test('Full version disabled host waits then clicks once when enabled', async env => {
    const state = guided(env); state.host.text = 'Switch to full version'; state.host.attrs.disabled = 'true';
    env.later(750, () => { state.host.attrs.disabled = 'false'; });
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1);
  });
  await test('Permanently disabled full version never clicks', async env => {
    const state = guided(env); state.host.text = 'Switch to full version'; state.inner.attrs.disabled = 'disabled';
    await assert.rejects(env.handler.ensureCustomMode(750), /Neither Guided Mode nor/);
    assert.strictEqual(state.inner.clicks, 0);
  });
  await test('Full version appears asynchronously after Create', async env => {
    let state;
    env.later(750, () => { state = guided(env); state.host.text = 'Switch to full version'; });
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Full version rerender replaces host before direct form appears', async env => {
    const state = guided(env); state.host.text = 'Switch to full version';
    state.inner.onClick = () => {
      state.host.visible = false; state.host.text = '';
      env.later(500, () => env.normal());
    };
    await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1);
  });
  await test('Full version resumes pending transition without clicking replaced host again', async env => {
    const state = guided(env); state.host.text = 'Switch to full version';
    state.inner.onClick = () => { state.host.visible = false; state.host.text = ''; };
    await assert.rejects(env.handler.ensureCustomMode(500), /Switch to full version did not produce/);
    env.normal(); await env.handler.ensureCustomMode(); assert.strictEqual(state.inner.clicks, 1);
  });
  await test('Full version ignores pre-existing Exit dialog', async env => {
    const old = env.document.body.appendChild(new Node('div', { role: 'dialog' }));
    const button = old.appendChild(new Node('button')); button.appendChild(new Node('slot', { name: 'cancel-btn' }, 'Exit'));
    const state = guided(env); state.host.text = 'Switch to full version';
    await env.handler.ensureCustomMode(); assert.strictEqual(button.clicks, 0); assert.strictEqual(state.exit.clicks, 1);
  });
  await test('Full version supports legacy Stay/Exit confirmation', async env => {
    const state = guided(env); state.host.text = 'Switch to full version'; let exit;
    state.inner.onClick = () => {
      const dlg = env.document.body.appendChild(new Node('div', { role: 'dialog' }, 'Stay '));
      exit = dlg.appendChild(new Node('button', {}, 'Exit'));
      exit.onClick = () => { dlg.visible = false; state.host.visible = false; env.normal(); };
    };
    await env.handler.ensureCustomMode(); assert.strictEqual(exit.clicks, 1);
  });
  await test('Multiple visible onboarding variants stop without blind clicks', async env => {
    const guidedState = guided(env); const full = guided(env); full.host.text = 'Switch to full version';
    await assert.rejects(env.handler.ensureCustomMode(), /Multiple active mode-switch actions/);
    assert.strictEqual(guidedState.inner.clicks, 0); assert.strictEqual(full.inner.clicks, 0);
  });
  await test('Hidden obsolete full version host is ignored', async env => {
    const full = guided(env); full.host.text = 'Switch to full version'; full.host.visible = false;
    const current = guided(env); await env.handler.ensureCustomMode();
    assert.strictEqual(full.inner.clicks, 0); assert.strictEqual(current.inner.clicks, 1);
  });
  await test('Full version respects Stop while popup is rendering', async env => {
    const state = guided(env, { delay: 1000 }); state.host.text = 'Switch to full version';
    env.later(250, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(env.handler.ensureCustomMode(), /aborted or paused/);
    assert.strictEqual(state.inner.clicks, 1); assert.strictEqual(state.exit, null);
  });
  await test('Full version missing popup/form stops with a useful diagnostic', async env => {
    const state = guided(env); state.host.text = 'Switch to full version'; state.inner.onClick = () => {};
    await assert.rejects(env.handler.ensureCustomMode(750), /Switch to full version did not produce/);
    assert.strictEqual(state.inner.clicks, 1);
  });
  console.log(`GUIDED MODE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exitCode = 1;
})();
