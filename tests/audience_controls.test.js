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

function audience(e, { expanded = false, delay = 0, opens = true } = {}) {
  const panel = e.document.body.appendChild(new Node('div', { 'data-lego-collapse-aria-expanded': String(expanded), 'data-lego-collapse-type': 'SecondaryModuleArea' }));
  const heading = panel.appendChild(new Node('div', { 'data-testid': 'lego-content-slot-panel-title-Audience controls' }, 'Audience controls'));
  panel.appendChild(new Node('div', { 'data-testid': 'config-component-919pVR-particleLocations' }, 'Locations: United States'));
  const link = panel.appendChild(new Node('a', {}, 'Account audience controls page'));
  const other = e.document.body.appendChild(new Node('div', { 'data-testid': 'lego-content-slot-panel-title-[object Object]' }, 'Automatic targeting guidance'));
  const ready = () => { panel.attrs['data-lego-collapse-aria-expanded'] = 'true'; const field = panel.appendChild(new Node('div', { id: 'fieldRenderer-particleLocations', style: 'display: contents;' })); field.getBoundingClientRect = () => ({ width: 0, height: 0 }); field.appendChild(new Node('div', { 'data-testid': 'lego-antd-select' })); };
  heading.onClick = () => { if (opens) delay ? e.later(delay, ready) : ready(); };
  if (expanded) ready();
  return { panel, heading, other, link };
}
let passed = 0, failed = 0;
async function test(name, fn) {
  const old = Date.now;
  try { const e = setup(); Date.now = e.now; await fn(e); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  finally { Date.now = old; }
}
(async () => {
  await test('Audience controls is accepted after objective Continue', async e => {
    let clicks = 0; e.campaign.clickCommonNextButton = async () => { clicks++; audience(e); };
    await e.campaign.clickContinueAndVerifyDemographics(); assert.strictEqual(clicks, 1);
  });
  await test('Collapsed audience opens once before unchanged country pipeline', async e => {
    const state = audience(e, { delay: 600 }); const calls = [];
    for (const method of ['cleanupUnwantedCountryTags', 'selectTargetCountriesViaDropdown', 'verifyFinalCountryTags']) {
      e.campaign[method] = async countries => {
        assert.ok(state.panel.querySelector('#fieldRenderer-particleLocations'));
        assert.deepStrictEqual(countries, ['Canada', 'United States']); calls.push(method);
      };
    }
    for (const method of ['closeLocationDropdown', 'verifyNoLocationErrors', 'clickCommonNextButton', 'verifyNavigationToNextPage']) e.campaign[method] = async () => calls.push(method);
    await e.campaign.configureDemographicsAndCountries({ targetCountries: ['Canada', 'United States'] });
    assert.strictEqual(calls.length, 7); assert.strictEqual(state.heading.clicks, 1); assert.strictEqual(state.link.clicks, 0); assert.strictEqual(state.other.clicks, 0);
  });
  await test('Already expanded Audience controls is not clicked', async e => {
    const state = audience(e, { expanded: true }); await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(state.heading.clicks, 0);
  });
  await test('Demographics retains priority and existing expansion', async e => {
    const state = audience(e); const panel = e.document.body.appendChild(new Node('div', { 'data-lego-collapse-aria-expanded': 'false' }));
    const demo = panel.appendChild(new Node('div', { id: 'section_dom_id_targetingDemographics' }, 'Demographics'));
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(demo.clicks, 1); assert.strictEqual(state.heading.clicks, 0);
  });
  await test('Delayed Audience controls is awaited', async e => {
    let state; e.later(1200, () => { state = audience(e); }); await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(state.heading.clicks, 1);
  });
  await test('Read-only location summary never permits country changes', async e => {
    const state = audience(e, { opens: false }); let changed = false;
    e.campaign.cleanupUnwantedCountryTags = async () => { changed = true; };
    await assert.rejects(e.campaign.configureDemographicsAndCountries({}), /Targeting section unavailable/);
    assert.strictEqual(state.heading.clicks, 1); assert.strictEqual(changed, false);
  });
  await test('Stop while waiting prevents clicks', async e => {
    e.later(100, () => { audience(e); global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(), /aborted/);
  });
  await test('Missing both targeting variants stops with diagnostic', async e => {
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(), /Targeting section unavailable/);
  });
  await test('Display-contents wrapper reaches real country dropdown and selects Canada', async e => {
    const state = audience(e, { expanded: true });
    const field = state.panel.querySelector('#fieldRenderer-particleLocations');
    const trigger = field.querySelector('[data-testid="lego-antd-select"]');
    assert.strictEqual(global.AutomationHelpers.isVisible(field), false);
    const popover = e.document.body.appendChild(new Node('div', { class: 'popover' })); popover.visible = false;
    const input = popover.appendChild(new Node('input', { 'data-testid': 'lego-antd-select-popover-content-input' }));
    input.focus = () => {}; input.blur = () => {}; global.window.HTMLInputElement = Node;
    const item = popover.appendChild(new Node('div', { role: 'treeitem' }));
    item.appendChild(new Node('span', { 'data-testid': 'lego-antd-tree-title' }, 'Canada'));
    const checkbox = item.appendChild(new Node('div', { role: 'checkbox', 'aria-checked': 'false' }));
    checkbox.onClick = () => {
      checkbox.attrs['aria-checked'] = 'true';
      trigger.appendChild(new Node('ks-tag-923', { 'data-testid': 'lego-tag-list-tag' }, 'Canada'));
    };
    trigger.onClick = () => { popover.visible = true; };
    await e.campaign.ensureCountryTargetingSectionOpen();
    await e.campaign.selectTargetCountriesViaDropdown(['Canada']);
    await e.campaign.verifyFinalCountryTags(['Canada']);
    assert.strictEqual(trigger.clicks, 1); assert.strictEqual(checkbox.clicks, 1); assert.strictEqual(state.heading.clicks, 0);
  });
  await test('Visible field without visible interactive dropdown remains blocked', async e => {
    const state = audience(e, { expanded: true });
    const field = state.panel.querySelector('#fieldRenderer-particleLocations');
    field.querySelector('[data-testid="lego-antd-select"]').visible = false;
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(), /Targeting section unavailable/);
  });
  console.log(`AUDIENCE CONTROLS TEST RESULTS: ${passed} PASSED, ${failed} FAILED`); if (failed) process.exitCode = 1;
})();
