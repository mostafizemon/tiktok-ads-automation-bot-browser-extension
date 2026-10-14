const assert = require('assert');
require('../automation/runner.js');
const runner = global.AutomationRunner;
let job, calls, mode, reloads;
function setup() {
  calls = []; reloads = 0; mode = 'success';
  job = { runId: 'run-1', status: 'RUNNING', currentCampaignIndex: 1, totalCampaigns: 1 };
  global.window = { location: { href: 'https://ads.tiktok.com/i18n/creation/1nn/create/brand-auction-creative?campaign_draft_id=1&adgroup_draft_id=2', reload() { reloads++; } } };
  global.AutomationHelpers = { isAborted: () => runner.shouldAbort, sleep: async () => {},
    Logger: { info() {}, log() {}, error() {}, warn() {} } };
  global.StorageService = { getJobState: async () => job, getConfig: async () => config,
    updateJobState: async patch => Object.assign(job, patch),
    saveJobState: async state => { job = state; return true; } };
  global.CampaignAutomation = {};
  for (const name of ['clickCreateCampaign', 'handleCustomModeFlow', 'selectTrafficObjectiveAndBudget',
    'configureDemographicsAndCountries', 'inputWebsiteUrl', 'openCreativeAssetsDrawer', 'attachSparkAdsPostWithRetry']) {
    global.CampaignAutomation[name] = async () => { calls.push(name); };
  }
  global.CampaignAutomation.configureCallToAction = async () => {
    calls.push('cta');
    if (mode === 'empty') throw Object.assign(new Error('empty'), { code: 'CTA_EMPTY_LIST' });
    if (mode === 'missing') throw new Error('Requested CTA not found');
  };
  global.CampaignAutomation.verifyCreativeAttachmentOnPage = async () => { calls.push('verify-video'); return true; };
  global.CampaignAutomation.handlePublishStep = async () => { calls.push('publish'); return { success: true, testMode: true }; };
  runner.shouldAbort = false; runner.isProcessingLock = false;
}
const config = { callToAction: 'Order now', campaignCount: 1, liveMode: false };
(async () => {
  setup();
  assert((await runner.executeSingleCampaign(1, config)).testMode);
  assert(calls.indexOf('attachSparkAdsPostWithRetry') < calls.indexOf('cta'));
  assert(calls.indexOf('cta') < calls.indexOf('publish'));

  setup(); mode = 'empty';
  assert((await runner.executeSingleCampaign(1, config)).reloading);
  assert.equal(reloads, 1); assert(!calls.includes('publish'));
  calls = []; mode = 'success';
  await runner.initialize();
  assert.deepStrictEqual(calls, ['verify-video', 'cta', 'publish']);
  assert.equal(job.status, 'COMPLETED');

  setup(); mode = 'empty'; await runner.executeSingleCampaign(1, config);
  calls = []; await runner.initialize();
  assert.equal(reloads, 1); assert(!calls.includes('publish')); assert.equal(job.status, 'FAILED');

  setup(); mode = 'missing'; await runner.executeSingleCampaign(1, config);
  assert.equal(reloads, 0); assert(!calls.includes('publish'));

  setup(); mode = 'empty'; await runner.executeSingleCampaign(1, config);
  calls = []; mode = 'success'; window.location.href += '&different=1';
  assert(!(await runner.executeSingleCampaign(1, config, true)).success);
  assert.deepStrictEqual(calls, []);

  setup(); mode = 'empty'; await runner.executeSingleCampaign(1, config);
  calls = []; mode = 'success';
  global.CampaignAutomation.verifyCreativeAttachmentOnPage = async () => false;
  assert(!(await runner.executeSingleCampaign(1, config, true)).success);
  assert(!calls.includes('cta')); assert(!calls.includes('publish'));

  setup(); mode = 'empty'; global.StorageService.saveJobState = async () => false;
  await runner.executeSingleCampaign(1, config); assert.equal(reloads, 0);

  setup(); mode = 'empty'; await runner.executeSingleCampaign(1, config);
  calls = []; job.status = 'PAUSED'; await runner.initialize(); assert.deepStrictEqual(calls, []);
  console.log('CTA REFRESH RECOVERY TEST RESULTS: 8 PASSED, 0 FAILED');
})().catch(error => { console.error(error); process.exitCode = 1; });
