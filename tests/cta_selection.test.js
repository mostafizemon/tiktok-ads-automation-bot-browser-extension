/** CTA selection regression tests; local DOM/Shadow DOM only, no browser, accounts, or network calls. */
const assert = require('assert');

class Node {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.text = text;
    this.children = []; this.parentElement = null; this.shadowRoot = null;
    this.visible = true; this.clicks = 0;
    this.classList = { contains: name => String(this.attrs.class || '').split(/\s+/).includes(name) };
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
    return String(selector).split(',').some(part => {
      part = part.trim();
      if (!part || part === '*') return true;
      const attrRe = /\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/g;
      let m;
      while ((m = attrRe.exec(part))) {
        const [, name, op, val] = m;
        if (!this.hasAttribute(name)) return false;
        const cur = String(this.getAttribute(name) ?? '');
        if (op === '=' && cur !== val) return false;
        if (op === '*=' && !cur.includes(val)) return false;
      }
      const prefix = part.replace(/\[[^\]]+\]/g, '').trim();
      if (!prefix || prefix === '*') return true;
      if (prefix.startsWith('#')) {
        const [id, ...cls] = prefix.slice(1).split('.');
        if (this.getAttribute('id') !== id) return false;
        const classList = String(this.attrs.class || '').split(/\s+/).filter(Boolean);
        return cls.filter(Boolean).every(c => classList.includes(c));
      }
      const bits = prefix.split('.');
      if (bits[0] && this.tagName.toLowerCase() !== bits[0].toLowerCase()) return false;
      const classList = String(this.attrs.class || '').split(/\s+/).filter(Boolean);
      return bits.slice(1).filter(Boolean).every(c => classList.includes(c));
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
  closest(selector) { for (let n = this; n; n = n.parentElement) if (typeof n.matches === 'function' && n.matches(selector)) return n; return null; }
  getBoundingClientRect() {
    let node = this;
    while (node) {
      if (!node.visible) return { width: 0, height: 0 };
      const parent = node.parentElement || node.host;
      if (!parent) return { width: 100, height: 30 };
      node = parent;
    }
  }
  scrollIntoView() {}
  dispatchEvent() {}
  click() { if (!this.disabled) { this.clicks++; this.onClick?.(); } }
}

const CTA_OPTIONS = ['Experience now', 'Apply now', 'Watch now', 'Order now'];

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
  const env = { document, campaign: global.CampaignAutomation,
    later(delay, fn) { timers.push({ at: now + delay, fn }); } };
  env.now = () => now;
  global.AutomationHelpers.sleep = async ms => {
    if (global.AutomationRunner.shouldAbort) throw new Error('Automation aborted or paused by user');
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
    if (global.AutomationRunner.shouldAbort) throw new Error('Automation aborted or paused by user');
  };
  return env;
}

/** Mirror of the real CTA DOM: section -> select/shadow -> value-field/shadow -> trigger + clear; popover menu outside the section. */
function ctaFixture(env, opts = {}) {
  const {
    preselected = ['Experience now', 'Apply now'],
    overflow = false,
    editorOpen = true,
    withEdit = true,
    removeIdUpfront = false,
    clearRemovesId = false,
    selectDelay = 0,
    glitchDoubleCheck = false,
    unrelated = true,
    slotPrefix = 'slot-item-label-201964_201490',
  } = opts;
  const body = env.document.body;
  const state = { clearClicks: 0, triggerClicks: 0, editClicks: 0, decoyClicks: 0 };
  const boxes = {}; const rows = {}; const tags = {};

  const section = body.appendChild(new Node('div', { id: 'fieldRenderer-callToActionAssetList', 'data-testid': 'fieldRenderer-callToActionAssetList' }));
  if (removeIdUpfront) delete section.attrs.id;
  const module = section.appendChild(new Node('div', { 'data-tea-std_module_name': 'creative__creative-cta-select-tree' }));
  const item = module.appendChild(new Node('div', { 'data-testid': 'lego-section-item', 'data-lego-anchor': 'callToActionAssetList' }));
  item.appendChild(new Node('ks-text-923', { 'data-testid': 'lego-section-item-header-title' }, 'Call to action text'));

  const select = item.appendChild(new Node('ks-select-923', { 'data-tea-std_component_name': 'creative_aigc_cta' }));
  select.visible = editorOpen && !selectDelay;
  if (selectDelay) env.later(selectDelay, () => { select.visible = true; });

  if (withEdit) {
    const editHost = item.appendChild(new Node('div', { 'data-testid': 'lego-hybrid-section-item-operation' }));
    const editBtn = editHost.shadow().appendChild(new Node('button', { part: 'base' }));
    editBtn.onClick = () => { state.editClicks++; select.visible = true; };
    state.editHost = editHost; state.editBtn = editBtn;
  }

  const selRoot = select.shadow();
  const valueField = selRoot.appendChild(new Node('ks-value-field-923'));
  // Slotted tags live as light-DOM children of the value field (as in the real component).
  for (const label of CTA_OPTIONS) {
    const tag = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }, label));
    tag.visible = preselected.includes(label);
    tags[label] = tag;
  }
  if (overflow) {
    const more = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }, '+ 8 more'));
    more.visible = preselected.length > 0;
    tags['+more'] = more;
  }

  const vfRoot = valueField.shadow();
  const trigger = vfRoot.appendChild(new Node('button', { part: 'base' }));
  trigger.onClick = () => { state.triggerClicks++; menu.visible = true; };

  let clearBtn = null;
  if (preselected.length > 0) {
    clearBtn = vfRoot.appendChild(new Node('div', { class: 'value-field__clear', part: 'suffixIcon' }));
    clearBtn.onClick = () => {
      state.clearClicks++;
      for (const label of CTA_OPTIONS) { boxes[label].attrs['aria-checked'] = 'false'; tags[label].visible = false; }
      if (tags['+more']) tags['+more'].visible = false;
      clearBtn.visible = false;
      if (clearRemovesId) delete section.attrs.id;
    };
  }

  // Dropdown popover renders outside the section tree (document body portal).
  const menu = body.appendChild(new Node('ks-dropdown-menu-923'));
  menu.visible = false;
  const holder = menu.appendChild(new Node('div', { class: 'menu-list-holder' }));
  holder.scrollTop = 0;
  const list = holder.appendChild(new Node('ks-dropdown-menu-list-923'));
  CTA_OPTIONS.forEach((label, i) => {
    const li = list.appendChild(new Node('li', { class: 'dropdown-item', role: 'option' }));
    const box = li.appendChild(new Node('ks-checkbox-923', { role: 'checkbox', 'aria-checked': preselected.includes(label) ? 'true' : 'false' }));
    const labelDiv = li.appendChild(new Node('div', { class: 'menu-item-base__content--text--label' }));
    const slot = labelDiv.appendChild(new Node('slot', { name: `${slotPrefix}-${i}` }));
    const assigned = new Node('div', { slot: `${slotPrefix}-${i}` });
    assigned.appendChild(new Node('ks-text-923', {}, label));
    slot.assignedElements = () => [assigned];
    li.onClick = () => {
      const on = box.attrs['aria-checked'] === 'true';
      box.attrs['aria-checked'] = on ? 'false' : 'true';
      tags[label].visible = !on;
      if (!on && glitchDoubleCheck) {
        const other = CTA_OPTIONS.find(l => l !== label);
        boxes[other].attrs['aria-checked'] = 'true';
        tags[other].visible = true;
      }
    };
    boxes[label] = box; rows[label] = li;
  });

  if (unrelated) {
    const other = body.appendChild(new Node('div', { id: 'fieldRenderer-unrelated' }));
    const otherSelect = other.appendChild(new Node('ks-select-999'));
    const decoy = otherSelect.shadow().appendChild(new Node('button', { part: 'base' }, 'Unrelated dropdown'));
    decoy.onClick = () => { state.decoyClicks++; };
    state.decoy = decoy;
  }
  return { section, select, trigger, clearBtn, menu, boxes, rows, tags, state };
}

function visibleTags(fx, label) {
  return fx.tags[label].visible;
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

  await test('CTA root ID exists; Watch now selected exactly once', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Watch now'), true);
    for (const label of ['Experience now', 'Apply now', 'Order now']) {
      assert.strictEqual(fx.boxes[label].attrs['aria-checked'], 'false', `${label} must be unchecked`);
      assert.strictEqual(visibleTags(fx, label), false, `${label} tag must be hidden`);
    }
    assert.strictEqual(fx.state.clearClicks, 1, 'Clear All clicked exactly once');
  });

  await test('Root ID missing but heading exists; Order now selected', async env => {
    const fx = ctaFixture(env, { removeIdUpfront: true });
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Order now'), true);
  });

  await test('Root ID removed by Clear All re-render; field reacquired', async env => {
    const fx = ctaFixture(env, { clearRemovesId: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.section.attrs.id, undefined, 'fixture simulated the ID disappearing');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Watch now'), true);
  });

  await test('Overflow "+ 8 more" tag cleared with the rest', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now', 'Apply now'], overflow: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.tags['+more'].visible, false, 'overflow indicator must be gone');
    assert.strictEqual(visibleTags(fx, 'Experience now'), false);
  });

  await test('Already-empty Select dropdown skips Clear All', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    assert.strictEqual(fx.clearBtn, null);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  await test('Editor already open (no Edit button) proceeds', async env => {
    const fx = ctaFixture(env, { withEdit: false });
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
    assert.strictEqual(fx.state.editClicks, 0);
  });

  await test('Dropdown opens through nested shadow trigger, not host', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.triggerClicks, 1, 'inner [part="base"] trigger clicked once');
    assert.strictEqual(fx.select.clicks, 0, 'select host wrapper must not be clicked');
    assert.strictEqual(fx.menu.visible, true);
  });

  await test('Options resolve through generated slot names', async env => {
    const fx = ctaFixture(env, { preselected: [], slotPrefix: 'slot-item-label-77RANDOM_99' });
    const label = env.campaign.resolveCtaOptionLabel(fx.rows['Order now']);
    assert.strictEqual(label, 'Order now');
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
  });

  await test('Exactly one CTA remains after selecting Watch now', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    const checked = CTA_OPTIONS.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  await test('Delayed select render still configures Order now', async env => {
    const fx = ctaFixture(env, { editorOpen: false, withEdit: false, preselected: [], selectDelay: 2000 });
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
  });

  await test('Unrelated dropdown is never clicked', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.decoyClicks, 0, 'unrelated dropdown trigger untouched');
  });

  await test('Second checked option aborts with safe failure', async env => {
    ctaFixture(env, { preselected: [], glitchDoubleCheck: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /exactly 1 selected/);
  });

  await test('Unavailable CTA fails without substitution', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    await assert.rejects(env.campaign.configureCallToAction('Fly now'), /not available/);
    const checked = CTA_OPTIONS.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, [], 'nothing must be selected on failure');
  });

  await test('Same CTA applies independently to a second campaign', async env => {
    const first = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    // Simulate navigating to the next campaign: a brand-new CTA field.
    env.document.body.children.length = 0;
    const second = ctaFixture(env, { slotPrefix: 'slot-item-label-next-campaign' });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(second.boxes['Watch now'].attrs['aria-checked'], 'true');
    assert.strictEqual(first.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  await test('Missing CTA config value throws before touching DOM', async env => {
    ctaFixture(env);
    await assert.rejects(env.campaign.configureCallToAction(''), /required/);
    await assert.rejects(env.campaign.configureCallToAction(null), /required/);
  });

  console.log(`CTA SELECTION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed ? 1 : 0);
})();
