/**
 * automation/runner.js
 * Master orchestrator for TikTok Ads campaigns.
 *
 * Enforces:
 * 1. Strict single-campaign mutex execution per browser profile.
 * 2. Multi-profile isolation via chrome.storage.local.
 * 3. Sequential multi-campaign loop (1 -> 2 -> ... -> N).
 * 4. Test Mode: Stops immediately before Publish all with "Test completed — Ready to Publish".
 *    Never increments published count, never loops to next campaign.
 * 5. Submission Verification: If ambiguous, marks NEEDS_VERIFICATION and halts without duplicating.
 * 6. Reload & navigation recovery using persistent checkpoints.
 * 7. Abort-aware Pause and Stop controls.
 */

(function (global) {
  'use strict';

  const RUNNER_STATES = {
    IDLE: 'IDLE',
    PREFLIGHT: 'PREFLIGHT',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    STOPPED: 'STOPPED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    NEEDS_ATTENTION: 'NEEDS_ATTENTION',
    NEEDS_VERIFICATION: 'NEEDS_VERIFICATION'
  };

  const WORKFLOW_STEPS = {
    CLICK_CREATE: 'CLICK_CREATE',
    CUSTOM_MODE_CHECK: 'CUSTOM_MODE_CHECK',
    OBJECTIVE_AND_BUDGET: 'OBJECTIVE_AND_BUDGET',
    DEMOGRAPHICS_COUNTRIES: 'DEMOGRAPHICS_COUNTRIES',
    WEBSITE_URL: 'WEBSITE_URL',
    OPEN_ASSETS_DRAWER: 'OPEN_ASSETS_DRAWER',
    SELECT_TIKTOK_POSTS: 'SELECT_TIKTOK_POSTS',
    AUTH_CODE_INPUT: 'AUTH_CODE_INPUT',
    ADD_POSTS_CONFIRM: 'ADD_POSTS_CONFIRM',
    CONFIRM_DRAWER: 'CONFIRM_DRAWER',
    PUBLISH: 'PUBLISH',
    PUBLISH_PENDING: 'PUBLISH_PENDING',
    VERIFY_SUBMISSION: 'VERIFY_SUBMISSION',
    REFRESH_CAMPAIGNS: 'REFRESH_CAMPAIGNS',
    TEST_COMPLETED: 'TEST_COMPLETED'
  };

  class AutomationRunner {
    constructor() {
      this.name = 'Runner';
      this.isProcessingLock = false;
      this.currentState = RUNNER_STATES.IDLE;
      this.activeConfig = null;
      this.shouldAbort = false;
      this.activeJobId = null;
    }

    get helpers() {
      return global.AutomationHelpers;
    }

    get storage() {
      return global.StorageService;
    }

    get campaign() {
      return global.CampaignAutomation;
    }

    /**
     * Diagnostic logger shortcut
     * @param {string} step
     * @param {string} action
     * @param {object} details
     */
    diag(step, action, details = {}) {
      if (this.helpers?.Logger?.diagnostic) {
        this.helpers.Logger.diagnostic(step, action, details);
      } else {
        this.log(`[${step}] ${action}`, details);
      }
    }

    /**
     * Initialize runner on page load / content script injection
     * Restores state if a run was in progress before navigation or refresh
     */
    async initialize() {
      this.log('Initializing Automation Runner...');

      // Prevent duplicate instances if runner is already active in this tab
      if (this.isProcessingLock) {
        this.log('Runner already processing in this tab. Skipping duplicate initialize.');
        return;
      }

      const jobState = await this.storage?.getJobState();
      if (!jobState) return;

      this.currentState = jobState.status || RUNNER_STATES.IDLE;
      this.activeJobId = jobState.runId;

      this.log(`Runner restored state: ${this.currentState} (Step: ${jobState.currentStep})`);

      // Handle post-refresh resume strictly when in REFRESH_CAMPAIGNS state
      if (this.currentState === RUNNER_STATES.RUNNING) {
        const config = await this.storage?.getConfig();
        this.activeConfig = config;

        if (jobState.currentStep === WORKFLOW_STEPS.REFRESH_CAMPAIGNS) {
          this.diag('RELOAD_RECOVERY', 'Resuming sequential loop after page refresh', {
            verification: `Resuming at Campaign ${jobState.currentCampaignIndex} of ${jobState.totalCampaigns}`
          });
          this.handlePostRefreshResume(jobState, config);
        } else {
          // If page navigated or refreshed unexpectedly in the middle of a step,
          // pause safely to avoid duplicate actions
          this.warn(`Unexpected page reload during step: ${jobState.currentStep}. Pausing for safety.`);
          await this.storage?.updateJobState({
            status: RUNNER_STATES.PAUSED,
            stepDescription: `Paused after page reload at: ${jobState.currentStep}`
          });
          this.currentState = RUNNER_STATES.PAUSED;
        }
      }
    }

    /**
     * Start execution of campaign batch
     * @param {object} config Validated configuration
     */
    async start(config) {
      console.log('[RUNNER] Runner initialization started');

      if (this.isProcessingLock) {
        this.warn('Cannot start: Another campaign automation is already running in this profile.');
        return { success: false, reason: 'Already running' };
      }

      this.activeConfig = config;
      this.isProcessingLock = true;
      this.shouldAbort = false;
      this.currentState = RUNNER_STATES.RUNNING;
      this.activeJobId = 'run_' + Date.now();

      const total = Number(config.campaignCount) || 1;

      await this.storage?.saveJobState({
        runId: this.activeJobId,
        status: RUNNER_STATES.RUNNING,
        currentCampaignIndex: 1,
        totalCampaigns: total,
        successfulCampaigns: 0,
        failedCampaigns: 0,
        currentStep: WORKFLOW_STEPS.CLICK_CREATE,
        stepDescription: `Starting Campaign 1 of ${total}`,
        lastError: null,
        startedAt: new Date().toISOString(),
        liveMode: !!config.liveMode,
        campaignResults: []
      });

      this.diag('START_AUTOMATION', `Job [${this.activeJobId}] launched`, {
        verification: `Total: ${total} campaigns | Mode: ${config.liveMode ? 'LIVE' : 'TEST'}`
      });

      // Run sequential loop asynchronously
      this.executeCampaignLoop(1, total, config);

      return { success: true, status: this.currentState, runId: this.activeJobId };
    }

    /**
     * Master sequential loop for creating N campaigns
     * @param {number} startIndex
     * @param {number} totalCampaigns
     * @param {object} config
     */
    async executeCampaignLoop(startIndex, totalCampaigns, config) {
      let currentIndex = startIndex;

      while (currentIndex <= totalCampaigns) {
        if (this.shouldAbort) {
          this.diag('CAMPAIGN_LOOP', `Loop halted due to user abort/pause request at Campaign ${currentIndex}`);
          this.isProcessingLock = false;
          return;
        }

        console.log(`[RUNNER] Campaign ${currentIndex}/${totalCampaigns} starting`);
        this.log(`========================================`);
        this.log(`🚀 Starting Campaign ${currentIndex} / ${totalCampaigns} (Mode: ${config.liveMode ? 'LIVE' : 'TEST'})`);
        this.log(`========================================`);

        await this.storage?.updateJobState({
          currentCampaignIndex: currentIndex,
          currentStep: WORKFLOW_STEPS.CLICK_CREATE,
          stepDescription: `Running Campaign ${currentIndex} of ${totalCampaigns}`
        });

        const result = await this.executeSingleCampaign(currentIndex, config);

        if (this.shouldAbort) {
          this.isProcessingLock = false;
          return;
        }

        // TASK 3: Test Mode Handling
        // Test Mode must stop immediately before Publish All, display "Test completed — Ready to Publish",
        // never mark campaign as published, and never loop to next campaign.
        if (result.testMode) {
          this.diag('TEST_MODE', 'Test Mode execution finished before publish', {
            verification: 'Test completed — Ready to Publish'
          });

          await this.storage?.updateJobState({
            status: RUNNER_STATES.COMPLETED,
            currentStep: WORKFLOW_STEPS.TEST_COMPLETED,
            stepDescription: 'Test completed — Ready to Publish'
          });

          this.currentState = RUNNER_STATES.COMPLETED;
          this.isProcessingLock = false;
          this.log('🎉 Test completed — Ready to Publish. No campaigns published.');
          return; // Stop immediately!
        }

        // Failure or Ambiguous Outcome Handling
        if (!result.success) {
          this.warn(`Campaign ${currentIndex} did not complete: ${result.error}`);

          if (result.ambiguous) {
            // TASK 2: Ambiguous Submission Handling
            this.diag('VERIFY_SUBMISSION', 'Ambiguous submission outcome', {
              error: 'Submission outcome ambiguous. Halting without advancing count or duplicating.'
            });

            await this.storage?.updateJobState({
              status: RUNNER_STATES.NEEDS_VERIFICATION,
              currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION,
              lastError: 'Submission outcome ambiguous. Check TikTok Ads Manager before proceeding.',
              stepDescription: 'Submission outcome ambiguous. Manual verification required in Ads Manager.'
            });
            this.currentState = RUNNER_STATES.NEEDS_VERIFICATION;
          } else if (result.aborted) {
            this.log('Execution was aborted or paused by user.');
          } else {
            const currentJob = await this.storage?.getJobState();
            await this.storage?.updateJobState({
              status: RUNNER_STATES.FAILED,
              failedCampaigns: (currentJob?.failedCampaigns || 0) + 1,
              lastError: result.error,
              stepDescription: `Failed on Campaign ${currentIndex}: ${result.error}`
            });
            this.currentState = RUNNER_STATES.FAILED;
          }

          this.isProcessingLock = false;
          return; // Stop loop safely
        }

        // Campaign succeeded in Live Mode
        const jobState = await this.storage?.getJobState();
        const successCount = (jobState?.successfulCampaigns || 0) + 1;

        const results = jobState?.campaignResults || [];
        results.push({
          index: currentIndex,
          status: 'SUBMITTED',
          campaignId: result.campaignId || null,
          submittedAt: new Date().toISOString()
        });

        await this.storage?.updateJobState({
          successfulCampaigns: successCount,
          campaignResults: results
        });

        this.log(`✅ Campaign ${currentIndex} / ${totalCampaigns} verified and submitted.`);

        // If more campaigns remain in the batch
        if (currentIndex < totalCampaigns) {
          currentIndex++;

          this.diag('PREPARE_NEXT_CAMPAIGN', `Navigating to Campaigns page and refreshing before Campaign ${currentIndex}`, {
            verification: `Advancing to Campaign ${currentIndex} of ${totalCampaigns}`
          });

          await this.storage?.updateJobState({
            currentCampaignIndex: currentIndex,
            currentStep: WORKFLOW_STEPS.REFRESH_CAMPAIGNS,
            stepDescription: `Campaign ${currentIndex - 1} verified. Refreshing before Campaign ${currentIndex}...`
          });

          // Ensure we are on campaigns page
          if (!window.location.href.includes('/manage/campaign')) {
            window.location.href = 'https://ads.tiktok.com/i18n/manage/campaign';
            return;
          } else {
            window.location.reload();
            return;
          }
        } else {
          // All requested campaigns finished!
          break;
        }
      }

      // Mark Job Completed
      await this.storage?.updateJobState({
        status: RUNNER_STATES.COMPLETED,
        currentStep: 'COMPLETED',
        stepDescription: `Batch complete: ${totalCampaigns} campaigns created.`
      });

      this.currentState = RUNNER_STATES.COMPLETED;
      this.isProcessingLock = false;
      this.log(`🎉 Batch finished! All ${totalCampaigns} campaigns completed.`);
    }

    /**
     * Handle resuming the sequential loop after page refresh
     * @param {object} jobState
     * @param {object} config
     */
    async handlePostRefreshResume(jobState, config) {
      const nextIndex = jobState.currentCampaignIndex;
      const total = jobState.totalCampaigns;

      this.log('Waiting for Campaigns page to become interactive after refresh...');
      await this.helpers?.sleep(3000);

      this.isProcessingLock = true;
      this.shouldAbort = false;

      this.diag('POST_REFRESH_RESUME', `Resuming batch loop at Campaign ${nextIndex} / ${total}`, {
        verification: 'Campaigns page interactive'
      });

      this.executeCampaignLoop(nextIndex, total, config);
    }

    /**
     * Execute full creation workflow for a single campaign
     * @param {number} campaignIndex
     * @param {object} config
     * @returns {Promise<{ success: boolean, testMode?: boolean, ambiguous?: boolean, aborted?: boolean, campaignId?: string, error?: string }>}
     */
    async executeSingleCampaign(campaignIndex, config) {
      const c = this.campaign;
      const h = this.helpers;

      try {
        // Step 1: Click Create
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.CLICK_CREATE,
          stepDescription: `[#${campaignIndex}] Clicking Create Campaign`
        });
        await c.clickCreateCampaign();
        await h.sleep(1500);

        // Step 2: Custom Mode Check
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.CUSTOM_MODE_CHECK,
          stepDescription: `[#${campaignIndex}] Verifying Custom Mode`
        });
        await c.handleCustomModeFlow();
        await h.sleep(1000);

        // Step 3: Objective & Budget
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.OBJECTIVE_AND_BUDGET,
          stepDescription: `[#${campaignIndex}] Setting Traffic objective & budget`
        });
        await c.selectTrafficObjectiveAndBudget(config);
        await h.sleep(1500);

        // Step 4: Demographics & Country Targeting
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.DEMOGRAPHICS_COUNTRIES,
          stepDescription: `[#${campaignIndex}] Configuring target countries`
        });
        await c.configureDemographicsAndCountries(config);
        await h.sleep(1500);

        // Step 5: Website URL
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.WEBSITE_URL,
          stepDescription: `[#${campaignIndex}] Setting Website URL`
        });
        await c.inputWebsiteUrl(config.websiteUrl);
        await h.sleep(1000);

        // Step 6: Creative Assets -> Click Add
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.OPEN_ASSETS_DRAWER,
          stepDescription: `[#${campaignIndex}] Opening Creative Assets drawer`
        });
        await c.openCreativeAssetsDrawer();
        await h.sleep(1000);

        // Step 7: Select TikTok posts tab -> Add post
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.SELECT_TIKTOK_POSTS,
          stepDescription: `[#${campaignIndex}] Selecting TikTok posts tab`
        });
        await c.selectTikTokPostsTabAndClickAdd();
        await h.sleep(1000);

        // Step 8: Input Spark Ads Auth Code -> Continue
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.AUTH_CODE_INPUT,
          stepDescription: `[#${campaignIndex}] Inputting Spark Ads auth code`
        });
        await c.inputSparkAdsCodeAndContinue(config.authCode);
        await h.sleep(1000);

        // Step 9: Click Add TikTok posts
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.ADD_POSTS_CONFIRM,
          stepDescription: `[#${campaignIndex}] Authorizing and adding TikTok posts`
        });
        await c.clickAddTikTokPosts();
        await h.sleep(1500);

        // Step 10: Confirm Drawer
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.CONFIRM_DRAWER,
          stepDescription: `[#${campaignIndex}] Confirming post in drawer`
        });
        await c.verifyPostAndClickConfirm();
        await h.sleep(1500);

        // Step 11: Final Publishing Step
        if (this.shouldAbort) return { success: false, aborted: true, error: 'Aborted' };
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.PUBLISH,
          stepDescription: `[#${campaignIndex}] Preparing publish step`
        });
        const publishResult = await c.handlePublishStep(config);

        // TASK 3: Test Mode check
        if (publishResult.testMode) {
          return { success: true, testMode: true };
        }

        // Step 12: Verify Submission (Live Mode)
        // TASK 2: Requires explicit TikTok confirmation; redirect alone is insufficient!
        await this.storage?.updateJobState({
          currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION,
          stepDescription: `[#${campaignIndex}] Verifying submission on TikTok`
        });
        const verifyResult = await c.verifySubmission(35000);

        if (!verifyResult.verified) {
          if (verifyResult.ambiguous) {
            return { success: false, ambiguous: true, error: 'Submission confirmation ambiguous' };
          }
          return { success: false, error: verifyResult.error || 'Submission failed' };
        }

        return { success: true, testMode: false, campaignId: verifyResult.campaignId };

      } catch (err) {
        if (err.message && err.message.includes('aborted or paused')) {
          this.log(`Campaign ${campaignIndex} was paused/aborted.`);
          return { success: false, aborted: true, error: err.message };
        }
        this.error(`Error during Campaign ${campaignIndex}:`, err);
        return { success: false, error: err.message };
      }
    }

    /**
     * Pause ongoing automation
     */
    async pause() {
      this.shouldAbort = true;
      this.currentState = RUNNER_STATES.PAUSED;
      this.isProcessingLock = false;

      await this.storage?.updateJobState({
        status: RUNNER_STATES.PAUSED,
        stepDescription: 'Automation paused by user'
      });
      this.log('Automation paused by user.');
      return { success: true };
    }

    /**
     * Resume paused automation
     */
    async resume() {
      const jobState = await this.storage?.getJobState();
      const config = await this.storage?.getConfig();

      if (!jobState || jobState.status !== RUNNER_STATES.PAUSED) {
        return { success: false, reason: 'Not paused' };
      }

      this.shouldAbort = false;
      this.isProcessingLock = true;
      this.currentState = RUNNER_STATES.RUNNING;
      this.activeConfig = config;

      await this.storage?.updateJobState({
        status: RUNNER_STATES.RUNNING,
        stepDescription: `Resuming Campaign ${jobState.currentCampaignIndex} of ${jobState.totalCampaigns}`
      });

      this.log('Automation resumed.');
      this.executeCampaignLoop(jobState.currentCampaignIndex || 1, jobState.totalCampaigns || 1, config);

      return { success: true };
    }

    /**
     * Stop automation immediately
     */
    async stop() {
      this.shouldAbort = true;
      this.currentState = RUNNER_STATES.STOPPED;
      this.isProcessingLock = false;

      await this.storage?.updateJobState({
        status: RUNNER_STATES.STOPPED,
        stepDescription: 'Automation stopped by user'
      });
      this.log('Automation stopped by user.');
      return { success: true };
    }

    /**
     * Get current runner status
     */
    getStatus() {
      return {
        state: this.currentState,
        isLocked: this.isProcessingLock,
        runId: this.activeJobId
      };
    }

    log(message, data = null) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.info(this.name, message, data);
      } else {
        console.log(`[TikTokAdsBot:${this.name}] ${message}`, data || '');
      }
    }

    warn(message, data = null) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.warn(this.name, message, data);
      } else {
        console.warn(`[TikTokAdsBot:${this.name}] ⚠️ ${message}`, data || '');
      }
    }

    error(message, err = null) {
      if (global.AutomationHelpers?.Logger) {
        global.AutomationHelpers.Logger.error(this.name, message, err);
      } else {
        console.error(`[TikTokAdsBot:${this.name}] ❌ ${message}`, err || '');
      }
    }
  }

  const automationRunnerInstance = new AutomationRunner();

  global.AutomationRunner = automationRunnerInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutomationRunner: automationRunnerInstance, RUNNER_STATES, WORKFLOW_STEPS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
