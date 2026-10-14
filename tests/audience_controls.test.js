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
function demographics(e, { expanded = false, animation = 0, renderDelay = 0, noEffect = false, missing = false } = {}) {
  const panel = e.document.body.appendChild(new Node('div', { 'data-lego-collapse-aria-expanded': String(expanded) }));
  const title = panel.appendChild(new Node('div', { 'data-testid': 'lego-content-slot-panel-title-[object Object]' }));
  const heading = title.appendChild(new Node('span', { id: 'section_dom_id_targetingDemographics' }, 'Demographics'));
  const chevron = title.appendChild(new Node('span', { 'data-testid': 'lego-get-chevron' }));
  title.appendChild(new Node('ks-icon', { name: 'edit' }));
  const content = panel.appendChild(new Node('div', { class: 'KsCollapseTransition' }));
  content.style = { height: expanded ? 'auto' : '0px' };
  content.computed = { opacity: expanded ? '1' : '0', overflow: 'hidden' };
  const computed = window.getComputedStyle;
  window.getComputedStyle = node => ({ ...computed(node), ...(node.computed || {}) });
  const state = { panel, title, heading, chevron, content, field: null, dropdown: null };
  state.render = () => {
    if (!state.field) state.field = content.appendChild(new Node('div', { id: 'fieldRenderer-particleLocations' }));
    if (!state.dropdown) state.dropdown = state.field.appendChild(new Node('div', { 'data-testid': 'lego-antd-select' }));
  };
  state.open = () => {
    panel.attrs['data-lego-collapse-aria-expanded'] = 'true';
    content.style.height = animation ? '20px' : 'auto'; content.computed.opacity = animation ? '0.5' : '1';
    if (animation) e.later(animation, () => { content.style.height = 'auto'; content.computed.opacity = '1'; });
    if (!missing) renderDelay ? e.later(renderDelay, state.render) : state.render();
  };
  chevron.onClick = () => { if (!noEffect) state.open(); };
  if (expanded && !missing) state.render();
  return state;
}
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
    demo.onClick = () => {
      panel.attrs['data-lego-collapse-aria-expanded'] = 'true';
      panel.appendChild(new Node('div', { id: 'fieldRenderer-particleLocations' }))
        .appendChild(new Node('div', { 'data-testid': 'lego-antd-select' }));
    };
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
  for (const variant of ['Audience controls', 'Demographics']) {
  await test(variant + ' ready wrapper reaches real country dropdown and selects Canada', async e => {
    const state = variant === 'Audience controls' ? audience(e, { expanded: true }) : demographics(e, { expanded: true });
    const field = state.panel.querySelector('#fieldRenderer-particleLocations');
    field.getBoundingClientRect = () => ({ width: 0, height: 0 });
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
  }
  await test('Visible field without visible interactive dropdown remains blocked', async e => {
    const state = audience(e, { expanded: true });
    const field = state.panel.querySelector('#fieldRenderer-particleLocations');
    field.querySelector('[data-testid="lego-antd-select"]').visible = false;
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(), /Targeting section unavailable/);
  });
  await test('Demographics already ready returns immediately without clicks', async e => {
    const s = demographics(e, { expanded: true });
    await e.campaign.ensureCountryTargetingSectionOpen();
    assert.strictEqual(s.chevron.clicks, 0); assert.strictEqual(e.sleeps, 0);
  });
  await test('Correct associated chevron clicked once, unrelated Edit untouched', async e => {
    const s = demographics(e);
    const other = e.document.body.appendChild(new Node('div', { 'data-testid': 'lego-content-slot-panel-title-[object Object]' }, 'Advanced targeting'));
    const edit = other.appendChild(new Node('ks-icon', { name: 'edit' }));
    await e.campaign.ensureCountryTargetingSectionOpen();
    assert.strictEqual(s.chevron.clicks, 1); assert.strictEqual(s.heading.clicks, 0); assert.strictEqual(edit.clicks, 0);
  });
  await test('Slow expansion animation finishes without duplicate toggle', async e => {
    const s = demographics(e, { animation: 4000 });
    const start = e.now(); await e.campaign.ensureCountryTargetingSectionOpen();
    assert.ok(e.now() - start >= 4000); assert.strictEqual(s.chevron.clicks, 1);
  });
  await test('Expanded attribute precedes delayed editable dropdown rendering', async e => {
    const s = demographics(e, { renderDelay: 1800 });
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.ok(s.dropdown); assert.strictEqual(s.chevron.clicks, 1);
  });
  await test('Entire panel rerender after click reacquires new heading and dropdown', async e => {
    const old = demographics(e); let current;
    old.chevron.onClick = () => {
      old.panel.visible = false; old.panel.attrs['data-lego-collapse-aria-expanded'] = 'true';
      e.later(500, () => { current = demographics(e, { expanded: true }); });
    };
    const logs = []; e.campaign.diag = (...args) => logs.push(args.join(' '));
    await e.campaign.ensureCountryTargetingSectionOpen();
    assert.strictEqual(old.chevron.clicks, 1); assert.strictEqual(current.chevron.clicks, 0);
    assert.ok(logs.some(text => text.includes('"rerender":true')));
  });
  await test('Mounted dropdown in collapsed opacity-zero content is not ready', async e => {
    const s = demographics(e); s.render();
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(s.chevron.clicks, 1);
  });
  await test('Already expanded hidden dropdown waits until it becomes visible', async e => {
    const s = demographics(e, { expanded: true }); s.dropdown.visible = false;
    e.later(1600, () => { s.dropdown.visible = true; });
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(s.chevron.clicks, 0);
  });
  await test('First no-effect click gets exactly one confirmed-collapsed recovery', async e => {
    const s = demographics(e);
    s.chevron.onClick = () => { if (s.chevron.clicks === 2) s.open(); };
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(s.chevron.clicks, 2);
  });
  await test('Both no-effect clicks stop within bound with persisted diagnostics', async e => {
    const s = demographics(e, { noEffect: true }); const logs = [];
    global.StorageService = { addLog: (...args) => logs.push(args) };
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(4000), /Demographics Locations dropdown/);
    assert.strictEqual(s.chevron.clicks, 2);
    assert.ok(logs.some(args => JSON.stringify(args).includes('readiness failed')));
  });
  await test('Opened panel missing dropdown fails without reopening or clearing countries', async e => {
    const s = demographics(e, { missing: true }); let changed = false;
    e.campaign.cleanupUnwantedCountryTags = async () => { changed = true; };
    await assert.rejects(e.campaign.configureDemographicsAndCountries({}), /Demographics Locations dropdown/);
    assert.strictEqual(s.chevron.clicks, 1); assert.strictEqual(changed, false);
  });
  await test('Expansion already transitioning is awaited without any click', async e => {
    const s = demographics(e, { animation: 1800 }); s.open();
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(s.chevron.clicks, 0);
  });
  await test('Obstructed expansion control is not clicked', async e => {
    const s = demographics(e); const overlay = e.document.body.appendChild(new Node('div'));
    e.document.elementFromPoint = () => overlay;
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(1000), /clicks=0/);
    assert.strictEqual(s.chevron.clicks, 0);
  });
  await test('Overlay disappears: click only when actual control is reachable', async e => {
    const s = demographics(e); const overlay = e.document.body.appendChild(new Node('div'));
    e.document.elementFromPoint = () => overlay;
    e.later(600, () => { e.document.elementFromPoint = () => s.chevron; });
    await e.campaign.ensureCountryTargetingSectionOpen(); assert.strictEqual(s.chevron.clicks, 1);
  });
  await test('Pause during expansion prevents country mutation and recovery', async e => {
    const s = demographics(e, { animation: 3000 });
    e.later(600, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(), /aborted/);
    assert.strictEqual(s.chevron.clicks, 1);
  });
  await test('Clipped height-zero editable content waits even with opacity one', async e => {
    const s = demographics(e, { expanded: true });
    s.content.style.height = '0px';
    e.later(1200, () => { s.content.style.height = 'auto'; });
    const start = e.now(); await e.campaign.ensureCountryTargetingSectionOpen();
    assert.ok(e.now() - start >= 1200); assert.strictEqual(s.chevron.clicks, 0);
  });
  await test('Unrelated visible select cannot satisfy missing Demographics dropdown', async e => {
    const s = demographics(e, { expanded: true, missing: true });
    const other = e.document.body.appendChild(new Node('div', { 'data-testid': 'lego-antd-select' }));
    await assert.rejects(e.campaign.ensureCountryTargetingSectionOpen(1000), /Demographics Locations dropdown/);
    assert.strictEqual(s.chevron.clicks, 0); assert.strictEqual(other.clicks, 0);
  });
  await test('Country-tag cleanup rerender is awaited before country selection', async e => {
    const s = demographics(e, { expanded: true });
    e.campaign.cleanupUnwantedCountryTags = async () => {
      s.dropdown.visible = false;
      e.later(1000, () => { s.dropdown.visible = true; });
    };
    let selected = false;
    e.campaign.selectTargetCountriesViaDropdown = async () => {
      assert.strictEqual(s.dropdown.visible, true); selected = true;
    };
    for (const method of ['verifyFinalCountryTags', 'closeLocationDropdown', 'verifyNoLocationErrors', 'clickCommonNextButton', 'verifyNavigationToNextPage']) {
      e.campaign[method] = async () => {};
    }
    await e.campaign.configureDemographicsAndCountries({ targetCountries: ['Canada'] });
    assert.strictEqual(selected, true); assert.strictEqual(s.chevron.clicks, 0);
  });
  await test('Slow animation with delayed expanded attribute and missing field never toggles twice', async e => {
    const s = demographics(e, { animation: 4000, renderDelay: 4500 });
    s.chevron.onClick = () => {
      s.open(); s.panel.attrs['data-lego-collapse-aria-expanded'] = 'false';
      e.later(4500, () => { s.panel.attrs['data-lego-collapse-aria-expanded'] = 'true'; });
    };
    await e.campaign.ensureCountryTargetingSectionOpen();
    assert.strictEqual(s.chevron.clicks, 1); assert.ok(s.dropdown);
  });
  console.log(`AUDIENCE CONTROLS TEST RESULTS: ${passed} PASSED, ${failed} FAILED`); if (failed) process.exitCode = 1;
})();
