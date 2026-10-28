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
      const prefix = part.replace(/\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/g, '');
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

function setup({ missing = false, noUpdate = false, abort = false, duplicate = false } = {}) {
  const document = new Node('#document'); document.body = document.appendChild(new Node('body'));
  global.document = document; global.Element = Node; global.MouseEvent = function () {};
  global.window = { HTMLTextAreaElement: Node, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  global.AutomationRunner = { shouldAbort: false };
  delete require.cache[require.resolve('../automation/helpers.js')]; require('../automation/helpers.js');
  let now = 0;
  const oldNow = Date.now; Date.now = () => now;
  global.AutomationHelpers.sleep = async ms => { now += ms; if (abort) global.AutomationRunner.shouldAbort = true; };
  const job = { runId: 'r1', currentCampaignIndex: 1 };
  global.StorageService = { getJobState: async () => job, updateJobState: async patch => Object.assign(job, patch) };
  const url = document.body.appendChild(new Node('textarea', { 'data-testid': 'ks-text-field-index-aZM5M2', placeholder: 'Enter URL starting with http://' }));
  url.value = 'https://example.com';
  const input = document.body.appendChild(new Node('textarea', { 'data-testid': 'ks-text-field-index-aZM5M2', placeholder: 'Enter text' }));
  input.value = ''; input.focus = () => {}; input.blur = () => { throw new Error('Do not blur before selecting suggestion'); };
  const options = [];
  const label = 'Explore the Richness of Viral Video Content';
  const addList = () => {
    const list = document.body.appendChild(new Node('ul'));
    for (const value of [label, 'New Video Content: Explore the Latest Trends!']) {
      const item = list.appendChild(new Node('li', { 'data-testid': 'ks-menu-item-item-xb3yLe-' + value }));
      item.appendChild(new Node('slot', { name: 'slot-item-label-' + value + '-0' }));
      item.onClick = () => { if (!noUpdate) input.value = value; };
      options.push(item);
    }
  };
  input.dispatchEvent = event => {
    if (event.type === 'input') {
      assert.strictEqual(input.value, 'Virul Video');
      if (!missing && !abort) { addList(); if (duplicate) addList(); }
    }
  };
  return { input, url, options, label, job, document, restore() { Date.now = oldNow; } };
}
const flow = require('../automation/ad-text.js');
(async () => {
  let passed = 0;
  const test = async (name, config, check) => {
    const e = setup(config);
    try { await check(e); passed++; console.log('PASS ' + name); } finally { e.restore(); }
  };
  await test('Exact seed, first slot-only suggestion, verify text, preserve URL', {}, async e => {
    assert.deepStrictEqual(await flow.configure(), { value: e.label });
    assert.strictEqual(e.url.value, 'https://example.com');
    assert.strictEqual(e.options[0].clicks, 1); assert.strictEqual(e.options[1].clicks, 0);
    assert.strictEqual(e.job.adTextSelection.value, e.label);
  });
  await test('Existing alternative text fields remain untouched', {}, async e => {
    const alternative = e.document.body.appendChild(new Node('textarea', { 'data-testid': 'ks-text-field-index-aZM5M2', placeholder: 'Enter text' }));
    alternative.value = 'Keep this alternative';
    alternative.focus = () => { throw new Error('Alternative must not be edited'); };
    await flow.configure();
    assert.strictEqual(e.input.value, e.label);
    assert.strictEqual(alternative.value, 'Keep this alternative');
  });
  await test('Suggestion adds empty field: verifies first field and retains it on CTA recovery', {}, async e => {
    const dispatch = e.input.dispatchEvent;
    let alternative;
    e.input.dispatchEvent = event => {
      dispatch(event);
      if (event.type === 'input') {
        const select = e.options[0].onClick;
        e.options[0].onClick = () => {
          select();
          alternative = e.document.body.appendChild(new Node('textarea', { 'data-testid': 'ks-text-field-index-aZM5M2', placeholder: 'Enter text' }));
          alternative.value = '';
          alternative.focus = () => { throw new Error('New empty field must not be edited'); };
        };
      }
    };
    await flow.configure();
    assert.strictEqual(e.input.value, e.label); assert.strictEqual(alternative.value, '');
    assert.deepStrictEqual(await flow.configure({ resume: true }), { value: e.label, retained: true });
    assert.strictEqual(e.options[0].clicks, 1);
  });
  await test('Suggestion in second field cannot falsely verify first field', { noUpdate: true }, async e => {
    const alternative = e.document.body.appendChild(new Node('textarea', { 'data-testid': 'ks-text-field-index-aZM5M2', placeholder: 'Enter text' }));
    alternative.value = e.label;
    await assert.rejects(flow.configure(), /did not update/);
    assert(!e.job.adTextSelection);
  });
  await test('Missing suggestions stops without accepting seed', { missing: true }, async e => {
    await assert.rejects(flow.configure(), /No fresh TikTok AI suggestion/); assert(!e.job.adTextSelection);
  });
  await test('Unresponsive suggestion stops before CTA', { noUpdate: true }, async e => {
    await assert.rejects(flow.configure(), /did not update/); assert.strictEqual(e.options[0].clicks, 1);
  });
  await test('Multiple menus refuse arbitrary selection', { duplicate: true }, async e => {
    await assert.rejects(flow.configure(), /Multiple AI suggestion lists/); assert(e.options.every(node => !node.clicks));
  });
  await test('Stop during suggestion wait', { abort: true }, async () => {
    await assert.rejects(flow.configure(), /aborted or paused/);
  });
  await test('CTA reload preserves already selected suggestion', {}, async e => {
    await flow.configure();
    assert.deepStrictEqual(await flow.configure({ resume: true }), { value: e.label, retained: true });
    assert.strictEqual(e.options.length, 2); assert.strictEqual(e.options[0].clicks, 1);
  });
  await test('CTA reload refuses lost text', {}, async e => {
    await flow.configure(); e.input.value = '';
    await assert.rejects(flow.configure({ resume: true }), /not retained/);
  });
  await test('Runner: account linking then AI text then CTA then publish boundary', {}, async e => {
    delete require.cache[require.resolve('../automation/runner.js')]; require('../automation/runner.js');
    const runner = global.AutomationRunner;
    let linked = false, cta = false;
    global.AccountLinkAutomation = { prepareQrLink: async () => { linked = true; } };
    const dispatch = e.input.dispatchEvent;
    e.input.dispatchEvent = event => { assert(linked); dispatch(event); };
    global.CampaignAutomation = {};
    for (const name of ['clickCreateCampaign', 'handleCustomModeFlow', 'selectTrafficObjectiveAndBudget',
      'configureDemographicsAndCountries', 'inputWebsiteUrl', 'openCreativeAssetsDrawer', 'attachSparkAdsPostWithRetry']) {
      global.CampaignAutomation[name] = async () => {};
    }
    global.CampaignAutomation.configureCallToAction = async () => { assert.strictEqual(e.input.value, e.label); cta = true; };
    global.CampaignAutomation.handlePublishStep = async () => { assert(cta); return { testMode: true }; };
    assert((await runner.executeSingleCampaign(1, { callToAction: 'Order now' })).testMode);
  });
  console.log(`AD TEXT TEST RESULTS: ${passed} PASSED`);
})().catch(error => { console.error(error); process.exitCode = 1; });
