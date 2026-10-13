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
  get disabled() { return ['BUTTON', 'INPUT'].includes(this.tagName) && this.hasAttribute('disabled'); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  shadow() { this.shadowRoot = new Node('#shadow-root'); this.shadowRoot.host = this; return this.shadowRoot; }
  getRootNode() { let node = this; while (node.parentElement) node = node.parentElement; return node; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part === ':disabled') return this.disabled;
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
  focus() {}
  blur() {}
  get value() { return this._value || ''; }
  set value(value) { this._value = value; }
  scrollIntoView() {}
  dispatchEvent() {}
  click() { if (!this.disabled) { this.clicks++; this.onClick?.(); } }
}

function setup() {
  const document = new Node('#document'); document.body = document.appendChild(new Node('body'));
  global.document = document; global.Element = Node;
  global.window = { HTMLInputElement: Node, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  global.MouseEvent = function () {}; global.StorageService = null;
  global.AutomationRunner = { shouldAbort: false };
  for (const file of ['helpers', 'campaign']) {
    delete require.cache[require.resolve(`../automation/${file}.js`)]; require(`../automation/${file}.js`);
  }
  let now = 1000; const timers = [];
  const env = { document, campaign: global.CampaignAutomation, now: () => now,
    later(delay, fn) { timers.push({ at: now + delay, fn }); } };
  global.AutomationHelpers.sleep = async ms => {
    if (global.AutomationHelpers.isAborted()) throw new Error('Automation aborted or paused by user');
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
    if (global.AutomationHelpers.isAborted()) throw new Error('Automation aborted or paused by user');
  };
  env.section = document.body.appendChild(new Node('section'));
  env.campaignRadio = env.section.appendChild(new Node('label', { 'data-testid': 'spp-cbo-1FqvMw', role: 'radio', 'aria-checked': 'false' }, 'Campaign budget'));
  env.campaignRadio.onClick = () => { env.campaignRadio.attrs['aria-checked'] = 'true'; };
  env.section.appendChild(new Node('div', { 'data-testid': 'campaign_settings_budgetCboSelect' }, 'Daily'));
  env.inputHost = env.section.appendChild(new Node('x-input-number', { 'data-testid': 'create_campaign_CBO_daily_budget' }));
  env.renderInput = () => {
    const inner = env.inputHost.shadow().appendChild(new Node('x-input', { 'x-name': 'x-input' }));
    env.input = inner.shadow().appendChild(new Node('input', { part: 'input', type: 'text' }));
    return env.input;
  };
  env.renderInput();
  env.option = (attrs = {}, section = env.section, text = ' Custom   budget ') => {
    const radio = section.appendChild(new Node('label', { role: 'radio', 'aria-checked': 'false', ...attrs }, text));
    radio.onClick = () => { radio.attrs['aria-checked'] = 'true'; };
    return radio;
  };
  return env;
}
// Fixture reproduces the supplied TikTok radio markup, including hidden native inputs.
function realBudgetGroup(e, { selected = false, testId = 'radio-radio-group-n3ki11' } = {}) {
  const group = e.section.appendChild(new Node('div', { 'data-testid': testId, role: 'radiogroup', class: 'vi-radio-group' }));
  const recommended = group.appendChild(new Node('label', { role: 'radio', class: 'vi-radio' }));
  recommended.appendChild(new Node('input', { type: 'radio', class: 'vi-radio__original', value: '1' })).visible = false;
  recommended.appendChild(new Node('span', {}, 'Recommended daily budget'));
  const custom = group.appendChild(new Node('label', {
    role: 'radio', class: selected ? 'vi-radio is-checked' : 'vi-radio', ...(selected ? { 'aria-checked': 'true' } : {})
  }));
  custom.appendChild(new Node('input', { type: 'radio', class: 'vi-radio__original', value: '2' })).visible = false;
  custom.appendChild(new Node('span', {}, 'Custom budget'));
  custom.onClick = () => { custom.attrs['aria-checked'] = 'true'; custom.attrs.class = 'vi-radio is-checked'; };
  return { group, recommended, custom };
}
let passed = 0, failed = 0;
async function test(name, fn) {
  const oldNow = Date.now;
  try { const env = setup(); Date.now = env.now; await fn(env); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  finally { Date.now = oldNow; }
}
(async () => {
  await test('Present radio selected once before verified daily entry', async e => {
    const radio = e.option(); radio.onClick = () => { assert.strictEqual(e.input.value, ''); radio.attrs['aria-checked'] = 'true'; };
    await e.campaign.configureCampaignBudget(25.5); assert.strictEqual(radio.clicks, 1); assert.strictEqual(e.input.value, '25.50');
  });
  await test('Absent radio retains existing workflow', async e => { await e.campaign.configureCampaignBudget(33); assert.strictEqual(e.input.value, '33.00'); });
  await test('Already selected radio is not clicked', async e => { const r = e.option({ 'aria-checked': 'true' }); await e.campaign.configureCampaignBudget(25); assert.strictEqual(r.clicks, 0); });
  await test('Radio renders after Campaign selection', async e => {
    let r; e.campaignRadio.onClick = () => { e.campaignRadio.attrs['aria-checked'] = 'true'; e.later(1200, () => { r = e.option(); }); };
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(r.clicks, 1);
  });
  await test('Disabled radio never clicked and blocks entry', async e => {
    const r = e.option({ 'aria-disabled': 'true' }); await assert.rejects(e.campaign.configureCampaignBudget(25), /Custom budget option/); assert.strictEqual(r.clicks, 0); assert.strictEqual(e.input.value, '');
  });
  await test('Disabled radio becomes available after settling', async e => {
    const r = e.option({ class: 'is-disabled' }); e.later(1800, () => delete r.attrs.class);
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(r.clicks, 1);
  });
  await test('Rerendered nested input is reacquired', async e => {
    const old = e.input; const r = e.option(); r.onClick = () => { r.attrs['aria-checked'] = 'true'; e.renderInput(); };
    await e.campaign.configureCampaignBudget(47.25); assert.strictEqual(old.value, ''); assert.strictEqual(e.input.value, '47.25');
  });
  await test('Unrelated and inexact radios ignored', async e => {
    const other = e.document.body.appendChild(new Node('section')); const r = e.option({}, other); const wrong = e.option({}, e.section, 'Custom budget cap');
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(r.clicks, 0); assert.strictEqual(wrong.clicks, 0);
  });
  await test('Native radio label and checked state supported', async e => {
    const label = e.section.appendChild(new Node('label', {}, 'Custom budget')); const r = label.appendChild(new Node('input', { type: 'radio' }));
    label.onClick = () => { r.checked = true; }; await e.campaign.configureCampaignBudget(25); assert.strictEqual(label.clicks, 1);
  });
  await test('Missing selection confirmation stops without second click', async e => {
    const r = e.option(); r.onClick = () => {}; await assert.rejects(e.campaign.configureCampaignBudget(25), /Custom budget option/); assert.strictEqual(r.clicks, 1);
  });
  await test('Accessible radio in open shadow root is selected', async e => {
    const root = e.section.appendChild(new Node('budget-options')).shadow();
    const r = root.appendChild(new Node('div', { role: 'radio', 'aria-label': 'Custom budget' }));
    r.onClick = () => { r.attrs['aria-checked'] = 'true'; };
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(r.clicks, 1);
  });
  await test('Disabled native radio blocks its visible label', async e => {
    const label = e.section.appendChild(new Node('label', {}, 'Custom budget'));
    label.appendChild(new Node('input', { type: 'radio', disabled: 'disabled' }));
    await assert.rejects(e.campaign.configureCampaignBudget(25), /Custom budget option/); assert.strictEqual(label.clicks, 0);
  });
  await test('Continue follows successful budget validation', async e => {
    e.option(); e.campaign.detectObjectivePage = async () => {}; e.campaign.selectTrafficObjective = async () => {};
    let continued = 0; e.campaign.clickContinueAndVerifyDemographics = async () => { assert.strictEqual(e.input.value, '25.00'); continued++; };
    await e.campaign.selectTrafficObjectiveAndBudget({ dailyBudget: 25 }); assert.strictEqual(continued, 1);
  });
  await test('Invalid displayed value prevents Continue', async e => {
    e.option(); e.input.dispatchEvent = () => { e.input.value = '0'; };
    e.campaign.detectObjectivePage = async () => {}; e.campaign.selectTrafficObjective = async () => {};
    let continued = 0; e.campaign.clickContinueAndVerifyDemographics = async () => continued++;
    await assert.rejects(e.campaign.selectTrafficObjectiveAndBudget({ dailyBudget: 25 }), /verification failed/); assert.strictEqual(continued, 0);
  });
  await test('Stop during settling prevents radio click', async e => {
    const r = e.option({ 'aria-disabled': 'true' }); e.later(1000, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(e.campaign.configureCampaignBudget(25), /aborted/); assert.strictEqual(r.clicks, 0);
  });
  await test('Supplied group clicks label, never hidden input or Recommended', async e => {
    const { custom, recommended } = realBudgetGroup(e);
    await e.campaign.configureCampaignBudget(62.75);
    assert.strictEqual(custom.clicks, 1); assert.strictEqual(recommended.clicks, 0);
    assert.strictEqual(custom.querySelector('input').clicks, 0); assert.strictEqual(e.input.value, '62.75');
  });
  await test('Supplied already-selected markup skips click', async e => {
    const { custom, recommended } = realBudgetGroup(e, { selected: true });
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(custom.clicks, 0); assert.strictEqual(recommended.clicks, 0);
  });
  await test('Dynamic group ID and class-only selection are supported', async e => {
    const { custom } = realBudgetGroup(e, { testId: 'radio-radio-group-new-session' });
    custom.onClick = () => { custom.attrs.class = 'vi-radio is-checked'; };
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(custom.clicks, 1);
  });
  await test('Rebate notice and Switch link are informational', async e => {
    const { recommended } = realBudgetGroup(e);
    const notice = e.section.appendChild(new Node('div', {}, "Custom budget doesn't qualify for rebate offer"));
    const link = notice.appendChild(new Node('a', {}, 'Switch to Recommended daily budget to qualify.'));
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(link.clicks, 0); assert.strictEqual(recommended.clicks, 0);
    assert.strictEqual(e.input.value, '25.00');
  });
  await test('Unrelated radiogroup outside Campaign Budget is ignored', async e => {
    const local = realBudgetGroup(e); const otherSection = e.document.body.appendChild(new Node('section'));
    const other = realBudgetGroup({ section: otherSection });
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(local.custom.clicks, 1); assert.strictEqual(other.custom.clicks, 0);
  });
  await test('Delayed real group renders before numeric input', async e => {
    e.inputHost.visible = false; let state;
    e.campaignRadio.onClick = () => {
      e.campaignRadio.attrs['aria-checked'] = 'true';
      e.later(1200, () => {
        state = realBudgetGroup(e);
        state.custom.onClick = () => { state.custom.attrs['aria-checked'] = 'true'; e.renderInput(); e.inputHost.visible = true; };
      });
    };
    await e.campaign.configureCampaignBudget(25); assert.strictEqual(state.custom.clicks, 1); assert.strictEqual(e.input.value, '25.00');
  });
  console.log(`CUSTOM BUDGET TEST RESULTS: ${passed} PASSED, ${failed} FAILED`); if (failed) process.exitCode = 1;
})();
