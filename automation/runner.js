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
    WAITING_FOR_CAMPAIGNS_PAGE: 'WAITING_FOR_CAMPAIGNS_PAGE',
    SETTLING_AFTER_REDIRECT: 'SETTLING_AFTER_REDIRECT',
    REFRESH_CAMPAIGNS: 'REFRESH_CAMPAIGNS',
    VERIFY_SUBMISSION: 'VERIFY_SUBMISSION',
    READY_FOR_NEXT_CAMPAIGN: 'READY_FOR_NEXT_CAMPAIGN',
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

      // Handle reload recovery checkpoints (Task 7)
      if (this.currentState === RUNNER_STATES.RUNNING) {
        const config = await this.storage?.getConfig();
        this.activeConfig = config;

        if (jobState.refreshCheckpoint === 'REFRESH_IN_PROGRESS' || jobState.currentStep === WORKFLOW_STEPS.REFRESH_CAMPAIGNS) {
          this.diag('RELOAD_RECOVERY', 'Resuming sequential loop after page refresh', {
            verification: `Resuming at Campaign ${jobState.currentCampaignIndex} of ${jobState.totalCampaigns}`
          });
          await this.handlePostRefreshResume(jobState, config);
        } else if (jobState.submissionStatus === 'SUBMISSION_PENDING') {
          this.diag('RELOAD_RECOVERY', 'Resuming workflow after submission pending reload', {
            verification: `Checking Campaign ${jobState.currentCampaignIndex} redirect`
          });
          await this.handleSubmissionPendingResume(jobState, config);
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
        campaignResults: [],
        submissionStatus: 'NONE',
        submissionEvidence: null,
        refreshCheckpoint: 'NONE',
        lastPublishClickTime: null
      });

      this.diag('START_AUTOMATION', `Job [${this.activeJobId}] launched`, {
        verification: `Total: ${total} campaigns | Mode: ${config.liveMode ? 'LIVE' : 'TEST'}`
      });

      // Run sequential loop asynchronously
      this.executeCampaignLoop(1, total, config);

      return { success: true, status: this.currentState, runId: this.activeJobId };
    }

    /**
     * Master sequential loop for creating N campaigns (Task 6)
     * Sequence per campaign: Publish -> Wait -> Return -> Refresh -> Verify
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

        console.log(`[RUNNER] Starting Campaign ${currentIndex}/${totalCampaigns}`);
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

        // TASK 3 & TASK 9: Test Mode Handling
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

        // Live Mode: Tab refresh was initiated
        if (result.reloading) {
          this.log(`Campaign ${currentIndex} publish step initiated refresh.`);
          // In real browser, page reloads and resumes via initialize().
          // In test mocks where reload() is intercepted:
          await this.helpers?.sleep(500);
          const updatedJob = await this.storage?.getJobState();
          if (updatedJob && (updatedJob.refreshCheckpoint === 'REFRESH_IN_PROGRESS' || updatedJob.currentStep === WORKFLOW_STEPS.REFRESH_CAMPAIGNS)) {
            await this.handlePostRefreshResume(updatedJob, config);
          }
          return;
        }

        // Failure or Ambiguous Outcome Handling
        if (!result.success) {
          this.warn(`Campaign ${currentIndex} did not complete: ${result.error}`);

          if (result.ambiguous) {
            console.log('[VERIFY] Submission could not be confirmed');
            console.log('[RUNNER] NEEDS_VERIFICATION');
            console.log('[RUNNER] Batch paused to prevent duplicates');

            await this.storage?.updateJobState({
              status: RUNNER_STATES.NEEDS_VERIFICATION,
              currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION,
              lastError: result.error || 'Submission outcome ambiguous. Check TikTok Ads Manager before proceeding.',
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
      }

      // Mark Job Completed if reached naturally
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
     * Handle resuming after a page reload while submission was pending (Task 7)
     * e.g., TikTok performed a full page navigation back to Campaigns page instead of SPA
     * @param {object} jobState
     * @param {object} config
     */
    async handleSubmissionPendingResume(jobState, config) {
      const h = this.helpers;
      const currentIndex = jobState.currentCampaignIndex || 1;
      this.isProcessingLock = true;
      this.shouldAbort = false;

      // Check if already returned to Campaigns page
      if (h.isCampaignsManagementUrl() && h.findCampaignsManagementUI()) {
        console.log('[NAVIGATION] Campaigns page detected');
        console.log('[NAVIGATION] Waiting 3 seconds for page to settle');
        await h.sleep(3000);

        if (!h.isCampaignsManagementUrl() || !h.findCampaignsManagementUI()) {
          const confirmed = await h.waitForCampaignsPage(5000);
          if (!confirmed) {
            console.log('[VERIFY] Submission could not be confirmed');
            console.log('[RUNNER] NEEDS_VERIFICATION');
            console.log('[RUNNER] Batch paused to prevent duplicates');
            await this.storage?.updateJobState({
              status: RUNNER_STATES.NEEDS_VERIFICATION,
              lastError: 'Navigation away from Campaigns page'
            });
            this.currentState = RUNNER_STATES.NEEDS_VERIFICATION;
            this.isProcessingLock = false;
            return;
          }
        }

        // Trigger single refresh
        await this.storage?.updateJobState({
          refreshCheckpoint: 'REFRESH_IN_PROGRESS',
          currentStep: WORKFLOW_STEPS.REFRESH_CAMPAIGNS
        });
        console.log('[REFRESH] Campaigns page refresh started');
        if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
          window.location.reload();
        }
        await h.sleep(500);
        const updatedJob = await this.storage?.getJobState();
        if (updatedJob && updatedJob.refreshCheckpoint === 'REFRESH_IN_PROGRESS') {
          await this.handlePostRefreshResume(updatedJob, config);
        }
      } else {
        // Wait up to 30s for redirect
        const reached = await h.waitForCampaignsPage(30000);
        if (reached) {
          console.log('[NAVIGATION] Campaigns page detected');
          console.log('[NAVIGATION] Waiting 3 seconds for page to settle');
          await h.sleep(3000);
          console.log('[REFRESH] Campaigns page refresh started');
          await this.storage?.updateJobState({
            refreshCheckpoint: 'REFRESH_IN_PROGRESS',
            currentStep: WORKFLOW_STEPS.REFRESH_CAMPAIGNS
          });
          if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
            window.location.reload();
          }
          await h.sleep(500);
          const updatedJob = await this.storage?.getJobState();
          if (updatedJob && updatedJob.refreshCheckpoint === 'REFRESH_IN_PROGRESS') {
            await this.handlePostRefreshResume(updatedJob, config);
          }
        } else {
          console.log('[VERIFY] Submission could not be confirmed');
          console.log('[RUNNER] NEEDS_VERIFICATION');
          console.log('[RUNNER] Batch paused to prevent duplicates');
          await this.storage?.updateJobState({
            status: RUNNER_STATES.NEEDS_VERIFICATION,
            lastError: 'Submission could not be confirmed after reload.'
          });
          this.currentState = RUNNER_STATES.NEEDS_VERIFICATION;
          this.isProcessingLock = false;
        }
      }
    }

    /**
     * Handle resuming the sequential loop after page refresh (Task 5, 6, 7)
     * Performs post-refresh submission verification, increments successful count,
     * and continues to the next campaign.
     * @param {object} jobState
     * @param {object} config
     */
    async handlePostRefreshResume(jobState, config) {
      const h = this.helpers;
      const c = this.campaign;
      const currentIndex = jobState.currentCampaignIndex || 1;
      const totalCampaigns = jobState.totalCampaigns || 1;

      this.isProcessingLock = true;
      this.shouldAbort = false;

      // 1. Wait for Campaigns page to be fully interactive
      const isReady = await h.waitForCampaignsPage(20000);
      if (!isReady) {
        console.log('[VERIFY] Submission could not be confirmed');
        console.log('[RUNNER] NEEDS_VERIFICATION');
        console.log('[RUNNER] Batch paused to prevent duplicates');
        await this.storage?.updateJobState({
          status: RUNNER_STATES.NEEDS_VERIFICATION,
          currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION,
          lastError: 'Campaigns page failed to become interactive after refresh.'
        });
        this.currentState = RUNNER_STATES.NEEDS_VERIFICATION;
        this.isProcessingLock = false;
        return;
      }

      console.log('[REFRESH] Page loaded successfully');

      // Update checkpoint to REFRESH_COMPLETED
      await this.storage?.updateJobState({
        refreshCheckpoint: 'REFRESH_COMPLETED',
        currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION
      });

      // 2. Verify submission using reliable evidence (TASK 5)
      const verifyResult = await c.verifySubmittedCampaign(jobState);

      if (!verifyResult.verified) {
        console.log('[VERIFY] Submission could not be confirmed');
        console.log('[RUNNER] NEEDS_VERIFICATION');
        console.log('[RUNNER] Batch paused to prevent duplicates');
        await this.storage?.updateJobState({
          status: RUNNER_STATES.NEEDS_VERIFICATION,
          currentStep: WORKFLOW_STEPS.VERIFY_SUBMISSION,
          lastError: verifyResult.error || 'Submission could not be confirmed on Campaigns page.',
          stepDescription: 'Submission outcome ambiguous. Manual verification required in Ads Manager.'
        });
        this.currentState = RUNNER_STATES.NEEDS_VERIFICATION;
        this.isProcessingLock = false;
        return;
      }

      // Verification succeeded!
      console.log('[VERIFY] Campaign submission verified');
      const currentJob = await this.storage?.getJobState();
      const successCount = (currentJob?.successfulCampaigns || 0) + 1;

      const results = currentJob?.campaignResults || [];
      results.push({
        index: currentIndex,
        status: 'SUBMITTED',
        campaignId: verifyResult.campaignId || null,
        submittedAt: new Date().toISOString()
      });

      await this.storage?.updateJobState({
        successfulCampaigns: successCount,
        campaignResults: results,
        submissionStatus: 'NONE',
        refreshCheckpoint: 'NONE',
        submissionEvidence: null
      });

      console.log(`[RUNNER] Campaign ${currentIndex}/${totalCampaigns} completed`);

      // 3. Sequential Multi-Campaign Loop (TASK 6)
      if (currentIndex < totalCampaigns) {
        const nextIndex = currentIndex + 1;
        console.log(`[RUNNER] Starting Campaign ${nextIndex}/${totalCampaigns}`);

        await this.storage?.updateJobState({
          currentCampaignIndex: nextIndex,
          currentStep: WORKFLOW_STEPS.CLICK_CREATE,
          stepDescription: `Starting Campaign ${nextIndex} of ${totalCampaigns}`
        });

        // Continue loop with next campaign
        await this.executeCampaignLoop(nextIndex, totalCampaigns, config);
      } else {
        // All requested campaigns finished!
        await this.storage?.updateJobState({
          status: RUNNER_STATES.COMPLETED,
          currentStep: 'COMPLETED',
          stepDescription: `Batch complete: ${totalCampaigns} campaigns created.`
        });
        this.currentState = RUNNER_STATES.COMPLETED;
        this.isProcessingLock = false;
        this.log(`🎉 Batch finished! All ${totalCampaigns} campaigns completed.`);
      }
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
        const total = Number(config.campaignCount) || 1;
        const publishResult = await c.handlePublishStep(config, campaignIndex, total);

        // TASK 3 & TASK 9: Test Mode check
        if (publishResult.testMode) {
          return { success: true, testMode: true };
        }

        // Live Mode: reloading initiated (Tasks 3, 4, 7)
        if (publishResult.reloading) {
          return { success: true, reloading: true };
        }

        if (!publishResult.success) {
          return publishResult;
        }

        return { success: true, testMode: false, campaignId: publishResult.campaignId };

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
