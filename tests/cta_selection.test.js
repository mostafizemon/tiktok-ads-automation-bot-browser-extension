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
  focus() {}
  blur() {}
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
  global.window = { location: { href: 'https://ads.tiktok.com/i18n/manage/campaign', pathname: '/i18n/manage/campaign' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
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
  global.window.HTMLInputElement = Node;
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
    noTagClose = false, // tags lack [part=closeIcon] -> dropdown deselection fallback
    rerenderAfterRemove = false, // simulate field rerender replacing remaining tag nodes
  } = opts;
  const options = fullList ? FULL_CTA_LIST : CTA_OPTIONS;
  const body = env.document.body;
  const state = { clearClicks: 0, triggerClicks: 0, editClicks: 0, decoyClicks: 0, events: [], tagCloseClicks: {} };
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
  const valueField = selRoot.appendChild(new Node('ks-value-field-923', { part: 'field' }));

  // REAL STRUCTURE: tags exist ONLY for selected CTAs. Label text lives in a
  // light-DOM <span>; the close control lives in the tag's open shadowRoot:
  //   div[part="base"] > div[part="closeIcon"][aria-label="Remove tag"]
  const removeTagNode = (label) => {
    const tag = tags[label];
    if (!tag) return;
    const idx = valueField.children.indexOf(tag);
    if (idx >= 0) valueField.children.splice(idx, 1);
    tag.visible = false;
    delete tags[label];
  };
  const makeTag = (label, visible = true) => {
    const tag = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }));
    if (!noTagClose) {
      const base = tag.shadow().appendChild(new Node('div', { part: 'base' }));
      const closeIcon = base.appendChild(new Node('div', { part: 'closeIcon', role: 'button', 'aria-label': 'Remove tag' }));
      closeIcon.onClick = () => {
        state.events.push(`tag-remove:${label}`);
        state.tagCloseClicks[label] = (state.tagCloseClicks[label] || 0) + 1;
        setSelected(label, false);
        if (rerenderAfterRemove) rerenderRemainingTags();
      };
    }
    tag.appendChild(new Node('span', {}, label));
    tag.visible = visible;
    tags[label] = tag;
    return tag;
  };
  const setSelected = (label, on) => {
    const box = boxes[label];
    if (box) box.attrs['aria-checked'] = on ? 'true' : 'false';
    if (on) {
      if (!tags[label]) makeTag(label, true);
      else tags[label].visible = true;
    } else {
      removeTagNode(label);
    }
    syncOverflow();
  };
  // Simulates TikTok rerendering the tagged field: remaining tag nodes are
  // replaced, so any previously captured handles become stale.
  const rerenderRemainingTags = () => {
    for (const label of Object.keys(tags)) {
      if (label === '+more') continue;
      const wasVisible = tags[label].visible;
      removeTagNode(label);
      makeTag(label, wasVisible);
    }
  };
  const syncOverflow = () => {
    if (!tags['+more']) return;
    const count = Object.keys(tags).filter(l => l !== '+more').length;
    tags['+more'].visible = count > 1;
  };
  for (const label of [...preselected, ...hiddenSelected, ...offscreenSelected]) {
    if (!options.includes(label) || tags[label]) continue;
    makeTag(label, !hiddenSelected.includes(label) && !offscreenSelected.includes(label));
  }
  if (overflow) {
    tags['+more'] = valueField.appendChild(new Node('ks-tag-923', { class: 'value-field__tagged__tag-item' }, '+ 8 more'));
    tags['+more'].visible = checked.size > 1;
  }

  const vfRoot = valueField.shadow();
  const trigger = vfRoot.appendChild(new Node('button', { part: 'base' }));
  // The Clear All cross exists in the DOM but the automation must never click it.
  let clearBtn = null;
  if (checked.size > 0) {
    clearBtn = vfRoot.appendChild(new Node('div', { class: 'value-field__clear', part: 'suffixIcon' }));
    clearBtn.appendChild(new Node('slot', { name: 'closeIcon' }))
      .appendChild(new Node('ks-icon-923', { name: 'filled-close' }));
    clearBtn.onClick = () => {
      state.clearClicks++; state.events.push('clear');
      for (const label of options) setSelected(label, false);
      if (opts.clearCloses) dropdownMenu.visible = false;
      if (opts.clearNoData || opts.permanentAfterClear) {
        ul.children = [];
        if (!opts.permanentAfterClear && opts.clearNoData !== 'reopen') env.later(1000, () => { ul.children = allRows; });
      }
    };
  }

  // REAL STRUCTURE: menu lives inside the select's shadow tree, nested through
  // ks-dropdown-menu -> ks-popover (shadow + light .dropdown-menu__popup) ->
  // ks-dropdown-menu-list (shadow) -> ks-spinner (light) -> wrapper -> ul.
  const dropdownMenu = selRoot.appendChild(new Node('ks-dropdown-menu-923', { part: 'dropdown' }));
  dropdownMenu.visible = false;
  const menuRoot = dropdownMenu.shadow();
  const popover = menuRoot.appendChild(new Node('ks-popover-923'));
  popover.shadow();
  const popup = popover.appendChild(new Node('div', { class: 'dropdown-menu__popup' }));
  const list = popup.appendChild(new Node('ks-dropdown-menu-list-923'));
  const listRoot = list.shadow();
  const spinner = listRoot.appendChild(new Node('ks-spinner-923'));
  spinner.shadow().appendChild(new Node('slot'));
  const wrapper = spinner.appendChild(new Node('div', { class: 'dropdown-menu__list__wrapper' }));
  wrapper.scrollTop = 0;
  const ul = wrapper.appendChild(new Node('ul'));

  // A neutral outside click closes the open popover, as in the real UI.
  body.onClick = () => { dropdownMenu.visible = false; };

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
        setSelected(label, !on);
        if (on && deselectClosesMenu) dropdownMenu.visible = false;
        if (!on && glitchDoubleCheck) {
          const other = options.find(l => l !== label);
          setSelected(other, true);
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
  const allRows = [...ul.children];
  const searchHost = popup.appendChild(new Node('ks-input-923'));
  const search = searchHost.shadow().appendChild(new Node('input', { part: 'input', placeholder: 'Search' }));
  search.value = opts.staleFilter || '';
  search.dispatchEvent = event => {
    if (event.type !== 'input') return;
    state.events.push('search:' + search.value);
    if (opts.permanentAfterClear && state.clearClicks) return;
    ul.children = allRows.filter(row => !search.value ||
      env.campaign.resolveCtaOptionLabel(row, select)?.toLowerCase().includes(search.value.toLowerCase()));
  };
  if (opts.missingSearch) searchHost.visible = false;
  const arrow = valueField.appendChild(new Node('div', { slot: 'suffix', class: 'select__suffix' }));
  arrow.appendChild(new Node('ks-icon-923', { name: 'chevron-down' }));

  const showOptionRows = () => { if (!selectAllRow) buildRows(); };
  trigger.onClick = () => {
    state.triggerClicks++;
    state.events.push('trigger');
    dropdownMenu.visible = !dropdownMenu.visible;
    if (opts.openDelay && state.triggerClicks === 1) {
      dropdownMenu.visible = false;
      env.later(opts.openDelay, () => { dropdownMenu.visible = true; });
    }
    if (opts.clearNoData === 'reopen' && state.clearClicks && state.triggerClicks >= 3) ul.children = allRows;
    if (triggerRemovesId && state.triggerClicks === 1) delete section.attrs.id;
    if (noDataUntilReopen && state.triggerClicks >= 2) showOptionRows();
  };
  arrow.onClick = trigger.onClick;

  if (unrelated) {
    const other = body.appendChild(new Node('div', { id: 'fieldRenderer-unrelated' }));
    const otherSelect = other.appendChild(new Node('ks-select-999'));
    const decoy = otherSelect.shadow().appendChild(new Node('button', { part: 'base' }, 'Unrelated dropdown'));
    decoy.onClick = () => { state.decoyClicks++; };
    state.decoy = decoy;
  }
  return { section, select, trigger, arrow, search, valueField, spinner, popup, clearBtn, get selectAllRow() { return selectAllRow; }, dropdownMenu, list, ul, boxes, rows, tags, slotNames, hostLabelDivs, state, options };
}

function visibleTags(fx, label) {
  return !!(fx.tags[label] && fx.tags[label].visible);
}

(async () => {
  let passed = 0; let failed = 0;
  const realNow = Date.now;
  async function test(name, fn) {
    const env = setup(); Date.now = env.now;
    try { await fn(env); passed++; console.log('PASS: ' + name); }
    catch (error) { failed++; console.error('FAIL: ' + name, error.stack); }
    finally { Date.now = realNow; }
  }
  const verify = (fx, label) => {
    assert.deepStrictEqual(Object.keys(fx.tags).filter(key => key !== '+more'), [label]);
    assert.strictEqual(fx.state.clearClicks, 1);
    assert.strictEqual(fx.state.decoyClicks, 0);
    assert.ok(!fx.state.events.includes('click:Select all'));
  };
  await test('Collapsed editor expands once', async env => {
    const fx = ctaFixture(env, { editorOpen: false });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.editClicks, 1); verify(fx, 'Watch now');
  });
  await test('Editable editor skips Edit and opens correct arrow', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.editClicks, 0); assert.strictEqual(fx.arrow.clicks, 1);
    assert.strictEqual(fx.trigger.clicks, 0); verify(fx, 'Watch now');
    assert.ok(fx.state.events.indexOf('trigger') < fx.state.events.indexOf('clear'));
    assert.ok(fx.state.events.indexOf('clear') < fx.state.events.indexOf('search:Watch now'));
  });
  await test('Already correct single CTA skips every click', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.editClicks, 0); assert.strictEqual(fx.state.triggerClicks, 0);
    assert.strictEqual(fx.state.clearClicks, 0); assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Multiple CTAs including requested target clear once then search', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now', 'Apply now'], overflow: true });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.rows['Watch now'].clicks, 1);
  });
  for (const label of ['Watch now', 'Order now']) {
    await test('Search and exact named-slot result: ' + label, async env => {
      const fx = ctaFixture(env, { assignedMode: 'placeholder', fullList: true });
      await env.campaign.configureCallToAction(label); verify(fx, label);
      assert.ok(fx.state.events.includes('search:' + label));
      assert.strictEqual(fx.rows[label].clicks, 1);
    });
  }
  await test('Clearing closes popup and reopens once', async env => {
    const fx = ctaFixture(env, { clearCloses: true });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.triggerClicks, 2);
  });
  await test('Temporary No Data settles without a second clear', async env => {
    const fx = ctaFixture(env, { clearNoData: true });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.state.triggerClicks, 1);
  });
  await test('No Data recovers with one scoped close/reopen', async env => {
    const fx = ctaFixture(env, { clearNoData: 'reopen' });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.state.triggerClicks, 3);
  });
  await test('Permanent No Data stops with recovery diagnostic', async env => {
    const fx = ctaFixture(env, { permanentAfterClear: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /did not recover after clear/);
    assert.strictEqual(fx.state.clearClicks, 1);
    assert.strictEqual(fx.rows['Watch now'].clicks, 0);
    assert.strictEqual(fx.state.triggerClicks, 3);
  });
  await test('Search missing stops safely', async env => {
    const fx = ctaFixture(env, { missingSearch: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /search input not found/);
    assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Options unavailable before clear preserves existing tags', async env => {
    const fx = ctaFixture(env, { noDataForever: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /Options not ready/);
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(visibleTags(fx, 'Experience now'), true);
  });
  await test('Unknown CTA cannot clear the field', async env => {
    const fx = ctaFixture(env);
    await assert.rejects(env.campaign.configureCallToAction('Fly now'), /Requested CTA not found in loaded results/);
    assert.strictEqual(fx.state.clearClicks, 0);
  });
  await test('Popup transition delay is awaited without duplicate click', async env => {
    const fx = ctaFixture(env, { openDelay: 1000 });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.state.triggerClicks, 1);
  });
  await test('Slotted light-DOM value field and spinner light-DOM rows', async env => {
    const fx = ctaFixture(env);
    fx.select.shadowRoot.children = fx.select.shadowRoot.children.filter(node => node !== fx.valueField);
    fx.select.appendChild(fx.valueField);
    assert.strictEqual(fx.spinner.shadowRoot.querySelectorAll('li.dropdown-item').length, 0);
    assert.ok(fx.spinner.querySelectorAll('li.dropdown-item').length > 0);
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
  });
  await test('Dynamic custom-element suffixes supported', async env => {
    const fx = ctaFixture(env);
    const visit = node => {
      if (node.tagName.startsWith('KS-')) node.tagName = node.tagName.replace(/-923$/, '-CHANGED');
      for (const child of node.children) visit(child);
      if (node.shadowRoot) visit(node.shadowRoot);
    };
    visit(fx.select);
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
  });
  await test('Arrow absent uses field base, never clear icon', async env => {
    const fx = ctaFixture(env); fx.arrow.visible = false;
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.trigger.clicks, 1);
  });
  await test('Mounted rows in closed popup require arrow click', async env => {
    const fx = ctaFixture(env); assert.ok(fx.ul.children.length);
    await env.campaign.configureCallToAction('Watch now'); assert.strictEqual(fx.arrow.clicks, 1);
  });
  await test('Stale search is cleared only in the associated popup', async env => {
    const fx = ctaFixture(env, { staleFilter: 'Unmatched' });
    const other = env.document.body.appendChild(new Node('input', { part: 'input', placeholder: 'Search' }));
    other.value = 'Canada';
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(other.value, 'Canada'); assert.ok(fx.state.events.includes('search:'));
  });
  await test('Case-insensitive normalized label match', async env => {
    const fx = ctaFixture(env);
    await env.campaign.configureCallToAction('  watch   NOW  '); verify(fx, 'Watch now');
  });
  await test('No preselected tags skips clear', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(visibleTags(fx, 'Watch now'), true);
  });
  await test('Framework rerenders result row after selection without second click', async env => {
    const fx = ctaFixture(env); const row = fx.rows['Watch now']; const click = row.onClick;
    row.onClick = () => { click(); fx.ul.children = []; fx.dropdownMenu.visible = false; };
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(row.clicks, 1);
  });
  await test('Wrong or multiple final tags stop', async env => {
    const fx = ctaFixture(env, { glitchDoubleCheck: true });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /selection verification failed/);
    assert.strictEqual(fx.state.clearClicks, 1); assert.strictEqual(fx.rows['Watch now'].clicks, 1);
  });
  await test('Stop during open transition prevents clear and selection', async env => {
    const fx = ctaFixture(env, { openDelay: 1000 });
    env.later(200, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /aborted/);
    assert.strictEqual(fx.state.clearClicks, 0); assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Delayed select expansion reacquires field', async env => {
    const fx = ctaFixture(env, { editorOpen: false, selectDelay: 1000 });
    fx.state.editBtn.onClick = () => { fx.state.editClicks++; };
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
  });
  await test('Missing dropdown never clicks unrelated select', async env => {
    const fx = ctaFixture(env);
    fx.arrow.onClick = () => {};
    fx.trigger.onClick = () => {};
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /Dropdown did not open/);
    assert.strictEqual(fx.state.decoyClicks, 0); assert.strictEqual(fx.state.clearClicks, 0);
  });
  await test('Assigned and direct named slots resolve exact labels', async env => {
    for (const mode of ['direct', 'placeholder', 'empty']) {
      const fx = ctaFixture(env, { assignedMode: mode });
      assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Watch now'], fx.select), 'Watch now');
      assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Order now'], fx.select), 'Order now');
      fx.section.visible = false;
    }
  });
  await test('Second campaign independently executes same CTA workflow', async env => {
    const first = ctaFixture(env); await env.campaign.configureCallToAction('Watch now');
    first.section.visible = false;
    const second = ctaFixture(env); await env.campaign.configureCallToAction('Order now');
    verify(first, 'Watch now'); verify(second, 'Order now');
  });
  await test('Missing config fails before clicks', async env => {
    const fx = ctaFixture(env);
    await assert.rejects(env.campaign.configureCallToAction(''), /required/);
    assert.strictEqual(fx.state.triggerClicks, 0);
  });
  await test('Clear All failing to update tags stops without selection', async env => {
    const fx = ctaFixture(env);
    fx.clearBtn.onClick = () => { fx.state.clearClicks++; };
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /Clear All did not update/);
    assert.strictEqual(fx.clearBtn.clicks, 1); assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Off-screen row is discovered, then scrolled into view for click', async env => {
    const fx = ctaFixture(env); const row = fx.rows['Watch now'];
    row.visible = false; row.scrollIntoView = () => { row.visible = true; };
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(row.clicks, 1);
  });
  await test('Opacity-zero popup transition is not treated as open', async env => {
    const fx = ctaFixture(env);
    const computed = window.getComputedStyle;
    const surface = fx.popup.parentElement.shadowRoot.appendChild(new Node('div', { class: 'tooltip__popup' }));
    surface.opacity = '0';
    window.getComputedStyle = node => ({ ...computed(node), opacity: node.opacity || '1' });
    const clicked = fx.arrow.onClick;
    fx.arrow.onClick = () => { clicked(); env.later(1000, () => { surface.opacity = '1'; }); };
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.arrow.clicks, 1);
  });
  await test('Missing arrow and field base never click global clear', async env => {
    const fx = ctaFixture(env); fx.arrow.visible = false; fx.trigger.visible = false;
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /Dropdown arrow not found/);
    assert.strictEqual(fx.state.clearClicks, 0); assert.strictEqual(fx.state.decoyClicks, 0);
  });
  await test('Failed filtered result reports search stage after clear', async env => {
    const fx = ctaFixture(env);
    const dispatch = fx.search.dispatchEvent;
    fx.search.dispatchEvent = event => { dispatch(event); if (fx.search.value === 'Watch now') fx.ul.children = []; };
    await assert.rejects(env.campaign.configureCallToAction('Watch now'), /Search results not available/);
    assert.strictEqual(fx.state.clearClicks, 1); assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Full CTA select rerender after Clear is reacquired', async env => {
    const first = ctaFixture(env);
    let second;
    first.clearBtn.onClick = () => {
      first.state.clearClicks++; first.section.visible = false;
      second = ctaFixture(env, { preselected: [] });
    };
    await env.campaign.configureCallToAction('Watch now');
    assert.strictEqual(first.state.clearClicks, 1); assert.strictEqual(second.state.clearClicks, 0);
    assert.strictEqual(second.rows['Watch now'].clicks, 1);
    assert.strictEqual(visibleTags(second, 'Watch now'), true);
  });
  console.log('CTA SELECTION TEST RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exitCode = failed ? 1 : 0;
})();
