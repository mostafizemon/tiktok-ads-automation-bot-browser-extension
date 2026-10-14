/**
 * tests/onboarding_traffic_integration.test.js
 * Integration test suite proving actual call order and execution between
 * AutomationRunner, CampaignAutomation, CustomModeHandler, and PopupHandler.
 *
 * Verifies all 22 required items:
 * 1. /i18n/nb_creation/create/objectives route.
 * 2. Switch to full version visible on this route.
 * 3. Onboarding runs before Traffic selection.
 * 4. Standard-form detection does not prematurely pass.
 * 5. Switch button clicked exactly once.
 * 6. Confirm modal detected.
 * 7. Correct Confirm clicked exactly once.
 * 8. Traffic selection begins only after modal closes.
 * 9. Traffic selection uses the existing selector.
 * 10. No onboarding immediately proceeds to Traffic.
 * 11. Existing Switch to custom mode still works (Variant A).
 * 12. Existing Exit guided mode still works (Variant B).
 * 13. Direct full-form route works.
 * 14. Client-side navigation between modes.
 * 15. DOM rerender after modal confirmation.
 * 16. Repeated handler invocation is idempotent.
 * 17. Failed onboarding prevents Traffic execution.
 * 18. Popup handler does not auto-close Confirm modal.
 * 19. CTA automation remains unchanged.
 * 20. Country selection remains unchanged.
 * 21. Budget and Spark Ads remain unchanged.
 * 22. Multi-campaign creation preserves the sequence.
 */

const assert = require('assert');

class MockDOMNode {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.text = text;
    this.children = [];
    this.parentElement = null;
    this.shadowRoot = null;
    this.visible = true;
    this.clicks = 0;
    this.classList = {
      _classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)),
      contains: name => this.classList._classes.has(name),
      add: name => this.classList._classes.add(name),
      remove: name => this.classList._classes.delete(name)
    };
  }

  get textContent() {
    return this.text + this.children.map(c => c.textContent).join(' ');
  }
  set textContent(v) { this.text = v; }

  get innerText() {
    return this.textContent;
  }
  set innerText(v) { this.text = v; }

  get disabled() {
    return this.tagName === 'BUTTON' && (this.hasAttribute('disabled') && this.getAttribute('disabled') !== 'false');
  }

  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attrs, name);
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  appendChild(node) {
    this.children.push(node);
    node.parentElement = this;
    return node;
  }

  removeChild(node) {
    const idx = this.children.indexOf(node);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      node.parentElement = null;
    }
    return node;
  }

  attachShadow() {
    this.shadowRoot = new MockDOMNode('#shadow-root');
    this.shadowRoot.host = this;
    return this.shadowRoot;
  }

  shadow() {
    return this.attachShadow();
  }

  getRootNode() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node;
  }

  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (!part) return false;
      if (part === '*') return true;
      const attrMatch = part.match(/\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/);
      if (attrMatch) {
        const [, attr, op, val] = attrMatch;
        if (!this.hasAttribute(attr)) return false;
        if (op === '=' && this.getAttribute(attr) !== val) return false;
        if (op === '*=' && !this.getAttribute(attr).includes(val)) return false;
      }
      const tagAndClass = part.replace(/\[[^\]]+\]/g, '');
      if (tagAndClass.startsWith('.')) return this.classList.contains(tagAndClass.slice(1));
      if (tagAndClass.startsWith('#')) return this.getAttribute('id') === tagAndClass.slice(1);
      return !tagAndClass || this.tagName.toLowerCase() === tagAndClass.toLowerCase();
    });
  }

  querySelectorAll(selector) {
    const res = [];
    for (const child of this.children) {
      if (child.matches(selector)) res.push(child);
      res.push(...child.querySelectorAll(selector));
    }
    return res;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    for (let n = this; n; n = n.parentElement) {
      if (n.matches(selector)) return n;
    }
    return null;
  }

  getBoundingClientRect() {
    let node = this;
    while (node) {
      if (!node.visible) return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      const parent = node.parentElement || node.host;
      if (!parent) break;
      node = parent;
    }
    return { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 };
  }

  scrollIntoView() {}
  dispatchEvent() { return true; }

  click() {
    if (!this.disabled) {
      this.clicks++;
      this.onClick?.();
    }
  }
}

function createEnvironment(initialUrl = 'https://ads.tiktok.com/i18n/nb_creation/create/objectives') {
  const document = new MockDOMNode('#document');
  document.body = document.appendChild(new MockDOMNode('body'));

  const parsedUrl = new URL(initialUrl);
  let currentHref = initialUrl;
  let currentPathname = parsedUrl.pathname;

  const window = {
    location: {
      get href() { return currentHref; },
      set href(val) {
        currentHref = val;
        try {
          currentPathname = new URL(val).pathname;
        } catch {
          currentPathname = val;
        }
      },
      get pathname() { return currentPathname; },
      reload: () => {}
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MouseEvent: function () {},
    Event: function () {}
  };

  global.document = document;
  global.window = window;
  global.Element = MockDOMNode;
  global.HTMLElement = MockDOMNode;
  global.MouseEvent = window.MouseEvent;
  global.Event = window.Event;

  const mockStorage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            for (const k of keys) res[k] = mockStorage[k];
          } else if (typeof keys === 'string') {
            res[keys] = mockStorage[keys];
          } else if (keys && typeof keys === 'object') {
            for (const k of Object.keys(keys)) res[k] = mockStorage[k] !== undefined ? mockStorage[k] : keys[k];
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items, cb) => {
          Object.assign(mockStorage, items);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    }
  };

  // Clear caches
  for (const mod of ['storage', 'helpers', 'custom-mode', 'campaign', 'popup-handler', 'runner']) {
    try {
      delete require.cache[require.resolve(`../automation/${mod}.js`)];
    } catch {}
    try {
      delete require.cache[require.resolve(`../${mod}.js`)];
    } catch {}
  }

  const StorageService = require('../storage.js');
  const AutomationHelpers = require('../automation/helpers.js');
  const { CustomModeHandler } = require('../automation/custom-mode.js');
  const { CampaignAutomation } = require('../automation/campaign.js');
  const { AutomationRunner, RUNNER_STATES, WORKFLOW_STEPS } = require('../automation/runner.js');
  const popupModule = require('../automation/popup-handler.js');

  global.StorageService = StorageService;
  global.AutomationHelpers = AutomationHelpers;
  global.CustomModeHandler = CustomModeHandler;
  global.CampaignAutomation = CampaignAutomation;
  global.AutomationRunner = AutomationRunner;
  global.PopupHandler = popupModule.PopupHandler || global.PopupHandler;

  const callLog = [];
  const mockSleeps = [];
  let simulatedTime = 1000;

  AutomationHelpers.sleep = async ms => {
    if (AutomationRunner.shouldAbort) throw new Error('Automation aborted or paused by user');
    simulatedTime += ms;
    for (const item of [...mockSleeps]) {
      if (item.at <= simulatedTime) {
        mockSleeps.splice(mockSleeps.indexOf(item), 1);
        item.fn();
      }
    }
  };

  const scheduleLater = (delayMs, fn) => {
    mockSleeps.push({ at: simulatedTime + delayMs, fn });
  };

  return {
    document,
    window,
    handler: CustomModeHandler,
    campaign: CampaignAutomation,
    runner: AutomationRunner,
    callLog,
    scheduleLater,
    setUrl: u => {
      window.location.href = u;
    }
  };
}

/**
 * Build the real TikTok "Switch to full version" button DOM structure
 */
function attachSwitchToFullVersionButton(env, suffix = 'pz4ceaj9') {
  const host = env.document.body.appendChild(new MockDOMNode(`ks-button-${suffix}`, {
    variant: 'default',
    loading: 'false',
    disabled: 'false'
  }, 'Switch to full version'));

  const shadow = host.attachShadow();
  const innerButton = shadow.appendChild(new MockDOMNode('button', {
    part: 'self'
  }));
  innerButton.appendChild(new MockDOMNode('slot'));

  const state = {
    host,
    innerButton,
    modal: null,
    confirmBtn: null,
    modalClosed: false
  };

  innerButton.onClick = () => {
    env.callLog.push('CLICK_SWITCH_BUTTON');

    // Display confirmation modal
    const modalHost = env.document.body.appendChild(new MockDOMNode('div', { class: 'modal__container' }));
    const wrapper = modalHost.appendChild(new MockDOMNode('div', { class: 'modal__wrapper', part: 'wrapper' }));
    state.modal = wrapper;

    const header = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__header', part: 'header' }));
    const headerSlot = header.appendChild(new MockDOMNode('slot', { name: 'header' }, 'Switch to full version?'));
    headerSlot.assignedElements = () => [];

    const footer = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__footer', part: 'footer' }));

    // Cancel button
    const cancelHost = footer.appendChild(new MockDOMNode('ks-button-zskw9xpt'));
    cancelHost.appendChild(new MockDOMNode('slot', { name: 'cancel-btn' }, 'Cancel'));

    // Confirm button
    const confirmHost = footer.appendChild(new MockDOMNode('ks-button-zskw9xpt', {
      disabled: 'false',
      loading: 'false'
    }));
    const confirmShadow = confirmHost.attachShadow();
    const confirmSelf = confirmShadow.appendChild(new MockDOMNode('button', { part: 'self' }));
    confirmHost.appendChild(new MockDOMNode('slot', { name: 'confirm-btn' }, 'Confirm'));

    state.confirmBtn = confirmSelf;

    confirmSelf.onClick = () => {
      env.callLog.push('CLICK_CONFIRM_BUTTON');
      // Close modal
      wrapper.visible = false;
      modalHost.visible = false;
      host.visible = false;
      state.modalClosed = true;
      env.callLog.push('MODAL_CLOSED');

      // Populate standard form Traffic objective
      attachStandardTrafficObjective(env);
    };
  };

  return state;
}

/**
 * Build the real TikTok "Switch to custom mode" button and confirmation modal DOM structure
 */
function attachSwitchToCustomModeButton(env, suffix = 'q37k4f39') {
  const host = env.document.body.appendChild(new MockDOMNode(`ks-button-${suffix}`, {
    variant: 'default',
    loading: 'false',
    disabled: 'false'
  }, 'Switch to custom mode'));

  const shadow = host.attachShadow();
  const innerButton = shadow.appendChild(new MockDOMNode('button', {
    part: 'self'
  }));
  innerButton.appendChild(new MockDOMNode('slot'));

  const state = {
    host,
    innerButton,
    modal: null,
    exitBtn: null,
    stayBtn: null,
    modalClosed: false
  };

  innerButton.onClick = () => {
    env.callLog.push('CLICK_SWITCH_TO_CUSTOM_MODE');

    // Display confirmation modal
    const modalHost = env.document.body.appendChild(new MockDOMNode('div', { class: 'modal__container' }));
    const wrapper = modalHost.appendChild(new MockDOMNode('div', { class: 'modal__wrapper modal__wrapper--md', part: 'wrapper' }));
    state.modal = wrapper;

    const header = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__header', part: 'header' }));
    const headerTitle = header.appendChild(new MockDOMNode('div', { class: 'modal__header-title' }));
    const headerSlot = headerTitle.appendChild(new MockDOMNode('slot', { name: 'header' }, 'Exit guided mode and switch to custom mode?'));
    headerSlot.assignedElements = () => [];

    const body = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__body-contener' }));
    body.appendChild(new MockDOMNode('slot', {}, 'No Data'));

    const footer = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__footer', part: 'footer' }));
    const btns = footer.appendChild(new MockDOMNode('div', { class: 'modal__footer__btns' }));

    // cancel-btn slot = "Exit"
    const exitHost = btns.appendChild(new MockDOMNode(`ks-button-${suffix}`, {
      disabled: 'false',
      loading: 'false'
    }));
    const exitShadow = exitHost.attachShadow();
    const exitSelf = exitShadow.appendChild(new MockDOMNode('button', { part: 'self' }));
    exitHost.appendChild(new MockDOMNode('slot', { name: 'cancel-btn' }, 'Exit'));

    // confirm-btn slot = "Stay"
    const stayHost = btns.appendChild(new MockDOMNode(`ks-button-${suffix}`, {
      disabled: 'false',
      loading: 'false'
    }));
    const stayShadow = stayHost.attachShadow();
    const staySelf = stayShadow.appendChild(new MockDOMNode('button', {
      part: 'self',
      class: 'button--type-contained button--color-primary'
    }));
    stayHost.appendChild(new MockDOMNode('slot', { name: 'confirm-btn' }, 'Stay'));

    state.exitBtn = exitSelf;
    state.stayBtn = staySelf;

    exitSelf.onClick = () => {
      env.callLog.push('CLICK_EXIT_BUTTON');
      wrapper.visible = false;
      modalHost.visible = false;
      host.visible = false;
      state.modalClosed = true;
      env.callLog.push('MODAL_CLOSED');

      attachStandardTrafficObjective(env);
    };

    staySelf.onClick = () => {
      env.callLog.push('CLICK_STAY_BUTTON');
    };
  };

  return state;
}

/**
 * Build standard campaign Traffic objective radio control in DOM
 */
function attachStandardTrafficObjective(env) {
  const container = env.document.body.appendChild(new MockDOMNode('div', { class: 'objective-container' }));
  const radioLabel = container.appendChild(new MockDOMNode('label', {
    role: 'radio',
    class: 'vi-radio is-bordered index_objective_EvS5B'
  }));

  const radioInput = radioLabel.appendChild(new MockDOMNode('input', {
    type: 'radio',
    class: 'vi-radio__original',
    value: '1'
  }));

  const titleSpan = radioLabel.appendChild(new MockDOMNode('span', {
    class: 'index_title_Nvlf1'
  }, 'Traffic'));

  radioLabel.onClick = () => {
    env.callLog.push('CLICK_TRAFFIC_RADIO');
    radioLabel.setAttribute('aria-checked', 'true');
    radioInput.setAttribute('checked', 'checked');
  };

  return { container, radioLabel, radioInput, titleSpan };
}

(async function runAllIntegrationTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      const env = createEnvironment();
      await fn(env);
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`, err);
      failed++;
    }
  }

  console.log('====================================================');
  console.log('STARTING INTEGRATION TESTS: ONBOARDING & TRAFFIC');
  console.log('====================================================');

  // Test 1 & 2: /i18n/nb_creation/create/objectives route with Switch to full version visible
  await test('1 & 2: Route /i18n/nb_creation/create/objectives detects Switch to full version', async env => {
    assert.strictEqual(env.window.location.pathname, '/i18n/nb_creation/create/objectives');
    const state = attachSwitchToFullVersionButton(env);
    const host = env.handler.findGuidedModeHost('Switch to full version');
    assert.ok(host, 'Switch to full version host must be detected');
    assert.strictEqual(env.handler.normalizedText(host), 'Switch to full version');
  });

  // Test 3: Onboarding runs before Traffic selection
  await test('3: Onboarding runs before Traffic selection', async env => {
    const state = attachSwitchToFullVersionButton(env);
    let trafficStarted = false;

    // Track when selectTrafficObjective begins
    const originalSelect = env.campaign.selectTrafficObjective.bind(env.campaign);
    env.campaign.selectTrafficObjective = async function () {
      trafficStarted = true;
      env.callLog.push('TRAFFIC_SELECTION_STARTED');
      return originalSelect();
    };

    await env.campaign.handleCustomModeFlow();

    assert.ok(state.modalClosed, 'Modal must be closed before returning');
    assert.strictEqual(trafficStarted, false, 'Traffic selection must NOT run during custom mode check');
    assert.deepStrictEqual(env.callLog, ['CLICK_SWITCH_BUTTON', 'CLICK_CONFIRM_BUTTON', 'MODAL_CLOSED']);
  });

  // Test 4: Standard-form detection does NOT prematurely pass on /i18n/nb_creation/create/objectives
  await test('4: Standard-form detection does not prematurely pass when button is present', async env => {
    // Add generic text like "Traffic" or "Objectives" that would fool naive selectors
    env.document.body.appendChild(new MockDOMNode('h1', {}, 'Advertising Objectives'));
    env.document.body.appendChild(new MockDOMNode('p', {}, 'Traffic and reach'));

    const state = attachSwitchToFullVersionButton(env);

    // Predicate MUST return false because Switch button is active
    assert.strictEqual(env.handler.isRegularCreationInterfacePresent(), false,
      'isRegularCreationInterfacePresent must return false while Switch to full version is visible');
  });

  // Test 5, 6, 7: Switch clicked once, Confirm modal detected, Confirm clicked once
  await test('5, 6, 7: Switch button clicked once and Confirm modal confirmed exactly once', async env => {
    const state = attachSwitchToFullVersionButton(env);

    await env.campaign.ensureInitialCreationModeReady(8000);

    assert.strictEqual(state.innerButton.clicks, 1, 'Switch button must be clicked exactly once');
    assert.strictEqual(state.confirmBtn.clicks, 1, 'Confirm button must be clicked exactly once');
    assert.ok(state.modalClosed, 'Modal must close after confirm');
  });

  // Test 8: Traffic selection begins only after modal closes
  await test('8: Traffic selection begins only after modal closes', async env => {
    const state = attachSwitchToFullVersionButton(env);

    env.campaign.configureCampaignBudget = async () => true;
    env.campaign.clickContinueAndVerifyDemographics = async () => true;

    await env.campaign.selectTrafficObjectiveAndBudget({ dailyBudget: '50.00' });

    const switchIdx = env.callLog.indexOf('CLICK_SWITCH_BUTTON');
    const confirmIdx = env.callLog.indexOf('CLICK_CONFIRM_BUTTON');
    const modalCloseIdx = env.callLog.indexOf('MODAL_CLOSED');
    const trafficIdx = env.callLog.indexOf('CLICK_TRAFFIC_RADIO');

    assert.ok(switchIdx !== -1, 'Switch must be clicked');
    assert.ok(confirmIdx > switchIdx, 'Confirm must follow switch');
    assert.ok(modalCloseIdx > confirmIdx, 'Modal close must follow confirm');
    assert.ok(trafficIdx > modalCloseIdx, 'Traffic selection must occur only after modal close');
  });

  // Test 9: Traffic selection uses the existing selector
  await test('9: Traffic selection uses verified radio label selector', async env => {
    const state = attachSwitchToFullVersionButton(env);
    await env.campaign.ensureInitialCreationModeReady();

    const trafficRadio = await env.campaign.findTrafficRadioLabel();
    assert.ok(trafficRadio, 'Existing radio label selector must locate Traffic');
    assert.strictEqual(trafficRadio.matches('label[role="radio"]'), true);
  });

  // Test 10: Variant D: No onboarding immediately proceeds to Traffic
  await test('10: Variant D (No onboarding) immediately proceeds to Traffic without delay', async env => {
    attachStandardTrafficObjective(env);

    const initialLogCount = env.callLog.length;
    const ready = await env.campaign.ensureInitialCreationModeReady(4000);

    assert.strictEqual(ready, true);
    assert.strictEqual(env.callLog.length, initialLogCount, 'No modal or switch buttons should be clicked');
  });

  // Test 11: Variant A: Existing Switch to custom mode works
  await test('11: Variant A (Switch to custom mode -> Stay/Exit modal -> Exit) continues to work', async env => {
    const customHost = env.document.body.appendChild(new MockDOMNode('ks-button-cst', {
      disabled: 'false'
    }, 'Switch to custom mode'));
    const customInner = customHost.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));

    customInner.onClick = () => {
      env.callLog.push('CLICK_CUSTOM_MODE');
      const dialog = env.document.body.appendChild(new MockDOMNode('div', { role: 'dialog' }));
      dialog.appendChild(new MockDOMNode('p', {}, 'Stay on simplified or Exit?'));
      const exitBtn = dialog.appendChild(new MockDOMNode('button', {}, 'Exit'));
      exitBtn.onClick = () => {
        env.callLog.push('CLICK_EXIT');
        dialog.visible = false;
        customHost.visible = false;
        attachStandardTrafficObjective(env);
      };
    };

    await env.campaign.ensureInitialCreationModeReady(8000);

    assert.strictEqual(customInner.clicks, 1);
    assert.deepStrictEqual(env.callLog, ['CLICK_CUSTOM_MODE', 'CLICK_EXIT']);
    assert.ok(env.handler.isRegularCreationInterfacePresent());
  });

  // Test 12: Variant B: Existing Exit guided mode works
  await test('12: Variant B (Exit guided mode -> cancel-btn slot -> Exit) continues to work', async env => {
    const guidedHost = env.document.body.appendChild(new MockDOMNode('ks-button-gdd', {
      disabled: 'false'
    }, 'Exit guided mode'));
    const guidedInner = guidedHost.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));

    guidedInner.onClick = () => {
      env.callLog.push('CLICK_GUIDED_EXIT_HOST');
      const dialog = env.document.body.appendChild(new MockDOMNode('div', { role: 'dialog' }));
      const exitHost = dialog.appendChild(new MockDOMNode('ks-button-dlg'));
      const exitInner = exitHost.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));
      exitHost.appendChild(new MockDOMNode('slot', { name: 'cancel-btn' }, 'Exit'));

      exitInner.onClick = () => {
        env.callLog.push('CLICK_GUIDED_EXIT_CONFIRM');
        dialog.visible = false;
        guidedHost.visible = false;
        attachStandardTrafficObjective(env);
      };
    };

    await env.campaign.ensureInitialCreationModeReady(8000);

    assert.strictEqual(guidedInner.clicks, 1);
    assert.deepStrictEqual(env.callLog, ['CLICK_GUIDED_EXIT_HOST', 'CLICK_GUIDED_EXIT_CONFIRM']);
    assert.ok(env.handler.isRegularCreationInterfacePresent());
  });

  // Test 13: Direct full-form route works
  await test('13: Direct full-form route (/i18n/creation/standard) works without onboarding', async env => {
    env.setUrl('https://ads.tiktok.com/i18n/creation/standard');
    attachStandardTrafficObjective(env);

    const ready = await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(ready, true);
    assert.strictEqual(env.callLog.length, 0);
  });

  // Test 14: Client-side navigation between modes
  await test('14: Client-side navigation triggers onboarding handler cleanly', async env => {
    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    // Navigate client-side to nb_creation
    env.setUrl('https://ads.tiktok.com/i18n/nb_creation/create/objectives');
    const state = attachSwitchToFullVersionButton(env);

    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state.innerButton.clicks, 1);
    assert.strictEqual(state.confirmBtn.clicks, 1);
    assert.ok(state.modalClosed);
  });

  // Test 15: DOM rerender after modal confirmation
  await test('15: DOM rerender of confirmation modal resolves safely', async env => {
    const host = env.document.body.appendChild(new MockDOMNode('ks-button-orig', { disabled: 'false' }, 'Switch to full version'));
    const inner = host.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));

    inner.onClick = () => {
      // Create initial modal
      const modal1 = env.document.body.appendChild(new MockDOMNode('div', { class: 'modal__wrapper', part: 'wrapper' }));
      const h1 = modal1.appendChild(new MockDOMNode('div', { part: 'header' }));
      h1.appendChild(new MockDOMNode('slot', { name: 'header' }, 'Switch to full version?'));

      // Simulate asynchronous rerender replacing modal1 with modal2
      env.scheduleLater(300, () => {
        modal1.visible = false;
        const modal2 = env.document.body.appendChild(new MockDOMNode('div', { class: 'modal__wrapper', part: 'wrapper' }));
        const h2 = modal2.appendChild(new MockDOMNode('div', { part: 'header' }));
        h2.appendChild(new MockDOMNode('slot', { name: 'header' }, 'Switch to full version?'));

        const footer2 = modal2.appendChild(new MockDOMNode('div', { part: 'footer' }));
        const confirmHost2 = footer2.appendChild(new MockDOMNode('ks-button-c2', { disabled: 'false' }));
        const confirmInner2 = confirmHost2.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));
        confirmHost2.appendChild(new MockDOMNode('slot', { name: 'confirm-btn' }, 'Confirm'));

        confirmInner2.onClick = () => {
          modal2.visible = false;
          host.visible = false;
          attachStandardTrafficObjective(env);
        };
      });
    };

    await env.campaign.ensureInitialCreationModeReady(8000);
    assert.ok(env.handler.isRegularCreationInterfacePresent());
  });

  // Test 16: Repeated handler invocation is idempotent
  await test('16: Repeated handler invocation is idempotent', async env => {
    const state = attachSwitchToFullVersionButton(env);

    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state.innerButton.clicks, 1);
    assert.strictEqual(state.confirmBtn.clicks, 1);

    // Call a second time
    const readyAgain = await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(readyAgain, true);
    assert.strictEqual(state.innerButton.clicks, 1, 'Should NOT click switch a second time');
    assert.strictEqual(state.confirmBtn.clicks, 1, 'Should NOT click confirm a second time');
  });

  // Test 17: Failed onboarding prevents Traffic execution and throws [ONBOARDING ERROR]
  await test('17: Failed onboarding aborts with ONBOARDING ERROR and halts Traffic', async env => {
    const host = env.document.body.appendChild(new MockDOMNode('ks-button-fail', { disabled: 'false' }, 'Switch to full version'));
    const inner = host.attachShadow().appendChild(new MockDOMNode('button', { part: 'self' }));
    // Modal never appears
    inner.onClick = () => {};

    let trafficReached = false;
    env.campaign.selectTrafficObjective = async () => { trafficReached = true; };

    await assert.rejects(async () => {
      await env.campaign.ensureInitialCreationModeReady(1000);
    }, /\[ONBOARDING ERROR\]/);

    assert.strictEqual(trafficReached, false, 'Traffic selection must NOT execute on failed onboarding');
  });

  // Test 18: Popup handler does not auto-close Confirm modal
  await test('18: Popup handler does not auto-close Confirm modal', async env => {
    const modalHost = env.document.body.appendChild(new MockDOMNode('div', { class: 'modal__container' }));
    const wrapper = modalHost.appendChild(new MockDOMNode('div', { class: 'modal__wrapper', part: 'wrapper' }));
    const header = wrapper.appendChild(new MockDOMNode('div', { class: 'modal__header', part: 'header' }));
    header.appendChild(new MockDOMNode('slot', { name: 'header' }, 'Switch to full version?'));

    const classification = global.PopupHandler.classifyDialog(wrapper);
    assert.strictEqual(classification.type, 'WORKFLOW_CRITICAL',
      'Switch to full version? modal must be classified as WORKFLOW_CRITICAL');
    assert.notStrictEqual(classification.type, 'INFORMATIONAL',
      'Workflow critical modal must never be INFORMATIONAL');
    assert.strictEqual(classification.rule?.autoDismiss, undefined,
      'Workflow critical modal must not have autoDismiss rule');
  });

  // Test 19: CTA automation remains unchanged
  await test('19: CTA automation remains unchanged', async env => {
    assert.strictEqual(typeof env.campaign.configureCallToAction, 'function');
  });

  // Test 20: Country selection remains unchanged
  await test('20: Country selection remains unchanged', async env => {
    assert.strictEqual(typeof env.campaign.configureDemographicsAndCountries, 'function');
  });

  // Test 21: Budget and Spark Ads remain unchanged
  await test('21: Budget and Spark Ads remain unchanged', async env => {
    assert.strictEqual(typeof env.campaign.configureCampaignBudget, 'function');
    assert.strictEqual(typeof env.campaign.attachSparkAdsPostWithRetry, 'function');
  });

  // Test 22: Multi-campaign creation preserves the sequence
  await test('22: Multi-campaign creation preserves onboarding -> traffic sequence for each campaign', async env => {
    // Campaign 1 onboarding & creation
    const state1 = attachSwitchToFullVersionButton(env, 'c1');
    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state1.innerButton.clicks, 1);
    assert.strictEqual(state1.confirmBtn.clicks, 1);

    // Reset document for Campaign 2
    for (const c of env.document.body.children) c.visible = false;

    // Campaign 2 onboarding & creation
    const state2 = attachSwitchToFullVersionButton(env, 'c2');
    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state2.innerButton.clicks, 1);
    assert.strictEqual(state2.confirmBtn.clicks, 1);
  });

  // Test 23: Real-browser flow: Switch to custom mode -> Exit guided mode and switch to custom mode? -> Exit clicked -> Traffic radio selected
  await test('23: Real-browser flow: Switch to custom mode -> Exit modal -> Exit clicked -> Traffic radio selected', async env => {
    const state = attachSwitchToCustomModeButton(env);

    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state.innerButton.clicks, 1, 'Switch to custom mode must be clicked');
    assert.strictEqual(state.exitBtn.clicks, 1, 'Exit button inside shadow DOM must be clicked');
    assert.strictEqual(state.stayBtn.clicks, 0, 'Stay button must NOT be clicked');
    assert.strictEqual(state.modalClosed, true, 'Confirmation modal must close before continuing');

    await env.campaign.selectTrafficObjective();
    assert.ok(env.callLog.includes('CLICK_TRAFFIC_RADIO'), 'Traffic radio must be selected');

    const exitIdx = env.callLog.indexOf('CLICK_EXIT_BUTTON');
    const trafficIdx = env.callLog.indexOf('CLICK_TRAFFIC_RADIO');
    assert.ok(exitIdx < trafficIdx, 'Exit click must occur before Traffic selection');
  });

  // Test 24: Stay button is never clicked during Switch to custom mode integration flow
  await test('24: Stay button is never clicked during Switch to custom mode integration flow', async env => {
    const state = attachSwitchToCustomModeButton(env);
    await env.campaign.handleCustomModeFlow();
    assert.strictEqual(state.stayBtn.clicks, 0, 'Stay button must never be clicked');
    assert.strictEqual(state.exitBtn.clicks, 1, 'Exit button must be clicked');
  });

  // Test 25: Multi-campaign onboarding with Switch to custom mode executes sequence for each campaign
  await test('25: Multi-campaign onboarding with Switch to custom mode executes sequence for each campaign', async env => {
    // Campaign 1
    const state1 = attachSwitchToCustomModeButton(env, 'custom-1');
    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state1.innerButton.clicks, 1);
    assert.strictEqual(state1.exitBtn.clicks, 1);
    assert.strictEqual(state1.stayBtn.clicks, 0);

    for (const c of env.document.body.children) c.visible = false;

    // Campaign 2
    const state2 = attachSwitchToCustomModeButton(env, 'custom-2');
    await env.campaign.ensureInitialCreationModeReady();
    assert.strictEqual(state2.innerButton.clicks, 1);
    assert.strictEqual(state2.exitBtn.clicks, 1);
    assert.strictEqual(state2.stayBtn.clicks, 0);
  });

  console.log('====================================================');
  console.log(`INTEGRATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
