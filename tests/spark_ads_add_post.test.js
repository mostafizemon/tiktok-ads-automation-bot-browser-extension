/**
 * Confirm-button-only Add Post regression suite. No real browser or network calls.
 * Tests run with a deterministic polling clock and in-memory Chrome storage.
 */
const assert = require('assert');

// Minimal DOM node supporting open Shadow DOM and CSS queries
class MockNode {
  constructor(tagName = 'DIV', attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.shadowRoot = null;
    this._innerText = undefined;
    this._textContent = undefined;
    this.value = attrs.value || '';
    this.classList = {
      _classes: new Set((attrs.class || '').split(' ').filter(Boolean)),
      contains: (c) => this.classList._classes.has(c),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c)
    };
    this.disabled = !!attrs.disabled;
    this.style = { display: 'block', visibility: 'visible', opacity: '1' };
    this.eventListeners = {};
    this.parentElement = null;
  }

  get innerText() {
    if (this._innerText !== undefined) return this._innerText;
    if (this.children.length > 0) return this.children.map(c => c.innerText).filter(Boolean).join(' ');
    return '';
  }
  set innerText(val) {
    this._innerText = String(val);
  }

  get textContent() {
    if (this._textContent !== undefined) return this._textContent;
    return this.innerText;
  }
  set textContent(val) {
    this._textContent = String(val);
    this._innerText = String(val);
  }

  hasAttribute(attr) {
    return this.attributes[attr] !== undefined;
  }

  getAttribute(attr) {
    return this.attributes[attr] !== undefined ? this.attributes[attr] : null;
  }

  setAttribute(attr, val) {
    this.attributes[attr] = String(val);
    if (attr === 'disabled') this.disabled = true;
    if (attr === 'class') {
      this.classList._classes = new Set(String(val).split(' ').filter(Boolean));
    }
  }

  removeAttribute(attr) {
    delete this.attributes[attr];
    if (attr === 'disabled') this.disabled = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (curr.matchesSelector && curr.matchesSelector(sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matchesSelector(sel) {
    if (!sel) return false;
    const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts.some(p => this.matchesSelector(p));
    }
    const single = parts[0];
    if (single.startsWith('.')) {
      const classes = single.slice(1).split('.').filter(Boolean);
      return classes.every(c => this.classList.contains(c));
    }
    if (single.startsWith('#')) return this.getAttribute('id') === single.slice(1);
    if (single.includes('^=')) {
      const m = single.match(/\[([a-zA-Z0-9_-]+)\^=["']?([^"'\]]+)["']?\]/);
      if (m) {
        const attrVal = this.attributes[m[1]] || '';
        return attrVal.startsWith(m[2]);
      }
    }
    if (single.includes('*=')) {
      const m = single.match(/\[([a-zA-Z0-9_-]+)\*=["']?([^"'\]]+)["']?\]/);
      if (m) {
        const attrVal = m[1] === 'class' ? Array.from(this.classList._classes).join(' ') : this.attributes[m[1]];
        return !!(attrVal && attrVal.includes(m[2]));
      }
    }
    if (single.includes('=')) {
      const m = single.match(/\[([a-zA-Z0-9_-]+)=["']?([^"'\]]+)["']?\]/);
      if (m) {
        return this.attributes[m[1]] === m[2];
      }
    }
    return this.tagName.toLowerCase() === single.toLowerCase();
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  click() {
    if (this.disabled) return;
    let curr = this;
    while (curr) {
      if (curr.eventListeners['click']) {
        curr.eventListeners['click'].forEach(fn => fn({ type: 'click', target: this }));
      }
      curr = curr.parentElement;
    }
  }

  dispatchEvent(evt) {
    if (!evt) return true;
    const type = evt.type;
    let curr = this;
    while (curr) {
      if (curr.eventListeners[type]) {
        curr.eventListeners[type].forEach(fn => fn(evt));
      }
      if (!evt.options?.bubbles && !evt.bubbles) break;
      curr = curr.parentElement;
    }
    return true;
  }

  focus() {}
  blur() {}

  scrollIntoView() {}

  get isConnected() {
    let root = this;
    while (root.parentElement) root = root.parentElement;
    return root.tagName === '#DOCUMENT';
  }

  contains(node) {
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }

  getClientRects() {
    return this.isConnected && this.style.display !== 'none' ? [this.getBoundingClientRect()] : [];
  }

  getBoundingClientRect() {
    return { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 };
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selectorString) {
    const results = [];
    const subSelectors = selectorString.split(',').map(s => s.trim()).filter(Boolean);

    const matchSingle = (el, sel) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();

      if (sel === '*') return true;
      if (sel.toLowerCase() === tag) return true;

      if (sel.startsWith('.')) {
        const classes = sel.slice(1).split('.').filter(Boolean);
        return classes.every(c => el.classList.contains(c));
      }

      if (sel.includes('^=')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)\^=["']?([^"'\]]+)["']?\]/);
        if (m) {
          const attrVal = el.attributes[m[1]] || '';
          return attrVal.startsWith(m[2]);
        }
      }

      if (sel.includes('*=')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)\*=["']?([^"'\]]+)["']?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          const attrVal = attr === 'class' ? Array.from(el.classList._classes).join(' ') : el.attributes[attr];
          return attrVal && attrVal.includes(val);
        }
      }

      if (sel.includes('=')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)=["']?([^"'\]]+)["']?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          return el.attributes[attr] === val;
        }
      }

      if (sel.startsWith('[') && sel.endsWith(']')) {
        const attr = sel.slice(1, -1);
        return el.attributes[attr] !== undefined;
      }

      if (sel.includes('[')) {
        const tagPart = sel.slice(0, sel.indexOf('['));
        const rest = sel.slice(sel.indexOf('['));
        if (tagPart && tag !== tagPart.toLowerCase()) return false;
        return matchSingle(el, rest);
      }

      return false;
    };

    const traverse = (node) => {
      for (const sel of subSelectors) {
        if (matchSingle(node, sel)) {
          if (!results.includes(node)) results.push(node);
          break;
        }
      }
      for (const child of node.children) {
        traverse(child);
      }
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) {
          traverse(child);
        }
      }
    };

    for (const child of this.children) {
      traverse(child);
    }
    if (this.shadowRoot) {
      for (const child of this.shadowRoot.children) {
        traverse(child);
      }
    }

    return results;
  }
}

// Setup Node Mock Environment
function createMockEnvironment() {
  const storageStore = { local: {}, session: {} };

  const mockChrome = {
    runtime: {
      id: 'mock-tiktok-ads-extension-id',
      lastError: null,
      onMessage: { addListener: () => {} }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) keys.forEach(k => { if (storageStore.local[k] !== undefined) res[k] = storageStore.local[k]; });
          else if (typeof keys === 'string') { if (storageStore.local[keys] !== undefined) res[keys] = storageStore.local[keys]; }
          else Object.assign(res, storageStore.local);
          cb(res);
        },
        set: (items, cb) => {
          Object.assign(storageStore.local, items);
          if (cb) cb();
        },
        remove: (keys, cb) => {
          if (Array.isArray(keys)) keys.forEach(k => delete storageStore.local[k]);
          else delete storageStore.local[keys];
          if (cb) cb();
        }
      },
      session: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) keys.forEach(k => { if (storageStore.session[k]) res[k] = storageStore.session[k]; });
          cb(res);
        },
        set: (items, cb) => {
          Object.assign(storageStore.session, items);
          if (cb) cb();
        }
      }
    }
  };

  const mockDocument = new MockNode('#DOCUMENT');
  mockDocument.body = new MockNode('BODY');
  mockDocument.appendChild(mockDocument.body);

  let currentUrl = 'https://ads.tiktok.com/i18n/manage/campaign/create';

  const mockWindow = {
    location: {
      get href() { return currentUrl; },
      set href(val) { currentUrl = val; }
    },
    document: mockDocument,
    getComputedStyle: (el) => ({
      display: (el && el.style && el.style.display !== undefined) ? el.style.display : 'block',
      visibility: (el && el.style && el.style.visibility !== undefined) ? el.style.visibility : 'visible',
      opacity: (el && el.style && el.style.opacity !== undefined) ? el.style.opacity : '1'
    }),
    MouseEvent: function(type, options) {
      this.type = type;
      this.options = options;
      this.bubbles = !!options?.bubbles;
    },
    Event: function(type, options) {
      this.type = type;
      this.options = options;
      this.bubbles = !!options?.bubbles;
    },
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} }
  };

  global.Element = MockNode;
  global.HTMLElement = MockNode;
  global.chrome = mockChrome;
  global.window = mockWindow;
  global.document = mockDocument;
  global.getComputedStyle = mockWindow.getComputedStyle;
  global.MouseEvent = mockWindow.MouseEvent;
  global.Event = mockWindow.Event;

  // Clear require cache for clean state
  delete require.cache[require.resolve('../storage.js')];
  delete require.cache[require.resolve('../automation/helpers.js')];
  delete require.cache[require.resolve('../automation/campaign.js')];
  delete require.cache[require.resolve('../automation/runner.js')];

  const StorageService = require('../storage.js');
  const AutomationHelpers = require('../automation/helpers.js');
  const { CampaignAutomation } = require('../automation/campaign.js');
  const { AutomationRunner, AutomationRunnerClass, RUNNER_STATES, WORKFLOW_STEPS } = require('../automation/runner.js');

  global.StorageService = StorageService;
  global.AutomationHelpers = AutomationHelpers;
  global.CampaignAutomation = CampaignAutomation;
  global.AutomationRunner = AutomationRunner;

  return {
    StorageService,
    AutomationHelpers,
    CampaignAutomation,
    AutomationRunner,
    AutomationRunnerClass,
    mockDocument,
    setUrl: (u) => { currentUrl = u; },
    cleanUp: () => {}
  };
}

// Exact Confirm HTML supplied from TikTok Ads Manager. Keep both fixtures verbatim.
const DISABLED_CONFIRM_HTML = `<button data-v-7579d5ab=""
  data-testid="hybrid-drawer-footer-submit-button"
  disabled="disabled"
  type="button"
  class="vi-button vi-byted-button vi-button--primary is-disabled">
  <span>Confirm</span>
</button>`;
const ENABLED_CONFIRM_HTML = `<button data-v-7579d5ab=""
  data-testid="hybrid-drawer-footer-submit-button"
  type="button"
  class="vi-button vi-byted-button vi-button--primary">
  <span>Confirm</span>
</button>`;

// Materialize these two button/span fixtures in the existing mock DOM; no general HTML parser needed.
function applyConfirmHtml(button, html) {
  const match = html.match(/^<button\s+([^>]+)>\s*<span>(Confirm)<\/span>\s*<\/button>$/);
  assert.ok(match, 'Expected the exact button/span fixture structure');
  for (const name of Object.keys(button.attributes)) button.removeAttribute(name);
  for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
    button.setAttribute(attribute[1], attribute[2]);
  }
  for (const child of [...button.children]) button.removeChild(child);
  button._innerText = undefined;
  button._textContent = undefined;
  const span = new MockNode('SPAN');
  span.textContent = match[2];
  button.appendChild(span);
  return button;
}

// UI Fixture Builder
function buildDrawerFixture(mockDocument) {
  // 1. Creative Assets Header on main page
  const header = new MockNode('DIV', { id: 'spp_creative_assets_header' });
  header.innerText = 'Creative Assets';
  mockDocument.body.appendChild(header);

  // 2. Drawer with role="dialog" matching real TikTok Ads Manager drawer DOM
  const drawer = new MockNode('DIV', { role: 'dialog', class: 'byted-drawer hybrid-drawer' });
  drawer.innerText = 'Creative Assets Drawer';
  mockDocument.body.appendChild(drawer);

  // 3. Tab: TikTok posts
  const tab = new MockNode('DIV', { role: 'tab', class: 'tab-item' });
  tab.innerText = 'TikTok posts';
  drawer.appendChild(tab);

  // 4. Top Add post button
  const addPostBtn = new MockNode('BUTTON', { 'data-testid': 'tab-mixed-post-tab-mixed-post-kQtpVD' });
  addPostBtn.innerText = 'Add post';
  drawer.appendChild(addPostBtn);

  // 5. Drawer footer Confirm button (disabled initially)
  const confirmBtn = new MockNode('BUTTON', { 'data-testid': 'hybrid-drawer-footer-submit-button', disabled: 'true' });
  confirmBtn.innerText = 'Confirm';
  confirmBtn.addEventListener('click', () => {
    drawer.style.display = 'none';
    const media = new MockNode('IMG', { class: 'video-cover', src: 'https://p16.tiktokcdn.com/test.jpg' });
    header.appendChild(media);
  });
  drawer.appendChild(confirmBtn);

  return { header, drawer, tab, addPostBtn, confirmBtn };
}

// Modal Fixture Builder
function buildModalFixture(mockDocument) {
  const modal = new MockNode('DIV', { role: 'dialog', class: 'byted-modal' });
  modal.innerText = 'TikTok Post Authorization';

  const textarea = new MockNode('TEXTAREA', { 'data-testid': 'multiple-input-to-tag-index-wSVv3f' });
  modal.appendChild(textarea);

  const continueBtn = new MockNode('BUTTON', { 'data-testid': 'native-batch-authorize-index-wZkvDo' });
  continueBtn.innerText = 'Continue';
  modal.appendChild(continueBtn);

  const addPostsBtn = new MockNode('BUTTON', { 'data-testid': 'native-batch-authorize-index-qXWhEZ' });
  addPostsBtn.innerText = 'Add TikTok posts';
  modal.appendChild(addPostsBtn);

  mockDocument.body.appendChild(modal);

  return { modal, textarea, continueBtn, addPostsBtn };
}

// Helper: Add post card to drawer matching real TikTok DOM
function addPostCard(drawer, isSelected = false) {
  const item = new MockNode('DIV', {
    class: 'item',
    'data-testid': 'tab-tab-common-skeleton-d3JhdZ-7611878030172278037',
    'data-tea-tab': 'tiktok_mixed_post'
  });
  const container = new MockNode('DIV', { class: isSelected ? 'container selected' : 'container' });
  const label = new MockNode('LABEL', {
    'data-testid': 'card-index-bqEQYC',
    role: 'checkbox',
    class: isSelected ? 'vi-checkbox cardCheckbox checkbox is-checked' : 'vi-checkbox cardCheckbox checkbox'
  });
  if (isSelected) label.setAttribute('aria-checked', 'true');
  const span = new MockNode('SPAN', {
    class: isSelected ? 'vi-checkbox__input is-checked' : 'vi-checkbox__input',
    'aria-checked': 'mixed'
  });
  label.appendChild(span);
  container.appendChild(label);
  item.appendChild(container);
  drawer.appendChild(item);
  return { item, container, label, checkbox: label };
}

function authorizationFixture(env, { enabledAt = 1, missing = false, processing = false, error = '', ambiguous = false, exactHtml = false } = {}) {
  const { CampaignAutomation: campaign, mockDocument: doc } = env;
  const { drawer, confirmBtn, addPostBtn } = buildDrawerFixture(doc);
  drawer.setAttribute('role', 'dialog');
  if (exactHtml) applyConfirmHtml(confirmBtn, DISABLED_CONFIRM_HTML);
  if (missing) drawer.removeChild(confirmBtn);
  const counts = { add: 0, continued: 0, authorized: 0, confirmed: 0, codes: [], modal: null };
  for (const method of ['findPostItemsInDrawer', 'findMatchingPostItems', 'isTikTokPostDrawerEmpty', 'selectPostInDrawer']) {
    campaign[method] = () => { throw new Error(`Forbidden post-card dependency: ${method}`); };
  }

  let postCard = null;
  const setSelected = (selected = true) => {
    if (postCard?.item?.parentElement) {
      drawer.removeChild(postCard.item);
    }
    postCard = addPostCard(drawer, selected);
    return postCard;
  };

  if (enabledAt <= 0) {
    setSelected(true);
  } else {
    setSelected(false);
  }

  // Replace fixture close handler to test both completed and ambiguous confirmation.
  confirmBtn.eventListeners.click = [() => {
    counts.confirmed++;
    if (!ambiguous) {
      drawer.style.display = 'none';
      const media = new MockNode('IMG', { class: 'video-cover' });
      doc.body.appendChild(media);
    }
  }];
  addPostBtn.addEventListener('click', () => {
    assert.ok(!counts.modal?.isConnected, 'Must not overlap authorization modals');
    counts.add++;
    const { modal, textarea, continueBtn, addPostsBtn } = buildModalFixture(doc);
    counts.modal = modal;
    addPostsBtn.style.display = 'none';
    continueBtn.addEventListener('click', () => {
      counts.continued++;
      counts.codes.push(textarea.value);
      if (error) {
        modal.innerText = error;
      } else {
        addPostsBtn.style.display = 'block';
      }
    });
    addPostsBtn.addEventListener('click', () => {
      counts.authorized++;
      if (!processing) modal.parentElement.removeChild(modal);
      if (counts.add >= enabledAt) {
        if (!confirmBtn.parentElement) drawer.appendChild(confirmBtn);
        if (exactHtml) applyConfirmHtml(confirmBtn, ENABLED_CONFIRM_HTML);
        else confirmBtn.removeAttribute('disabled');
        setSelected(true);
      } else {
        setSelected(false);
      }
    });
  });
  return { drawer, confirmBtn, addPostBtn, counts, setSelected };
}

async function runAllTests() {
  let passed = 0;
  let failed = 0;
  const realNow = Date.now;
  async function test(name, fn) {
    let now = 1000;
    Date.now = () => now;
    const env = createMockEnvironment();
    env.onSleep = null;
    env.AutomationHelpers.sleep = async (ms) => {
      if (env.AutomationHelpers.isAborted()) throw new Error('Automation aborted or paused by user');
      now += ms;
      if (env.onSleep) await env.onSleep(ms);
      if (env.AutomationHelpers.isAborted()) throw new Error('Automation aborted or paused by user');
    };
    await env.StorageService.saveJobState({ runId: 'run_test', status: 'RUNNING', currentCampaignIndex: 1, totalCampaigns: 2 });
    try {
      await fn(env);
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (error) {
      console.error(`❌ [FAIL] ${name}: ${error.stack}`);
      failed++;
    } finally {
      Date.now = realNow;
    }
  }

  await test('Exact disabled HTML: disabled attribute and is-disabled class each block Confirm', async env => {
    const { drawer, confirmBtn, counts } = authorizationFixture(env, { exactHtml: true });
    assert.strictEqual(confirmBtn.getAttribute('data-v-7579d5ab'), '');
    assert.strictEqual(confirmBtn.getAttribute('disabled'), 'disabled');
    assert.strictEqual(confirmBtn.children[0].tagName, 'SPAN');
    assert.strictEqual(confirmBtn.textContent, 'Confirm');
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    confirmBtn.removeAttribute('disabled');
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    applyConfirmHtml(confirmBtn, DISABLED_CONFIRM_HTML);
    confirmBtn.classList.remove('is-disabled');
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('Exact enabled HTML is detected only when visible in the active drawer', async env => {
    const { drawer, confirmBtn, counts } = authorizationFixture(env, { exactHtml: true });
    applyConfirmHtml(confirmBtn, ENABLED_CONFIRM_HTML);
    assert.strictEqual(confirmBtn.hasAttribute('disabled'), false);
    assert.strictEqual(confirmBtn.classList.contains('is-disabled'), false);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), confirmBtn);
    confirmBtn.style.display = 'none';
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    confirmBtn.style.display = 'block';
    const otherDialog = new MockNode('DIV', { role: 'dialog' });
    env.mockDocument.body.appendChild(otherDialog);
    drawer.removeChild(confirmBtn);
    otherDialog.appendChild(confirmBtn);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('Exact disabled HTML becomes enabled during settling without reauthorizing', async env => {
    const { confirmBtn, counts, setSelected } = authorizationFixture(env, { exactHtml: true, enabledAt: Infinity });
    let polls = 0;
    env.onSleep = async () => {
      const job = await env.StorageService.getJobState();
      if (job.addPostPhase === 'AWAITING_CONFIRM' && ++polls === 2) {
        applyConfirmHtml(confirmBtn, ENABLED_CONFIRM_HTML);
        setSelected(true);
      }
    };
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('SAME_CODE');
    assert.strictEqual(counts.add, 1);
    assert.strictEqual(counts.confirmed, 1);
  });

  await test('Exact HTML: disabled first attempt retries same code; enabled second attempt confirms once', async env => {
    const { confirmBtn, counts } = authorizationFixture(env, { exactHtml: true, enabledAt: 2 });
    const result = await env.CampaignAutomation.attachSparkAdsPostWithRetry('SAME_CODE');
    assert.strictEqual(result.attempts, 2);
    assert.deepStrictEqual(counts.codes, ['SAME_CODE', 'SAME_CODE']);
    assert.strictEqual(confirmBtn.getAttribute('class'), 'vi-button vi-byted-button vi-button--primary');
    assert.strictEqual(counts.confirmed, 1);
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('SAME_CODE');
    assert.strictEqual(counts.add, 2);
    assert.strictEqual(counts.confirmed, 1);
  });

  await test('Exact disabled HTML for all five attempts exhausts without a Confirm click', async env => {
    const { counts } = authorizationFixture(env, { exactHtml: true, enabledAt: Infinity });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('SAME_CODE'), { code: 'POST_RETRY_EXHAUSTED' });
    assert.strictEqual(counts.add, 5);
    assert.deepStrictEqual(counts.codes, Array(5).fill('SAME_CODE'));
    assert.strictEqual(counts.confirmed, 0);
  });

  for (const [name, enabledAt, missing] of [
    ['Confirm enabled after first attempt', 1, false],
    ['Confirm disabled once, enabled after second attempt', 2, false],
    ['Confirm missing twice, enabled after third attempt', 3, true],
    ['Confirm enabled on fifth attempt succeeds', 5, false]
  ]) {
    await test(name, async env => {
      const { counts } = authorizationFixture(env, { enabledAt, missing });
      const result = await env.CampaignAutomation.attachSparkAdsPostWithRetry('SAME_SECRET_CODE', 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.attempts, enabledAt);
      assert.strictEqual(counts.add, enabledAt);
      assert.strictEqual(counts.continued, enabledAt);
      assert.strictEqual(counts.authorized, enabledAt);
      assert.strictEqual(counts.confirmed, 1);
      assert.deepStrictEqual(counts.codes, Array(enabledAt).fill('SAME_SECRET_CODE'));
      const job = await env.StorageService.getJobState();
      assert.strictEqual(job.addPostAttemptCount, enabledAt);
      assert.strictEqual(job.addPostPhase, 'COMPLETED');
    });
  }

  await test('Disabled for five attempts stops; reinvocation cannot reset the counter', async env => {
    const { counts } = authorizationFixture(env, { enabledAt: Infinity });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE', 1), {
      code: 'POST_RETRY_EXHAUSTED', message: 'Confirm button did not become enabled after 5 Add Post attempts'
    });
    assert.strictEqual(counts.add, 5);
    assert.strictEqual(counts.confirmed, 0);
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE', 1), { code: 'POST_RETRY_EXHAUSTED' });
    assert.strictEqual(counts.add, 5);
    const result = await env.AutomationRunner.executeSingleCampaign(1, { authCode: 'CODE' });
    assert.strictEqual(result.exhausted, true);
    assert.strictEqual((await env.StorageService.getJobState()).addPostAttemptCount, 5);
  });

  await test('Disabled, aria-disabled, CSS-disabled, hidden and detached Confirm are never clicked', async env => {
    const { drawer, confirmBtn, counts } = authorizationFixture(env);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    confirmBtn.removeAttribute('disabled');
    for (const attr of ['aria-disabled', 'class']) {
      confirmBtn.setAttribute(attr, attr === 'class' ? 'is-disabled' : 'true');
      assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
      confirmBtn.removeAttribute(attr);
      confirmBtn.classList.remove('is-disabled');
    }
    confirmBtn.style.display = 'none';
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    confirmBtn.style.display = 'block';
    drawer.removeChild(confirmBtn);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('Enabled Confirm in an unrelated or nested dialog is ignored', async env => {
    const { drawer, confirmBtn, counts } = authorizationFixture(env, { missing: true, enabledAt: Infinity });
    const dialog = new MockNode('DIV', { role: 'dialog' });
    env.mockDocument.body.appendChild(dialog);
    confirmBtn.removeAttribute('disabled');
    dialog.appendChild(confirmBtn);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    dialog.parentElement.removeChild(dialog);
    drawer.appendChild(dialog);
    assert.strictEqual(await env.CampaignAutomation.waitForConfirmButtonEnabled(drawer, 500), null);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('Authorization still processing times out for verification without resubmitting', async env => {
    const { counts } = authorizationFixture(env, { processing: true });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.add, 1);
    assert.strictEqual(counts.confirmed, 0);
    assert.strictEqual((await env.StorageService.getJobState()).status, 'NEEDS_VERIFICATION');
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.add, 1);
  });

  await test('Wait for delayed modal closure and loading settlement before Confirm', async env => {
    const { drawer, counts } = authorizationFixture(env, { processing: true });
    const spinner = new MockNode('DIV', { role: 'progressbar' });
    let ticks = 0;
    env.onSleep = () => {
      if (!counts.authorized) return;
      ticks++;
      if (ticks === 2) {
        counts.modal.parentElement.removeChild(counts.modal);
        drawer.appendChild(spinner);
      }
      if (ticks === 6) spinner.parentElement.removeChild(spinner);
      if (ticks < 6) assert.strictEqual(counts.confirmed, 0);
    };
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE');
    assert.strictEqual(counts.add, 1);
    assert.strictEqual(counts.confirmed, 1);
  });

  for (const action of ['stop', 'pause']) {
    await test(`${action} during retry prevents additional clicks`, async env => {
      const { counts } = authorizationFixture(env, { enabledAt: Infinity });
      env.onSleep = async ms => {
        if (counts.authorized && ms === 1500) await env.AutomationRunner[action]();
      };
      await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), /aborted or paused/);
      assert.strictEqual(counts.add, 1);
      assert.strictEqual(counts.confirmed, 0);
    });
  }

  for (const message of ['Invalid authorization code', 'Authorization code expired', 'Too many requests. Please try again later.']) {
    await test(`${message}: stop immediately`, async env => {
      const { counts } = authorizationFixture(env, { error: message });
      await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_BLOCKED' });
      assert.strictEqual(counts.add, 1);
      assert.strictEqual(counts.authorized, 0);
      assert.strictEqual(counts.confirmed, 0);
    });
  }

  await test('Persisted attempt 4 permits only one further authorization', async env => {
    const { counts } = authorizationFixture(env, { enabledAt: Infinity });
    await env.StorageService.updateJobState({ addPostAttemptCount: 4, addPostRunId: 'run_test', addPostCampaignIndex: 1 });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'POST_RETRY_EXHAUSTED' });
    assert.strictEqual(counts.add, 1);
    assert.strictEqual((await env.StorageService.getJobState()).addPostAttemptCount, 5);
  });

  await test('Pending fifth attempt can finish after reinvocation without reauthorizing', async env => {
    const { confirmBtn, counts, setSelected } = authorizationFixture(env);
    confirmBtn.removeAttribute('disabled');
    setSelected(true);
    await env.StorageService.updateJobState({ addPostAttemptCount: 5, addPostRunId: 'run_test', addPostCampaignIndex: 1, addPostPhase: 'PROCESSING' });
    const result = await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE');
    assert.strictEqual(result.success, true);
    assert.strictEqual(counts.add, 0);
    assert.strictEqual(counts.confirmed, 1);
  });

  await test('Successful Confirm exits permanently for this run and campaign', async env => {
    const { counts } = authorizationFixture(env);
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE');
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE');
    assert.strictEqual(counts.add, 1);
    assert.strictEqual(counts.confirmed, 1);
  });

  await test('Ambiguous Confirm never triggers another authorization or Confirm click', async env => {
    const { counts } = authorizationFixture(env, { ambiguous: true });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.add, 1);
    assert.strictEqual(counts.confirmed, 1);
  });

  await test('Persisted CONFIRMING prevents duplicate clicks after reload', async env => {
    const { counts } = authorizationFixture(env);
    await env.StorageService.updateJobState({ addPostAttemptCount: 1, addPostRunId: 'run_test', addPostCampaignIndex: 1, addPostPhase: 'CONFIRMING' });
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.add, 0);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('New campaign and new run each receive their own counter', async env => {
    await env.StorageService.updateJobState({ addPostAttemptCount: 5, addPostRunId: 'run_test', addPostCampaignIndex: 1, addPostPhase: 'EXHAUSTED', currentCampaignIndex: 2 });
    const { drawer, confirmBtn, counts, setSelected } = authorizationFixture(env);
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE', 2);
    assert.strictEqual((await env.StorageService.getJobState()).addPostAttemptCount, 1);
    drawer.style.display = 'block';
    confirmBtn.setAttribute('disabled', 'true');
    setSelected(false);
    await env.StorageService.updateJobState({ runId: 'run_new', currentCampaignIndex: 1 });
    await env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE', 1);
    assert.strictEqual((await env.StorageService.getJobState()).addPostAttemptCount, 1);
    assert.strictEqual(counts.add, 2);
  });

  await test('Concurrent controller call is rejected', async env => {
    authorizationFixture(env);
    const first = env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE');
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), /Concurrent Add Post/);
    await first;
  });

  await test('Runner uses one controller and preserves Add Post verification status without publishing', async env => {
    const { CampaignAutomation: c, AutomationRunner: runner } = env;
    authorizationFixture(env, { ambiguous: true });
    for (const method of ['clickCreateCampaign', 'handleCustomModeFlow', 'selectTrafficObjectiveAndBudget', 'configureDemographicsAndCountries', 'inputWebsiteUrl', 'openCreativeAssetsDrawer']) c[method] = async () => {};
    let publishes = 0;
    c.handlePublishStep = async () => { publishes++; return { success: true }; };
    await runner.executeCampaignLoop(1, 1, { authCode: 'CODE', liveMode: true });
    assert.strictEqual(publishes, 0);
    assert.strictEqual(runner.currentState, 'NEEDS_VERIFICATION');
    assert.strictEqual((await env.StorageService.getJobState()).status, 'NEEDS_VERIFICATION');
  });

  await test('Final creative validation failure stops for verification after a single Confirm', async env => {
    const { counts } = authorizationFixture(env);
    env.CampaignAutomation.verifyCreativeAttachmentOnPage = async () => { throw new Error('Creative validation failed'); };
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.confirmed, 1);
    assert.strictEqual(counts.add, 1);
    assert.strictEqual((await env.StorageService.getJobState()).status, 'NEEDS_VERIFICATION');
  });

  await test('Runner calls the retry controller once and publishes only after Confirm completes', async env => {
    const { CampaignAutomation: c, AutomationRunner: runner } = env;
    const { counts } = authorizationFixture(env, { enabledAt: 2 });
    for (const method of ['clickCreateCampaign', 'handleCustomModeFlow', 'selectTrafficObjectiveAndBudget', 'configureDemographicsAndCountries', 'inputWebsiteUrl', 'openCreativeAssetsDrawer']) c[method] = async () => {};
    const controller = c.attachSparkAdsPostWithRetry.bind(c);
    let calls = 0;
    let publishes = 0;
    c.attachSparkAdsPostWithRetry = async (...args) => { calls++; return controller(...args); };
    c.handlePublishStep = async () => {
      assert.strictEqual(counts.confirmed, 1);
      assert.strictEqual((await env.StorageService.getJobState()).addPostPhase, 'COMPLETED');
      publishes++;
      return { success: true, testMode: true };
    };
    const result = await runner.executeSingleCampaign(1, { authCode: 'CODE', liveMode: false });
    assert.strictEqual(result.success, true);
    assert.strictEqual(calls, 1);
    assert.strictEqual(publishes, 1);
    assert.strictEqual(counts.add, 2);
  });

  await test('Pre-existing authorization modal blocks new Add post clicks until it finishes', async env => {
    const { counts } = authorizationFixture(env);
    buildModalFixture(env.mockDocument);
    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('CODE'), { code: 'ADD_POST_NEEDS_VERIFICATION' });
    assert.strictEqual(counts.add, 0);
    assert.strictEqual(counts.confirmed, 0);
  });

  await test('hasSelectedTikTokPost accurately distinguishes unselected vs selected post items', async env => {
    const c = env.CampaignAutomation;
    const { drawer } = buildDrawerFixture(env.mockDocument);
    assert.strictEqual(c.hasSelectedTikTokPost(drawer), false);

    // 1. Unselected TikTok post item matching user HTML
    const unselectedItem = new MockNode('DIV', {
      class: 'item',
      'data-testid': 'tab-tab-common-skeleton-d3JhdZ-7611878030172278037',
      'data-tea-tab': 'tiktok_mixed_post'
    });
    const unselectedContainer = new MockNode('DIV', { class: 'container' });
    const unselectedLabel = new MockNode('LABEL', {
      'data-testid': 'card-index-bqEQYC',
      role: 'checkbox',
      class: 'vi-checkbox cardCheckbox checkbox'
    });
    const unselectedSpan = new MockNode('SPAN', {
      class: 'vi-checkbox__input',
      'aria-checked': 'mixed'
    });
    unselectedLabel.appendChild(unselectedSpan);
    unselectedContainer.appendChild(unselectedLabel);
    unselectedItem.appendChild(unselectedContainer);
    drawer.appendChild(unselectedItem);

    assert.strictEqual(c.hasSelectedTikTokPost(drawer), false, 'Unselected post must return false');

    // 2. Selected TikTok post item matching user HTML
    const selectedItem = new MockNode('DIV', {
      class: 'item',
      'data-testid': 'tab-tab-common-skeleton-d3JhdZ-7573077093462838546',
      'data-tea-tab': 'tiktok_mixed_post'
    });
    const selectedContainer = new MockNode('DIV', { class: 'container selected' });
    const selectedLabel = new MockNode('LABEL', {
      'data-testid': 'card-index-bqEQYC',
      role: 'checkbox',
      class: 'vi-checkbox cardCheckbox checkbox is-checked'
    });
    selectedLabel.setAttribute('aria-checked', 'true');
    const selectedSpan = new MockNode('SPAN', {
      class: 'vi-checkbox__input is-checked',
      'aria-checked': 'mixed'
    });
    selectedLabel.appendChild(selectedSpan);
    selectedContainer.appendChild(selectedLabel);
    selectedItem.appendChild(selectedContainer);
    drawer.appendChild(selectedItem);

    assert.strictEqual(c.hasSelectedTikTokPost(drawer), true, 'Selected post must return true');

    // 3. Remove selected item, leaves only unselected item
    drawer.removeChild(selectedItem);
    assert.strictEqual(c.hasSelectedTikTokPost(drawer), false, 'Only unselected remaining must return false');
  });

  await test('New UI behavior: Confirm button enabled from start does NOT confirm if 0 posts selected; retries until post selected', async env => {
    const { confirmBtn, counts, setSelected } = authorizationFixture(env, { enabledAt: 2 });
    // In TikTok's new UI, Confirm button remains enabled even with 0 posts selected:
    confirmBtn.removeAttribute('disabled');
    setSelected(false);

    const result = await env.CampaignAutomation.attachSparkAdsPostWithRetry('TEST_CODE');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2, 'Must retry since attempt 1 had 0 selected posts despite enabled Confirm');
    assert.strictEqual(counts.add, 2);
    assert.strictEqual(counts.confirmed, 1, 'Confirm must be clicked only once after post selection');
  });

  await test('New UI behavior: Confirm button enabled from start exhausts after 5 attempts if no post is selected', async env => {
    const { confirmBtn, counts, setSelected } = authorizationFixture(env, { enabledAt: Infinity });
    // Confirm is enabled, but no post is ever selected:
    confirmBtn.removeAttribute('disabled');
    setSelected(false);

    await assert.rejects(env.CampaignAutomation.attachSparkAdsPostWithRetry('TEST_CODE'), {
      code: 'POST_RETRY_EXHAUSTED'
    });
    assert.strictEqual(counts.add, 5, 'Must attempt 5 times before exhausting');
    assert.strictEqual(counts.confirmed, 0, 'Confirm must NEVER be clicked when 0 posts are selected');
  });

  console.log(`SPARK ADS ADD POST TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exitCode = 1;
}
runAllTests().catch(error => { console.error(error); process.exitCode = 1; });
