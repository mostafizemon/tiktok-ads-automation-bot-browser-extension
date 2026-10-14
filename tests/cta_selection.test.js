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
  const state = { clearClicks: 0, triggerClicks: 0, editClicks: 0, decoyClicks: 0, events: [], tagCloseClicks: {}, selectedSnapshots: [] };
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
    state.selectedSnapshots.push(Object.keys(tags).filter(label => label !== '+more'));
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
  let allRows = [...ul.children];
  const searchHost = popup.appendChild(new Node('ks-input-923'));
  const search = searchHost.shadow().appendChild(new Node('input', { part: 'input', placeholder: 'Search' }));
  search.value = opts.staleFilter || '';
  search.dispatchEvent = event => {
    if (event.type !== 'input') return;
    state.events.push('search:' + search.value);
    if (opts.permanentAfterClear && state.clearClicks) return;
    ul.children = allRows.filter(row => !search.value ||
      env.campaign.resolveCtaOptionLabel(row, select)?.toLowerCase().includes(search.value.toLowerCase()));
    if (search.value) {
      for (const row of ul.children) {
        const label = env.campaign.resolveCtaOptionLabel(row, select);
        if (hiddenSelected.includes(label) || offscreenSelected.includes(label)) row.visible = true;
      }
    }
  };
  if (opts.missingSearch) searchHost.visible = false;
  const arrow = valueField.appendChild(new Node('div', { slot: 'suffix', class: 'select__suffix' }));
  arrow.appendChild(new Node('ks-icon-923', { name: 'chevron-down' }));

  const showOptionRows = () => { if (!selectAllRow) { buildRows(); allRows = [...ul.children]; } };
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
  return { section, select, trigger, arrow, search, valueField, spinner, popup, clearBtn, get selectAllRow() { return selectAllRow; }, dropdownMenu, list, ul, boxes, rows, tags, slotNames, hostLabelDivs, state, options, restoreOptions: () => { ul.children = allRows; } };
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
    assert.strictEqual(fx.state.clearClicks, 0);
    assert.strictEqual(fx.state.decoyClicks, 0);
    assert.ok(!fx.state.events.includes('click:Select all'));
    assert.ok(fx.state.selectedSnapshots.every(tags => tags.length > 0), 'never intentionally reaches zero selections');
  };
  for (const [before, requested] of [['Watch now', 'Order now'], ['Order now', 'Watch now']]) {
    await test(before + ' -> ' + requested + ' selects target before removal', async env => {
      const fx = ctaFixture(env, { preselected: [before], permanentAfterClear: true });
      await env.campaign.configureCallToAction(requested); verify(fx, requested);
      assert.ok(fx.state.events.indexOf('click:' + requested) < fx.state.events.indexOf('tag-remove:' + before));
      assert.deepStrictEqual(fx.state.selectedSnapshots, [[before, requested], [requested]]);
    });
  }
  await test('Real failure fixture: Clear would destroy rows, simulated refresh restores them', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'], permanentAfterClear: true });
    const count = fx.ul.children.length;
    fx.clearBtn.click(); assert.strictEqual(fx.ul.children.length, 0);
    fx.restoreOptions(); assert.strictEqual(fx.ul.children.length, count);
  });
  await test('Same broken-clear fixture succeeds normally without Clear or refresh', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now', 'Apply now'], permanentAfterClear: true });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.ok(fx.state.selectedSnapshots.every(labels => labels.includes('Order now')));
  });
  await test('Target among multiple tags removes others without Edit or dropdown', async env => {
    const fx = ctaFixture(env, { preselected: ['Experience now', 'Apply now', 'Watch now'] });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.state.editClicks, 0); assert.strictEqual(fx.state.triggerClicks, 0);
    assert.strictEqual(fx.rows['Watch now'].clicks, 0);
  });
  await test('Exactly correct selected CTA skips all clicks', async env => {
    const fx = ctaFixture(env, { preselected: ['Order now'] });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.deepStrictEqual(fx.state.events, []);
  });
  await test('Hidden overflow tags removed individually while preserving target', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'], hiddenSelected: ['Experience now'], offscreenSelected: ['Apply now'], overflow: true });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.ok(fx.state.selectedSnapshots.every(labels => labels.includes('Watch now')));
  });
  await test('Missing tag close falls back to scoped unwanted checkbox', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'], noTagClose: true });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.rows['Order now'].clicks, 1); assert.strictEqual(fx.rows['Watch now'].clicks, 1);
  });
  await test('Unresponsive individual close uses checkbox once, never global clear', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    const close = fx.tags['Watch now'].shadowRoot.querySelector('[part="closeIcon"]'); close.onClick = () => {};
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(close.clicks, 1); assert.strictEqual(fx.rows['Watch now'].clicks, 1);
  });
  await test('Tags rerender after each removal; fresh close handles used', async env => {
    const fx = ctaFixture(env, { rerenderAfterRemove: true });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.tagCloseClicks['Experience now'], 1); assert.strictEqual(fx.state.tagCloseClicks['Apply now'], 1);
  });
  await test('Collapsed editor expands once before adding absent target', async env => {
    const fx = ctaFixture(env, { editorOpen: false });
    await env.campaign.configureCallToAction('Watch now'); verify(fx, 'Watch now');
    assert.strictEqual(fx.state.editClicks, 1);
  });
  await test('Popup opens asynchronously without duplicate opening click', async env => {
    const fx = ctaFixture(env, { openDelay: 1000 });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.triggerClicks, 1);
  });
  await test('Temporary No Data during search settles non-destructively', async env => {
    const fx = ctaFixture(env); const dispatch = fx.search.dispatchEvent;
    fx.search.dispatchEvent = event => {
      dispatch(event);
      if (event.type === 'input' && fx.search.value === 'Order now') {
        const ready = [...fx.ul.children]; fx.ul.children = [];
        env.later(1000, () => { fx.ul.children = ready; });
      }
    };
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.triggerClicks, 1);
  });
  await test('No Data recovers with one scoped close/reopen', async env => {
    const fx = ctaFixture(env, { noDataUntilReopen: true });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.triggerClicks, 3);
  });
  await test('Order now search shows No Data but unfiltered exact row succeeds', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    const dispatch = fx.search.dispatchEvent;
    fx.search.dispatchEvent = event => {
      dispatch(event);
      if (fx.search.value === 'Order now') fx.ul.children = [];
    };
    const logs = await captureLogs(() => env.campaign.configureCallToAction('Order now'));
    verify(fx, 'Order now');
    assert.strictEqual(fx.rows['Order now'].clicks, 1);
    assert.strictEqual(fx.state.events.filter(event => event === 'search:Order now').length, 1);
    assert.strictEqual(fx.state.triggerClicks, 1);
    assert.ok(logs.some(line => line.includes('Exact CTA recovered after clearing search filter: Order now')));
  });
  await test('Order now only recovers after scoped reopen without repeating broken search', async env => {
    const fx = ctaFixture(env, { preselected: ['Watch now'] });
    const dispatch = fx.search.dispatchEvent;
    fx.search.dispatchEvent = event => {
      dispatch(event);
      if (fx.search.value === 'Order now' || fx.state.triggerClicks < 3) fx.ul.children = [];
    };
    const arrowClick = fx.arrow.onClick;
    fx.arrow.onClick = () => {
      arrowClick();
      if (fx.state.triggerClicks >= 3) fx.restoreOptions();
    };
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(fx.state.triggerClicks, 3);
    assert.strictEqual(fx.state.events.filter(event => event === 'search:Order now').length, 1);
  });
  await test('Permanent No Data preserves initial tags and identifies search stage', async env => {
    const fx = ctaFixture(env, { noDataForever: true });
    const logs = await captureLogs(async () => {
      await assert.rejects(env.campaign.configureCallToAction('Order now'), /zero option rows after bounded recovery/);
    });
    assert.deepStrictEqual(Object.keys(fx.tags), ['Experience now', 'Apply now']);
    assert.strictEqual(fx.state.clearClicks, 0); assert.strictEqual(fx.state.triggerClicks, 3);
    for (const field of ['Stage:', 'Selected tags before:', 'Selected tags after:', 'Search input found:', 'No Data visible:', 'CTA select connected:', 'CTA menu connected:', 'Elapsed ms:', 'recovery count: 1/1']) {
      assert.ok(logs.some(line => line.includes(field)), field);
    }
  });
  await test('Missing search preserves initial selection', async env => {
    const fx = ctaFixture(env, { missingSearch: true });
    await assert.rejects(env.campaign.configureCallToAction('Order now'), /search input not found/);
    assert.deepStrictEqual(Object.keys(fx.tags), ['Experience now', 'Apply now']);
    assert.strictEqual(fx.state.clearClicks, 0);
  });
  await test('Genuine unavailability does not mutate tags', async env => {
    const fx = ctaFixture(env);
    await assert.rejects(env.campaign.configureCallToAction('Fly now'), /not found in loaded results|zero option rows/);
    assert.deepStrictEqual(Object.keys(fx.tags), ['Experience now', 'Apply now']);
    assert.strictEqual(fx.state.clearClicks, 0); assert.deepStrictEqual(fx.state.selectedSnapshots, []);
  });
  await test('Rerender after selecting target preserves old selections before removing them', async env => {
    const first = ctaFixture(env, { preselected: ['Watch now'] }); let second;
    first.rows['Order now'].onClick = () => {
      first.section.visible = false;
      second = ctaFixture(env, { preselected: ['Watch now', 'Order now'] });
    };
    await env.campaign.configureCallToAction('Order now'); verify(second, 'Order now');
    assert.strictEqual(first.rows['Order now'].clicks, 1); assert.strictEqual(first.state.clearClicks, 0);
  });
  await test('Rows unmount after selection; requested tag still verified before removals', async env => {
    const fx = ctaFixture(env); const row = fx.rows['Order now']; const click = row.onClick;
    row.onClick = () => { click(); fx.ul.children = []; fx.dropdownMenu.visible = false; };
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
    assert.strictEqual(row.clicks, 1);
  });
  await test('Individual removal losing target stops immediately', async env => {
    const fx = ctaFixture(env, { preselected: ['Order now', 'Watch now'] });
    const close = fx.tags['Watch now'].shadowRoot.querySelector('[part="closeIcon"]');
    close.onClick = () => {
      fx.valueField.children = fx.valueField.children.filter(node => node !== fx.tags['Order now']);
    };
    await assert.rejects(env.campaign.configureCallToAction('Order now'), /Requested CTA tag lost/);
    assert.strictEqual(close.clicks, 1); assert.strictEqual(fx.state.clearClicks, 0);
  });
  await test('Failed target click is never repeated and leaves old tags alone', async env => {
    const fx = ctaFixture(env); fx.rows['Order now'].onClick = () => {};
    await assert.rejects(env.campaign.configureCallToAction('Order now'), /tag did not appear/);
    assert.strictEqual(fx.rows['Order now'].clicks, 1); assert.strictEqual(fx.state.clearClicks, 0);
    assert.deepStrictEqual(Object.keys(fx.tags), ['Experience now', 'Apply now']);
  });
  await test('Missing dropdown never clicks unrelated field or mutates tags', async env => {
    const fx = ctaFixture(env); fx.arrow.onClick = () => {};
    await assert.rejects(env.campaign.configureCallToAction('Order now'), /Dropdown did not open/);
    assert.strictEqual(fx.state.decoyClicks, 0); assert.strictEqual(fx.state.clearClicks, 0);
  });
  await test('Stop during open prevents selection and removal', async env => {
    const fx = ctaFixture(env, { openDelay: 1000 });
    env.later(200, () => { global.AutomationRunner.shouldAbort = true; });
    await assert.rejects(env.campaign.configureCallToAction('Order now'), /aborted/);
    assert.deepStrictEqual(Object.keys(fx.tags), ['Experience now', 'Apply now']);
  });
  await test('Slotted field trigger and spinner LIGHT DOM preserve structural traversal', async env => {
    const fx = ctaFixture(env);
    fx.select.shadowRoot.children = fx.select.shadowRoot.children.filter(node => node !== fx.valueField);
    fx.select.appendChild(fx.valueField);
    assert.strictEqual(fx.spinner.shadowRoot.querySelectorAll('li.dropdown-item').length, 0);
    assert.ok(fx.spinner.querySelectorAll('li.dropdown-item').length);
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
  });
  await test('Dynamic custom element suffixes and named slots', async env => {
    const fx = ctaFixture(env, { assignedMode: 'placeholder' });
    const visit = node => {
      node.tagName = node.tagName.replace(/-923$/, '-DIFFERENT');
      for (const child of node.children) visit(child);
      if (node.shadowRoot) visit(node.shadowRoot);
    };
    visit(fx.select);
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
  });
  await test('Off-screen result discovered then scrolled before click', async env => {
    const fx = ctaFixture(env); const row = fx.rows['Order now'];
    row.visible = false; row.scrollIntoView = () => { row.visible = true; };
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
  });
  await test('Stale filter cleared only in the scoped CTA popup', async env => {
    const fx = ctaFixture(env, { staleFilter: 'Something else' });
    const other = env.document.body.appendChild(new Node('input', { part: 'input', placeholder: 'Search' })); other.value = 'Canada';
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now'); assert.strictEqual(other.value, 'Canada');
  });
  await test('Two campaigns independently verify requested CTA', async env => {
    const first = ctaFixture(env); await env.campaign.configureCallToAction('Watch now'); first.section.visible = false;
    const second = ctaFixture(env); await env.campaign.configureCallToAction('Order now');
    verify(first, 'Watch now'); verify(second, 'Order now');
  });
  await test('Empty initial field selects target and verifies exactly one tag', async env => {
    const fx = ctaFixture(env, { preselected: [] });
    await env.campaign.configureCallToAction('Order now'); verify(fx, 'Order now');
  });
  await test('Normalized case-insensitive CTA matches exact label', async env => {
    const fx = ctaFixture(env); await env.campaign.configureCallToAction('  Order   NOW '); verify(fx, 'Order now');
  });
  await test('Existing named-slot label resolver remains unchanged', async env => {
    for (const mode of ['direct', 'placeholder', 'empty']) {
      const fx = ctaFixture(env, { assignedMode: mode });
      assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Watch now'], fx.select), 'Watch now');
      assert.strictEqual(env.campaign.resolveCtaOptionLabel(fx.rows['Order now'], fx.select), 'Order now');
      fx.section.visible = false;
    }
  });
  await test('Missing config stops without touching field', async env => {
    const fx = ctaFixture(env);
    await assert.rejects(env.campaign.configureCallToAction(''), /required/);
    assert.strictEqual(fx.state.triggerClicks, 0);
  });
  console.log('CTA SELECTION TEST RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exitCode = failed ? 1 : 0;
})();
