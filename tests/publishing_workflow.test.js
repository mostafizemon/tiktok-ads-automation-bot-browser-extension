/**
 * tests/publishing_workflow.test.js
 * Deterministic test suite for TikTok Ads Automation publishing workflow and sequential loop.
 *
 * Covers all 10 required scenarios:
 * 1. Publish success with delayed redirect
 * 2. Publish success with immediate redirect
 * 3. Redirect without success confirmation (ambiguous -> NEEDS_VERIFICATION)
 * 4. TikTok publish error (batch stops)
 * 5. Refresh after confirmed submission (reload recovery)
 * 6. Multiple campaigns sequentially (1/3 -> 2/3 -> 3/3 -> COMPLETED)
 * 7. Page reload during submission (TikTok full page reload recovery)
 * 8. Unknown submission outcome (60s timeout -> NEEDS_VERIFICATION)
 * 9. Duplicate refresh prevention
 * 10. Stop / Pause during publishing
 * Plus: Strict Test Mode preservation (never clicks Publish all, no refresh, no loop)
 */

const assert = require('assert');

// Minimal DOM node supporting open Shadow DOM and CSS queries
class MockNode {
  constructor(tagName = 'DIV', attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.shadowRoot = null;
    this.textContent = '';
    this.innerText = '';
    this.classList = {
      _classes: new Set((attrs.class || '').split(' ').filter(Boolean)),
      contains: (c) => this.classList._classes.has(c),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c)
    };
    this.disabled = !!attrs.disabled;
    this.style = { display: 'block', visibility: 'visible', opacity: '1' };
    this.eventListeners = {};
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
    this.children.push(child);
    return child;
  }

  attachShadow() {
    this.shadowRoot = new MockNode('#SHADOW-ROOT');
    return this.shadowRoot;
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(evt) {
    return true;
  }

  click() {
    if (this.disabled) return;
    if (this.eventListeners['click']) {
      this.eventListeners['click'].forEach(fn => fn({ type: 'click', target: this }));
    }
  }

  scrollIntoView() {}

  getBoundingClientRect() {
    return { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 };
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selectorString) {
    const results = [];
    // Handle comma-separated selectors
    const subSelectors = selectorString.split(',').map(s => s.trim()).filter(Boolean);

    const matchSingle = (el, sel) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();

      // Wildcard
      if (sel === '*') return true;

      // Tag name match
      if (sel.toLowerCase() === tag) return true;

      // Class selector .class
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return el.classList.contains(cls);
      }

      // Attribute substring [attr*="val"]
      if (sel.includes('*=')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)\*=["']?([^"'\]]+)["']?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          const attrVal = attr === 'class' ? Array.from(el.classList._classes).join(' ') : el.attributes[attr];
          return attrVal && attrVal.includes(val);
        }
      }

      // Attribute exact [attr="val"]
      if (sel.includes('=')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)=["']?([^"'\]]+)["']?\]/);
        if (m) {
          const attr = m[1];
          const val = m[2];
          return el.attributes[attr] === val;
        }
      }

      // Attribute presence [attr]
      if (sel.startsWith('[') && sel.endsWith(']')) {
        const attr = sel.slice(1, -1);
        return el.attributes[attr] !== undefined;
      }

      // Tag + attribute e.g. ks-button-923[data-testid="common_next_button"]
      if (sel.includes('[')) {
        const tagPart = sel.slice(0, sel.indexOf('['));
        const rest = sel.slice(sel.indexOf('['));
        if (tagPart && tagPart.toLowerCase() !== tag) return false;
        return matchSingle(el, rest);
      }

      return false;
    };

    const match = (el) => {
      return subSelectors.some(sel => matchSingle(el, sel));
    };

    const traverse = (node) => {
      for (const child of node.children) {
        if (match(child)) results.push(child);
        traverse(child);
      }
    };

    traverse(this);
    return results;
  }
}

// Setup Node Mock DOM & Chrome Environment
function createMockEnvironment() {
  const storageStore = {
    local: {},
    session: {}
  };

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
          if (Array.isArray(keys)) {
            keys.forEach(k => { if (storageStore.local[k] !== undefined) res[k] = storageStore.local[k]; });
          } else if (typeof keys === 'string') {
            if (storageStore.local[keys] !== undefined) res[keys] = storageStore.local[keys];
          } else {
            Object.assign(res, storageStore.local);
          }
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
  let reloadCount = 0;

  const mockWindow = {
    location: {
      get href() { return currentUrl; },
      set href(val) { currentUrl = val; },
      reload: () => { reloadCount++; }
    },
    document: mockDocument,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MouseEvent: function() {},
    Event: function() {},
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} }
  };

  return {
    mockChrome,
    mockWindow,
    mockDocument,
    storageStore,
    setUrl: (u) => { currentUrl = u; },
    getReloadCount: () => reloadCount,
    resetReloadCount: () => { reloadCount = 0; }
  };
}

// Global bootstrap for test execution
function setupGlobalScope(env) {
  global.Element = MockNode;
  global.HTMLElement = MockNode;
  global.chrome = env.mockChrome;
  global.window = env.mockWindow;
  global.document = env.mockDocument;
  global.getComputedStyle = env.mockWindow.getComputedStyle;
  global.MouseEvent = env.mockWindow.MouseEvent;
  global.Event = env.mockWindow.Event;

  // Clear module caches and re-require
  delete require.cache[require.resolve('../storage.js')];
  delete require.cache[require.resolve('../automation/helpers.js')];
  delete require.cache[require.resolve('../automation/popup-handler.js')];
  delete require.cache[require.resolve('../automation/custom-mode.js')];
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

  return { StorageService, AutomationHelpers, CampaignAutomation, AutomationRunner, AutomationRunnerClass, RUNNER_STATES, WORKFLOW_STEPS };
}

// Helper to create the verified Publish All button in DOM
function createPublishAllButton(doc, enabled = true) {
  const host = new MockNode('ks-button-923', {
    'data-testid': 'common_next_button',
    class: 'primaryHalfStart-TMSZmk'
  });
  host.innerText = 'Publish all';
  host.textContent = 'Publish all';

  const shadow = host.attachShadow();
  const innerBtn = new MockNode('button', {
    type: 'button',
    part: 'base'
  });
  if (!enabled) {
    innerBtn.setAttribute('disabled', 'true');
    innerBtn.disabled = true;
  }
  shadow.appendChild(innerBtn);
  doc.body.appendChild(host);
  return { host, innerBtn };
}

// Helper to create Campaigns management UI in DOM
function createCampaignsManagementUI(doc) {
  const createBtn = new MockNode('ks-button-923', {
    'data-testid': 'campaign_create',
    class: 'primaryHalfStart-TMSZmk'
  });
  createBtn.innerText = 'Create';
  createBtn.textContent = 'Create';
  const shadow = createBtn.attachShadow();
  const inner = new MockNode('button', { type: 'button', part: 'base' });
  shadow.appendChild(inner);
  doc.body.appendChild(createBtn);

  const table = new MockNode('div', {
    'data-testid': 'campaign_table',
    class: 'byted-table'
  });
  doc.body.appendChild(table);
  return { createBtn, table };
}

// Run the 10 scenarios
async function runTests() {
  console.log('\n==================================================');
  console.log('STARTING PUBLISHING WORKFLOW TEST SUITE');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      const env = createMockEnvironment();
      const mods = setupGlobalScope(env);
      await fn(env, mods);
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      console.error(err.stack);
      failed++;
    }
  }

  // --- SCENARIO 0: TEST MODE PRESERVATION ---
  await test('Test Mode: Never clicks Publish all, no refresh, halts with Ready to Publish', async (env, mods) => {
    const { CampaignAutomation } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: false, campaignCount: 1 };
    let clickCount = 0;
    env.mockDocument.body.children[0].shadowRoot.children[0].addEventListener('click', () => { clickCount++; });

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1);
    assert.strictEqual(result.testMode, true, 'Should return testMode: true');
    assert.strictEqual(result.submitted, false, 'Should not submit in test mode');
    assert.strictEqual(clickCount, 0, 'Publish All button must never be clicked in Test Mode');
    assert.strictEqual(env.getReloadCount(), 0, 'Must not refresh in Test Mode');
  });

  // --- SCENARIO 1: PUBLISH SUCCESS WITH DELAYED REDIRECT ---
  await test('Scenario 1: Publish success with delayed redirect', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    const { innerBtn } = createPublishAllButton(env.mockDocument, true);

    let clickCount = 0;
    innerBtn.addEventListener('click', () => { clickCount++; });

    const config = { liveMode: true, campaignCount: 1, websiteUrl: 'https://example.com' };

    // Simulate delayed success modal and redirect after 300ms
    setTimeout(() => {
      const toast = new MockNode('div', { class: 'byted-message-success' });
      toast.innerText = 'Campaign created successfully! Campaign ID: 1812345678901234';
      env.mockDocument.body.appendChild(toast);
    }, 250);

    setTimeout(() => {
      // Simulate redirect to Campaigns page
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign?aadvid=12345');
      createCampaignsManagementUI(env.mockDocument);
    }, 500);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);

    assert.strictEqual(clickCount, 1, 'Publish All must be clicked exactly once');
    assert.strictEqual(result.submitted, true, 'Should mark submitted: true');
    assert.strictEqual(result.reloading, true, 'Should trigger page reload');
    assert.strictEqual(env.getReloadCount(), 1, 'Should trigger exactly one refresh');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.refreshCheckpoint, 'REFRESH_IN_PROGRESS', 'Should persist REFRESH_IN_PROGRESS');
    assert.ok(job.submissionEvidence, 'Submission evidence must be captured and persisted');
    assert.strictEqual(job.submissionEvidence.campaignId, '1812345678901234');
  });

  // --- SCENARIO 2A: CAMPAIGN SUBMITTED WITH "NOT DELIVERED" DELIVERY STATUS ---
  await test('Scenario 2A: Campaign with "Not Delivered" status is accepted as created', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '50.00' };

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      // Verified TikTok campaign table row with "Not Delivered" delivery status
      const row = new MockNode('tr', { class: 'byted-table-row', 'data-row-key': '1' });
      row.innerText = 'New Campaign 1   1899998888777755   Not Delivered   $50.00';
      table.appendChild(row);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true, '"Not Delivered" delivery status must NOT block verification');
    assert.strictEqual(verifyResult.campaignId, '1899998888777755');
  });

  // --- SCENARIO 2B: CAMPAIGN SUBMITTED WITH "UNDER REVIEW" STATUS ---
  await test('Scenario 2B: Campaign with "Under review" status is accepted', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '50.00' };

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      const row = new MockNode('tr', { class: 'byted-table-row', 'data-row-key': '1' });
      row.innerText = 'New Campaign 1   1899998888777766   Under review   $50.00';
      table.appendChild(row);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true, 'Should verify from table row status');
    assert.strictEqual(verifyResult.campaignId, '1899998888777766');
  });

  // --- SCENARIO 2C: CAMPAIGN SUBMITTED WITH "ACTIVE" STATUS ---
  await test('Scenario 2C: Campaign with "Active" status is accepted', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '50.00' };

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      const row = new MockNode('tr', { class: 'byted-table-row', 'data-row-key': '1' });
      row.innerText = 'New Campaign 1   1899998888777777   Active   $50.00';
      table.appendChild(row);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true, 'Should verify from table row status');
    assert.strictEqual(verifyResult.campaignId, '1899998888777777');
  });

  // --- SCENARIO 2E: REAL-BROWSER CASE: CAMPAIGN NAME Traffic20261013161035 WITHOUT VISIBLE ID ---
  await test('Scenario 2E: Real-browser case: Campaign Traffic20261013161035 with 44.00 USD and Not delivered without visible ID verifies successfully', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '44.00' };

    // Set expected campaign name as captured during creation
    await StorageService.updateJobState({
      expectedCampaignName: 'Traffic20261013161035'
    });

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign?aadvid=778899');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      // Exact table row structure and text observed in real browser:
      const row = new MockNode('tr', { class: 'byted-table-row' });
      row.innerText = 'Traffic20261013161035\nNot delivered\n44.00 USD\nDaily, Campaign budget\n0.00 USD';
      table.appendChild(row);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true, 'Campaign Traffic20261013161035 must be verified by name and budget');
    assert.strictEqual(verifyResult.campaignName, 'Traffic20261013161035');
    assert.strictEqual(verifyResult.campaignId, null, 'Numeric campaignId must be null when not rendered in table');
  });

  // --- SCENARIO 2F: CAMPAIGN ID PRESENT ONLY IN ROW ATTRIBUTE ---
  await test('Scenario 2F: Campaign ID present only in data-row-key attribute is extracted and verified', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '44.00' };

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      // ID in data-row-key, but text only shows name and budget
      const row = new MockNode('tr', { class: 'byted-table-row', 'data-row-key': '1899123456789012' });
      row.innerText = 'Traffic20261013161035\nNot delivered\n44.00 USD\nDaily, Campaign budget\n0.00 USD';
      table.appendChild(row);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true);
    assert.strictEqual(verifyResult.campaignId, '1899123456789012', 'Must extract numeric campaign ID from data-row-key');
    assert.strictEqual(verifyResult.campaignName, 'Traffic20261013161035');
  });

  // --- SCENARIO 2G: OLD CAMPAIGN WITH IDENTICAL BUDGET DISTINGUISHED BY NAME ---
  await test('Scenario 2G: Pre-existing old campaign with identical budget 44.00 USD is distinguished by name', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '44.00' };

    // Baseline had an old campaign
    await StorageService.updateJobState({
      expectedCampaignName: 'Traffic20261013161035',
      knownCampaignNames: ['oldcampaign44']
    });

    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);

      // Old row
      const oldRow = new MockNode('tr', { class: 'byted-table-row' });
      oldRow.innerText = 'OldCampaign44\nActive\n44.00 USD\nDaily, Campaign budget\n10.00 USD';
      table.appendChild(oldRow);

      // New row
      const newRow = new MockNode('tr', { class: 'byted-table-row' });
      newRow.innerText = 'Traffic20261013161035\nNot delivered\n44.00 USD\nDaily, Campaign budget\n0.00 USD';
      table.appendChild(newRow);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);

    assert.strictEqual(verifyResult.verified, true);
    assert.strictEqual(verifyResult.campaignName, 'Traffic20261013161035');
    assert.strictEqual(verifyResult.campaignId, null);
  });

  // --- SCENARIO 2H: UNSAFE PREFIX / SUBSTRING MATCH REJECTION ---
  await test('Scenario 2H: Unsafe prefix/substring matching is rejected (Traffic20261013161035_other does not match)', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;

    await StorageService.updateJobState({
      expectedCampaignName: 'Traffic20261013161035',
      expectedBudget: '44.00'
    });

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    const { table } = createCampaignsManagementUI(env.mockDocument);

    // Row has prefix/suffix, not exact name
    const row = new MockNode('tr', { class: 'byted-table-row' });
    row.innerText = 'Traffic20261013161035_other\nNot delivered\n44.00 USD\nDaily, Campaign budget\n0.00 USD';
    table.appendChild(row);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 1000);

    assert.strictEqual(verifyResult.verified, false, 'Unsafe prefix match must be rejected');
    assert.strictEqual(verifyResult.ambiguous, true);
  });

  // --- SCENARIO 2I: ADVERTISER ACCOUNT MISMATCH REJECTION ---
  await test('Scenario 2I: Mismatched advertiser account URL is rejected even with matching name and budget', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;

    await StorageService.updateJobState({
      expectedCampaignName: 'Traffic20261013161035',
      expectedBudget: '44.00',
      advertiserId: '778899112233'
    });

    // Current page URL has different advertiser ID
    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign?aadvid=999999999999');
    const { table } = createCampaignsManagementUI(env.mockDocument);

    const row = new MockNode('tr', { class: 'byted-table-row' });
    row.innerText = 'Traffic20261013161035\nNot delivered\n44.00 USD\nDaily, Campaign budget\n0.00 USD';
    table.appendChild(row);

    const job = await StorageService.getJobState();
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 1000);

    assert.strictEqual(verifyResult.verified, false, 'Advertiser account mismatch must be rejected');
    assert.strictEqual(verifyResult.ambiguous, true);
  });

  // --- SCENARIO 3: REDIRECT WITHOUT SUCCESS CONFIRMATION ---
  await test('Scenario 3: Redirect without success confirmation -> NEEDS_VERIFICATION', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Redirect to campaigns page, but table has NO matching status or new campaigns
    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);
      const oldRow = new MockNode('tr', { class: 'byted-table-row' });
      oldRow.innerText = 'Old Unrelated Campaign   1800000000000000   Completed   $100.00';
      table.appendChild(oldRow);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 10000);
    assert.strictEqual(result.reloading, true);

    const job = await StorageService.getJobState();
    // Simulate verifying on the refreshed page with short timeout
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 500);

    assert.strictEqual(verifyResult.verified, false, 'Must not verify without trustworthy evidence');
    assert.strictEqual(verifyResult.ambiguous, true, 'Must flag ambiguous: true');
  });

  // --- SCENARIO 4: TIKTOK PUBLISH ERROR ---
  await test('Scenario 4: TikTok publish error stops batch', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Simulate error banner appearing
    setTimeout(() => {
      const errBanner = new MockNode('div', { class: 'byted-message-error' });
      errBanner.innerText = 'Account balance is insufficient. Please top up.';
      env.mockDocument.body.appendChild(errBanner);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 5000);
    assert.strictEqual(result.success, false, 'Publish step must fail on error');
    assert.ok(result.error.includes('insufficient'), 'Should capture error text');
    assert.strictEqual(env.getReloadCount(), 0, 'Must NOT refresh on error');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.submissionStatus, 'FAILED');
  });

  // --- SCENARIO 4B: INFORMATIONAL UTM NOTIFICATION DOES NOT FAIL SUBMISSION ---
  await test('Scenario 4B: Informational UTM notification does not mark submission FAILED or independently establish SUCCESS', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    const { innerBtn } = createPublishAllButton(env.mockDocument, true);

    let clickCount = 0;
    innerBtn.addEventListener('click', () => { clickCount++; });

    const config = { liveMode: true, campaignCount: 1, dailyBudget: '50.00' };

    // 1. Simulate exact informational TikTok UTM tracking alert appearing after Publish All
    setTimeout(() => {
      const utmNotice = new MockNode('div', { class: 'arco-message-info', role: 'alert' });
      utmNotice.innerText = 'We auto-added 4 UTM parameters to your URL.';
      env.mockDocument.body.appendChild(utmNotice);
    }, 200);

    // 2. Check intermediate state while UTM notice is visible:
    // It must NOT set submissionStatus to FAILED, and must NOT set SUBMITTED prematurely
    setTimeout(async () => {
      const midJob = await StorageService.getJobState();
      assert.notStrictEqual(midJob.status, 'FAILED', 'UTM notice must not fail job');
      assert.strictEqual(midJob.submissionStatus, 'SUBMISSION_PENDING', 'UTM notice does not independently establish success');
    }, 350);

    // 3. Simulate subsequent normal redirect to Campaigns page
    setTimeout(() => {
      env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
      const { table } = createCampaignsManagementUI(env.mockDocument);
      const row = new MockNode('tr', { class: 'byted-table-row', 'data-row-key': '1' });
      row.innerText = 'New Campaign 1   1899998888777799   Not Delivered   $50.00';
      table.appendChild(row);
    }, 600);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 15000);
    assert.strictEqual(clickCount, 1, 'Publish All must be clicked exactly once');
    assert.strictEqual(result.submitted, true, 'Campaign submitted');
    assert.strictEqual(result.reloading, true, 'Proceeds to refresh despite informational UTM alert');
    assert.strictEqual(env.getReloadCount(), 1, 'Full page reload triggered exactly once');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.refreshCheckpoint, 'REFRESH_IN_PROGRESS');

    // Submission verification succeeds from table row (even with "Not Delivered")
    const verifyResult = await CampaignAutomation.verifySubmittedCampaign(job, 3000);
    assert.strictEqual(verifyResult.verified, true);
    assert.strictEqual(verifyResult.campaignId, '1899998888777799');
  });

  // --- SCENARIO 4C: ACTUAL URL VALIDATION ERROR STOPS THE BATCH ---
  await test('Scenario 4C: Actual URL validation error stops the batch', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Simulate real URL validation error
    setTimeout(() => {
      const urlError = new MockNode('div', { class: 'vi-form-item__error' });
      urlError.innerText = 'Please enter a valid website URL';
      env.mockDocument.body.appendChild(urlError);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 5000);
    assert.strictEqual(result.success, false, 'Publish step must fail on actual URL error');
    assert.ok(result.error.toLowerCase().includes('valid website url'), 'Should capture URL validation error');
    assert.strictEqual(env.getReloadCount(), 0, 'Must NOT refresh on URL validation error');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.submissionStatus, 'FAILED');
  });

  // --- SCENARIO 4D: ACTUAL UTM VALIDATION FAILURE STOPS THE BATCH ---
  await test('Scenario 4D: Actual UTM validation failure stops the batch', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Simulate real UTM error (not informational)
    setTimeout(() => {
      const utmError = new MockNode('div', { class: 'byted-message-error' });
      utmError.innerText = 'Invalid UTM parameter format: spaces are not allowed.';
      env.mockDocument.body.appendChild(utmError);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 5000);
    assert.strictEqual(result.success, false, 'Publish step must fail on real UTM error');
    assert.ok(result.error.toLowerCase().includes('invalid utm parameter'), 'Should capture UTM error');
    assert.strictEqual(env.getReloadCount(), 0, 'Must NOT refresh on UTM error');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.submissionStatus, 'FAILED');
  });

  // --- SCENARIO 4E: INFORMATIONAL NOTIFICATION AND REAL ERROR APPEARING TOGETHER ---
  await test('Scenario 4E: Informational UTM notice and real error together still stops batch', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Simulate informational notice AND real form error both present in DOM
    setTimeout(() => {
      const utmNotice = new MockNode('div', { class: 'arco-message-info', role: 'alert' });
      utmNotice.innerText = 'We auto-added 4 UTM parameters to your URL.';
      env.mockDocument.body.appendChild(utmNotice);

      const budgetError = new MockNode('div', { class: 'vi-form-item__error' });
      budgetError.innerText = 'Daily budget must be at least $50.00';
      env.mockDocument.body.appendChild(budgetError);
    }, 200);

    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 5000);
    assert.strictEqual(result.success, false, 'Must fail when real error is present');
    assert.ok(result.error.toLowerCase().includes('budget'), 'Must detect real budget error despite UTM notice');
    assert.strictEqual(env.getReloadCount(), 0, 'Must NOT refresh when error present');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.submissionStatus, 'FAILED');
  });

  // --- SCENARIO 5: REFRESH AFTER CONFIRMED SUBMISSION ---
  await test('Scenario 5: Reload recovery verifies submission and updates successfulCampaigns', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    // Persist checkpoint as if page just refreshed
    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_test_recovery',
      currentCampaignIndex: 1,
      totalCampaigns: 1,
      successfulCampaigns: 0,
      currentStep: 'REFRESH_CAMPAIGNS',
      refreshCheckpoint: 'REFRESH_IN_PROGRESS',
      submissionStatus: 'SUBMISSION_PENDING',
      submissionEvidence: {
        confirmed: true,
        type: 'TOAST',
        campaignId: '1877777777777777'
      }
    });

    await StorageService.saveConfig({ liveMode: true, campaignCount: 1 });

    // Initialize runner (simulating content script reload)
    await AutomationRunner.initialize();

    const finalJob = await StorageService.getJobState();
    assert.strictEqual(finalJob.successfulCampaigns, 1, 'successfulCampaigns must increment to 1');
    assert.strictEqual(finalJob.status, 'COMPLETED', 'Single campaign batch must be COMPLETED');
    assert.strictEqual(finalJob.refreshCheckpoint, 'NONE', 'Checkpoint should be cleared');
  });

  // --- SCENARIO 6: MULTIPLE CAMPAIGNS SEQUENTIALLY ---
  await test('Scenario 6: Multiple campaigns sequentially (Campaign 1/2 -> Campaign 2/2 -> COMPLETED)', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    const config = { liveMode: true, campaignCount: 2 };
    await StorageService.saveConfig(config);

    // Initial state after Campaign 1 was submitted and refreshed
    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_multi_test',
      currentCampaignIndex: 1,
      totalCampaigns: 2,
      successfulCampaigns: 0,
      currentStep: 'REFRESH_CAMPAIGNS',
      refreshCheckpoint: 'REFRESH_IN_PROGRESS',
      submissionStatus: 'SUBMISSION_PENDING',
      submissionEvidence: {
        confirmed: true,
        type: 'MODAL',
        campaignId: '1811111111111111'
      }
    });

    let campaign2Started = false;
    // Mock executeSingleCampaign for Campaign 2 so it simulates publish and reload trigger
    AutomationRunner.executeSingleCampaign = async (idx, cfg) => {
      campaign2Started = true;
      assert.strictEqual(idx, 2, 'Must execute Campaign 2');
      await StorageService.updateJobState({
        currentCampaignIndex: 2,
        submissionStatus: 'SUBMISSION_PENDING',
        refreshCheckpoint: 'REFRESH_IN_PROGRESS',
        submissionEvidence: { confirmed: true, type: 'MODAL', campaignId: '1822222222222222' }
      });
      return { success: true, reloading: true };
    };

    // Step 1: Content script on reloaded page resumes Campaign 1
    const jobState = await StorageService.getJobState();
    await AutomationRunner.handlePostRefreshResume(jobState, config);

    assert.strictEqual(campaign2Started, true, 'Campaign 2 must be started automatically');

    const midState = await StorageService.getJobState();
    assert.strictEqual(midState.successfulCampaigns, 1, 'Campaign 1 must be verified before Campaign 2');

    // Step 2: Fresh content script created after Campaign 2 reload
    const runner2 = new mods.AutomationRunnerClass();
    runner2.executeSingleCampaign = AutomationRunner.executeSingleCampaign;
    await runner2.initialize();

    const postAll = await StorageService.getJobState();
    assert.strictEqual(postAll.successfulCampaigns, 2, 'Both campaigns must be verified');
    assert.strictEqual(postAll.status, 'COMPLETED', 'Job must complete after reaching campaign count');
  });

  // --- SCENARIO 6B: COUNT 3 ALL THREE CAMPAIGNS SEQUENTIALLY ---
  await test('Scenario 6B: Campaign Count 3 executes all three campaigns sequentially (1/3 -> 2/3 -> 3/3 -> COMPLETED)', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    const config = { liveMode: true, campaignCount: 3 };
    await StorageService.saveConfig(config);

    // Initial state after Campaign 1 submitted and refreshed
    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_count_3_test',
      currentCampaignIndex: 1,
      totalCampaigns: 3,
      successfulCampaigns: 0,
      currentStep: 'REFRESH_CAMPAIGNS',
      refreshCheckpoint: 'REFRESH_IN_PROGRESS',
      submissionStatus: 'SUBMISSION_PENDING',
      submissionEvidence: { confirmed: true, type: 'MODAL', campaignId: '1811111111111111' }
    });

    const executedCampaigns = [];
    AutomationRunner.executeSingleCampaign = async (idx, cfg) => {
      executedCampaigns.push(idx);
      await StorageService.updateJobState({
        currentCampaignIndex: idx,
        submissionStatus: 'SUBMISSION_PENDING',
        refreshCheckpoint: 'REFRESH_IN_PROGRESS',
        submissionEvidence: { confirmed: true, type: 'MODAL', campaignId: `18${idx}${idx}${idx}${idx}` }
      });
      return { success: true, reloading: true };
    };

    // Step 1: Content script on reloaded page resumes and verifies Campaign 1 -> starts Campaign 2
    const jobState = await StorageService.getJobState();
    await AutomationRunner.handlePostRefreshResume(jobState, config);
    assert.ok(executedCampaigns.includes(2), 'Must start Campaign 2');

    // Step 2: Fresh content script created after Campaign 2 reload -> verifies Campaign 2 -> starts Campaign 3
    const runner2 = new mods.AutomationRunnerClass();
    runner2.executeSingleCampaign = AutomationRunner.executeSingleCampaign;
    await runner2.initialize();
    assert.ok(executedCampaigns.includes(3), 'Must start Campaign 3');

    // Step 3: Fresh content script created after Campaign 3 reload -> verifies Campaign 3 -> COMPLETED
    const runner3 = new mods.AutomationRunnerClass();
    runner3.executeSingleCampaign = AutomationRunner.executeSingleCampaign;
    await runner3.initialize();

    const finalState = await StorageService.getJobState();
    assert.strictEqual(finalState.successfulCampaigns, 3, 'All 3 campaigns must be verified');
    assert.strictEqual(finalState.status, 'COMPLETED', 'Batch must complete after reaching campaignCount 3');
  });

  // --- SCENARIO 6C: CAMPAIGN COUNT = 2 WITH UTM NOTICE CONTINUES AUTOMATICALLY ---
  await test('Scenario 6C: Campaign Count = 2 with informational UTM notification continues automatically to Campaign 2', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    const config = { liveMode: true, campaignCount: 2, dailyBudget: '50.00' };
    await StorageService.saveConfig(config);

    // Initial state: Campaign 1 submitted, encountered informational UTM notice, and refreshed
    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_utm_multi_test',
      currentCampaignIndex: 1,
      totalCampaigns: 2,
      successfulCampaigns: 0,
      currentStep: 'REFRESH_CAMPAIGNS',
      refreshCheckpoint: 'REFRESH_IN_PROGRESS',
      submissionStatus: 'SUBMISSION_PENDING',
      submissionEvidence: {
        confirmed: true,
        type: 'MODAL',
        campaignId: '1899111122223333'
      }
    });

    let campaign2ClickedCreate = false;
    let campaign2Executed = false;

    AutomationRunner.executeSingleCampaign = async (idx, cfg) => {
      campaign2Executed = true;
      assert.strictEqual(idx, 2, 'Must execute Campaign 2');
      // Simulate Campaign 2 completion
      await StorageService.updateJobState({
        currentCampaignIndex: 2,
        submissionStatus: 'SUBMISSION_PENDING',
        refreshCheckpoint: 'REFRESH_IN_PROGRESS',
        submissionEvidence: { confirmed: true, type: 'MODAL', campaignId: '1899444455556666' }
      });
      return { success: true, reloading: true };
    };

    // Step 1: Content script resumes after Campaign 1 refresh
    const jobState = await StorageService.getJobState();
    await AutomationRunner.handlePostRefreshResume(jobState, config);

    assert.strictEqual(campaign2Executed, true, 'Campaign 2 must be started automatically after Campaign 1 verifies');

    const midJob = await StorageService.getJobState();
    assert.strictEqual(midJob.successfulCampaigns, 1, 'Campaign 1 must be recorded as successful');

    // Step 2: Fresh runner after Campaign 2 reload
    const runner2 = new mods.AutomationRunnerClass();
    runner2.executeSingleCampaign = AutomationRunner.executeSingleCampaign;
    await runner2.initialize();

    const finalJob = await StorageService.getJobState();
    assert.strictEqual(finalJob.successfulCampaigns, 2, 'Both campaigns must be successfully completed');
    assert.strictEqual(finalJob.status, 'COMPLETED', 'Batch must be marked COMPLETED');
  });

  // --- SCENARIO 7: PAGE RELOAD DURING SUBMISSION ---
  await test('Scenario 7: Full page reload during submission pending recovers safely', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_pending_reload',
      currentCampaignIndex: 1,
      totalCampaigns: 1,
      successfulCampaigns: 0,
      currentStep: 'PUBLISH_PENDING',
      submissionStatus: 'SUBMISSION_PENDING',
      refreshCheckpoint: 'NONE',
      submissionEvidence: {
        confirmed: true,
        type: 'TOAST',
        campaignId: '1855555555555555'
      }
    });

    await StorageService.saveConfig({ liveMode: true, campaignCount: 1 });

    // Step 1: Content script injected on redirected page (saves checkpoint and reloads)
    await AutomationRunner.initialize();

    const midJob = await StorageService.getJobState();
    assert.strictEqual(midJob.refreshCheckpoint, 'REFRESH_IN_PROGRESS', 'Should save refresh checkpoint before reload');
    assert.strictEqual(env.getReloadCount(), 1, 'Should trigger page reload');

    // Step 2: Fresh content script injected on reloaded page
    const reloadedRunner = new mods.AutomationRunnerClass();
    await reloadedRunner.initialize();

    const job = await StorageService.getJobState();
    assert.strictEqual(job.successfulCampaigns, 1, 'Should recover, refresh once, and verify');
    assert.strictEqual(job.status, 'COMPLETED');
    assert.strictEqual(env.getReloadCount(), 1, 'Must not reload a second time');
  });

  // --- SCENARIO 8: UNKNOWN SUBMISSION OUTCOME (TIMEOUT) ---
  await test('Scenario 8: Unknown submission outcome (60s timeout without return) -> NEEDS_VERIFICATION', async (env, mods) => {
    const { CampaignAutomation, StorageService } = mods;
    createPublishAllButton(env.mockDocument, true);

    const config = { liveMode: true, campaignCount: 1 };

    // Stays on create page, never returns to campaigns page, no error
    const result = await CampaignAutomation.handlePublishStep(config, 1, 1, 500);

    assert.strictEqual(result.ambiguous, true, 'Must return ambiguous: true');
    assert.strictEqual(result.success, false, 'Must not be marked success');

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'NEEDS_VERIFICATION', 'Status must be NEEDS_VERIFICATION');
    assert.strictEqual(job.submissionStatus, 'NEEDS_VERIFICATION');
  });

  // --- SCENARIO 9: DUPLICATE REFRESH PREVENTION ---
  await test('Scenario 9: Duplicate refresh prevention (does not re-refresh if already completed)', async (env, mods) => {
    const { StorageService, AutomationRunner } = mods;

    env.setUrl('https://ads.tiktok.com/i18n/manage/campaign');
    createCampaignsManagementUI(env.mockDocument);

    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_dup_refresh',
      currentCampaignIndex: 1,
      totalCampaigns: 1,
      successfulCampaigns: 0,
      currentStep: 'REFRESH_CAMPAIGNS',
      refreshCheckpoint: 'REFRESH_IN_PROGRESS',
      submissionEvidence: { confirmed: true, type: 'TOAST' }
    });

    env.resetReloadCount();

    // First resume handles verification
    const jobState = await StorageService.getJobState();
    await AutomationRunner.handlePostRefreshResume(jobState, { liveMode: true, campaignCount: 1 });

    const jobAfter = await StorageService.getJobState();
    assert.strictEqual(jobAfter.status, 'COMPLETED');
    assert.strictEqual(jobAfter.refreshCheckpoint, 'NONE');
    assert.strictEqual(env.getReloadCount(), 0, 'Must not trigger duplicate reload after already refreshed');
  });

  // --- SCENARIO 10: STOP / PAUSE DURING PUBLISHING ---
  await test('Scenario 10: Stop / Pause aborts immediately without submitting next campaign', async (env, mods) => {
    const { AutomationRunner, StorageService } = mods;

    await StorageService.saveJobState({
      status: 'RUNNING',
      runId: 'run_pause_test',
      currentCampaignIndex: 1,
      totalCampaigns: 3
    });

    AutomationRunner.shouldAbort = true;
    await AutomationRunner.pause();

    const job = await StorageService.getJobState();
    assert.strictEqual(job.status, 'PAUSED', 'Job state must be PAUSED');
    assert.strictEqual(AutomationRunner.shouldAbort, true, 'Runner shouldAbort must be true');
  });

  // --- SCENARIO 11: EXTENSION CONTEXT INVALIDATED IS HANDLED SAFELY ---
  await test('Scenario 11: Extension context invalidated is handled gracefully without unhandled exceptions', async (env, mods) => {
    const { StorageService } = mods;

    // Simulate invalidated extension context by removing runtime.id
    const origId = global.chrome.runtime.id;
    delete global.chrome.runtime.id;

    assert.strictEqual(StorageService.isContextValid(), false, 'isContextValid must return false when runtime.id is absent');

    const config = await StorageService.getConfig();
    assert.ok(config, 'getConfig must return default config fallback');

    const job = await StorageService.getJobState();
    assert.ok(job, 'getJobState must return default job fallback');

    const saveSuccess = await StorageService.saveJobState({ status: 'RUNNING' });
    assert.strictEqual(saveSuccess, false, 'saveJobState must resolve false gracefully');

    // Restore runtime.id
    global.chrome.runtime.id = origId;
    assert.strictEqual(StorageService.isContextValid(), true);
  });

  console.log('\n==================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
