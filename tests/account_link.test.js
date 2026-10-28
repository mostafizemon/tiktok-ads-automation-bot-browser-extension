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

function setup({ selected = false, missingConfirm = false, missingNext = false, stop = false, missingGotIt = false, staysOpen = false, duplicateGotIt = false, disabledGotIt = false } = {}) {
  const document = new Node('#document'); document.body = document.appendChild(new Node('body'));
  global.document = document; global.Element = Node;
  global.window = { getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', overflowY: node.overflow || 'visible' }) };
  global.AutomationRunner = { shouldAbort: false };
  delete require.cache[require.resolve('../automation/helpers.js')];
  require('../automation/helpers.js');
  let now = 0, job = {}, waits = [];
  global.StorageService = { updateJobState: async patch => Object.assign(job, patch) };
  global.AutomationHelpers.sleep = async ms => {
    waits.push(ms); now += ms;
    if (ms === 40000 && stop) global.AutomationRunner.shouldAbort = true;
  };
  const realNow = Date.now; Date.now = () => now;
  const makeButton = (root, label, attrs = {}) => {
    const host = root.appendChild(new Node('ks-button-923', attrs, label));
    const inner = host.shadow().appendChild(new Node('button', { part: 'base' }));
    return inner;
  };
  const trigger = makeButton(document.body, 'Link TikTok account', { 'data-testid': 'components-IdentityEmptyStatus-cTfGZe' });
  const modal = document.body.appendChild(new Node('ks-modal-dynamic')); modal.visible = false;
  const makeTile = label => {
    const tile = modal.appendChild(new Node('ks-tile-qv36ngxf'));
    tile.appendChild(new Node('span', { slot: 'title' }, label));
    const surface = tile.shadow().appendChild(new Node('div', { 'data-testid': 'ks-tile-index-3TTQAz', class: selected ? 'tile--checked' : 'tile' }));
    surface.onClick = () => { surface.attrs.class = 'tile--checked'; };
    return surface;
  };
  const existing = makeTile('Link existing TikTok account');
  const qr = makeTile('Link with QR code');
  const create = makeTile('Create new TikTok account');
  const login = makeTile('Log in to an existing TikTok account');
  const confirm = makeButton(modal, missingConfirm ? 'Other' : 'Confirm');
  const unrelated = makeButton(document.body, 'Confirm');
  const next = document.body.appendChild(new Node('ks-modal-next')); next.visible = false;
  const scroller = next.shadow().appendChild(new Node('div', { part: 'content' }, 'Scan QR code'));
  scroller.clientHeight = 300; scroller.scrollHeight = 1200; scroller.scrollTop = 0; scroller.overflow = 'auto';
  document.body.scrollHeight = 5000; document.body.clientHeight = 800; document.body.scrollTop = 0;
  const footer = next.appendChild(new Node('div', { slot: 'footer' }));
  const footerSlot = next.shadowRoot.appendChild(new Node('slot', { name: 'footer' }));
  footer.assignedSlot = footerSlot;
  footerSlot.assignedElements = () => [footer];
  const copy = makeButton(footer, 'Copy QR code', { 'data-testid': 'ks-button-index-onaHQE' });
  const gotIt = makeButton(footer, missingGotIt ? 'Other' : 'Got it', { 'data-testid': 'ks-button-index-onaHQE' });
  gotIt.attrs.part = 'self';
  gotIt.parentElement.host.tagName = 'KS-BUTTON-P9P4XN4B';
  if (disabledGotIt) gotIt.attrs.disabled = '';
  if (duplicateGotIt) makeButton(footer, 'Got it');
  const outsideGotIt = makeButton(document.body, 'Got it');
  gotIt.onClick = () => {
    assert(waits.includes(40000), 'Got it must follow the full QR wait');
    if (!staysOpen) next.visible = false;
  };
  trigger.onClick = () => { modal.visible = true; };
  confirm.onClick = () => { modal.visible = false; if (!missingNext) next.visible = true; };
  return { gotIt, copy, outsideGotIt, trigger, existing, qr, create, login, confirm, unrelated, scroller, document, waits, job,
    restore() { Date.now = realNow; } };
}
const flow = require('../automation/account-link.js');
(async () => {
  let passed = 0;
  async function test(name, options, check) {
    const env = setup(options);
    try { await check(env); passed++; console.log('PASS ' + name); } finally { env.restore(); }
  }
  await test('Select existing and QR, scoped Confirm, scroll only popup, wait and dismiss QR popup', {}, async e => {
    assert.deepStrictEqual(await flow.prepareQrLink(), { completed: true });
    for (const key of ['trigger', 'existing', 'qr', 'confirm', 'gotIt']) assert.strictEqual(e[key].clicks, 1);
    for (const key of ['create', 'login', 'unrelated', 'copy', 'outsideGotIt']) assert.strictEqual(e[key].clicks, 0);
    assert.strictEqual(e.scroller.scrollTop, 1200); assert.strictEqual(e.document.body.scrollTop, 0);
    assert.strictEqual(e.waits.filter(ms => ms === 40000).length, 1);
    assert.strictEqual(e.job.currentStep, 'LINK_ACCOUNT_QR_COMPLETE');
  });
  await test('Current nested shadow radio selects existing account when tile surface has no handler', {}, async e => {
    const host = e.existing.getRootNode().host;
    const title = host.children[0];
    // Resolve an assigned title, not a direct [slot="title"] descendant.
    delete title.attrs.slot;
    const slot = e.existing.appendChild(new Node('slot', { name: 'title' }));
    slot.assignedElements = () => [title];
    const radioHost = e.existing.appendChild(new Node('ks-radio-qv36ngxf'));
    const radio = radioHost.shadow().appendChild(new Node('input', { type: 'radio', part: 'self', 'data-testid': 'ks-radio-index-8AA75q' }));
    e.existing.onClick = null;
    radio.onClick = () => { radio.checked = true; e.existing.attrs.class = 'tile--checked'; };
    await flow.prepareQrLink();
    assert.strictEqual(radio.clicks, 1); assert.strictEqual(e.existing.clicks, 0);
    assert.strictEqual(e.create.clicks, 0); assert.strictEqual(e.gotIt.clicks, 1);
  });
  await test('Disabled nested radio never falls back to clicking tile surface', {}, async e => {
    const radioHost = e.existing.appendChild(new Node('ks-radio-qv36ngxf', { 'aria-disabled': 'true' }));
    const radio = radioHost.shadow().appendChild(new Node('input', { type: 'radio' }));
    await assert.rejects(flow.prepareQrLink(), /radio did not become enabled/);
    assert.strictEqual(radio.clicks, 0); assert.strictEqual(e.existing.clicks, 0);
    assert.strictEqual(e.confirm.clicks, 0);
  });
  await test('Screenshot state: existing click reveals QR only after app accepts selection', {}, async e => {
    const qrHost = e.qr.getRootNode().host;
    qrHost.visible = false;
    e.create.attrs.class = 'tile--checked';
    const radioHost = e.existing.appendChild(new Node('ks-radio-qv36ngxf'));
    const radio = radioHost.shadow().appendChild(new Node('input', { type: 'radio' }));
    radio.onClick = () => { radio.checked = true; }; // Native state alone is insufficient.
    e.existing.onClick = () => {
      e.existing.attrs.class = 'tile--checked';
      e.create.attrs.class = 'tile';
      qrHost.visible = true;
    };
    e.qr.onClick = () => {
      assert(e.existing.classList.contains('tile--checked'));
      assert(!e.create.classList.contains('tile--checked'));
      e.qr.attrs.class = 'tile--checked';
    };
    await flow.prepareQrLink();
    assert.strictEqual(radio.clicks, 1); assert.strictEqual(e.existing.clicks, 1);
    assert.strictEqual(e.qr.clicks, 1); assert.strictEqual(e.create.clicks, 0);
    assert.strictEqual(e.confirm.clicks, 1); assert.strictEqual(e.gotIt.clicks, 1);
  });
  await test('Native checked without accepted existing selection cannot advance to QR or Confirm', {}, async e => {
    const radioHost = e.existing.appendChild(new Node('ks-radio-qv36ngxf'));
    const radio = radioHost.shadow().appendChild(new Node('input', { type: 'radio' }));
    radio.onClick = () => { radio.checked = true; };
    e.existing.onClick = null;
    await assert.rejects(flow.prepareQrLink(), /selection could not be verified/);
    assert.strictEqual(radio.clicks, 1); assert.strictEqual(e.existing.clicks, 1);
    assert.strictEqual(e.qr.clicks, 0); assert.strictEqual(e.confirm.clicks, 0);
  });
  await test('Already selected tiles are not clicked', { selected: true }, async e => {
    await flow.prepareQrLink(); assert.strictEqual(e.existing.clicks, 0); assert.strictEqual(e.qr.clicks, 0);
  });
  await test('Missing scoped Confirm never clicks unrelated Confirm', { missingConfirm: true }, async e => {
    await assert.rejects(flow.prepareQrLink(), /Confirm button missing/); assert.strictEqual(e.unrelated.clicks, 0);
  });
  await test('Missing next popup does not scroll or wait 40 seconds', { missingNext: true }, async e => {
    await assert.rejects(flow.prepareQrLink(), /popup after Confirm/);
    assert.strictEqual(e.scroller.scrollTop, 0); assert(!e.waits.includes(40000));
  });
  await test('Stop during QR wait does not report completion', { stop: true }, async e => {
    await assert.rejects(flow.prepareQrLink(), /aborted or paused/);
    assert.strictEqual(e.job.currentStep, 'LINK_ACCOUNT_QR_WAIT');
    assert.strictEqual(e.gotIt.clicks, 0);
  });
  await test('Absent link control leaves existing workflow available', {}, async e => {
    e.trigger.parentElement.host.visible = false;
    assert.deepStrictEqual(await flow.prepareQrLink(), { skipped: true }); assert.strictEqual(e.confirm.clicks, 0);
  });
  for (const [name, options, message] of [
    ['Missing Got it', { missingGotIt: true }, /Got it button missing/],
    ['Disabled Got it', { disabledGotIt: true }, /Got it button missing/],
    ['Ambiguous Got it', { duplicateGotIt: true }, /Multiple QR popup Got it/],
    ['Popup stays open', { staysOpen: true }, /did not close/]
  ]) {
    await test(name + ' blocks continuation', options, async e => {
      await assert.rejects(flow.prepareQrLink(), message);
      assert.strictEqual(e.outsideGotIt.clicks, 0); assert.strictEqual(e.copy.clicks, 0);
      assert.strictEqual(e.gotIt.clicks, options.staysOpen ? 1 : 0);
      assert.notStrictEqual(e.job.currentStep, 'LINK_ACCOUNT_QR_COMPLETE');
    });
  }
  // Exercise the actual runner boundary: account linking precedes CTA and
  // continues through CTA to the existing Test Mode publish boundary.
  await test('Runner continues after Got it to CTA and existing Test Mode boundary', {}, async e => {
    require('../automation/runner.js');
    const runner = global.AutomationRunner;
    const calls = [];
    global.StorageService.getJobState = async () => e.job;
    global.CampaignAutomation = {};
    for (const name of ['clickCreateCampaign', 'handleCustomModeFlow', 'selectTrafficObjectiveAndBudget',
      'configureDemographicsAndCountries', 'inputWebsiteUrl', 'openCreativeAssetsDrawer', 'attachSparkAdsPostWithRetry']) {
      global.CampaignAutomation[name] = async () => calls.push(name);
    }
    global.CampaignAutomation.configureCallToAction = async () => { assert.strictEqual(e.gotIt.clicks, 1); calls.push('cta'); };
    global.CampaignAutomation.handlePublishStep = async () => { assert(calls.includes('cta')); calls.push('publish'); return { testMode: true }; };
    runner.currentState = 'RUNNING'; runner.isProcessingLock = true;
    await runner.executeCampaignLoop(1, 3, { callToAction: 'Order now' });
    assert.strictEqual(runner.currentState, 'COMPLETED');
    assert.strictEqual(runner.isProcessingLock, false);
    assert.strictEqual(e.job.currentCampaignIndex, 1);
    assert.strictEqual(e.job.currentStep, 'TEST_COMPLETED');
    assert(calls.indexOf('cta') < calls.indexOf('publish'));
    assert.strictEqual(calls.filter(name => name === 'clickCreateCampaign').length, 1);
  });
  console.log(`ACCOUNT LINK TEST RESULTS: ${passed} PASSED`);
})().catch(error => { console.error(error); process.exitCode = 1; });
