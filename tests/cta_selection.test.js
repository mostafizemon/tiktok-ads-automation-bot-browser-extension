/** CTA selection regression tests; local DOM/Shadow DOM only, no browser, accounts, or network calls.
 * Fixture mirrors the verified TikTok structure:
 *   ks-select-923 (light children carry the real labels via slot attributes)
 *     shadowRoot: ks-value-field-923 (tags + trigger) + ks-dropdown-menu-923
 *       shadowRoot: ks-popover-923
 *         shadowRoot + light .dropdown-menu__popup -> ks-dropdown-menu-list-923
 *           shadowRoot: ks-spinner-923 -> .dropdown-menu__list__wrapper -> ul -> li.dropdown-item
 *             li holds only an empty <slot name="slot-item-label-...">;
 *             the label text lives on the select host's matching light child.
 */
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
const FULL_CTA_LIST = [
  'Learn more', 'Sign up', 'Shop now', 'Book now', 'Download',
  'Watch now', 'Order now', 'Subscribe', 'Contact us', 'Apply now',
  'Experience now', 'Get offer', 'Install now', 'Join now', 'Visit website',
  'Send inquiry', 'Listen now', 'Read more', 'Reserve', 'Donate',
  'Play game', 'Take survey', 'Start trial', 'Find a store', 'View content'
];
// Verified slot names from the captured TikTok HTML (examples only; matched dynamically).
const REAL_SLOT_NAMES = {
  'Watch now': 'slot-item-label-201964_201490-3',
  'Order now': 'slot-item-label-202046_201641-5'
};

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

async function captureLogs(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try { await fn(); } finally { console.log = orig; }
  return logs;
}

function ctaFixture(env, opts = {}) {
  const {
    preselected = ['Experience now', 'Apply now'],
    overflow = false,
    editorOpen = true,
    withEdit = true,
    removeIdUpfront = false,
    triggerRemovesId = false,
    deselectClosesMenu = false,
    hiddenSelected = [],
    offscreenSelected = [],
    noDataUntilReopen = false,
    noDataForever = false,
    selectDelay = 0,
    glitchDoubleCheck = false,
    unrelated = true,
    fullList = false,
    assignedMode = 'empty', // 'empty' | 'placeholder' | 'direct' — how the row slot resolves
    slotPrefix = 'slot-item-label-x9y8z7',
  } = opts;
  const options = fullList ? FULL_CTA_LIST : CTA_OPTIONS;
  const body = env.document.body;
  const state = { clearClicks: 0, triggerClicks: 0, editClicks: 0, decoyClicks: 0, events: [] };
  const boxes = {}; const rows = {}; const tags = {}; const slotNames = {}; const hostLabelDivs = {};
  const checked = new Set([...preselected, ...hiddenSelected, ...offscreenSelected].filter(l => options.includes(l)));

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

  // REAL STRUCTURE: the labels live as DIRECT light-DOM children of the
  // ks-select host, each carrying slot="slot-item-label-...".
  options.forEach((label, i) => {
    const slotName = REAL_SLOT_NAMES[label] || `${slotPrefix}-${i}`;
    slotNames[label] = slotName;
    const labelDiv = select.appendChild(new Node('div', { slot: slotName }));
    labelDiv.appendChild(new Node('ks-text-923', {}, label));
    hostLabelDivs[label] = labelDiv;
  });

  const selRoot = select.shadow();
  const valueField = selRoot.appendChild(new Node('ks-value-field-923'));
  // Selected CTA tags: light-DOM ks-tag children of the value field.
  for (const label of options) {
    const tag = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }, label));
    tag.visible = checked.has(label);
    tags[label] = tag;
  }
  if (overflow) {
    const more = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }, '+ 8 more'));
    more.visible = checked.size > 0;
    tags['+more'] = more;
  }

  const vfRoot = valueField.shadow();
  const trigger = vfRoot.appendChild(new Node('button', { part: 'base' }));
  // The Clear All cross exists in the DOM but the automation must never click it.
  let clearBtn = null;
  if (checked.size > 0) {
    clearBtn = vfRoot.appendChild(new Node('div', { class: 'value-field__clear', part: 'suffixIcon' }));
    clearBtn.onClick = () => { state.clearClicks++; state.events.push('clear'); };
  }

  // REAL STRUCTURE: menu lives inside the select's shadow tree, nested through
  // ks-dropdown-menu -> ks-popover (shadow + light .dropdown-menu__popup) ->
  // ks-dropdown-menu-list (shadow) -> ks-spinner (light) -> wrapper -> ul.
  const dropdownMenu = selRoot.appendChild(new Node('ks-dropdown-menu-923'));
  dropdownMenu.visible = false;
  const menuRoot = dropdownMenu.shadow();
  const popover = menuRoot.appendChild(new Node('ks-popover-923'));
  popover.shadow();
  const popup = popover.appendChild(new Node('div', { class: 'dropdown-menu__popup' }));
  const list = popup.appendChild(new Node('ks-dropdown-menu-list-923'));
  const listRoot = list.shadow();
  const spinner = listRoot.appendChild(new Node('ks-spinner-923'));
  const wrapper = spinner.appendChild(new Node('div', { class: 'dropdown-menu__list__wrapper' }));
  wrapper.scrollTop = 0;
  const ul = wrapper.appendChild(new Node('ul'));

  // A neutral outside click closes the open popover, as in the real UI.
  body.onClick = () => { dropdownMenu.visible = false; };

  const syncOverflow = () => {
    if (!tags['+more']) return;
    tags['+more'].visible = options.filter(l => tags[l].visible).length > 1;
  };
  let selectAllRow = null;
  const noDataNode = ul.appendChild(new Node('div', { class: 'dropdown-empty' }, 'No Data'));

  const buildRows = () => {
    if (noDataNode.parentElement) noDataNode.visible = false;
    options.forEach((label) => {
      const slotName = slotNames[label];
      const li = ul.appendChild(new Node('li', { class: 'dropdown-item', role: 'option', 'data-testid': `ks-menu-item-item-${slotName.replace('slot-item-label-', '')}` }));
      // Off-screen rows exist in the DOM with layout but are scrolled out of
      // the popup viewport; hiddenSelected rows are unrendered until swept.
      li.visible = !hiddenSelected.includes(label) && !offscreenSelected.includes(label);
      const box = li.appendChild(new Node('ks-checkbox-923', { role: 'checkbox', 'aria-checked': checked.has(label) ? 'true' : 'false' }));
      const labelDiv = li.appendChild(new Node('div', { class: 'menu-item-base__content--text--label' }));
      // REAL STRUCTURE: the LI contains only an empty named slot; no text.
      const slot = labelDiv.appendChild(new Node('slot', { name: slotName }));
      if (assignedMode === 'direct') {
        slot.assignedElements = () => [hostLabelDivs[label]];
      } else if (assignedMode === 'placeholder') {
        slot.assignedElements = () => [new Node('slot', { slot: slotName })];
      } else {
        slot.assignedElements = () => []; // Real browser behavior: empty.
      }
      li.onClick = () => {
        state.events.push(`click:${label}`);
        const on = box.attrs['aria-checked'] === 'true';
        box.attrs['aria-checked'] = on ? 'false' : 'true';
        tags[label].visible = !on;
        syncOverflow();
        if (on && deselectClosesMenu) dropdownMenu.visible = false;
        if (!on && glitchDoubleCheck) {
          const other = options.find(l => l !== label);
          boxes[other].attrs['aria-checked'] = 'true';
          tags[other].visible = true;
          syncOverflow();
        }
      };
      boxes[label] = box; rows[label] = li;
    });
    // "Select all" header row: separate from CTA options, never clicked.
    selectAllRow = ul.appendChild(new Node('li', { class: 'dropdown-item', role: 'option' }));
    const selectAllBox = selectAllRow.appendChild(new Node('ks-checkbox-923', { role: 'checkbox', 'aria-checked': 'false' }));
    selectAllRow.appendChild(new Node('div', { class: 'menu-item-base__content--text--label' }, 'Select all'));
    selectAllRow.onClick = () => {
      state.events.push('click:Select all');
      const on = selectAllBox.attrs['aria-checked'] === 'true';
      selectAllBox.attrs['aria-checked'] = on ? 'false' : 'true';
    };
  };
  if (!noDataForever && !noDataUntilReopen) buildRows();

  const showOptionRows = () => { if (!selectAllRow) buildRows(); };
  trigger.onClick = () => {
    state.triggerClicks++;
    state.events.push('trigger');
    dropdownMenu.visible = true;
    if (triggerRemovesId && state.triggerClicks === 1) delete section.attrs.id;
    if (noDataUntilReopen && state.triggerClicks >= 2) showOptionRows();
  };

  if (unrelated) {
    const other = body.appendChild(new Node('div', { id: 'fieldRenderer-unrelated' }));
    const otherSelect = other.appendChild(new Node('ks-select-999'));
    const decoy = otherSelect.shadow().appendChild(new Node('button', { part: 'base' }, 'Unrelated dropdown'));
    decoy.onClick = () => { state.decoyClicks++; };
    state.decoy = decoy;
  }
  return { section, select, trigger, clearBtn, get selectAllRow() { return selectAllRow; }, dropdownMenu, list, ul, boxes, rows, tags, slotNames, hostLabelDivs, state, options };
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

  // ---- 1. CTA root detection ----
  await test('CTA root ID exists; Watch now selected, others deselected individually', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Watch now'), true);
    assert.strictEqual(fx.rows['Watch now'].clicks, 1, 'initially-unselected target clicked once');
    for (const label of ['Experience now', 'Apply now', 'Order now']) {
      assert.strictEqual(fx.boxes[label].attrs['aria-checked'], 'false', `${label} must be unchecked`);
      assert.strictEqual(visibleTags(fx, label), false, `${label} tag must be hidden`);
    }
    assert.strictEqual(fx.state.clearClicks, 0, 'Clear All must never be clicked');
    assert.strictEqual(fx.clearBtn.clicks, 0, 'Clear All cross untouched');
  });

  await test('Root ID missing but heading exists; Order now selected', async env => {
    const fx = ctaFixture(env, { removeIdUpfront: true });
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Order now'), true);
  });

  // ---- 2. CTA dropdown opens through the nested shadow trigger ----
  await test('Dropdown opens through nested shadow trigger, not host', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.triggerClicks, 1, 'inner [part="base"] trigger clicked once');
    assert.strictEqual(fx.select.clicks, 0, 'select host wrapper must not be clicked');
  });

  // ---- 3+4. Deep Shadow DOM discovery through ks-dropdown-menu-list ----
  await test('All 25 captured options are mapped through deep shadow traversal', async env => {
    const fx = ctaFixture(env, { fullList: true, preselected: [] });
    assert.strictEqual(fx.options.length, 25);
    await env.campaign.configureCallToAction('Take survey');
    assert.strictEqual(fx.boxes['Take survey'].attrs['aria-checked'], 'true');
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Take survey']);
    for (const label of fx.options) {
      assert.ok(fx.rows[label], `row exists for ${label}`);
      assert.strictEqual(
        env.campaign.resolveCtaOptionLabel(fx.rows[label], fx.select),
        label,
        `label resolves for ${label}`
      );
    }
  });

  // ---- 5+6. Named slot label resolution ----
  await test('Named slot resolves Watch now via select host light DOM', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    const label = env.campaign.resolveCtaOptionLabel(fx.rows['Watch now'], fx.select);
    assert.strictEqual(label, 'Watch now');
  });

  await test('Named slot resolves Order now via select host light DOM', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    const label = env.campaign.resolveCtaOptionLabel(fx.rows['Order now'], fx.select);
    assert.strictEqual(label, 'Order now');
  });

  // ---- 7+8. assignedElements empty; host direct child is the source ----
  await test('assignedElements empty: label comes from the host direct child only', async env => {
    const fx = ctaFixture(env, { preselected: [], assignedMode: 'empty' });
    assert.deepStrictEqual(fx.rows['Watch now'].querySelector('slot').assignedElements(), [], 'fixture models the real empty channel');
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Watch now']), null, 'without the host there is no text in the row');
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Watch now'], fx.select), 'Watch now');
    const child = fx.select.children.find(el => el.getAttribute('slot') === fx.slotNames['Watch now']);
    assert.strictEqual(child, fx.hostLabelDivs['Watch now'], 'label DIV is a direct light child of the select host');
  });

  // ---- 9. Empty intermediary slot placeholder is ignored ----
  await test('Empty intermediary slot placeholder is ignored, host child wins', async env => {
    const fx = ctaFixture(env, { preselected: [], assignedMode: 'placeholder' });
    const assigned = fx.rows['Order now'].querySelector('slot').assignedElements();
    assert.strictEqual(assigned[0].tagName, 'SLOT', 'fixture returns a placeholder slot element');
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Order now']), null, 'placeholder contributes no text');
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Order now'], fx.select), 'Order now');
  });

  await test('assignedElements direct path still resolves without host fallback', async env => {
    const fx = ctaFixture(env, { preselected: [], assignedMode: 'direct' });
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Watch now']), 'Watch now');
  });

  // ---- 10. Dynamic generated slot names ----
  await test('Dynamic generated slot names resolve and configure', async env => {
    const fx = ctaFixture(env, { preselected: [], slotPrefix: 'slot-item-label-77RANDOM_99' });
    assert.strictEqual(fx.slotNames['Order now'], REAL_SLOT_NAMES['Order now'], 'real captured names kept for known labels');
    assert.strictEqual(fx.slotNames['Experience now'], 'slot-item-label-77RANDOM_99-0');
    assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Experience now'], fx.select), 'Experience now');
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
  });

  // ---- 12+13. Already-correct state returns success without changes ----
  await test('Watch now already selected and sole CTA: success with no clicks', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    const logs = await captureLogs(() => env.campaign.configureCallToAction('Watch now'));
    assert.strictEqual(fx.rows['Watch now'].clicks, 0, 'target never re-clicked');
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(fx.selectAllRow.clicks, 0);
    assert.ok(logs.some(l => l.includes('[CTA] Requested CTA already selected: Watch now')), `logs: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('[CTA] Exactly one selected CTA verified')), `logs: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('[CTA] No changes required')), `logs: ${logs.join(' | ')}`);
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  // ---- 14+15. Order now requested while Watch now selected; target first ----
  await test('Order now selected before Watch now is removed', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    await env.campaign.configureCallToAction('Order now');
    const selectIdx = fx.state.events.indexOf('click:Order now');
    const deselectIdx = fx.state.events.indexOf('click:Watch now');
    assert.ok(selectIdx !== -1, `events: ${fx.state.events.join(', ')}`);
    assert.ok(deselectIdx !== -1, `events: ${fx.state.events.join(', ')}`);
    assert.ok(selectIdx < deselectIdx, 'target selected BEFORE the old CTA is deselected');
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Order now'], 'exactly one selected CTA remains');
    assert.strictEqual(visibleTags(fx, 'Order now'), true);
    assert.strictEqual(visibleTags(fx, 'Watch now'), false);
  });

  // ---- 16+17+18. Individual deselection; never Clear All / Select all ----
  await test('Target already selected among defaults is kept, never re-clicked', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now', 'Apply now', 'Watch now', 'Order now'] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.rows['Watch now'].clicks, 0, 'already-selected target must not be clicked');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  await test('Select all row is never clicked', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.selectAllRow.clicks, 0, 'Select all row untouched');
    assert.strictEqual(fx.state.events.includes('click:Select all'), false);
    const selectAllBox = fx.selectAllRow.querySelector('ks-checkbox-923');
    assert.strictEqual(selectAllBox.attrs['aria-checked'], 'false');
  });

  await test('Overflow "+ 8 more" indicator gone when one CTA remains', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now', 'Apply now'], overflow: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.tags['+more'].visible, false, 'overflow indicator must be gone');
    assert.strictEqual(visibleTags(fx, 'Experience now'), false);
  });

  await test('Empty field selects directly without any clearing', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    assert.strictEqual(fx.clearBtn, null);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  // ---- 19. Off-screen rows are discoverable and deselected ----
  await test('Off-screen selected row is discovered and deselected', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now'], offscreenSelected: ['Order now'] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'false', 'off-screen option deselected');
    assert.strictEqual(visibleTags(fx, 'Order now'), false);
    assert.strictEqual(fx.boxes['Experience now'].attrs['aria-checked'], 'false');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  await test('Hidden selected option is deselected too', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now'], hiddenSelected: ['Order now'] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'false', 'hidden option deselected');
    assert.strictEqual(visibleTags(fx, 'Order now'), false);
    assert.strictEqual(fx.boxes['Experience now'].attrs['aria-checked'], 'false');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  // ---- 20. DOM rerender after each option click ----
  await test('Root ID removed during interaction; field reacquired via fallback', async env => {
    const fx = ctaFixture(env, { triggerRemovesId: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.section.attrs.id, undefined, 'fixture simulated the ID disappearing');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
    assert.strictEqual(visibleTags(fx, 'Watch now'), true);
  });

  await test('Dropdown closing after each deselect is recovered', async env => {
    const fx = ctaFixture(env, { deselectClosesMenu: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.ok(fx.state.triggerClicks >= 2, `dropdown reopened (trigger clicks: ${fx.state.triggerClicks})`);
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  await test('Double-check glitch is repaired by deselecting the other option', async env => {
    const fx = ctaFixture(env, { preselected: [], glitchDoubleCheck: true });
    await env.campaign.configureCallToAction('Watch now');
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  await test('Exactly one CTA remains after selecting Watch now', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    const checked = fx.options.filter(l => fx.boxes[l].attrs['aria-checked'] === 'true');
    assert.deepStrictEqual(checked, ['Watch now']);
  });

  // ---- 21. Tag verification ----
  await test('Correct selected tag is the only visible tag after success', async env => {
    const fx = ctaFixture(env, { overflow: true });
    await env.campaign.configureCallToAction('Order now');
    const visible = fx.options.filter(l => visibleTags(fx, l));
    assert.deepStrictEqual(visible, ['Order now']);
    assert.strictEqual(fx.tags['+more'].visible, false);
  });

  // ---- 22. Genuinely absent CTA ----
  await test('Unavailable CTA fails without touching selections', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now'] });
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      await assert.rejects(env.campaign.configureCallToAction('Fly now'), /not available/);
    } finally { console.log = orig; }
    assert.strictEqual(fx.boxes['Experience now'].attrs['aria-checked'], 'true', 'existing selection preserved');
    assert.strictEqual(visibleTags(fx, 'Experience now'), true);
    assert.strictEqual(fx.rows['Watch now'].clicks, 0, 'no option clicked on failure');
    assert.ok(logs.some(l => l.includes('[CTA DEBUG] Available CTA labels:')), 'debug lists available labels');
    assert.ok(logs.some(l => l.includes('[CTA DEBUG] Requested CTA matched: false')), 'debug names the miss');
    assert.ok(logs.some(l => l.includes('[CTA DEBUG] Menu rows found:')), 'debug reports row count');
  });

  // ---- 23. Unexpected empty menu fails safely ----
  await test('Persistent No Data fails safely without changing selections', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now'], noDataForever: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /not available|No Data|did not open/);
    assert.strictEqual(visibleTags(fx, 'Experience now'), true, 'existing selection untouched');
    assert.strictEqual(fx.state.clearClicks, 0, 'Clear All never used during recovery');
  });

  await test('Temporary No Data recovers on reopen', async env => {
    const fx = ctaFixture(env, { preselected: [], noDataUntilReopen: true });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.triggerClicks, 2, 'dropdown reopened once for recovery');
    assert.strictEqual(fx.boxes['Watch now'].attrs['aria-checked'], 'true');
  });

  // ---- Remaining working scenarios preserved ----
  await test('Editor already open (no Edit button) proceeds', async env => {
    const fx = ctaFixture(env, { withEdit: false });
    await env.campaign.configureCallToAction('Order now');
    assert.strictEqual(fx.boxes['Order now'].attrs['aria-checked'], 'true');
    assert.strictEqual(fx.state.editClicks, 0);
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

  // ---- 24. Multiple campaign configuration remains intact ----
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
