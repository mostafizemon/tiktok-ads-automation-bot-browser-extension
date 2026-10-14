/**
 * automation/campaign.js
 * Comprehensive Campaign creation pipeline for TikTok Ads Manager.
 *
 * Implements full verified workflow:
 * 1. Click Create Campaign on /manage/campaign
 * 2. Handle optional Custom Mode transition
 * 3. Select Traffic objective, configure Campaign Budget, click Continue
 * 4. Demographics & Multi-Country targeting using REAL TikTok tree & search selectors:
 *    - Container: #fieldRenderer-particleLocations
 *    - Dropdown: [data-testid="lego-antd-select"]
 *    - Search input: input[data-testid="lego-antd-select-popover-content-input"]
 *    - Country treeitem: [role="treeitem"] containing [data-testid="lego-antd-tree-title"]
 *    - Checkbox: [role="checkbox"] with aria-checked inspection
 *    - Verification tags: <ks-tag-923 data-testid="lego-tag-list-tag">
 * 5. Input Destination Website URL
 * 6. Creative Assets -> Add -> TikTok posts tab -> Add post
 * 7. Spark Ads Post Authorization Code input -> Continue -> Add TikTok posts
 * 8. Verify post selection and Confirm drawer
 * 9. Publish step (Test Mode: stops before publish; Live Mode: clicks Publish all)
 * 10. Robust Submission Verification (requires explicit TikTok confirmation, never raw redirect)
 */

(function (global) {
  'use strict';

  class CampaignAutomation {
    constructor() {
      this.name = 'CampaignAutomation';
      this._isAddPostRunning = false;
    }

    get helpers() {
      return global.AutomationHelpers;
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
     * Step 1: Detect current view and click Create button on Campaigns page
     */
    async clickCreateCampaign() {
      const h = this.helpers;
      const stepName = 'CLICK_CREATE';
      this.diag(stepName, 'Locating "Create" button on Campaigns page');

      // Target: <ks-button-923 class="primaryHalfStart-TMSZmk KsButton"> containing "Create"
      let createBtn = null;

      const ksButtons = h.queryShadowAll('ks-button-923, [class*="KsButton"], button');
      for (const btn of ksButtons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (text === 'Create' && h.isVisible(btn)) {
          createBtn = h.getClickableTarget(btn);
          break;
        }
      }

      if (!createBtn) {
        createBtn = await h.waitForButtonByText('Create', 10000);
      }

      if (!createBtn) {
        this.diag(stepName, 'Locate Create button', {
          elementMissing: 'ks-button-923[Create]',
          error: 'Create button not found on page'
        });
        throw new Error('Could not find visible "Create" button on Campaigns page.');
      }

      // Snapshot visible existing campaign IDs and names on the management page before creating new campaign
      if (this.storage && h.isCampaignsManagementUrl && h.isCampaignsManagementUrl()) {
        try {
          const baseline = h.extractCampaignBaselineFromTable ? h.extractCampaignBaselineFromTable() : { ids: [], names: [] };
          const job = await this.storage.getJobState();
          if (job) {
            const currentKnownIds = new Set(job.knownCampaignIds || []);
            const currentKnownNames = new Set(job.knownCampaignNames || []);
            (baseline.ids || []).forEach(id => currentKnownIds.add(id));
            (baseline.names || []).forEach(name => currentKnownNames.add(name));
            await this.storage.updateJobState({
              knownCampaignIds: Array.from(currentKnownIds),
              knownCampaignNames: Array.from(currentKnownNames)
            });
          }
        } catch (e) {
          // Non-blocking snapshot
        }
      }

      this.diag(stepName, 'Clicking Create button', {
        elementFound: 'ks-button-923[Create]',
        verification: 'Button found and clicked'
      });

      h.safeClick(createBtn, 'Campaigns Create Button');
      await h.sleep(1500);
      return true;
    }

    /**
     * Step 2: Handle optional Custom Mode dialog flow
     */
    async handleCustomModeFlow() {
      const stepName = 'CUSTOM_MODE_CHECK';
      this.diag(stepName, 'Evaluating Custom Mode transition requirement');

      if (global.CustomModeHandler) {
        await global.CustomModeHandler.ensureCustomMode(8000);
        console.log('[RUNNER] Continuing Traffic objective selection');
      }

      this.diag(stepName, 'Custom Mode evaluation finished', {
        verification: 'Interface ready for Traffic objective'
      });
      return true;
    }

    /**
     * Step 3: Select Traffic objective, set budget, and click Continue
     * Strictly verifies each action before advancing:
     * 1. Detect Advertising Objective page
     * 2. Select Traffic objective (using verified label[role="radio"])
     * 3. Verify Traffic selected & Reach not selected
     * 4. Locate Campaign Budget section
     * 5. Enable Campaign Budget if disabled
     * 6. Verify Campaign Budget enabled
     * 7. Locate budget input & enter budget value
     * 8. Verify budget value & check validation errors
     * 9. Click Continue
     * 10. Verify navigation to Demographics page
     * @param {object} config
     */
    async selectTrafficObjectiveAndBudget(config) {
      const h = this.helpers;
      const stepName = 'OBJECTIVE_AND_BUDGET';

      // 1. Detect Advertising Objective page
      await this.detectObjectivePage();

      // 2. Select Traffic objective with strict verification
      await this.selectTrafficObjective();

      // 3. Configure Campaign Budget with strict verification
      await this.configureCampaignBudget(config.dailyBudget);

      // Capture autogenerated campaign name (e.g. Traffic20261013161035) from objective page
      try {
        const detectedName = h.extractCampaignNameFromPage ? h.extractCampaignNameFromPage() : null;
        if (detectedName) {
          console.log(`[OBJECTIVE] Expected campaign name captured: ${detectedName}`);
          await this.storage?.updateJobState({
            expectedCampaignName: detectedName
          });
        }
      } catch (e) {
        // Non-blocking capture
      }

      // 4. Click Continue and verify navigation to Demographics page
      await this.clickContinueAndVerifyDemographics();

      return true;
    }

    /**
     * 1. Detect Advertising Objective page
     */
    async detectObjectivePage() {
      const h = this.helpers;
      const stepName = 'DETECT_OBJECTIVE_PAGE';
      this.diag(stepName, 'Detecting Advertising Objective page');

      const start = Date.now();
      let detected = false;

      while (Date.now() - start < 15000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        if (global.PopupHandler?.checkForKnownTutorialPopup) {
          global.PopupHandler.checkForKnownTutorialPopup();
        }

        const labels = h.queryShadowAll('label[role="radio"], span.index_title_Nvlf1, h1, h2, h3, h4, div');
        let hasObjectiveText = false;
        let hasRadioLabels = false;

        for (const el of labels) {
          if (!h.isVisible(el)) continue;
          if (el.matches && el.matches('label[role="radio"]')) {
            hasRadioLabels = true;
          }
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (text === 'advertising objective' || text === 'campaign objective' || text.includes('advertising objective')) {
            hasObjectiveText = true;
          }
        }

        if (hasRadioLabels || hasObjectiveText) {
          detected = true;
          break;
        }

        await h.sleep(400);
      }

      if (!detected) {
        this.diag(stepName, 'Advertising Objective page not detected', {
          error: 'Page detection timed out'
        });
        throw new Error('Advertising Objective page was not detected.');
      }

      console.log('[OBJECTIVE] Objective page detected');
      this.diag(stepName, 'Advertising Objective page confirmed', { verification: 'Page ready' });
    }

    /**
     * 2. Select Traffic objective and verify selection
     * Uses real verified HTML:
     * <label role="radio" class="vi-radio is-bordered index_objective_EvS5B">
     *   <input type="radio" class="vi-radio__original" value="1">
     *   <span class="index_title_Nvlf1">Traffic</span>
     * </label>
     */
    async selectTrafficObjective() {
      const h = this.helpers;
      const stepName = 'TRAFFIC_OBJECTIVE';

      // 1. Locate Traffic radio label
      const trafficRadio = await this.findTrafficRadioLabel();
      if (!trafficRadio) {
        this.diag(stepName, 'Traffic radio label could not be found', {
          error: 'Traffic objective radio label not found'
        });
        throw new Error('Traffic objective selection failed.');
      }

      console.log('[OBJECTIVE] Traffic option found');
      this.diag(stepName, 'Traffic option found', {
        elementFound: 'label[role="radio"] containing "Traffic"'
      });

      // 2. Check if Traffic is already selected
      const reachRadio = this.findReachRadioLabel();
      const isTrafficAlreadySelected = this.isRadioSelected(trafficRadio);
      const isReachSelected = this.isRadioSelected(reachRadio);

      if (isTrafficAlreadySelected && !isReachSelected) {
        this.diag(stepName, 'Traffic is already selected; skipping click', {
          verification: 'Traffic verified active'
        });
        console.log('[OBJECTIVE] Traffic verified');
        console.log('[OBJECTIVE] Traffic selection verified');
        console.log('[OBJECTIVE] Reach is not selected');
        return true;
      }

      // 3. Attempt click on the Traffic label directly
      console.log('[OBJECTIVE] Traffic click attempted');
      this.diag(stepName, 'Clicking Traffic radio label directly', {
        elementFound: 'label[role="radio"][Traffic]'
      });

      trafficRadio.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(300);

      h.safeClick(trafficRadio, 'Traffic radio label');
      await h.sleep(800);

      // 4. Verify Traffic is actually selected and Reach is no longer selected
      const verifyStart = Date.now();
      let isVerified = false;

      while (Date.now() - verifyStart < 6000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        const currentTrafficRadio = this.findTrafficRadioLabel() || trafficRadio;
        const currentReachRadio = this.findReachRadioLabel();

        const trafficSelected = this.isRadioSelected(currentTrafficRadio);
        const reachDeselected = !this.isRadioSelected(currentReachRadio);

        if (trafficSelected && reachDeselected) {
          isVerified = true;
          break;
        }

        // Retry click on the inner input or span if state did not update after 2.5s
        if (Date.now() - verifyStart > 2500 && !trafficSelected) {
          const innerInput = currentTrafficRadio.querySelector('input[type="radio"]') ||
                             currentTrafficRadio.querySelector('.vi-radio__inner') ||
                             currentTrafficRadio.querySelector('.index_title_Nvlf1');
          if (innerInput) {
            this.diag(stepName, 'Retrying click on inner radio control');
            h.safeClick(innerInput, 'Traffic inner radio control');
            await h.sleep(800);
          }
        }

        await h.sleep(300);
      }

      if (!isVerified) {
        this.diag(stepName, 'Traffic selection verification failed', {
          error: 'Traffic objective selection failed.',
          trafficClasses: trafficRadio.className,
          reachClasses: reachRadio ? reachRadio.className : 'N/A'
        });
        throw new Error('Traffic objective selection failed.');
      }

      console.log('[OBJECTIVE] Traffic verified');
      console.log('[OBJECTIVE] Traffic selection verified');
      console.log('[OBJECTIVE] Reach is not selected');
      this.diag(stepName, 'Traffic objective verified selected, Reach verified deselected');
      return true;
    }

    /**
     * Find the visible label[role="radio"] containing exact title "Traffic"
     * Requires exactly one visible matching Traffic radio label.
     * @returns {HTMLElement|null}
     */
    findTrafficRadioLabel() {
      const h = this.helpers;
      // Rebate accounts append a badge to the title ("Traffic Rebate offer").
      // Use the supplied objective metadata before the legacy exact-title fallback.
      // Do not use objective_type alone: Sales also exposes objective_type="1".
      const wrappers = h.queryShadowAll('[data-tea-objective-content="Traffic"]');
      for (const wrapper of wrappers) {
        if (wrapper.getAttribute('data-tea-objective-value') !== '1') continue;
        const label = h.queryShadow('label[role="radio"]', wrapper);
        if (label && h.isVisible(label)) return label;
      }
      const radioLabels = h.queryShadowAll('label[role="radio"], [role="radio"]');
      const matches = [];

      for (const label of radioLabels) {
        if (!h.isVisible(label)) continue;

        // Check for child title with exact text "Traffic"
        const titleSpan = label.querySelector('.index_title_Nvlf1') ||
                          label.querySelector('.index_objectiveTitle_hK5BW') ||
                          label.querySelector('.vi-radio__label');

        let text = '';
        if (titleSpan) {
          text = (titleSpan.innerText || titleSpan.textContent || '').trim();
        } else {
          const spans = label.querySelectorAll('span, div');
          for (const s of spans) {
            if ((s.innerText || s.textContent || '').trim() === 'Traffic') {
              text = 'Traffic';
              break;
            }
          }
        }

        if (text === 'Traffic') {
          matches.push(label);
        }
      }

      if (matches.length === 1) {
        return matches[0];
      }

      if (matches.length > 1) {
        this.diag('TRAFFIC_FIND', `Found ${matches.length} matching Traffic labels; selecting first visible`);
        return matches[0];
      }

      return null;
    }

    /**
     * Find the visible label[role="radio"] containing exact title "Reach"
     * @returns {HTMLElement|null}
     */
    findReachRadioLabel() {
      const h = this.helpers;
      const radioLabels = h.queryShadowAll('label[role="radio"], [role="radio"]');

      for (const label of radioLabels) {
        if (!h.isVisible(label)) continue;

        const titleSpan = label.querySelector('.index_title_Nvlf1') ||
                          label.querySelector('.index_objectiveTitle_hK5BW') ||
                          label.querySelector('.vi-radio__label');

        let text = '';
        if (titleSpan) {
          text = (titleSpan.innerText || titleSpan.textContent || '').trim();
        } else {
          const spans = label.querySelectorAll('span, div');
          for (const s of spans) {
            if ((s.innerText || s.textContent || '').trim() === 'Reach') {
              text = 'Reach';
              break;
            }
          }
        }

        if (text === 'Reach') {
          return label;
        }
      }

      return null;
    }

    /**
     * Inspect whether a radio label is currently in selected state
     * Checks:
     * - "is-checked" class on label
     * - aria-checked="true" attribute
     * - input[type="radio"].checked property
     * - .vi-radio__input with "is-checked" class
     * @param {HTMLElement} label
     * @returns {boolean}
     */
    isRadioSelected(label) {
      if (!label) return false;

      // 1. Selected-state CSS class on the label
      if (label.classList.contains('is-checked')) return true;
      if (typeof label.className === 'string' && /(^|\s)is-checked(\s|$)/.test(label.className)) return true;

      // 2. aria-checked attribute
      if (label.getAttribute('aria-checked') === 'true') return true;

      // 3. Radio input checked property
      const radioInput = label.querySelector('input[type="radio"]');
      if (radioInput && radioInput.checked) return true;

      // 4. Inner vi-radio__input checked class
      const radioInputSpan = label.querySelector('.vi-radio__input');
      if (radioInputSpan && radioInputSpan.classList.contains('is-checked')) return true;

      // 5. Check if inner radio or wrapper has aria-checked="true"
      const ariaInner = label.querySelector('[aria-checked="true"]');
      if (ariaInner) return true;

      return false;
    }

    /**
     * Step 3.2: Configure Campaign Budget with verified HTML and nested Shadow DOM traversal:
     * 1. Find Campaign Budget radio
     * 2. Check aria-checked: if true, do not click again; if not selected, click and verify aria-checked="true"
     * 3. Find Budget Mode dropdown and verify "Daily" is selected (if Lifetime, choose Daily)
     * 4. Find Budget Input host [data-testid="create_campaign_CBO_daily_budget"]
     * 5. Access first open shadowRoot -> find [x-name="x-input"]
     * 6. Access second open shadowRoot -> locate input[part="input"]
     * 7. Focus, set native value with HTMLInputElement value setter, dispatch input/change/blur
     * 8. Wait for TikTok validation, verify numeric value matches configured budget
     * 9. Inspect validation errors inside #cbo-daily-budget .vi-form-item__error
     * @param {string|number} budget
     */
    async configureCampaignBudget(budget) {
      const stepName = 'CAMPAIGN_BUDGET';
      const budgetNum = parseFloat(budget);
      if (isNaN(budgetNum) || budgetNum <= 0) {
        this.diag(stepName, `Invalid budget value configured: "${budget}"`, {
          error: 'Budget must be a positive number'
        });
        throw new Error(`Invalid budget configured: "${budget}". Budget must be a positive number.`);
      }

      const budgetFormatted = budgetNum.toFixed(2);
      this.diag(stepName, `Configuring Campaign Budget: $${budgetFormatted}`);

      // 1-5. Find and verify Campaign Budget radio selection
      await this.ensureCampaignBudgetRadioSelected();
      console.log('[BUDGET] Campaign budget selected');
      await this.ensureOptionalCustomBudgetSelected();

      // 6-8. Find Budget Mode dropdown and ensure Daily mode is selected
      await this.ensureDailyBudgetMode();

      // 9-13. Traverse TWO nested open Shadow DOM roots to locate budget input
      const budgetInput = await this.locateNestedShadowBudgetInput();
      console.log('[BUDGET] Daily budget input ready');

      // 14-23. Set budget value, verify numeric value, inspect TikTok validation errors
      await this.enterAndVerifyBudgetValue(budgetInput, budgetFormatted);
      console.log('[BUDGET] Daily budget entered');
      console.log('[BUDGET] Budget verified');

      return true;
    }

    /** Scope optional radio discovery to the local budget section, never the page. */
    findCustomBudgetOption() {
      const h = this.helpers;
      const campaign = this.findCampaignBudgetRadio();
      const parent = node => node.parentElement || node.getRootNode()?.host;
      let section = null;
      for (let node = campaign; node; node = parent(node)) {
        if (node.matches('body, html, form')) break;
        const budgetAnchor = h.queryShadow(
          '[data-testid="create_campaign_CBO_daily_budget"], [data-testid="campaign_settings_budgetCboSelect"], #cbo-daily-budget', node
        );
        if (budgetAnchor || (node === campaign && h.queryShadow('[role="radiogroup"]', node)) ||
            node.matches('section, fieldset, [role="group"]')) {
          section = node;
          break;
        }
      }
      if (!section) return null;
      const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
      // Prefer the supplied radiogroup structure; its generated test ID is not stable.
      const groups = h.queryShadowAll('[role="radiogroup"]', section).filter(group => h.isVisible(group));
      const options = groups.length
        ? groups.flatMap(group => h.queryShadowAll('label[role="radio"]', group))
        : h.queryShadowAll('[role="radio"], input[type="radio"]', section);
      for (const radio of options) {
        const label = radio.closest('label');
        const labels = Array.from(radio.labels || []);
        const root = radio.getRootNode();
        const labelledBy = (radio.getAttribute('aria-labelledby') || '').split(/\s+/)
          .map(id => root.getElementById?.(id)?.textContent || '').join(' ');
        // The supplied label also contains the complete budget form and rebate notice.
        // Read only its own title span, not the combined descendant text.
        const labelContent = Array.from(label?.children || []).find(node => node.classList.contains('vi-radio__label'));
        const title = Array.from(labelContent?.children || []).find(node => node.tagName === 'SPAN');
        const name = radio.getAttribute('aria-label') || labelledBy.trim() ||
          title?.textContent || labels.map(item => item.textContent).join(' ') || label?.textContent || radio.textContent;
        const target = label || labels.find(item => h.isVisible(item)) || radio;
        if (normalize(name) !== 'Custom budget' || !h.isVisible(target)) continue;
        const controls = [target, radio, ...h.queryShadowAll('input[type="radio"], [role="radio"]', target)];
        return {
          target,
          selected: target.matches('label[role="radio"]')
            ? target.getAttribute('aria-checked') === 'true' || target.classList.contains('is-checked')
            : controls.some(node => node.checked === true || this.isRadioSelected(node)),
          disabled: controls.some(node => node.disabled === true || node.matches(':disabled') ||
            (node.hasAttribute('disabled') && node.getAttribute('disabled') !== 'false') ||
            node.getAttribute('aria-disabled') === 'true' ||
            node.classList.contains('is-disabled'))
        };
      }
      return null;
    }

    async ensureOptionalCustomBudgetSelected(timeoutMs = 5000) {
      const h = this.helpers;
      const started = Date.now();
      let detected = false;
      let clicked = false;
      // Allow optional controls to render even when the old Daily input is still visible.
      while (Date.now() - started < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        const option = this.findCustomBudgetOption();
        if (option) {
          if (!detected) console.log('[BUDGET] Custom budget radio detected');
          detected = true;
          if (option.selected) {
            console.log(clicked ? '[BUDGET] Custom budget selected' : '[BUDGET] Custom budget already selected');
            console.log('[BUDGET] Continuing to daily budget input');
            return;
          }
          if (!option.disabled && !clicked) {
            await h.sleep(100);
            // Pause/Stop and rerenders can occur during the settling wait.
            if (h.isAborted()) throw new Error('Automation aborted or paused by user');
            const current = this.findCustomBudgetOption();
            if (current && !current.disabled && !current.selected) {
              h.safeClick(current.target);
              clicked = true;
            }
          }
        } else if (!detected && Date.now() - started >= 1000) {
          console.log('[BUDGET] Custom budget not present');
          console.log('[BUDGET] Using existing daily budget flow');
          return;
        }
        await h.sleep(200);
      }
      throw new Error('Custom budget option did not become available and selected in the Campaign Budget section.');
    }

    /**
     * Find Campaign Budget radio element using verified stable selectors
     * Verified HTML:
     * <label data-testid="spp-cbo-1FqvMw" role="radio" aria-checked="true"
     *        class="vi-radio is-checked" data-tea-std-component-name="campaign_budget">
     *   Campaign budget
     * </label>
     * @returns {HTMLElement|null}
     */
    findCampaignBudgetRadio() {
      const h = this.helpers;

      // 1. Stable attribute selectors
      const stableSelectors = [
        'label[data-tea-std-component-name="campaign_budget"]',
        '[data-tea-std-component-name="campaign_budget"]',
        'label[data-testid*="spp-cbo"]',
        '[data-testid*="spp-cbo"]'
      ];

      for (const sel of stableSelectors) {
        const el = document.querySelector(sel) || h.queryShadow(sel);
        if (el && h.isVisible(el)) {
          return el;
        }
      }

      // 2. Search all radio labels containing "Campaign budget"
      const radioLabels = h.queryShadowAll('label[role="radio"], [role="radio"]');
      for (const label of radioLabels) {
        if (!h.isVisible(label)) continue;
        const text = (label.innerText || label.textContent || '').trim();
        if (text === 'Campaign budget' || text.toLowerCase().includes('campaign budget')) {
          return label;
        }
      }

      return null;
    }

    /**
     * Verify and ensure Campaign Budget radio is selected:
     * - Check aria-checked
     * - If aria-checked="true", do not click again
     * - If not selected, click and verify aria-checked becomes "true"
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<HTMLElement>}
     */
    async ensureCampaignBudgetRadioSelected(timeoutMs = 10000) {
      const h = this.helpers;
      const stepName = 'CAMPAIGN_BUDGET_RADIO';
      const start = Date.now();

      let radio = null;
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        radio = this.findCampaignBudgetRadio();
        if (radio) break;
        await h.sleep(300);
      }

      if (!radio) {
        this.diag(stepName, 'Campaign Budget radio not found', {
          error: 'Could not find Campaign budget radio element'
        });
        throw new Error('Campaign Budget radio could not be found.');
      }

      console.log('[BUDGET] Campaign Budget radio found');
      this.diag(stepName, 'Campaign Budget radio found', {
        elementFound: radio.getAttribute('data-testid') || radio.tagName
      });

      // Check aria-checked and class state
      const isAlreadyChecked = radio.getAttribute('aria-checked') === 'true' ||
                              radio.classList.contains('is-checked') ||
                              this.isRadioSelected(radio);

      if (isAlreadyChecked) {
        this.diag(stepName, 'Campaign Budget radio is already selected; skipping click', {
          verification: 'aria-checked="true"'
        });
        console.log('[BUDGET] Radio selected');
        return radio;
      }

      // Click to select
      radio.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(300);
      this.diag(stepName, 'Clicking Campaign Budget radio label');
      h.safeClick(radio, 'Campaign Budget radio label');
      await h.sleep(600);

      // Verify aria-checked becomes "true"
      const verifyStart = Date.now();
      let verified = false;

      while (Date.now() - verifyStart < 6000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        const current = this.findCampaignBudgetRadio() || radio;
        if (current.getAttribute('aria-checked') === 'true' ||
            current.classList.contains('is-checked') ||
            this.isRadioSelected(current)) {
          verified = true;
          break;
        }
        await h.sleep(300);
      }

      if (!verified) {
        this.diag(stepName, 'Failed to verify aria-checked="true" on Campaign Budget radio', {
          error: 'Radio selection verification failed'
        });
        throw new Error('Campaign Budget radio selection could not be verified (aria-checked did not become true).');
      }

      console.log('[BUDGET] Radio selected');
      this.diag(stepName, 'Campaign Budget radio selected and verified');
      return radio;
    }

    /**
     * Ensure Budget Mode dropdown is set to "Daily":
     * - Verified selector: [data-testid="campaign_settings_budgetCboSelect"]
     * - Verified Daily option: [data-testid="campaign_settings_budgetCboOption3"] (data-tea-budget-mode="3")
     * - If Lifetime is selected, choose Daily
     * @param {number} [timeoutMs=8000]
     * @returns {Promise<boolean>}
     */
    async ensureDailyBudgetMode(timeoutMs = 8000) {
      const h = this.helpers;
      const stepName = 'BUDGET_MODE_DAILY';
      const start = Date.now();

      let selectEl = null;
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        selectEl = document.querySelector('[data-testid="campaign_settings_budgetCboSelect"]') ||
                   h.queryShadow('[data-testid="campaign_settings_budgetCboSelect"]') ||
                   document.querySelector('[data-testid*="budgetCboSelect"]') ||
                   h.queryShadow('[data-testid*="budgetCboSelect"]');
        if (selectEl && h.isVisible(selectEl)) break;
        selectEl = null; // Hidden legacy controls must not make the dropdown mandatory.
        if (this.findAvailableDailyBudgetInput()) {
          console.log('[BUDGET] Daily mode verified');
          this.diag(stepName, 'Daily mode verified by usable input inside the daily-specific budget host/container');
          return true;
        }
        await h.sleep(300);
      }

      const isDailySelected = (el) => {
        if (!el) return false;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const modeAttr = el.getAttribute('data-tea-budget-mode');
        if (modeAttr === '3') return true;
        if (text.includes('daily') && !text.includes('lifetime')) return true;
        const selectedChild = el.querySelector('[data-tea-budget-mode="3"], [data-testid*="Option3"]');
        if (selectedChild) return true;
        return false;
      };

      if (!selectEl) {
        this.diag(stepName, 'Daily budget interface unresolved', {
          error: 'No visible budget mode dropdown or usable input in the daily-specific budget host/container after waiting'
        });
        throw new Error('Daily budget interface could not be verified: no visible Budget Mode dropdown or usable Daily Budget input after waiting.');
      }

      if (isDailySelected(selectEl)) {
        console.log('[BUDGET] Daily mode verified');
        this.diag(stepName, 'Daily mode already selected and verified');
        return true;
      }

      // If Lifetime is selected, choose Daily
      this.diag(stepName, 'Opening Budget Mode dropdown to select Daily');
      selectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);
      h.safeClick(selectEl, 'Budget Mode dropdown');
      await h.sleep(600);

      // Locate Daily option: [data-testid="campaign_settings_budgetCboOption3"] or [data-tea-budget-mode="3"]
      const optStart = Date.now();
      let dailyOption = null;

      while (Date.now() - optStart < 5000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        dailyOption = document.querySelector('[data-testid="campaign_settings_budgetCboOption3"]') ||
                      h.queryShadow('[data-testid="campaign_settings_budgetCboOption3"]') ||
                      document.querySelector('[data-tea-budget-mode="3"]') ||
                      h.queryShadow('[data-tea-budget-mode="3"]');

        if (dailyOption && h.isVisible(dailyOption)) break;

        // Fallback search across visible menu items/options for "Daily"
        const allOptions = h.queryShadowAll('[role="option"], li, div[class*="option"], div[class*="item"]');
        for (const opt of allOptions) {
          if (!h.isVisible(opt)) continue;
          const t = (opt.innerText || opt.textContent || '').trim().toLowerCase();
          if (t === 'daily' || t === 'daily budget' || (t.startsWith('daily') && !t.includes('lifetime'))) {
            dailyOption = opt;
            break;
          }
        }
        if (dailyOption) break;
        await h.sleep(300);
      }

      if (!dailyOption) {
        this.diag(stepName, 'Daily budget option not found in dropdown', {
          error: 'Option [data-testid="campaign_settings_budgetCboOption3"] missing'
        });
        throw new Error('Daily budget option could not be found in Budget Mode dropdown.');
      }

      h.safeClick(dailyOption, 'Daily budget option');
      await h.sleep(600);

      // Verify Daily is now selected
      const verifyDailyStart = Date.now();
      let verifiedDaily = false;

      while (Date.now() - verifyDailyStart < 4000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        const currentSelect = document.querySelector('[data-testid="campaign_settings_budgetCboSelect"]') || selectEl;
        if (isDailySelected(currentSelect)) {
          verifiedDaily = true;
          break;
        }
        await h.sleep(300);
      }

      if (!verifiedDaily) {
        this.diag(stepName, 'Daily mode verification failed', {
          error: 'Dropdown did not switch to Daily'
        });
        throw new Error('Failed to verify Daily budget mode was selected.');
      }

      console.log('[BUDGET] Daily mode verified');
      this.diag(stepName, 'Daily mode verified');
      return true;
    }

    /**
     * Traverse TWO nested open Shadow DOM roots to locate the budget input:
     * Outer host: [data-testid="create_campaign_CBO_daily_budget"] (x-name="x-input-number")
     *   #shadow-root (open)
     *     Nested host: [x-name="x-input"]
     *       #shadow-root (open)
     *         input[part="input"]
     *
     * Stable rules:
     * - Do not depend on dynamic custom-element tag suffixes (e.g. -s5lfyjk4)
     * - Use stable data-testid and x-name attributes
     * - Bounded waiting
     * @returns {HTMLInputElement|null}
     */
    // The daily-specific host/container is the mode evidence; require an actual usable input.
    findAvailableDailyBudgetInput() {
      const h = this.helpers;
      const stepName = 'NESTED_BUDGET_INPUT';
      // 9. Find Budget Input host using stable data-testid or x-name
      const host1 = document.querySelector('[data-testid="create_campaign_CBO_daily_budget"]') ||
                    h.queryShadow('[data-testid="create_campaign_CBO_daily_budget"]') ||
                    document.querySelector('#cbo-daily-budget [x-name="x-input-number"]') ||
                    h.queryShadow('#cbo-daily-budget [x-name="x-input-number"]');

      if (host1 && host1.shadowRoot) {
        // 10. Access the first open shadowRoot
        const root1 = host1.shadowRoot;

        // 11. Find the nested element: [x-name="x-input"]
        const host2 = root1.querySelector('[x-name="x-input"]') ||
                      root1.querySelector('x-input, [class*="x-input"]');

        if (host2 && host2.shadowRoot) {
          // 12. Access its second open shadowRoot
          const root2 = host2.shadowRoot;

          // 13. Locate input[part="input"]
          const input = root2.querySelector('input[part="input"]') ||
                        root2.querySelector('input.input') ||
                        root2.querySelector('input[type="text"]') ||
                        root2.querySelector('input');

          if (input && h.isVisible(input) && !input.disabled && !input.readOnly) {
            console.log('[BUDGET] Nested Shadow DOM input found');
            this.diag(stepName, 'Nested Shadow DOM budget input found', {
              host1: host1.getAttribute('data-testid') || host1.tagName,
              host2: host2.getAttribute('x-name') || host2.tagName,
              inputPart: input.getAttribute('part')
            });
            return input;
          }
        }
      }

      // Direct fallback piercing host1 if shadow hierarchy differs slightly
      if (host1) {
        const fallbackInput = h.queryShadow('input[part="input"], input.input, input[type="text"]', host1.shadowRoot || host1);
        if (fallbackInput && h.isVisible(fallbackInput) && !fallbackInput.disabled && !fallbackInput.readOnly) {
          console.log('[BUDGET] Nested Shadow DOM input found');
          this.diag(stepName, 'Budget input found via shadow fallback traversal');
          return fallbackInput;
        }
      }
      return null;
    }

    async locateNestedShadowBudgetInput(timeoutMs = 10000) {
      const h = this.helpers;
      const stepName = 'NESTED_BUDGET_INPUT';
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        const input = this.findAvailableDailyBudgetInput();
        if (input) return input;

        await h.sleep(300);
      }

      this.diag(stepName, 'Budget input host or nested shadow DOM elements not found', {
        error: 'Could not traverse shadow roots to input[part="input"]'
      });
      throw new Error('Nested Shadow DOM budget input field could not be found.');
    }

    clickOutsideBudgetInput(input) {
      if (this.helpers.isAborted()) throw new Error('Automation aborted or paused by user');
      // Target the page background itself. safeClick(body) could resolve a child button.
      const background = document.body;
      for (const type of ['mousedown', 'mouseup']) {
        background.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      input.blur();
      background.click();

      // In real browser environments, also dispatch outside click on an empty non-interactive container
      try {
        const emptyArea = document.querySelector('.byted-layout, .spp-layout, #app, form, section');
        if (emptyArea && emptyArea !== background && !emptyArea.matches('button, a, input, select, textarea, [role="button"], [role="radio"]')) {
          for (const type of ['mousedown', 'mouseup']) {
            emptyArea.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
          }
        }
      } catch (_) {}

      console.log('[BUDGET] Clicked outside budget input');
    }

    /**
     * Type budget value into input field with React/synthetic event support
     * @param {HTMLInputElement} input
     * @param {string} valueStr
     */
    typeBudgetValue(input, valueStr) {
      input.focus();
      try {
        if (typeof FocusEvent !== 'undefined') {
          input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
          input.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }));
        }
      } catch (_) {}

      if (typeof input.select === 'function') {
        try { input.select(); } catch (_) {}
      }

      // React tracker synchronization if present
      if (input._valueTracker) {
        input._valueTracker.setValue('');
      }

      try {
        if (typeof InputEvent !== 'undefined') {
          input.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            data: valueStr,
            inputType: 'insertText'
          }));
        }
      } catch (_) {}

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement?.prototype || {},
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, valueStr);
      } else {
        input.value = valueStr;
      }

      try {
        if (typeof InputEvent !== 'undefined') {
          input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            data: valueStr,
            inputType: 'insertText'
          }));
        } else {
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
      } catch (_) {
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }

      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      input.blur();
    }

    /**
     * Enter budget value, verify numeric match, and check TikTok validation errors:
     * - Focus the input
     * - Type budget using native HTMLInputElement value setter and React tracker sync
     * - Dispatch input, change, and blur events with bubbling and composition
     * - Click outside in an empty space to commit value
     * - Wait for TikTok validation
     * - Verify displayed numeric value matches configuration
     * - Check validation errors inside: #cbo-daily-budget .vi-form-item__error
     * - If a transient validation error is detected (e.g. "between 20.00 and 9,999,999.99"),
     *   re-click into the input field and click an empty space to clear it
     * @param {HTMLInputElement} input
     * @param {string} budgetFormatted
     * @returns {Promise<boolean>}
     */
    async enterAndVerifyBudgetValue(input, budgetFormatted) {
      const h = this.helpers;
      const stepName = 'ENTER_VERIFY_BUDGET';

      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);

      // 14. Focus and type into the input
      if (h.isAborted()) throw new Error('Automation aborted or paused by user');
      h.safeClick(input, 'Daily budget input');
      this.typeBudgetValue(input, budgetFormatted);

      // 15. Click outside in an empty area to commit
      this.clickOutsideBudgetInput(input);

      console.log('[BUDGET] Value entered');
      this.diag(stepName, `Entered budget value: ${budgetFormatted}`);

      // 16. Wait for TikTok's validation to complete
      await h.sleep(600);
      input = await this.locateNestedShadowBudgetInput();

      // 17. Verify the displayed numeric value matches the configured budget
      let actualVal = (input.value || '').trim();
      let numericActual = parseFloat(actualVal.replace(/[^0-9.]/g, ''));
      const numericExpected = parseFloat(budgetFormatted);

      if (isNaN(numericActual) || Math.abs(numericActual - numericExpected) > 0.01) {
        // Retry entry once
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        h.safeClick(input, 'Daily budget input');
        this.typeBudgetValue(input, budgetFormatted);
        this.clickOutsideBudgetInput(input);
        await h.sleep(500);
        input = await this.locateNestedShadowBudgetInput();

        actualVal = (input.value || '').trim();
        numericActual = parseFloat(actualVal.replace(/[^0-9.]/g, ''));
        if (isNaN(numericActual) || Math.abs(numericActual - numericExpected) > 0.01) {
          this.diag(stepName, 'Numeric value mismatch', {
            expected: budgetFormatted,
            actual: actualVal
          });
          throw new Error(`Budget numeric value verification failed: expected "${budgetFormatted}", found "${actualVal}".`);
        }
      }

      console.log('[BUDGET] Numeric value verified');
      this.diag(stepName, `Numeric value verified: ${budgetFormatted}`);

      // Helper to find visible errors in DOM/Shadow DOM
      const getVisibleErrors = () => {
        const errorContainers = h.queryShadowAll('#cbo-daily-budget .vi-form-item__error, .vi-form-item__error');
        return errorContainers.filter(errEl => {
          if (!h.isVisible(errEl)) return false;
          const text = (errEl.innerText || errEl.textContent || '').trim();
          return text.length > 0;
        });
      };

      let visibleErrors = getVisibleErrors();

      // 18. If a validation error is detected (such as "Your budget must be a number between 20.00 and 9,999,999.99.")
      // but the numeric value is valid (e.g. >= 20.00), handle TikTok's transient validation state:
      // Real-browser testing confirmed: clicking the input field and then clicking in an empty space clears this error.
      if (visibleErrors.length > 0 && !isNaN(numericActual) && numericActual >= 20.00 && numericActual <= 9999999.99) {
        for (let retry = 1; retry <= 2; retry++) {
          const firstErrText = (visibleErrors[0].innerText || visibleErrors[0].textContent || '').trim();
          console.log(`[BUDGET] Transient validation error detected ("${firstErrText}"). Clicking input and empty area to clear (attempt ${retry}/2)...`);
          this.diag(stepName, 'Re-clicking input and empty area to clear transient validation error', { error: firstErrText, attempt: retry });

          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          input = await this.locateNestedShadowBudgetInput();
          h.safeClick(input, 'Daily budget input');
          this.typeBudgetValue(input, budgetFormatted);
          await h.sleep(200);

          this.clickOutsideBudgetInput(input);
          await h.sleep(600);

          visibleErrors = getVisibleErrors();
          if (visibleErrors.length === 0) {
            console.log('[BUDGET] Validation error cleared successfully');
            this.diag(stepName, 'Budget validation error successfully cleared after re-clicking input and empty area');
            break;
          }
        }
      }

      // 19. If errors remain after retry, throw error
      if (visibleErrors.length > 0) {
        const errText = (visibleErrors[0].innerText || visibleErrors[0].textContent || '').trim();
        this.diag(stepName, `TikTok budget validation error: "${errText}"`, { error: errText });
        throw new Error(`TikTok budget validation error: ${errText}`);
      }

      console.log('[BUDGET] Validation passed');
      this.diag(stepName, 'Budget validation passed without errors');
      return true;
    }

    /**
     * Click Continue and verify navigation to Demographics page
     */
    async clickContinueAndVerifyDemographics() {
      const h = this.helpers;
      const stepName = 'NAVIGATION_TO_DEMOGRAPHICS';

      // 1. Click Continue
      await this.clickCommonNextButton('Continue (Objective page)');
      console.log('[NAVIGATION] Continue clicked');
      this.diag(stepName, 'Clicked Continue button; waiting for Demographics page');

      // 2. Wait and verify navigation to Demographics page
      const start = Date.now();
      let demographicsDetected = false;

      while (Date.now() - start < 15000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        if (global.PopupHandler?.checkForKnownTutorialPopup) {
          global.PopupHandler.checkForKnownTutorialPopup();
        }

        const demoHeader = h.queryShadow('#section_dom_id_targetingDemographics, [id*="targetingDemographics"]');
        const locationDropdown = h.queryShadow('#fieldRenderer-particleLocations, [data-testid="lego-antd-select"]');

        if ((demoHeader && h.isVisible(demoHeader)) || this.findAudienceControlsHeading() || (locationDropdown && h.isVisible(locationDropdown))) {
          demographicsDetected = true;
          break;
        }

        const headings = h.queryShadowAll('h1, h2, h3, h4, div, span');
        for (const el of headings) {
          if (!h.isVisible(el)) continue;
          const text = (el.innerText || el.textContent || '').trim();
          if (text === 'Demographics' || text === 'Location' || text === 'Locations' || text === 'Placements') {
            if (el.children.length <= 2) {
              demographicsDetected = true;
              break;
            }
          }
        }

        if (demographicsDetected) break;
        await h.sleep(400);
      }

      if (!demographicsDetected) {
        this.diag(stepName, 'Demographics page not detected after Continue', {
          error: 'Navigation to Demographics page timed out'
        });
        throw new Error('Navigation to Demographics page could not be verified after clicking Continue.');
      }

      console.log('[NAVIGATION] Demographics page detected');
      this.diag(stepName, 'Demographics page confirmed ready');
      return true;
    }

    findAudienceControlsHeading() {
      return this.helpers.queryShadowAll('[data-testid="lego-content-slot-panel-title-Audience controls"]')
        .find(node => this.helpers.isVisible(node)) || null;
    }

    async ensureCountryTargetingSectionOpen(timeoutMs = 8000) {
      const h = this.helpers;
      const start = Date.now();
      let clicked = false;
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        const demo = h.queryShadowAll('#section_dom_id_targetingDemographics, [id*="targetingDemographics"]')
          .find(node => h.isVisible(node));
        const heading = demo || this.findAudienceControlsHeading();
        if (heading) {
          const panel = heading.closest('[data-lego-collapse-aria-expanded]');
          const expanded = panel?.getAttribute('data-lego-collapse-aria-expanded');
          if (demo) {
            // Preserve the existing Demographics path when available.
            if (expanded === 'false' && !clicked) {
              await h.sleep(300);
              if (h.isAborted()) throw new Error('Automation aborted or paused by user');
              h.safeClick(heading, 'Demographics section header');
              await h.sleep(600);
            }
            return;
          }
          // A read-only Locations summary is not the editable country field.
          const location = panel && h.queryShadow('#fieldRenderer-particleLocations', panel);
          // The supplied field wrapper uses display: contents and has no layout box.
          // Test the actual interactive dropdown instead of the wrapper's dimensions.
          const locationTrigger = location && h.queryShadow('[data-testid="lego-antd-select"]', location);
          if (expanded === 'true' && locationTrigger && h.isVisible(locationTrigger)) {
            console.log('[TARGETING] Audience controls ready');
            return;
          }
          if (expanded === 'false' && !clicked) {
            await h.sleep(100);
            if (h.isAborted()) throw new Error('Automation aborted or paused by user');
            if (panel.getAttribute('data-lego-collapse-aria-expanded') === 'false') {
              h.safeClick(heading, 'Audience controls section header');
              console.log('[TARGETING] Audience controls clicked');
              clicked = true;
            }
          }
        } else {
          const location = h.queryShadow('#fieldRenderer-particleLocations');
          const locationTrigger = location && h.queryShadow('[data-testid="lego-antd-select"]', location);
          if (locationTrigger && h.isVisible(locationTrigger)) return;
        }
        await h.sleep(200);
      }
      throw new Error('Targeting section unavailable: expected Demographics or expanded Audience controls with an editable Locations field.');
    }

    /**
     * Step 4: Demographics & Country Targeting
     * Implements REAL verified HTML selectors:
     * - Container: #fieldRenderer-particleLocations
     * - Dropdown: [data-testid="lego-antd-select"]
     * - Search input: input[data-testid="lego-antd-select-popover-content-input"]
     * - Country result: [role="treeitem"] with [data-testid="lego-antd-tree-title"]
     * - Checkbox: [role="checkbox"] inspected for aria-checked
     * - Verified tags: <ks-tag-923 data-testid="lego-tag-list-tag">
     * @param {object} config
     */
    async configureDemographicsAndCountries(config) {
      const h = this.helpers;
      const stepName = 'DEMOGRAPHICS_COUNTRIES';
      const targetCountries = (config.targetCountries && config.targetCountries.length > 0)
        ? config.targetCountries
        : ['United States'];

      this.diag(stepName, `Configuring target countries: ${JSON.stringify(targetCountries)}`);

      // Open the account's targeting variant before using the unchanged country workflow.
      await this.ensureCountryTargetingSectionOpen();

      // 2. Manage existing selected tags:
      // Remove unwanted default countries, retain requested ones
      await this.cleanupUnwantedCountryTags(targetCountries);

      // 3. Select all requested countries using Method 1 (Direct) & Method 2 (Search)
      await this.selectTargetCountriesViaDropdown(targetCountries);

      // 4. Final verification: Check that all requested countries are selected in the tags
      await this.verifyFinalCountryTags(targetCountries);

      // 5. Close the dropdown by clicking outside it
      await this.closeLocationDropdown();

      // 6. Verify no location validation errors remain
      await this.verifyNoLocationErrors();

      // Keep default demographics for age, gender, languages
      this.diag(stepName, 'Defaults retained for age/gender/languages');

      // 7. Click Continue: <ks-button-923 data-testid="common_next_button">
      await this.clickCommonNextButton('Continue (Demographics page)');
      console.log('[NAVIGATION] Demographics continue clicked');

      // 8. Verify navigation to the next page
      await this.verifyNavigationToNextPage();

      return true;
    }

    /**
     * Inspect existing tags: remove default countries not in requested list, retain requested ones
     * Country remove button: [part="closeIcon"][aria-label="Remove tag"] inside open Shadow DOM
     * @param {Array<string>} targetCountries
     */
    async cleanupUnwantedCountryTags(targetCountries) {
      const h = this.helpers;
      const stepName = 'CLEANUP_COUNTRY_TAGS';
      const normalizedTargets = targetCountries.map(c => c.trim().toLowerCase());

      const existingTags = h.queryShadowAll('ks-tag-923[data-testid="lego-tag-list-tag"], [data-testid="lego-tag-list-tag"]');
      this.diag(stepName, `Found ${existingTags.length} existing country tag(s)`);

      for (const tag of existingTags) {
        if (!h.isVisible(tag)) continue;
        const countryName = (tag.innerText || tag.textContent || '').trim();
        const lowerName = countryName.toLowerCase();

        if (normalizedTargets.includes(lowerName)) {
          this.diag(stepName, `Retaining already-selected country tag: ${countryName}`, {
            verification: 'Tag matches configuration'
          });
        } else {
          this.diag(stepName, `Removing unwanted country tag: ${countryName}`);
          let closeBtn = null;
          if (tag.shadowRoot) {
            closeBtn = tag.shadowRoot.querySelector('[part="closeIcon"][aria-label="Remove tag"]') ||
                       tag.shadowRoot.querySelector('[part="closeIcon"]') ||
                       tag.shadowRoot.querySelector('[aria-label*="Remove"]');
          }
          if (!closeBtn) {
            closeBtn = tag.querySelector('[part="closeIcon"][aria-label="Remove tag"], [part="closeIcon"], [aria-label*="Remove"], [class*="close"]');
          }

          if (closeBtn) {
            h.safeClick(closeBtn, `Remove tag button for ${countryName}`);
            await h.sleep(350);
          }
        }
      }
    }

    /**
     * Select all requested target countries:
     * For each requested country:
     * - Check if already selected.
     * - If not, try direct dropdown selection (Method 1).
     * - If direct selection fails, search and click country name (Method 2).
     * - Verify the selected tag.
     * - Clear search and repeat for the next country.
     * - Never deselect an already selected requested country.
     * @param {Array<string>} targetCountries
     */
    async selectTargetCountriesViaDropdown(targetCountries) {
      const h = this.helpers;
      const stepName = 'SELECT_COUNTRIES_DROPDOWN';

      // 1. Open the Location Dropdown if not already open
      let selectTrigger = h.queryShadow('#fieldRenderer-particleLocations [data-testid="lego-antd-select"]') ||
                          h.queryShadow('[data-testid="lego-antd-select"]');

      if (!selectTrigger) {
        this.diag(stepName, 'Location dropdown trigger missing', {
          error: 'Location select trigger [data-testid="lego-antd-select"] not found'
        });
        throw new Error('Location Dropdown [data-testid="lego-antd-select"] not found.');
      }

      // Check if verified search input is already visible
      let searchInput = h.queryShadow('input[data-testid="lego-antd-select-popover-content-input"]');
      if (!searchInput || !h.isVisible(searchInput)) {
        this.diag(stepName, 'Opening Location dropdown', {
          elementFound: '[data-testid="lego-antd-select"]'
        });
        h.safeClick(selectTrigger, 'Location country selector trigger');
        await h.sleep(700);
      }

      // Bounded wait for search input
      searchInput = await h.waitForVisibleElement('input[data-testid="lego-antd-select-popover-content-input"]', 8000);
      if (!searchInput) {
        this.diag(stepName, 'Country search input missing', {
          error: 'Verified search input [data-testid="lego-antd-select-popover-content-input"] not found'
        });
        throw new Error('Verified country search input [data-testid="lego-antd-select-popover-content-input"] not found.');
      }

      console.log('[COUNTRY] Location dropdown opened');

      // 2. Process each requested country
      for (const country of targetCountries) {
        const trimmedCountry = country.trim();
        if (!trimmedCountry) continue;

        // Check if already selected
        if (this.isCountryTagSelected(trimmedCountry)) {
          this.diag(stepName, `Country "${trimmedCountry}" is already selected; skipping selection`, {
            verification: 'Tag present'
          });
          console.log(`[COUNTRY] Country "${trimmedCountry}" already selected`);
          continue;
        }

        // Try Method 1: Direct dropdown selection
        let selected = await this.tryDirectDropdownSelection(trimmedCountry, searchInput);

        // If direct selection fails, try Method 2: Search and click country name
        if (!selected) {
          selected = await this.selectCountryViaSearch(trimmedCountry, searchInput);
        }

        // Verify the country tag is now present
        const tagPresent = await this.waitForCountryTagToAppear(trimmedCountry, 4000);
        if (!tagPresent) {
          this.diag(stepName, `Failed to verify tag for country "${trimmedCountry}"`, {
            error: 'Country tag missing after selection attempt'
          });
          throw new Error(`Country selection verification failed for "${trimmedCountry}".`);
        }

        console.log(`[COUNTRY] Tag verified: "${trimmedCountry}"`);

        // Clear search input for the next country
        this.clearSearchInput(searchInput);
        await h.sleep(300);
      }

      return true;
    }

    /**
     * METHOD 1 — DIRECT DROPDOWN SELECTION:
     * 1. Inspect visible country list without searching.
     * 2. Find exact country name.
     * 3. Select via checkbox or clickable title.
     * 4. Bounded local scrolling within dropdown only (never window/page).
     * 5. Do not click tree expansion arrow.
     * 6. If not found efficiently, return false to trigger Method 2.
     * @param {string} countryName
     * @param {HTMLInputElement} searchInput
     * @returns {Promise<boolean>}
     */
    async tryDirectDropdownSelection(countryName, searchInput) {
      const h = this.helpers;
      const stepName = 'DIRECT_DROPDOWN_SELECTION';
      const targetLower = countryName.trim().toLowerCase();

      if (this.isCountryTagSelected(countryName)) {
        return true;
      }

      // Clear search input if it has residual text
      if (searchInput && searchInput.value) {
        this.clearSearchInput(searchInput);
        await h.sleep(300);
      }

      const popover = searchInput ? (searchInput.closest('[class*="popover"]') || searchInput.parentElement?.parentElement) : null;
      const scrollContainer = popover?.querySelector('.ant-tree-list-holder, [class*="tree-list"], [class*="scroll"]') || null;
      const maxScrollSteps = scrollContainer ? 2 : 1;

      for (let step = 0; step < maxScrollSteps; step++) {
        const treeTitles = h.queryShadowAll('[data-testid="lego-antd-tree-title"], .ant-tree-title', popover || document);

        for (const titleEl of treeTitles) {
          if (!h.isVisible(titleEl)) continue;
          const text = (titleEl.innerText || titleEl.textContent || '').trim().toLowerCase();

          if (text === targetLower) {
            const treeItem = titleEl.closest('[role="treeitem"]') || titleEl.parentElement;
            const checkbox = treeItem?.querySelector('[role="checkbox"]');

            if (checkbox) {
              const isChecked = checkbox.getAttribute('aria-checked') === 'true';
              if (isChecked) {
                this.diag(stepName, `Country "${countryName}" checkbox already checked`);
                return true;
              }

              this.diag(stepName, `Clicking treeitem checkbox for "${countryName}"`);
              h.safeClick(checkbox, `Checkbox for ${countryName}`);
            } else {
              this.diag(stepName, `Clicking direct tree title for "${countryName}"`);
              h.safeClick(titleEl, `Country title for ${countryName}`);
            }

            const tagAppeared = await this.waitForCountryTagToAppear(countryName, 3000);
            if (tagAppeared) {
              this.diag(stepName, `Direct dropdown selection successful for "${countryName}"`);
              return true;
            }
          }
        }

        // Bounded scroll inside dropdown only
        if (scrollContainer && step < maxScrollSteps - 1) {
          scrollContainer.scrollTop += 180;
          await h.sleep(250);
        }
      }

      this.diag(stepName, `Country "${countryName}" not found via direct selection, proceeding to Method 2`);
      return false;
    }

    /**
     * METHOD 2 — SEARCH AND CLICK COUNTRY NAME:
     * 1. Find verified search input: [data-testid="lego-antd-select-popover-content-input"]
     * 2. Clear previous search text.
     * 3. Enter requested country name.
     * 4. Wait for search results to update.
     * 5. Find visible "Search results" section / items.
     * 6. Locate exact country-name match.
     * 7. Ensure result represents a Country, not city/region.
     * 8. Identify clickable result row or title.
     * 9. Click Country Name / Result directly.
     * 10. Do not require [role="treeitem"] or [role="checkbox"].
     * 11. Wait for selected country tag to appear.
     * 12. Verify selected country name matches input.
     * 13. If clicking did not select the country, report an error instead of clicking repeatedly.
     * @param {string} countryName
     * @param {HTMLInputElement} searchInput
     * @returns {Promise<boolean>}
     */
    async selectCountryViaSearch(countryName, searchInput) {
      const h = this.helpers;
      const stepName = 'SEARCH_COUNTRY_SELECTION';

      this.diag(stepName, `Searching country: "${countryName}"`);

      // 1-2. Clear previous search text
      this.clearSearchInput(searchInput);
      await h.sleep(200);

      // 3. Enter requested country name
      h.setNativeInputValue(searchInput, countryName);
      await h.sleep(600);

      // 4. Locate popover content container
      const popover = searchInput.closest('[class*="popover"]') ||
                      document.querySelector('.ant-popover-content, [class*="popover-content"]') ||
                      document;

      // 5-8. Wait for search results and locate matching Country result
      const waitStart = Date.now();
      let matchedElement = null;

      while (Date.now() - waitStart < 6000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        matchedElement = this.findSearchResultCountry(countryName, popover);
        if (matchedElement) break;

        await h.sleep(300);
      }

      if (!matchedElement) {
        this.diag(stepName, `No matching country search result found for "${countryName}"`, {
          error: `Search result for "${countryName}" not found`
        });
        throw new Error(`Country "${countryName}" could not be found in TikTok Ads search results.`);
      }

      // 9. Click Country Name / Result directly
      this.diag(stepName, `Clicking country search result directly for "${countryName}"`);
      h.safeClick(matchedElement, `Country search result for ${countryName}`);

      // 11-12. Wait for selected country tag to appear & verify
      const tagAppeared = await this.waitForCountryTagToAppear(countryName, 4000);

      // 13. If clicking did not select the country, report error instead of clicking repeatedly
      if (!tagAppeared) {
        this.diag(stepName, `Country tag did not appear after clicking search result for "${countryName}"`, {
          error: 'Country tag missing after click'
        });
        throw new Error(`Clicking search result for "${countryName}" did not add the country tag. Automation stopped.`);
      }

      console.log(`[COUNTRY] Selected via search: "${countryName}"`);
      this.diag(stepName, `Verified country "${countryName}" tag added via search selection`);

      return true;
    }

    /**
     * Find the matching Country search result element:
     * - Searches inside popover or document
     * - Verifies that result represents a "Country", not a city, region, or state
     * - Returns the clickable country name element or row
     * - Does NOT require [role="treeitem"] or [role="checkbox"]
     * @param {string} countryName
     * @param {Element} [popoverContainer=document]
     * @returns {HTMLElement|null}
     */
    findSearchResultCountry(countryName, popoverContainer = document) {
      const h = this.helpers;
      const targetLower = countryName.trim().toLowerCase();
      const root = popoverContainer || document;

      // Query visible candidate elements
      const candidates = h.queryShadowAll('div, li, span, tr', root);

      // Strategy 1: Find row/item that contains countryName AND indicates "Country"
      const matchingRows = [];
      for (const el of candidates) {
        if (!h.isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim();
        const lower = text.toLowerCase();

        if (!lower.includes(targetLower)) continue;

        // Ensure result represents a Country, not a city or region
        const isCountryType = lower.includes('country');
        const isCityOrRegion = lower.includes('city') || lower.includes('region') ||
                               lower.includes('province') || lower.includes('state') ||
                               lower.includes('district');

        if (isCountryType && !isCityOrRegion) {
          if (text.length < 120) {
            matchingRows.push({ el, text });
          }
        }
      }

      if (matchingRows.length > 0) {
        // Sort by shortest text length to get most specific container
        matchingRows.sort((a, b) => a.text.length - b.text.length);
        const bestRow = matchingRows[0].el;

        // Find child element whose exact text is the country name (e.g. <span>Bangladesh</span>)
        const children = bestRow.querySelectorAll('*');
        for (const child of children) {
          if (!h.isVisible(child)) continue;
          const childText = (child.innerText || child.textContent || '').trim().toLowerCase();
          if (childText === targetLower) {
            return child;
          }
        }
        return bestRow;
      }

      // Strategy 2: Check for direct element with exact text match under popover
      for (const el of candidates) {
        if (!h.isVisible(el)) continue;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') continue;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (text === targetLower) {
          return el;
        }
      }

      // Strategy 3: Check [data-testid="lego-antd-tree-title"]
      const titles = h.queryShadowAll('[data-testid="lego-antd-tree-title"]', root);
      for (const t of titles) {
        if (!h.isVisible(t)) continue;
        if ((t.innerText || t.textContent || '').trim().toLowerCase() === targetLower) {
          return t;
        }
      }

      return null;
    }

    /**
     * Clear the search input completely and trigger synthetic React input/change events
     * @param {HTMLInputElement} searchInput
     */
    clearSearchInput(searchInput) {
      const h = this.helpers;
      if (!searchInput) return;

      searchInput.focus();
      h.setNativeInputValue(searchInput, '');
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    /**
     * Check if a country tag is currently selected and visible
     * @param {string} countryName
     * @returns {boolean}
     */
    isCountryTagSelected(countryName) {
      const h = this.helpers;
      const targetLower = countryName.trim().toLowerCase();
      const tags = h.queryShadowAll('ks-tag-923[data-testid="lego-tag-list-tag"], [data-testid="lego-tag-list-tag"]');

      for (const tag of tags) {
        if (!h.isVisible(tag)) continue;
        const text = (tag.innerText || tag.textContent || '').trim().toLowerCase();
        if (text === targetLower || text.startsWith(targetLower)) {
          return true;
        }
      }

      return false;
    }

    /**
     * Bounded wait for a country tag to appear in the selected tags list
     * @param {string} countryName
     * @param {number} [timeoutMs=4000]
     * @returns {Promise<boolean>}
     */
    async waitForCountryTagToAppear(countryName, timeoutMs = 4000) {
      const h = this.helpers;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        if (this.isCountryTagSelected(countryName)) {
          return true;
        }
        await h.sleep(200);
      }

      return false;
    }

    /**
     * Close the location dropdown by clicking outside it
     */
    async closeLocationDropdown() {
      const h = this.helpers;
      this.diag('CLOSE_DROPDOWN', 'Closing Location dropdown by clicking outside');

      const neutralElement = h.queryShadow('#section_dom_id_targetingDemographics') ||
                             h.queryShadow('h1, h2, h3, h4') ||
                             document.body;

      if (neutralElement) {
        neutralElement.click();
        await h.sleep(400);
      }
    }

    /**
     * Verify no location validation errors remain inside #fieldRenderer-particleLocations
     */
    async verifyNoLocationErrors() {
      const h = this.helpers;
      const stepName = 'VERIFY_NO_LOCATION_ERRORS';

      const locContainer = h.queryShadow('#fieldRenderer-particleLocations') || document;
      const errorElements = h.queryShadowAll('.vi-form-item__error, [role="alert"]', locContainer);

      for (const errEl of errorElements) {
        if (h.isVisible(errEl)) {
          const text = (errEl.innerText || errEl.textContent || '').trim();
          if (text.length > 0) {
            this.diag(stepName, `Location validation error detected: "${text}"`, { error: text });
            throw new Error(`Location validation error: ${text}`);
          }
        }
      }

      this.diag(stepName, 'No location validation errors found');
      return true;
    }

    /**
     * Verify navigation from Demographics to the next page (Website URL / Ad setup)
     * @param {number} [timeoutMs=15000]
     * @returns {Promise<boolean>}
     */
    async verifyNavigationToNextPage(timeoutMs = 15000) {
      const h = this.helpers;
      const stepName = 'NAVIGATION_TO_NEXT_PAGE';
      const start = Date.now();
      let navigated = false;

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');
        if (global.PopupHandler?.checkForKnownTutorialPopup) {
          global.PopupHandler.checkForKnownTutorialPopup();
        }

        // Check for presence of Website URL textarea or Ad Creative setup on next page
        const urlTextarea = h.queryShadow('textarea[data-testid="ks-text-field-index-aZM5M2"], textarea[placeholder*="http"]');
        const nextHeader = h.queryShadow('[data-testid*="creative"], [data-testid*="ad_text"], [id*="creative"], [id*="adSetup"]');

        // Or verify that demographics container is no longer the active page section
        const locSection = h.queryShadow('#fieldRenderer-particleLocations');
        const locGone = !locSection || !h.isVisible(locSection);

        if ((urlTextarea && h.isVisible(urlTextarea)) || (nextHeader && h.isVisible(nextHeader)) || locGone) {
          navigated = true;
          break;
        }

        await h.sleep(400);
      }

      if (!navigated) {
        this.diag(stepName, 'Next page detection timed out after clicking Continue', {
          error: 'Navigation to next page timed out'
        });
        throw new Error('Navigation to next page could not be verified after Demographics Continue.');
      }

      console.log('[NAVIGATION] Navigated to next page');
      this.diag(stepName, 'Next page verified successfully');
      return true;
    }

    /**
     * Verify all selected countries using the actual selected tags (<ks-tag-923 data-testid="lego-tag-list-tag">)
     * @param {Array<string>} targetCountries
     */
    async verifyFinalCountryTags(targetCountries) {
      const h = this.helpers;
      const stepName = 'VERIFY_COUNTRY_TAGS';
      const normalizedTargets = targetCountries.map(c => c.trim().toLowerCase());

      const finalTags = h.queryShadowAll('ks-tag-923[data-testid="lego-tag-list-tag"], [data-testid="lego-tag-list-tag"]');
      const foundNames = finalTags.map(t => (t.innerText || t.textContent || '').trim().toLowerCase());

      const missing = normalizedTargets.filter(c => !foundNames.some(fn => fn === c || fn.startsWith(c)));

      if (missing.length > 0) {
        this.diag(stepName, 'Verify final tags match configuration', {
          elementMissing: `Tags for: ${missing.join(', ')}`,
          verification: `Found tags: ${foundNames.join(', ')}`,
          error: `Missing required country tags: ${missing.join(', ')}`
        });
        throw new Error(`Country selection verification failed: Missing [${missing.join(', ')}].`);
      }

      this.diag(stepName, 'All target country tags verified', {
        verification: `Confirmed ${foundNames.length} tag(s): ${foundNames.join(', ')}`
      });
    }

    /**
     * Step 5: Input Destination Website URL
     * @param {string} websiteUrl
     */
    async inputWebsiteUrl(websiteUrl) {
      const h = this.helpers;
      const stepName = 'WEBSITE_URL';
      this.diag(stepName, `Setting destination Website URL`);

      // Target: <textarea part="textarea" class="text-field" placeholder="Enter URL starting with http:// or https://" data-testid="ks-text-field-index-aZM5M2"></textarea>
      let textarea = await h.waitForVisibleElement('textarea[data-testid="ks-text-field-index-aZM5M2"], textarea[placeholder*="http"]', 10000);

      if (!textarea) {
        const allTextareas = h.queryShadowAll('textarea');
        for (const ta of allTextareas) {
          const ph = (ta.getAttribute('placeholder') || '').toLowerCase();
          if (ph.includes('http') && h.isVisible(ta)) {
            textarea = ta;
            break;
          }
        }
      }

      if (!textarea) {
        this.diag(stepName, 'Locate Website URL textarea', {
          elementMissing: 'textarea[placeholder*="http"]',
          error: 'Website URL field missing'
        });
        throw new Error('Could not find Website URL textarea.');
      }

      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(300);

      h.setNativeTextareaValue(textarea, websiteUrl);
      await h.sleep(400);

      if (!textarea.value.includes(websiteUrl)) {
        h.setNativeTextareaValue(textarea, websiteUrl);
      }

      this.diag(stepName, 'Website URL verified', {
        elementFound: 'textarea[data-testid="ks-text-field-index-aZM5M2"]',
        verification: 'URL set successfully'
      });
    }

    normalizeCtaText(value) {
      return (value || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Robust CTA section locator. The root ID may disappear after Clear All
     * re-renders the field, so fall back to stable anchors and the visible
     * "Call to action text" heading. Never matches an unrelated dropdown.
     * @returns {HTMLElement|null}
     */
    findCtaSection() {
      const h = this.helpers;
      // Priority 1: original root ID.
      let section = h.queryShadow('#fieldRenderer-callToActionAssetList');
      if (section && h.isVisible(section)) return section;
      // Priority 2: lego anchor.
      section = h.queryShadow('[data-lego-anchor="callToActionAssetList"]');
      if (section) {
        const container = section.closest
          ? (section.closest('[data-testid="lego-section-item"], #fieldRenderer-callToActionAssetList, [data-tea-std_module_name="creative__creative-cta-select-tree"]') || section)
          : section;
        if (!container || h.isVisible(container)) return container || section;
      }
      // Priority 3: tea module wrapper.
      section = h.queryShadow('[data-tea-std_module_name="creative__creative-cta-select-tree"]');
      if (section && h.isVisible(section)) return section;
      // Priority 4: visible heading with exact text "Call to action text".
      const headingCandidates = h.queryShadowAll('[data-testid="lego-section-item-header-title"], ks-text-923, h1, h2, h3, h4, span, div');
      for (const el of headingCandidates) {
        if (!h.isVisible(el)) continue;
        if (this.normalizeCtaText(el.innerText || el.textContent) !== 'Call to action text') continue;
        // Ascend through composed tree (heading may live inside shadow DOM).
        let current = el;
        for (let depth = 0; depth < 12 && current; depth++) {
          if (current.matches && current.matches('[data-testid="lego-section-item"]')) return current;
          current = current.assignedSlot || current.parentElement || current.getRootNode?.().host || null;
        }
        // Fallback: nearest section container holding a CTA select.
        current = el;
        for (let depth = 0; depth < 12 && current; depth++) {
          const select = current.querySelector
            ? (current.querySelector('ks-select-923, [data-tea-std_component_name="creative_aigc_cta"]') || (h.queryShadow('ks-select-923, [data-tea-std_component_name="creative_aigc_cta"]', current)))
            : null;
          if (select) return current;
          current = current.assignedSlot || current.parentElement || current.getRootNode?.().host || null;
        }
      }
      return null;
    }

    /**
     * Locate the CTA select within an already-resolved section.
     * Does not rely on generated numeric tag suffixes.
     */
    findCtaSelectInSection(section) {
      const h = this.helpers;
      if (!section) return null;
      const direct = h.queryShadow('ks-select-923, [data-tea-std_component_name="creative_aigc_cta"]', section);
      if (direct) {
        try { if (h.isVisible(direct)) return direct; } catch (_) {}
      }
      const all = h.queryShadowAll('ks-select-923, [data-tea-std_component_name="creative_aigc_cta"]', section);
      for (const el of all) {
        try { if (h.isVisible(el)) return el; } catch (_) {}
      }
      return null;
    }

    /**
     * Resolve the visible label of a CTA dropdown item through its named slot.
     * Real TikTok markup: the LI contains only an empty
     * <slot name="slot-item-label-...">. The actual text lives in a matching
     * <div slot="slot-item-label-..."><ks-text-923>Watch now</ks-text-923></div>
     * that is a DIRECT light-DOM child of the CTA ks-select-923 host. The
     * slot's own assignedElements channel is often empty or holds an empty
     * intermediary <slot> placeholder, so the slot name must be matched
     * against the select host's direct children. Slot names and generated
     * IDs change between renders and are always matched dynamically.
     * @param {Element} item li.dropdown-item row
     * @param {Element|null} [selectHost] CTA ks-select-923 host owning the slotted labels
     */
    resolveCtaOptionLabel(item, selectHost = null) {
      if (!item || typeof item.querySelector !== 'function') {
        return this.normalizeCtaText(item?.innerText || item?.textContent) || null;
      }
      const usable = (value) => {
        const text = this.normalizeCtaText(value);
        return text || null;
      };
      // STEP A: the named slot inside the row's label container.
      const labelDiv = item.querySelector('.menu-item-base__content--text--label, [class*="content--text--label"]');
      let slot = labelDiv ? labelDiv.querySelector('slot[name]') : null;
      if (!slot) slot = item.querySelector('slot[name]');
      // STEP B: read the slot name.
      const slotName = slot?.getAttribute?.('name') || null;
      // STEP C: assignedElements first (only valid when it yields real text).
      if (slot && typeof slot.assignedElements === 'function') {
        try {
          const assigned = slot.assignedElements({ flatten: true }) || [];
          for (const node of assigned) {
            // Never treat an empty intermediary <slot> placeholder as the label.
            if (!node || node.tagName === 'SLOT') continue;
            const text = usable(node.innerText || node.textContent);
            if (text) return text;
          }
        } catch (_) {}
      }
      // STEP D: match the slot name against the select HOST's direct light-DOM
      // children. This is the real relationship in TikTok's markup whenever
      // assignedElements is empty or placeholder-only.
      if (slotName && selectHost && selectHost.children) {
        for (const child of selectHost.children) {
          try {
            if (!child || child.tagName === 'SLOT') continue;
            if (child.getAttribute?.('slot') !== slotName) continue;
            const text = usable(child.innerText || child.textContent);
            if (text) return text;
          } catch (_) {}
        }
      }
      // Last-resort fallbacks inside the row itself.
      const ksText = item.querySelector('ks-text-923');
      if (ksText) {
        const text = usable(ksText.innerText || ksText.textContent);
        if (text) return text;
      }
      if (labelDiv) {
        const text = usable(labelDiv.innerText || labelDiv.textContent);
        if (text) return text;
      }
      return this.normalizeCtaText(item.innerText || item.textContent) || null;
    }

    /**
     * Step 5.5: Configure Call to Action (CTA)
     * Section: #fieldRenderer-callToActionAssetList
     * Title: "Call to action text"
     * Editor: ks-select-923 with nested Shadow DOM
     * Strategy: keep the requested CTA selected, deselect others individually.
     * The Clear All cross button is never clicked (it can leave "No Data").
     * Options: li.dropdown-item with ks-checkbox-923, label via named slots
     * @param {string} callToAction
     */
    async configureCallToAction(callToAction) {
      const h = this.helpers;
      const stepName = 'CONFIGURE_CTA';
      this.diag(stepName, `Configuring Call to Action: "${callToAction}"`);

      if (!callToAction || typeof callToAction !== 'string' || !callToAction.trim()) {
        throw new Error('Call to Action is required but not configured.');
      }

      const ctaValue = callToAction.trim();
      console.log(`[CTA] Starting CTA configuration: ${ctaValue}`);
      console.log(`[CTA] Requested CTA: ${ctaValue}`);

      // 1. Locate the CTA section container with fallbacks (root ID may vanish after re-render).
      const rootById = document.querySelector('#fieldRenderer-callToActionAssetList') ||
        h.queryShadow('#fieldRenderer-callToActionAssetList');
      console.log(`[CTA] Root ID found: ${!!(rootById && h.isVisible(rootById))}`);
      let ctaSection = this.findCtaSection();
      const headingPresent = !!ctaSection;
      console.log(`[CTA] CTA heading found: ${headingPresent}`);
      if (!ctaSection) {
        this.diag(stepName, 'Call to action section not found', {
          elementMissing: '#fieldRenderer-callToActionAssetList, [data-lego-anchor="callToActionAssetList"], "Call to action text" heading',
          error: 'CTA section not found on page'
        });
        console.log('[CTA ERROR] CTA section not found (root ID, anchor, module, heading all missed)');
        throw new Error('Could not find Call to action text section (root ID, anchor, module wrapper, and heading fallbacks all missed).');
      }

      this.diag(stepName, 'Call to action section found', {
        elementFound: ctaSection.id ? `#${ctaSection.id}` : (ctaSection.getAttribute?.('data-lego-anchor') || ctaSection.tagName)
      });
      console.log('[CTA] Call to action section found');

      // 1b. SELECTED-TAG-FIRST STRATEGY. The tagged value field is the
      // authoritative selection state. Read ALL ks-tag-923 elements inside the
      // CTA section (hidden overflow tags included — they still represent
      // selections). Labels come from each tag host's light-DOM textContent.
      const tagElements = (scope) => h.queryShadowAll(
        'ks-tag-923.value-field__tagged__tag-item, ks-tag-923[data-testid*="tag"], [data-testid*="tag-list-tag"]',
        scope || ctaSection || document
      );
      const readTagLabels = (scope) => {
        const out = [];
        for (const tag of tagElements(scope)) {
          try {
            const text = this.normalizeCtaText(tag.innerText || tag.textContent);
            // Skip the "Select" placeholder and the synthetic "+ N more"
            // overflow indicator; never skip a real (even hidden) CTA tag.
            if (!text || text.toLowerCase() === 'select' || /^\+\s*\d+\s*more$/i.test(text)) continue;
            out.push(text);
          } catch (_) {}
        }
        return out;
      };
      const selectedTags = readTagLabels(ctaSection);
      console.log(`[CTA] Current selected tags: ${JSON.stringify(selectedTags)}`);
      this.diag(stepName, 'Current selected tags', { selectedTags: selectedTags.join(', ') });

      if (selectedTags.length === 1 && selectedTags[0] === ctaValue) {
        // Already exactly correct: never open the dropdown, never click.
        console.log('[CTA] Requested CTA already configured');
        console.log('[CTA] Exactly one CTA verified');
        console.log('[CTA] No changes required');
        this.diag(stepName, 'CTA already configured via selected tags', {
          selectedTags: selectedTags.join(', '),
          verification: 'Exactly one CTA verified; no dropdown interaction performed'
        });
        return true;
      }

      // 2. Find and click the Edit button inside the CTA section
      // Selector: [data-testid="lego-hybrid-section-item-operation"]
      // Click target: host.shadowRoot.querySelector('button[part="base"]')
      let editButtonHost = h.queryShadow('[data-testid="lego-hybrid-section-item-operation"]', ctaSection);
      let editorOpened = false;

      if (editButtonHost && editButtonHost.shadowRoot) {
        const editButton = editButtonHost.shadowRoot.querySelector('button[part="base"]');
        if (editButton && h.isVisible(editButton)) {
          this.diag(stepName, 'Opening CTA editor', {
            elementFound: '[data-testid="lego-hybrid-section-item-operation"] button[part="base"]'
          });
          h.safeClick(editButton, 'CTA Edit button');
          await h.sleep(800);
          editorOpened = true;
        }
      }

      // If no edit button found, the editor might already be open
      if (!editorOpened) {
        this.diag(stepName, 'CTA editor appears to be already open; skipping Edit click');
      }

      // 3. Wait for the CTA select component to be ready within the section.
      // Do not depend on the generated numeric tag suffix.
      let ctaSelectHost = this.findCtaSelectInSection(ctaSection);
      if (!ctaSelectHost) {
        const waited = await h.waitForVisibleElement('ks-select-923, [data-tea-std_component_name="creative_aigc_cta"]', 8000, ctaSection);
        if (waited) ctaSelectHost = waited;
      }
      console.log(`[CTA] CTA select found: ${!!ctaSelectHost}`);
      if (!ctaSelectHost) {
        this.diag(stepName, 'CTA select component not found', {
          elementMissing: 'ks-select-923 / [data-tea-std_component_name="creative_aigc_cta"]',
          error: 'CTA dropdown editor not available'
        });
        console.log('[CTA ERROR] CTA select not found after opening editor');
        throw new Error('CTA select component not found after opening editor.');
      }

      // 4. Existing selections are already known from the selected-tag read
      // (hidden overflow tags included; no visibility filtering).
      console.log(`[CTA] Existing selections count: ${selectedTags.length}`);

      // 5. Open the dropdown WHILE existing options are still populated.
      // The global Clear All cross button (.value-field__clear) is intentionally
      // NEVER clicked: clearing to zero selections can leave the dropdown in a
      // "No Data" state with no option rows to recover from. The "Select all"
      // row is likewise never used.
      const isCtaChecked = (box) => !!box && (box.getAttribute?.('aria-checked') === 'true' || box.checked === true);
      const ctaItemCheckbox = (item) => {
        try { return item?.querySelector ? item.querySelector('ks-checkbox-923, [role="checkbox"]') : null; }
        catch (_) { return null; }
      };
      const isVisibleCta = (el) => { try { return h.isVisible(el); } catch (_) { return false; } };
      const isSelectAllRow = (text) => /^\s*select\s+all\s*$/i.test(text || '');
      const resolveDropdownTrigger = (selectHost) => {
        try {
          // TikTok may render the slotted value field in the select host's
          // light DOM. Search both composed sides, then enter the field's own
          // shadow root for its actual clickable base.
          const valueField = selectHost?.querySelector?.('ks-value-field-923, [part="field"]') ||
            selectHost?.shadowRoot?.querySelector('ks-value-field-923, [part="field"]') ||
            h.queryShadow('ks-value-field-923, [part="field"]', selectHost);
          const inner = valueField?.shadowRoot?.querySelector('[part="base"], button[part="base"], [role="combobox"], button') ||
            (valueField && h.queryShadow('[part="base"], button[part="base"], [role="combobox"], button', valueField));
          if (inner) return inner;
        } catch (_) {}
        try {
          const direct = selectHost?.shadowRoot?.querySelector('[part="base"], button[part="base"], button, [role="combobox"], [part="trigger"]');
          if (direct) return direct;
        } catch (_) {}
        return selectHost;
      };
      const ctaStructuralState = (selectHost) => {
        const shadow = !!selectHost?.shadowRoot;
        const dropdown = selectHost?.shadowRoot?.querySelector('[part="dropdown"], ks-dropdown-menu-923') || null;
        const popover = dropdown?.shadowRoot?.querySelector('ks-popover-923, [class*="popover"]') || null;
        const list = popover?.querySelector('ks-dropdown-menu-list-923, [class*="dropdown-menu__body-content"] ks-dropdown-menu-list-923') || null;
        const spinner = list?.shadowRoot?.querySelector('ks-spinner-923, [class*="spinner"]') || null;
        const lightRows = spinner?.querySelectorAll?.('li.dropdown-item, li.menu-item-base, [role="option"]') || [];
        const shadowRows = spinner?.shadowRoot?.querySelectorAll?.('li.dropdown-item, li.menu-item-base, [role="option"]') || [];
        return { shadow, dropdown, popover, list, spinner, lightRows: lightRows.length, shadowRows: shadowRows.length };
      };
      const snapshotMenus = () => h.queryShadowAll(
        'ks-dropdown-menu-923, ks-dropdown-menu-list-923, [role="listbox"], ul[class*="menu"], li.dropdown-item, li.menu-item-base, [role="option"]'
      ).filter(el => isVisibleCta(el));
      // Collect CTA option rows. The popover may render outside the section
      // tree, so menu subtrees come first, then a document fallback restricted
      // to rows carrying a ks-checkbox-923 (other dropdowns use other markup).
      const collectItemsFrom = (menus) => {
        const seen = new Set();
        const items = [];
        const pushAll = (list) => {
          for (const el of list || []) {
            if (!el || seen.has(el)) continue;
            seen.add(el);
            items.push(el);
          }
        };
        for (const menu of menus || []) {
          if (menu.matches && menu.matches('li, [role="option"]')) pushAll([menu]);
          if (typeof menu.querySelectorAll === 'function') {
            pushAll(Array.from(menu.querySelectorAll('li.dropdown-item, li.menu-item-base, [role="option"]')));
          }
          if (menu.shadowRoot?.querySelectorAll) {
            pushAll(Array.from(menu.shadowRoot.querySelectorAll('li, [role="option"]')));
          }
          // ks-spinner-923 projects its list through a slot: rows are light
          // DOM children of the spinner host, not its shadow root.
          if (menu.matches?.('ks-spinner-923') || menu.tagName?.toLowerCase().startsWith('ks-spinner-')) {
            pushAll(Array.from(menu.querySelectorAll('li.dropdown-item, li.menu-item-base, [role="option"]')));
          }
        }
        pushAll(h.queryShadowAll('li.dropdown-item, li.menu-item-base, [role="option"]'));
        return items.filter(item => {
          try { return !!item.querySelector?.('ks-checkbox-923'); }
          catch (_) { return false; }
        });
      };
      const scrollCtaMenuTo = async (menus, label) => {
        const scroller = (menus || []).map(m => m.closest?.('[class*="holder"], [class*="scroll"], [class*="list"], [role="listbox"]') || null)
          .find(el => el && typeof el.scrollTop === 'number');
        if (!scroller) return;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          // Presence in the DOM is enough: off-screen rows still exist and can
          // be clicked after an in-menu scroll. Never filter on viewport rects.
          const items = collectItemsFrom(menus);
          if (items.some(item => this.resolveCtaOptionLabel(item, ctaSelectHost) === label)) return;
          scroller.scrollTop += 220;
          await h.sleep(250);
        }
      };
      // Sweep the whole menu top-to-bottom so hidden/overflow rows that are
      // virtualized out of view are still observed (never the page itself).
      const sweepCtaMenu = async (menus) => {
        const seen = new Map();
        const harvest = () => {
          for (const item of collectItemsFrom(snapshotMenus())) {
            const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
            if (!text || isSelectAllRow(text)) continue;
            if (!seen.has(text)) seen.set(text, item);
          }
        };
        harvest();
        const scroller = (menus || []).map(m => m.closest?.('[class*="holder"], [class*="scroll"], [class*="list"], [role="listbox"]') || null)
          .find(el => el && typeof el.scrollTop === 'number');
        if (scroller) {
          scroller.scrollTop = 0;
          await h.sleep(250);
          harvest();
          const deadline = Date.now() + 4000;
          let stable = 0;
          while (Date.now() < deadline && stable < 3) {
            if (h.isAborted()) throw new Error('Automation aborted or paused by user');
            const before = seen.size;
            scroller.scrollTop += 240;
            await h.sleep(250);
            harvest();
            stable = seen.size === before ? stable + 1 : 0;
          }
        }
        return [...seen.values()];
      };
      const ensureDropdownOpen = async () => {
        let menus = snapshotMenus();
        if (menus.length > 0) return menus;
        const before = new Set(menus);
        const freshSection = this.findCtaSection();
        const freshSelect = (freshSection && this.findCtaSelectInSection(freshSection)) || ctaSelectHost;
        if (freshSection) ctaSection = freshSection;
        if (freshSelect) ctaSelectHost = freshSelect;
        const trigger = resolveDropdownTrigger(ctaSelectHost);
        if (!trigger || !isVisibleCta(trigger)) {
          console.log('[CTA DEBUG] Dropdown trigger found: false');
          throw new Error('[CTA ERROR] Dropdown trigger not found');
        }
        console.log('[CTA DEBUG] Dropdown trigger found: true');
        h.safeClick(trigger, 'CTA dropdown trigger');
        console.log('[CTA DEBUG] Trigger clicked: true');
        await h.sleep(700);
        menus = snapshotMenus().filter(el => !before.has(el));
        if (menus.length === 0) menus = snapshotMenus();
        if (menus.length === 0) {
          h.safeClick(ctaSelectHost, 'CTA dropdown host fallback');
          await h.sleep(700);
          menus = snapshotMenus();
        }
        return menus;
      };
      const readCheckedLabels = (items) => {
        const checked = [];
        for (const item of items || []) {
          const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
          if (!text || isSelectAllRow(text)) continue;
          if (isCtaChecked(ctaItemCheckbox(item))) checked.push(text);
        }
        return checked;
      };
      // Diagnostic snapshot so a failure names the actual defect: discovery,
      // slot resolution, or interaction. Never collapses everything into
      // "Requested CTA not available".
      const logCtaDebug = (context) => {
        try {
          const items = collectItemsFrom(snapshotMenus());
          const labels = [];
          const unresolvedSlots = [];
          const seen = new Set();
          for (const item of items) {
            const slotEl = item.querySelector?.('.menu-item-base__content--text--label slot[name], [class*="content--text--label"] slot[name], slot[name]');
            const slotName = slotEl?.getAttribute?.('name') || null;
            const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
            if (text && !isSelectAllRow(text)) {
              if (!seen.has(text)) { seen.add(text); labels.push(text); }
            } else if (slotName) {
              unresolvedSlots.push(slotName);
            }
          }
          let pathname = '';
          try { pathname = window.location.pathname || ''; } catch (_) {}
          console.log(`[CTA DEBUG] ${context}`);
          console.log(`[CTA DEBUG] URL: ${pathname}`);
          console.log(`[CTA DEBUG] CTA section found: ${!!ctaSection}`);
          console.log(`[CTA DEBUG] CTA select found: ${!!ctaSelectHost}`);
          const structure = ctaStructuralState(ctaSelectHost);
          console.log(`[CTA DEBUG] Select shadowRoot available: ${structure.shadow}`);
          console.log(`[CTA DEBUG] Dropdown host found: ${!!structure.dropdown}`);
          console.log(`[CTA DEBUG] Popover host found: ${!!structure.popover}`);
          console.log(`[CTA DEBUG] Dropdown list host found: ${!!structure.list}`);
          console.log(`[CTA DEBUG] Spinner host found: ${!!structure.spinner}`);
          console.log(`[CTA DEBUG] Spinner light DOM row count: ${structure.lightRows}`);
          console.log(`[CTA DEBUG] Spinner shadow DOM row count: ${structure.shadowRows}`);
          console.log(`[CTA DEBUG] Selected tags: ${JSON.stringify(readTagLabels(ctaSection))}`);
          console.log(`[CTA DEBUG] Dropdown open: ${snapshotMenus().length > 0}`);
          console.log(`[CTA DEBUG] Total CTA option rows: ${items.length}`);
          console.log(`[CTA DEBUG] Menu rows found: ${items.length}`);
          console.log(`[CTA DEBUG] Resolved labels: [${labels.join(', ')}]`);
          console.log(`[CTA DEBUG] Unresolved slot names: [${unresolvedSlots.join(', ')}]`);
          console.log(`[CTA DEBUG] Requested CTA: ${ctaValue}`);
          console.log(`[CTA DEBUG] Exact match found: ${labels.includes(ctaValue)}`);
          console.log(`[CTA DEBUG] Checked CTA labels: [${readCheckedLabels(items).join(', ')}]`);
          this.diag(stepName, 'CTA debug snapshot', {
            context,
            url: pathname,
            menuRows: items.length,
            resolvedLabels: labels.join(', '),
            unresolvedSlots: unresolvedSlots.join(', '),
            selectedTags: readTagLabels(ctaSection).join(', '),
            requested: ctaValue
          });
        } catch (err) {
          try { console.log(`[CTA DEBUG] diagnostics failed: ${err.message}`); } catch (_) {}
        }
      };
      // Remove one unwanted CTA tag via its own close control (the real
      // [part="closeIcon"][aria-label="Remove tag"] inside the tag's open
      // shadowRoot). Everything is reacquired first: TikTok rerenders the
      // tagged field after every removal, so stale handles are never reused.
      const findTagElement = (label, scope) => {
        for (const tag of tagElements(scope || this.findCtaSection() || ctaSection)) {
          try {
            if (this.normalizeCtaText(tag.innerText || tag.textContent) === label) return tag;
          } catch (_) {}
        }
        return null;
      };
      const removeTagByCloseControl = async (label, keepLabel) => {
        const sectionNow = this.findCtaSection() || ctaSection;
        const tag = findTagElement(label, sectionNow);
        if (!tag) return 'gone';
        let closeBtn = null;
        try {
          closeBtn = (tag.shadowRoot && (
            tag.shadowRoot.querySelector('[part="closeIcon"][aria-label="Remove tag"]') ||
            tag.shadowRoot.querySelector('[part="closeIcon"]') ||
            tag.shadowRoot.querySelector('[aria-label="Remove tag"]')
          )) || null;
        } catch (_) { closeBtn = null; }
        if (!closeBtn) return 'no-close-control';
        h.safeClick(closeBtn, `Remove CTA tag: ${label}`);
        await h.sleep(600);
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          const labelsNow = readTagLabels(this.findCtaSection() || ctaSection);
          if (!labelsNow.includes(label)) {
            if (keepLabel && !labelsNow.includes(keepLabel)) {
              this.diag(stepName, `Requested CTA tag lost while removing "${label}"`, {
                error: 'Target tag disappeared during tag removal'
              });
              throw new Error(`[CTA ERROR] Requested CTA "${keepLabel}" tag disappeared while removing "${label}".`);
            }
            return 'removed';
          }
          await h.sleep(300);
        }
        return 'timeout';
      };
      const stripUnwantedTags = async (keepLabel) => {
        let removed = 0;
        const fallbackLabels = [];
        for (let guard = 0; guard < 20; guard++) {
          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          const labelsNow = readTagLabels(this.findCtaSection() || ctaSection);
          const unwanted = [...new Set(labelsNow)].filter(l => l !== keepLabel);
          if (unwanted.length === 0) break;
          const label = unwanted[0];
          const result = await removeTagByCloseControl(label, keepLabel);
          if (result === 'removed' || result === 'gone') {
            removed++;
            console.log(`[CTA] Removed tag: ${label}`);
            this.diag(stepName, `Removed tag "${label}"`);
            continue;
          }
          // 'no-close-control' or 'timeout': handled by the verified dropdown
          // deselection fallback, never a blind click.
          fallbackLabels.push(label);
          break;
        }
        return { removed, fallbackLabels };
      };
      const rowsAreClean = () => {
        const items = collectItemsFrom(snapshotMenus());
        if (items.length === 0) return true; // menu closed/unmounted; tags are authoritative
        const checkedNow = readCheckedLabels(items);
        return checkedNow.length === 1 && checkedNow[0] === ctaValue;
      };

      // 5-7. TARGET NOT AMONG SELECTED TAGS: open the dropdown, discover
      // options, select the target once, verify checkbox + tag — all with
      // categorized runtime diagnostics on failure.
      let openedMenus = null;
      const selectTargetViaDropdown = async () => {
        console.log('[CTA] Opening CTA dropdown');
        this.diag(stepName, 'Opening CTA dropdown');
        openedMenus = await ensureDropdownOpen();
        console.log(`[CTA] CTA options loaded: ${openedMenus.length > 0}`);

        // Locate the requested CTA while the menu is still populated.
        // Nothing has been deselected yet: if the target is genuinely missing,
        // we fail here WITHOUT having changed any existing selection.
        if (openedMenus.length === 0) {
          logCtaDebug('CTA dropdown did not open');
          this.diag(stepName, 'CTA dropdown menu did not open', {
            error: 'No visible CTA options after clicking trigger'
          });
          console.log('[CTA ERROR] CTA dropdown discovery failed: menu did not open');
          throw new Error('CTA dropdown discovery failed: menu did not open after clicking the trigger.');
        }
        // Bounded wait for the async menu render (rows may appear after the
        // popover mounts). Respect Pause/Stop; never wait forever.
        {
          const rowsDeadline = Date.now() + 5000;
          while (Date.now() < rowsDeadline && collectItemsFrom(snapshotMenus()).length === 0) {
            if (h.isAborted()) throw new Error('Automation aborted or paused by user');
            await h.sleep(250);
          }
        }
        // Discovery includes EVERY row present in the associated CTA dropdown,
        // even rows scrolled out of the popup's visible viewport. Visibility is
        // only ensured right before clicking a specific row.
        const findCtaItem = (label) => {
          const items = collectItemsFrom(snapshotMenus());
          for (const item of items) {
            const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
            if (!text || isSelectAllRow(text)) continue; // Never "Select all".
            if (text === label) return item;
          }
          return null;
        };
        // An open menu with zero option rows in the DOM ("No Data") is
        // recoverable: a stale search filter may be active. Clear ONLY search
        // text, then close and reopen the dropdown exactly once. Never Select
        // all, never Clear All, never reload the page.
        const menuShowsNoData = (menus) => {
          const open = (menus || []).filter(isVisibleCta);
          if (open.length === 0) return false;
          return collectItemsFrom(menus).length === 0;
        };
        const clearCtaSearchFilter = async () => {
          let cleared = false;
          for (const root of [ctaSection, ...(openedMenus || [])]) {
            if (!root) continue;
            const inputs = h.queryShadowAll('input, textarea', root);
            for (const input of inputs) {
              try {
                if (!isVisibleCta(input)) continue;
                if ((input.value || '') !== '') {
                  try { input.focus?.(); } catch (_) {}
                  try { input.value = ''; } catch (_) {}
                  try { input.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (_) {}
                  try { input.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                  cleared = true;
                }
              } catch (_) {}
            }
          }
          return cleared;
        };

        let targetItem = findCtaItem(ctaValue);
        if (!targetItem) {
          await scrollCtaMenuTo(openedMenus, ctaValue);
          openedMenus = snapshotMenus();
          targetItem = findCtaItem(ctaValue);
        }
        if (targetItem && !isVisibleCta(targetItem)) {
          // Row exists (possibly off-screen in the popup): scroll it into view
          // within the CTA dropdown before interacting.
          await scrollCtaMenuTo(openedMenus, ctaValue);
          openedMenus = snapshotMenus();
          const refreshed = findCtaItem(ctaValue);
          if (refreshed) targetItem = refreshed;
        }
        if (!targetItem && menuShowsNoData(openedMenus)) {
          console.log('[CTA] Dropdown shows No Data; attempting recovery (search filter, reopen)');
          this.diag(stepName, 'CTA dropdown shows No Data; attempting recovery');
          await clearCtaSearchFilter();
          await h.sleep(800);
          try { (h.queryShadowAll('h1, h2, h3, h4').find(el => isVisibleCta(el)) || document.body).click(); } catch (_) {}
          await h.sleep(400);
          openedMenus = await ensureDropdownOpen();
          await h.sleep(500);
          await scrollCtaMenuTo(openedMenus, ctaValue);
          targetItem = findCtaItem(ctaValue);
        }
        if (!targetItem) {
          // Categorize the failure with runtime evidence — never a generic
          // unavailable error for a DOM traversal or timing problem.
          const debugItems = collectItemsFrom(snapshotMenus());
          const labelSet = [];
          const seenLabels = new Set();
          for (const item of debugItems) {
            const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
            if (text && !isSelectAllRow(text) && !seenLabels.has(text)) {
              seenLabels.add(text); labelSet.push(text);
            }
          }
          let categorized;
          if (debugItems.length === 0) {
            categorized = '[CTA ERROR] CTA dropdown discovery failed: zero menu rows (No Data state)';
          } else if (labelSet.length === 0) {
            categorized = `[CTA ERROR] Named-slot resolution failed: ${debugItems.length} rows but zero resolved labels`;
          } else {
            categorized = `[CTA ERROR] Requested CTA not available: ${ctaValue} (${labelSet.length} labels resolved; option missing from this UI)`;
          }
          logCtaDebug('CTA option lookup failed');
          this.diag(stepName, 'CTA option lookup failed', {
            error: categorized,
            menuRows: debugItems.length,
            resolvedLabels: labelSet.join(', '),
            elementMissing: `dropdown item with label "${ctaValue}"`
          });
          console.log(categorized);
          throw new Error(categorized);
        }
        console.log(`[CTA] Found requested CTA: ${ctaValue}`);
        logCtaDebug('CTA discovery succeeded');

        // Guarantee the target is selected BEFORE removing anything else, so
        // a zero-selection intermediate state can never occur.
        const readTargetChecked = () => {
          const fresh = findCtaItem(ctaValue);
          if (!fresh) return null;
          return isCtaChecked(ctaItemCheckbox(fresh));
        };
        if (isCtaChecked(ctaItemCheckbox(targetItem))) {
          console.log(`[CTA] Requested CTA already selected: ${ctaValue}`);
          this.diag(stepName, `Requested CTA already selected: ${ctaValue}`);
        } else {
          console.log(`[CTA] Selecting ${ctaValue}`);
          this.diag(stepName, `Selecting "${ctaValue}"`, {
            elementFound: `dropdown item with label "${ctaValue}"`
          });
          h.safeClick(targetItem, `CTA option: ${ctaValue}`);
          await h.sleep(700);
          if (readTargetChecked() !== true) {
            logCtaDebug('CTA interaction failed');
            this.diag(stepName, `Failed to verify selection of "${ctaValue}"`, {
              error: 'CTA interaction failed: target checkbox not set'
            });
            console.log(`[CTA ERROR] CTA interaction failed: checkbox for "${ctaValue}" did not become checked`);
            throw new Error(`[CTA ERROR] CTA interaction failed: checkbox for "${ctaValue}" did not become checked.`);
          }
          console.log(`[CTA] Selected CTA verified: ${ctaValue}`);
        }
        // Bounded wait: the requested CTA tag must appear in the tagged field.
        {
          const tagDeadline = Date.now() + 5000;
          let appeared = readTagLabels(this.findCtaSection() || ctaSection).includes(ctaValue);
          while (!appeared && Date.now() < tagDeadline) {
            if (h.isAborted()) throw new Error('Automation aborted or paused by user');
            await h.sleep(300);
            appeared = readTagLabels(this.findCtaSection() || ctaSection).includes(ctaValue);
          }
          if (!appeared) {
            logCtaDebug('CTA state verification failed');
            this.diag(stepName, 'CTA tag did not appear after selection', {
              error: 'CTA state verification failed: tag missing'
            });
            console.log(`[CTA ERROR] CTA state verification failed: tag for "${ctaValue}" did not appear`);
            throw new Error(`[CTA ERROR] CTA state verification failed: tag for "${ctaValue}" did not appear.`);
          }
          console.log(`[CTA] Requested CTA tag appeared: ${ctaValue}`);
        }
      };

      // 8. VERIFIED FALLBACK: deselect other selected CTAs through the
      // dropdown, reacquiring fresh handles after each change. Only used when
      // tag close controls are unavailable or row state desyncs from tags.
      const deselectOthersViaDropdown = async () => {
        let count = 0;
        const deselectDeadline = Date.now() + 90000;
        for (let guard = 0; guard < 40; guard++) {
          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          if (Date.now() > deselectDeadline) {
            throw new Error('[CTA ERROR] CTA deselection timed out.');
          }
          openedMenus = await ensureDropdownOpen();
          if (openedMenus.length === 0) {
            this.diag(stepName, 'CTA dropdown menu did not open', {
              error: 'No visible CTA options during deselection'
            });
            throw new Error('CTA dropdown did not open during deselection of other CTAs.');
          }
          const items = await sweepCtaMenu(openedMenus);
          const liveTarget = items.find(item => this.resolveCtaOptionLabel(item, ctaSelectHost) === ctaValue);
          if (liveTarget && !isCtaChecked(ctaItemCheckbox(liveTarget))) {
            this.diag(stepName, `Requested CTA "${ctaValue}" became deselected`, {
              error: 'Target lost selection during deselection'
            });
            throw new Error(`[CTA ERROR] Requested CTA "${ctaValue}" lost its selection during deselection.`);
          }
          const unwanted = [];
          for (const item of items) {
            const text = this.resolveCtaOptionLabel(item, ctaSelectHost);
            if (!text || isSelectAllRow(text) || text === ctaValue) continue;
            if (isCtaChecked(ctaItemCheckbox(item))) unwanted.push({ item, text });
          }
          if (unwanted.length === 0) break;
          let row = unwanted[0].item;
          const rowLabel = unwanted[0].text;
          if (!isVisibleCta(row)) {
            await scrollCtaMenuTo(openedMenus, rowLabel);
            const refound = collectItemsFrom(snapshotMenus())
              .find(item => this.resolveCtaOptionLabel(item, ctaSelectHost) === rowLabel);
            if (refound) {
              row = refound;
            } else {
              try { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
              await h.sleep(400);
            }
          }
          h.safeClick(row, `Deselect CTA: ${rowLabel}`);
          await h.sleep(700);
          // Verify this option is now deselected and the target remains selected.
          openedMenus = snapshotMenus();
          const after = await sweepCtaMenu(openedMenus.length ? openedMenus : snapshotMenus());
          const afterRow = after.find(item => this.resolveCtaOptionLabel(item, ctaSelectHost) === rowLabel);
          if (afterRow && isCtaChecked(ctaItemCheckbox(afterRow))) {
            this.diag(stepName, `Failed to deselect "${rowLabel}"`, {
              error: 'Option still selected after click'
            });
            throw new Error(`[CTA ERROR] Failed to deselect "${rowLabel}".`);
          }
          const afterTarget = after.find(item => this.resolveCtaOptionLabel(item, ctaSelectHost) === ctaValue);
          if (afterTarget && !isCtaChecked(ctaItemCheckbox(afterTarget))) {
            this.diag(stepName, `Requested CTA "${ctaValue}" became deselected`, {
              error: 'Target lost selection during deselection'
            });
            throw new Error(`[CTA ERROR] Requested CTA "${ctaValue}" lost its selection during deselection.`);
          }
          count++;
          console.log(`[CTA] Deselected ${rowLabel}`);
          this.diag(stepName, `Deselected "${rowLabel}"`);
        }
        return count;
      };

      // ORCHESTRATION: keep the target, strip every other CTA tag individually
      // through its close control; dropdown deselection only as verified
      // fallback. The dropdown is never opened when tags are already correct
      // for the requested CTA (handled by the early return above).
      let deselectedCount = 0;
      const targetWasSelectedFromTags = selectedTags.includes(ctaValue);
      if (!targetWasSelectedFromTags) {
        await selectTargetViaDropdown();
      } else {
        console.log(`[CTA] Requested CTA already selected: ${ctaValue}`);
        this.diag(stepName, `Requested CTA already selected via tags: ${ctaValue}`);
      }
      console.log('[CTA] Removing other selected CTAs');
      this.diag(stepName, 'Removing other selected CTAs');
      const strip = await stripUnwantedTags(ctaValue);
      deselectedCount += strip.removed;
      if (strip.fallbackLabels.length > 0 || !rowsAreClean()) {
        if (strip.fallbackLabels.length > 0) {
          console.log(`[CTA] Tag close controls unavailable for: [${strip.fallbackLabels.join(', ')}]; using dropdown deselection fallback`);
          this.diag(stepName, 'Tag close controls unavailable; dropdown fallback', {
            labels: strip.fallbackLabels.join(', ')
          });
        }
        deselectedCount += await deselectOthersViaDropdown();
      }
      console.log('[CTA] Requested CTA remains selected');

      // 9. Final verification after closing the dropdown: exactly one CTA
      // selected overall (visible and hidden/overflow rows), exactly one tag,
      // and the tag text matches config.callToAction.
      try {
        const heading = h.queryShadowAll('h1, h2, h3, h4')
          .find(el => { try { return h.isVisible(el); } catch (_) { return false; } });
        (heading || document.body).click();
      } catch (_) { try { document.body.click(); } catch (_) {} }
      await h.sleep(400);

      const freshSection = this.findCtaSection() || ctaSection;
      const freshSelect = (freshSection && this.findCtaSelectInSection(freshSection)) || ctaSelectHost;
      const finalItems = await sweepCtaMenu(snapshotMenus());
      const finalChecked = readCheckedLabels(finalItems);
      // Selected tags: exactly one <ks-tag-923> whose light-DOM text equals the
      // requested CTA. Hidden overflow tags count; "+ N more" indicators and
      // the "Select" placeholder never do.
      const tagTexts = readTagLabels(freshSection);
      const fieldText = this.normalizeCtaText(freshSelect?.innerText || freshSelect?.textContent || freshSection?.innerText || '');
      const displaysRequested = tagTexts.includes(ctaValue) ||
        (fieldText.includes(ctaValue) && !fieldText.includes('+') && !fieldText.match(/,\s*\w/));
      // When the menu is closed, option rows may unmount; rely on the tags
      // then. While rows are present, the checked-row state is authoritative.
      const rowsObserved = finalItems.length > 0;
      if ((rowsObserved && (finalChecked.length !== 1 || finalChecked[0] !== ctaValue)) ||
          !displaysRequested || !(tagTexts.length === 1 && tagTexts[0] === ctaValue)) {
        logCtaDebug('CTA final verification failed');
        this.diag(stepName, 'CTA final verification failed', {
          error: `Checked: [${finalChecked.join(', ')}]; tags: [${tagTexts.join(', ') || fieldText.slice(0, 120)}]; expected exactly ["${ctaValue}"]`
        });
        console.log(`[CTA ERROR] CTA state verification failed: expected exactly one "${ctaValue}"`);
        throw new Error(`[CTA ERROR] CTA state verification failed: expected exactly one "${ctaValue}".`);
      }
      console.log(`[CTA] Exactly one selected CTA verified: ${ctaValue}`);
      if (targetWasSelectedFromTags && deselectedCount === 0) {
        console.log('[CTA] No changes required');
      }

      console.log('[CTA] CTA configuration completed');
      console.log('[CTA] Configuration completed');
      this.diag(stepName, 'CTA configuration completed', {
        verification: `Exactly one CTA selected: ${ctaValue}`
      });
      return true;
    }

    /**
     * Step 6: Creative Assets -> Click Add
     */
    async openCreativeAssetsDrawer() {
      const h = this.helpers;
      const stepName = 'OPEN_ASSETS_DRAWER';
      this.diag(stepName, 'Locating Creative Assets "Add" button');

      const header = h.queryShadow('#spp_creative_assets_header');
      if (header) {
        header.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await h.sleep(400);
      }

      // Target: <ks-button-923 data-testid="image-list-add-button-8fEZK3" class="KsButton">
      let addBtnHost = await h.waitForVisibleElement('ks-button-923[data-testid="image-list-add-button-8fEZK3"], [data-testid="image-list-add-button-8fEZK3"]', 10000);

      if (!addBtnHost) {
        const buttons = h.queryShadowAll('ks-button-923, button');
        for (const b of buttons) {
          const text = (b.innerText || b.textContent || '').trim();
          if (text === 'Add' && h.isVisible(b)) {
            addBtnHost = b;
            break;
          }
        }
      }

      if (!addBtnHost) {
        this.diag(stepName, 'Locate Add button', {
          elementMissing: 'ks-button-923[data-testid="image-list-add-button-8fEZK3"]',
          error: 'Add button in Creative Assets missing'
        });
        throw new Error('Could not find Creative Assets "Add" button.');
      }

      this.diag(stepName, 'Clicking Creative Assets Add button', {
        elementFound: 'Add button'
      });
      h.safeClick(addBtnHost, 'Creative Assets Add button');

      // Wait for drawer to open and verify visibility
      const drawer = await this.waitForCreativeAssetsDrawer(10000);
      if (!drawer) {
        this.diag(stepName, 'Creative Assets drawer did not open', {
          error: 'Drawer not found after clicking Add'
        });
        throw new Error('Creative Assets side panel drawer did not open.');
      }

      console.log('[CREATIVE] Creative Assets drawer opened');
      this.diag(stepName, 'Creative Assets drawer opened and verified');
      await h.sleep(600);
    }

    /**
     * Wait for the Creative Assets side panel / drawer to become visible
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<HTMLElement|null>}
     */
    async waitForCreativeAssetsDrawer(timeoutMs = 10000) {
      const h = this.helpers;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        // Look for drawer containers
        const drawers = h.queryShadowAll('.byted-drawer, .arco-drawer, [class*="drawer-content"], [class*="hybrid-drawer"], [role="dialog"][class*="drawer"], [role="dialog"]');
        for (const d of drawers) {
          if (h.isVisible(d)) {
            const text = (d.innerText || d.textContent || '').toLowerCase();
            if (text.includes('tiktok posts') || text.includes('video') || text.includes('image') || text.includes('creative') || text.includes('asset')) {
              return d;
            }
          }
        }

        await h.sleep(300);
      }

      return null;
    }

    /**
     * Step 7: Select TikTok posts tab, verify active, and click exact "Add post" button
     * Strictly avoids "Link TikTok account" action.
     */
    async selectTikTokPostsTabAndClickAdd() {
      const h = this.helpers;
      const stepName = 'SELECT_TIKTOK_POSTS';

      // 1. Wait for drawer to be visible
      const drawer = await this.waitForCreativeAssetsDrawer(8000);
      if (!drawer) {
        this.diag(stepName, 'Creative Assets drawer not visible', {
          error: 'Drawer missing'
        });
        throw new Error('Creative Assets side panel drawer is not visible.');
      }

      // 2-3. Select "TikTok posts" tab and verify it is active
      await this.ensureTikTokPostsTabActive(drawer);

      // 4-5. Search for and verify the exact "Add post" button
      const addPostBtn = await this.findExactAddPostButton(drawer, 8000);
      if (!addPostBtn) {
        this.diag(stepName, 'Exact Add post button not found', {
          error: 'Could not find exact button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]'
        });
        throw new Error('Could not find exact "Add post" button in TikTok posts panel.');
      }

      // 6-7. Scroll into view and click the exact Add post button
      addPostBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);

      // Click directly without generic child button resolution
      addPostBtn.click();
      console.log('[CREATIVE] Add post button clicked');
      this.diag(stepName, 'Exact Add post button clicked successfully');

      // 10. Verify that the TikTok Post Authorization popup opens
      await this.waitForAuthorizationModal(10000);

      return true;
    }

    /**
     * Select "TikTok posts" tab and verify it becomes active in drawer
     * @param {HTMLElement} drawer
     */
    async ensureTikTokPostsTabActive(drawer) {
      const h = this.helpers;
      const stepName = 'TIKTOK_POSTS_TAB';

      // Find tab with exact text "TikTok posts" inside drawer
      let tabElement = null;
      const candidates = h.queryShadowAll('.tab-item-text, [role="tab"], .tab-item, [class*="tabs-header-cell"], p, span, div', drawer);
      for (const cand of candidates) {
        if (!h.isVisible(cand)) continue;
        const text = (cand.innerText || cand.textContent || '').trim();
        if (text === 'TikTok posts') {
          tabElement = cand;
          if (cand.classList.contains('tab-item-text') || cand.getAttribute('role') === 'tab') {
            break;
          }
        }
      }

      if (!tabElement) {
        this.diag(stepName, 'Locate TikTok posts tab', {
          elementMissing: 'tab element with text "TikTok posts"',
          error: 'Tab missing in drawer'
        });
        throw new Error('Could not find "TikTok posts" tab in Creative Assets drawer.');
      }

      const isTabActive = () => {
        if (tabElement.getAttribute('aria-selected') === 'true') return true;
        if (tabElement.classList.contains('is-active') || tabElement.classList.contains('active')) return true;
        const parentTab = tabElement.closest('[role="tab"], .tab-item, [class*="tabs-header-cell"], [class*="tab-item"]');
        if (parentTab) {
          if (parentTab.getAttribute('aria-selected') === 'true') return true;
          if (parentTab.classList.contains('is-active') || parentTab.classList.contains('active')) return true;
        }
        const addBtn = drawer.querySelector('button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"], button[data-testid*="tab-mixed-post"]');
        if (addBtn && h.isVisible(addBtn)) return true;
        return false;
      };

      if (!isTabActive()) {
        this.diag(stepName, 'Clicking TikTok posts tab');
        tabElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await h.sleep(200);

        // Click the tab directly without child button resolution
        tabElement.click();
        await h.sleep(600);

        const start = Date.now();
        let verified = false;
        while (Date.now() - start < 5000) {
          if (h.isAborted()) throw new Error('Automation aborted or paused by user');
          if (isTabActive()) {
            verified = true;
            break;
          }
          if (Date.now() - start > 2000) {
            const parentTab = tabElement.closest('[role="tab"], .tab-item, [class*="tabs-header-cell"]');
            if (parentTab) {
              parentTab.click();
              await h.sleep(500);
            }
          }
          await h.sleep(300);
        }

        if (!verified) {
          this.diag(stepName, 'Failed to verify TikTok posts tab active', {
            error: 'Tab did not become active'
          });
          throw new Error('Failed to verify "TikTok posts" tab became active.');
        }
      }

      console.log('[CREATIVE] TikTok posts tab selected');
      this.diag(stepName, 'TikTok posts tab selected and verified active');
      return true;
    }

    /**
     * Find the exact "Add post" button with strict safety guards:
     * - Primary: button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]
     * - Secondary: button[data-testid*="tab-mixed-post"]
     * - Scoped fallback: strictly within active drawer, exact text "Add post"
     * - STRICT SAFETY GUARD: Never click "Link TikTok account" or any button matching "Link" / "account"
     * - Requires: exactly one matching button, visible, enabled, exact text "Add post"
     * @param {HTMLElement} drawer
     * @param {number} [timeoutMs=8000]
     * @returns {Promise<HTMLElement|null>}
     */
    async findExactAddPostButton(drawer, timeoutMs = 8000) {
      const h = this.helpers;
      const start = Date.now();
      console.log('[CREATIVE] Searching for exact Add post button');

      const isForbiddenAction = (el) => {
        if (!el) return false;
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        // NEVER click "Link TikTok account" or any link account action
        return text.includes('link tiktok') || text.includes('link account') || (text.includes('link') && text.includes('account'));
      };

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        // 1. Primary search: exact verified selector
        const exactButtons = h.queryShadowAll('button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]', drawer);
        const validExact = exactButtons.filter(b => {
          if (!h.isVisible(b)) return false;
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
          if (isForbiddenAction(b)) return false;
          const text = (b.innerText || b.textContent || '').trim();
          return text === 'Add post' || b.querySelector('span')?.textContent?.trim() === 'Add post';
        });

        if (validExact.length === 1) {
          console.log('[CREATIVE] Correct Add post button found');
          return validExact[0];
        }

        // 2. Secondary search: button[data-testid*="tab-mixed-post"]
        const mixedButtons = h.queryShadowAll('button[data-testid*="tab-mixed-post"]', drawer);
        const validMixed = mixedButtons.filter(b => {
          if (!h.isVisible(b)) return false;
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
          if (isForbiddenAction(b)) return false;
          const text = (b.innerText || b.textContent || '').trim();
          return text === 'Add post' || b.querySelector('span')?.textContent?.trim() === 'Add post';
        });

        if (validMixed.length === 1) {
          console.log('[CREATIVE] Correct Add post button found');
          return validMixed[0];
        }

        // 3. Strict Contextual Fallback:
        // Scoped strictly to the active drawer panel
        // Require exact button text "Add post" and explicitly exclude "Link TikTok account"
        const allDrawerButtons = h.queryShadowAll('button', drawer);
        const candidates = allDrawerButtons.filter(b => {
          if (!h.isVisible(b)) return false;
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
          if (isForbiddenAction(b)) return false;
          const text = (b.innerText || b.textContent || '').trim();
          return text === 'Add post';
        });

        if (candidates.length === 1) {
          console.log('[CREATIVE] Correct Add post button found');
          return candidates[0];
        }

        await h.sleep(300);
      }

      console.error('[CREATIVE ERROR] Exact Add post button not found');
      return null;
    }

    /**
     * Verify that the TikTok Post Authorization popup / modal opens and textarea is visible
     * - Verified textarea: textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]
     * - Alternative: textarea[placeholder="Enter or paste each TikTok post code on a new line"]
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<HTMLTextAreaElement>}
     */
    async waitForAuthorizationModal(timeoutMs = 10000) {
      const h = this.helpers;
      const stepName = 'AUTH_MODAL_VERIFY';
      const start = Date.now();
      let modalDetected = false;

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        // Detect modal container
        const modals = h.queryShadowAll('[role="dialog"], .byted-modal, .arco-modal, .modal, [class*="modal"]');
        for (const m of modals) {
          if (h.isVisible(m)) {
            const text = (m.innerText || m.textContent || '').toLowerCase();
            if (text.includes('authorization') || text.includes('spark ads') || text.includes('post code') || text.includes('batch authorize') || text.includes('tiktok post')) {
              if (!modalDetected) {
                modalDetected = true;
                console.log('[CREATIVE] Authorization modal detected');
                this.diag(stepName, 'Authorization modal detected');
              }
              break;
            }
          }
        }

        // Locate verified authorization textarea
        const textarea = h.queryShadow('textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]') ||
                         h.queryShadow('textarea[placeholder="Enter or paste each TikTok post code on a new line"]') ||
                         h.queryShadow('textarea[placeholder*="TikTok post code"]');

        if (textarea && h.isVisible(textarea)) {
          if (!modalDetected) {
            modalDetected = true;
            console.log('[CREATIVE] Authorization modal detected');
          }
          console.log('[CREATIVE] Authorization textarea found');
          this.diag(stepName, 'Authorization textarea found and verified');
          return textarea;
        }

        await h.sleep(300);
      }

      this.diag(stepName, 'Authorization modal or textarea not detected', {
        error: 'Timeout waiting for authorization modal'
      });
      throw new Error('TikTok Post Authorization popup or textarea did not appear after clicking Add post.');
    }

    /**
     * Step 8: Input Spark Ads Post Authorization Code and click Continue
     * button[data-testid="native-batch-authorize-index-wZkvDo"] (Text: Continue)
     * Does NOT log or expose the raw authCode.
     * @param {string} authCode
     */
    async inputSparkAdsCodeAndContinue(authCode) {
      const h = this.helpers;
      const stepName = 'AUTH_CODE_INPUT';
      const masked = h.Logger.maskCode(authCode);
      this.diag(stepName, `Inputting Spark Ads authorization code (${masked})`);

      // 1. Locate authorization textarea (verified selectors)
      let textarea = h.queryShadow('textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]') ||
                     h.queryShadow('textarea[placeholder="Enter or paste each TikTok post code on a new line"]') ||
                     h.queryShadow('textarea[placeholder*="TikTok post code"]');

      if (!textarea || !h.isVisible(textarea)) {
        textarea = await this.waitForAuthorizationModal(10000);
      }

      if (!textarea) {
        this.diag(stepName, 'Locate auth code textarea', {
          elementMissing: 'textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]',
          error: 'Auth code input field missing'
        });
        throw new Error('Could not find authorization code textarea in modal.');
      }

      // 2. Set code using native descriptor setter without logging raw code
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);
      h.setNativeTextareaValue(textarea, authCode);
      await h.sleep(600);

      // 3. Locate Continue button: button[data-testid="native-batch-authorize-index-wZkvDo"]
      this.diag(stepName, 'Locating Continue button on authorization modal');
      let continueBtn = null;
      const start = Date.now();

      while (Date.now() - start < 10000) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        const btn = h.queryShadow('button[data-testid="native-batch-authorize-index-wZkvDo"]') ||
                    h.findButtonByExactText('Continue');

        if (btn && h.isVisible(btn)) {
          const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('is-disabled');
          if (!isDisabled) {
            continueBtn = btn;
            break;
          }
        }
        await h.sleep(300);
      }

      if (!continueBtn) {
        this.diag(stepName, 'Locate Continue button on auth modal', {
          elementMissing: 'button[data-testid="native-batch-authorize-index-wZkvDo"]',
          error: 'Continue button missing or disabled'
        });
        throw new Error('Could not find enabled Continue button in authorization code modal.');
      }

      // 4. Click Continue
      h.safeClick(continueBtn, 'Authorization Continue button');
      await h.sleep(2000);
    }

    /**
     * Step 9: Click "Add TikTok posts"
     */
    async clickAddTikTokPosts() {
      const h = this.helpers;
      const stepName = 'ADD_POSTS_CONFIRM';
      this.diag(stepName, 'Clicking "Add TikTok posts" confirmation button');

      let addPostsBtn = await h.waitForVisibleElement('button[data-testid="native-batch-authorize-index-qXWhEZ"]', 10000);

      if (!addPostsBtn) {
        const btns = h.queryShadowAll('button');
        for (const b of btns) {
          if ((b.innerText || b.textContent || '').trim().includes('Add TikTok posts') && h.isVisible(b)) {
            addPostsBtn = b;
            break;
          }
        }
      }

      if (!addPostsBtn) {
        this.diag(stepName, 'Locate Add TikTok posts button', {
          elementMissing: 'button[data-testid="native-batch-authorize-index-qXWhEZ"]',
          error: 'Add TikTok posts button missing'
        });
        throw new Error('Could not find "Add TikTok posts" confirmation button.');
      }

      h.safeClick(addPostsBtn, 'Add TikTok posts button');
      await h.sleep(2500);
    }

    /**
     * Step 10: Verify post and click Confirm button in drawer footer
     */
    async verifyPostAndClickConfirm() {
      const h = this.helpers;
      const stepName = 'CONFIRM_DRAWER';
      this.diag(stepName, 'Locating Confirm button in drawer footer');

      let confirmBtn = null;
      const start = Date.now();

      while (Date.now() - start < 15000) {
        confirmBtn = h.queryShadow('button[data-testid="hybrid-drawer-footer-submit-button"]');
        if (confirmBtn && h.isVisible(confirmBtn)) {
          const isDisabled = confirmBtn.disabled || confirmBtn.getAttribute('aria-disabled') === 'true';
          if (!isDisabled) {
            break;
          }
        }
        await h.sleep(500);
      }

      if (!confirmBtn) {
        const btns = h.queryShadowAll('button');
        for (const b of btns) {
          if ((b.innerText || b.textContent || '').trim() === 'Confirm' && h.isVisible(b) && !b.disabled) {
            confirmBtn = b;
            break;
          }
        }
      }

      if (!confirmBtn) {
        this.diag(stepName, 'Locate Confirm button in drawer', {
          elementMissing: 'button[data-testid="hybrid-drawer-footer-submit-button"]',
          error: 'Confirm button was not ready or disabled'
        });
        throw new Error('Confirm button in Creative Assets drawer was not ready or disabled.');
      }

      this.diag(stepName, 'Clicking Confirm in drawer footer', {
        elementFound: 'Confirm button'
      });
      h.safeClick(confirmBtn, 'Drawer Confirm button');

      await h.sleep(2000);
    }

    /**
     * Check whether the TikTok posts drawer is in an empty state
     * (e.g. "Leverage TikTok posts in your ads", Confirm disabled, no post cards)
     * @param {HTMLElement} drawer
     * @returns {boolean}
     */
    isTikTokPostDrawerEmpty(drawer) {
      const h = this.helpers;
      if (!drawer) return true;

      // 1. Check for visible post cards or checkbox items
      const postItems = this.findPostItemsInDrawer(drawer);
      if (postItems.length > 0) {
        return false;
      }

      // 2. Check for empty-state text indicators
      const drawerText = (drawer.innerText || drawer.textContent || '').toLowerCase();
      const hasEmptyText = drawerText.includes('leverage tiktok posts in your ads') ||
                           drawerText.includes('add authorized post') ||
                           drawerText.includes('no data') ||
                           drawerText.includes('no posts found') ||
                           drawerText.includes('no content');

      // 3. Check for dedicated empty-state containers
      const emptyContainers = h.queryShadowAll('.byted-empty, .arco-empty, [class*="empty-state"], [class*="no-data"]', drawer);
      const hasEmptyContainer = emptyContainers.some(el => h.isVisible(el));

      // 4. Confirm button state
      const confirmBtn = h.queryShadow('button[data-testid="hybrid-drawer-footer-submit-button"]', drawer);
      const isConfirmDisabled = !confirmBtn || confirmBtn.disabled ||
                                confirmBtn.getAttribute('aria-disabled') === 'true' ||
                                confirmBtn.classList.contains('is-disabled');

      return (hasEmptyText || hasEmptyContainer || postItems.length === 0) && isConfirmDisabled;
    }

    /**
     * Find visible candidate TikTok post items in drawer
     * Strictly excludes:
     * - "Add post" button: button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]
     * - Toolbar buttons and search/filter inputs
     * - Header, tablist, and footer submit/confirm buttons
     * - Empty-state containers
     * @param {HTMLElement} drawer
     * @returns {HTMLElement[]}
     */
    findPostItemsInDrawer(drawer) {
      const h = this.helpers;
      if (!drawer) return [];

      const candidates = h.queryShadowAll(
        '[data-testid*="post-item"], [data-testid*="post-card"], [class*="post-card"], [class*="video-card"], [class*="media-card"], [class*="tiktok-post-item"], [class*="mixed-post-item"], [class*="grid-item"], [class*="list-item"], .byted-checkbox, .arco-checkbox',
        drawer
      );

      const filtered = candidates.filter(el => {
        if (!h.isVisible(el)) return false;

        const testId = (el.getAttribute('data-testid') || '').toLowerCase();

        // 1. Explicitly exclude Add Post buttons, toolbar buttons, and drawer action buttons
        if (
          testId.includes('tab-mixed-post') ||
          testId.includes('mixed-post-tab') ||
          testId.includes('hybrid-drawer-footer') ||
          testId.includes('batch-authorize') ||
          testId.includes('cancel') ||
          testId.includes('close') ||
          testId.includes('link-account') ||
          testId.includes('account-link')
        ) {
          return false;
        }

        // 2. Exclude ANY element inside drawer header, footer, tablist, toolbar, or empty state
        if (typeof el.closest === 'function') {
          if (el.closest(
            '.byted-drawer-header, .arco-drawer-header, [class*="drawer-header"], ' +
            '.byted-drawer-footer, .arco-drawer-footer, [class*="drawer-footer"], ' +
            '[role="tablist"], [role="tab"], ' +
            '[class*="toolbar"], [class*="action-bar"], [class*="filter-bar"], [class*="search-bar"], ' +
            '.byted-empty, .arco-empty, [class*="empty-state"], [class*="no-data"]'
          )) {
            return false;
          }

          // Modal exclusions: exclude elements in floating modals, but NEVER exclude the drawer itself
          const modal = el.closest('.byted-modal, .arco-modal, [class*="modal-content"]');
          if (modal) return false;

          const dialog = el.closest('[role="dialog"]');
          if (dialog && dialog !== drawer && !drawer.contains(dialog)) {
            return false;
          }
        }

        // 3. Exclude interactive controls that are not post card containers
        const tag = el.tagName ? el.tagName.toUpperCase() : '';
        if (tag === 'BUTTON' || (tag === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') || tag === 'TEXTAREA') {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (text === 'add post' || text === 'confirm' || text === 'cancel' || text === 'link tiktok account' || text.includes('search') || text.includes('filter')) {
            return false;
          }
          if (tag === 'BUTTON' && !testId.includes('post-item') && !testId.includes('post-card')) {
            return false;
          }
        }

        return true;
      });

      // Deduplicate nested items: if a parent card is in filtered, don't return both parent and its inner checkbox
      return filtered.filter(item => {
        let parent = item.parentElement;
        while (parent && parent !== drawer) {
          if (filtered.includes(parent)) return false;
          parent = parent.parentElement;
        }
        return true;
      });
    }

    /**
     * Find post items in drawer that match the requested post or authCode
     * @param {HTMLElement} drawer
     * @param {string} [authCode='']
     * @returns {HTMLElement[]}
     */
    findMatchingPostItems(drawer, authCode = '') {
      const allPosts = this.findPostItemsInDrawer(drawer);
      if (allPosts.length === 0) return [];

      const cleanCode = (authCode || '').trim().toLowerCase();
      if (cleanCode) {
        const matching = allPosts.filter(item => {
          const text = (item.innerText || item.textContent || '').toLowerCase();
          const testId = (item.getAttribute('data-testid') || '').toLowerCase();
          return text.includes(cleanCode) || testId.includes(cleanCode);
        });
        if (matching.length > 0) return matching;
      }

      return allPosts;
    }

    /**
     * Select a post item in the drawer (click checkbox or card)
     * @param {HTMLElement} drawer
     * @param {HTMLElement} [postItem]
     * @param {string} [authCode]
     * @returns {Promise<boolean>}
     */
    async selectPostInDrawer(drawer, postItem = null, authCode = '') {
      const h = this.helpers;
      const target = postItem || this.findMatchingPostItems(drawer, authCode)[0] || this.findPostItemsInDrawer(drawer)[0];
      if (!target) return false;

      const checkbox = target.querySelector ? target.querySelector('[role="checkbox"], input[type="checkbox"], .byted-checkbox, .arco-checkbox') : null;
      const clickTarget = checkbox || target;

      clickTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);
      h.safeClick(clickTarget, 'TikTok post selection');
      await h.sleep(600);
      return true;
    }

    /**
     * Wait for Confirm button to become enabled in drawer footer
     * @param {HTMLElement} drawer
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<HTMLElement|null>}
     */
    async waitForConfirmButtonEnabled(drawer, timeoutMs = 5000) {
      return this.waitForAddPostCondition(() => {
        if (!drawer.isConnected || !this.helpers.isVisible(drawer)) return null;
        const button = drawer.querySelector('button[data-testid="hybrid-drawer-footer-submit-button"]');
        // Ignore a same-named button belonging to a nested, unrelated dialog.
        const dialog = button?.closest('[role="dialog"], .byted-modal, .arco-modal');
        if (dialog && dialog !== drawer && drawer.contains(dialog)) return null;
        return this.isAddPostButtonEnabled(button) ? button : null;
      }, timeoutMs);
    }

    isAddPostButtonEnabled(button) {
      return !!(button && button.isConnected && button.getClientRects().length > 0 &&
        this.helpers.isVisible(button) && !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true' &&
        !button.classList.contains('is-disabled'));
    }

    checkAddPostAbort() {
      if (this.helpers.isAborted()) throw new Error('Automation aborted or paused by user');
    }

    checkAddPostErrors() {
      const notices = this.helpers.queryShadowAll(
        '[role="dialog"], .byted-modal, .arco-modal, [role="alert"], .vi-form-item__error, ' +
        '.byted-message-error, .arco-message-error, .semi-toast-error'
      );
      for (const notice of notices) {
        if (!this.helpers.isVisible(notice)) continue;
        const text = (notice.innerText || notice.textContent || '').toLowerCase();
        if (/(?:invalid|expired) (?:authorization )?code|(?:code|authorization) (?:is )?(?:invalid|expired)|code not found|please check your code/.test(text)) {
          const error = new Error('Spark Ads code is invalid or expired. Please check your authorization code.');
          error.code = 'ADD_POST_BLOCKED';
          throw error;
        }
        if (/too many requests|rate limit|frequent requests|please try again later/.test(text)) {
          const error = new Error('TikTok rate limit detected. Please wait before retrying.');
          error.code = 'ADD_POST_BLOCKED';
          throw error;
        }
      }
    }

    // Bounded, abort-aware polling only; all authorization retries belong to one loop below.
    async waitForAddPostCondition(check, timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        this.checkAddPostAbort();
        this.checkAddPostErrors();
        const result = check();
        if (result) return result;
        await this.helpers.sleep(250);
      }
      this.checkAddPostAbort();
      this.checkAddPostErrors();
      return null;
    }

    async waitForAuthorizationToFinish(drawer, timeoutMs = 15000) {
      let settledAt = null;
      return !!(await this.waitForAddPostCondition(() => {
        const modalOpen = this.helpers.queryShadowAll(
          'textarea[data-testid="multiple-input-to-tag-index-wSVv3f"], ' +
          'button[data-testid="native-batch-authorize-index-qXWhEZ"], ' +
          'button[data-testid="native-batch-authorize-index-wZkvDo"]'
        ).some(el => this.helpers.isVisible(el));
        const loading = this.helpers.queryShadowAll(
          '.byted-spin-spinning, .arco-spin-loading, [class*="loading-indicator"], [role="progressbar"]', drawer
        ).some(el => this.helpers.isVisible(el));
        if (modalOpen || loading) {
          settledAt = null;
          return false;
        }
        if (settledAt === null) settledAt = Date.now();
        return Date.now() - settledAt >= 1000;
      }, timeoutMs));
    }

    /** Wait for every authorization control to disappear, not just the first match. */
    async waitForModalToClose(timeoutMs = 15000) {
      return !!(await this.waitForAddPostCondition(() => !this.helpers.queryShadowAll(
        'textarea[data-testid="multiple-input-to-tag-index-wSVv3f"], ' +
        'button[data-testid="native-batch-authorize-index-qXWhEZ"], ' +
        'button[data-testid="native-batch-authorize-index-wZkvDo"]'
      ).some(el => this.helpers.isVisible(el)), timeoutMs));
    }

    /**
     * Verify attached creative on main page after drawer closes
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<boolean>}
     */
    async verifyCreativeAttachmentOnPage(timeoutMs = 10000, authCode = '') {
      const h = this.helpers;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

        const openDrawer = h.queryShadow('.byted-drawer:not([style*="display: none"]), .arco-drawer:not([style*="display: none"]), [class*="hybrid-drawer"]:not([style*="display: none"])');
        const isDrawerStillOpen = openDrawer && h.isVisible(openDrawer);

        const header = h.queryShadow('#spp_creative_assets_header');
        const creativeContainer = header ? (header.closest ? (header.closest('[class*="form-item"], [class*="card"], [class*="section"]') || header.parentElement) : header.parentElement) : document;

        const hasMedia = h.queryShadow('img, video, [class*="video-cover"], [class*="media-cover"], [class*="post-card"], [class*="creative-item"], [data-testid*="image-list-item"], [data-testid*="media-item"], [data-testid*="post-item"]', creativeContainer);
        const errorNotice = h.queryShadow('[class*="error-message"], [class*="form-item-explain-error"]', creativeContainer);
        const hasCreativeError = errorNotice && h.isVisible(errorNotice) && (errorNotice.innerText || '').toLowerCase().includes('creative');

        if (!isDrawerStillOpen && !hasCreativeError) {
          if (hasMedia) {
            return true;
          }
          if (header && creativeContainer) {
            const containerText = (creativeContainer.innerText || creativeContainer.textContent || '').toLowerCase();
            if (!containerText.includes('please upload') && !containerText.includes('add creative') && !containerText.includes('select post')) {
              return true;
            }
          }
        }
        await h.sleep(400);
      }
      return false;
    }

    /** Click the exact enabled drawer button once, then verify completion without retrying authorization. */
    async clickConfirmAndVerifyAttachment(drawer, authCode = '', confirmBtn = null) {
      const button = confirmBtn || await this.waitForConfirmButtonEnabled(drawer);
      this.checkAddPostAbort();
      this.checkAddPostErrors();
      if (!button || drawer.querySelector('button[data-testid="hybrid-drawer-footer-submit-button"]') !== button ||
          !this.isAddPostButtonEnabled(button)) {
        throw this.addPostVerificationError('Confirm button changed before confirmation. Verify the drawer manually.');
      }
      console.log('[ADD POST] Confirm enabled');
      // The controller persists CONFIRMING before this click, so re-entry cannot repeat it.
      button.click();
      console.log('[ADD POST] Confirm clicked');
      try {
        const closed = await this.waitForAddPostCondition(
          () => !drawer.isConnected || !this.helpers.isVisible(drawer), 10000
        );
        if (!closed || !await this.verifyCreativeAttachmentOnPage(10000, authCode)) {
          throw this.addPostVerificationError('Confirm outcome is ambiguous. Verify the creative attachment manually.');
        }
      } catch (error) {
        if (error.message.includes('aborted or paused')) throw error;
        // Once clicked, any failed verification must never trigger reauthorization.
        throw this.addPostVerificationError('Confirm outcome is ambiguous. Verify the creative attachment manually.');
      }
    }

    addPostVerificationError(message) {
      const error = new Error(message);
      error.code = 'ADD_POST_NEEDS_VERIFICATION';
      return error;
    }

    async runAddPostAuthorization(drawer, authCode) {
      const h = this.helpers;
      const addPost = await this.waitForAddPostCondition(() => {
        const button = drawer.querySelector('button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]');
        return this.isAddPostButtonEnabled(button) ? button : null;
      }, 8000);
      if (!addPost) throw new Error('Could not find enabled Add post button in the TikTok posts drawer.');
      this.checkAddPostAbort();
      addPost.click();

      const textarea = await this.waitForAddPostCondition(() => h.queryShadowAll(
        'textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]'
      ).find(el => h.isVisible(el)), 10000);
      if (!textarea) throw this.addPostVerificationError('Authorization modal did not appear. Verify Add Post before continuing.');
      const modal = textarea.closest('[role="dialog"], .byted-modal, .arco-modal, .modal, [class*="modal-content"]');
      if (!modal || modal === drawer) throw this.addPostVerificationError('Could not identify the authorization modal.');
      this.checkAddPostAbort();
      h.setNativeTextareaValue(textarea, authCode);
      console.log('[ADD POST] Authorization code entered');

      const continueBtn = await this.waitForAddPostCondition(() => {
        const button = modal.querySelector('button[data-testid="native-batch-authorize-index-wZkvDo"]');
        return this.isAddPostButtonEnabled(button) ? button : null;
      }, 10000);
      if (!continueBtn) throw this.addPostVerificationError('Authorization Continue button did not become enabled.');
      this.checkAddPostAbort();
      continueBtn.click();
      console.log('[ADD POST] Continue clicked');

      const addPosts = await this.waitForAddPostCondition(() => {
        // TikTok can replace the modal between Continue and Add TikTok posts.
        return h.queryShadowAll('button[data-testid="native-batch-authorize-index-qXWhEZ"]')
          .find(button => this.isAddPostButtonEnabled(button) &&
            button.closest('[role="dialog"], .byted-modal, .arco-modal, .modal, [class*="modal-content"]'));
      }, 10000);
      if (!addPosts) throw this.addPostVerificationError('Add TikTok posts button did not become enabled.');
      this.checkAddPostAbort();
      addPosts.click();
      console.log('[ADD POST] Add TikTok posts clicked');
    }

    /** One authorization retry loop. Only the exact drawer Confirm state decides whether to retry. */
    async attachSparkAdsPostWithRetry(authCode, campaignIndex = 1) {
      const MAX_ATTEMPTS = 5;
      const h = this.helpers;
      if (!authCode || typeof authCode !== 'string' || !authCode.trim()) {
        throw new Error('Spark Ads authorization code is missing or empty.');
      }
      if (this._isAddPostRunning) throw new Error('Concurrent Add Post operation detected.');
      this._isAddPostRunning = true;
      try {
        this.checkAddPostAbort();
        const job = await this.storage.getJobState();
        const sameCampaign = job.addPostRunId === job.runId && job.addPostCampaignIndex === campaignIndex;
        // Migrate an existing unscoped counter without granting extra attempts.
        const legacyCounter = job.addPostCampaignIndex == null && job.currentCampaignIndex === campaignIndex;
        let attemptCount = sameCampaign || legacyCounter ? Number(job.addPostAttemptCount) || 0 : 0;
        let phase = sameCampaign ? job.addPostPhase || 'READY' : 'READY';
        await this.storage.updateJobState({
          addPostRunId: job.runId,
          addPostCampaignIndex: campaignIndex,
          addPostAttemptCount: attemptCount,
          addPostPhase: phase
        });
        if (phase === 'COMPLETED') return { success: true, attempts: attemptCount, attached: true };
        if (['CONFIRMING', 'VERIFY_REQUIRED', 'AUTHORIZING', 'BLOCKED'].includes(phase)) {
          throw this.addPostVerificationError('Previous Add Post operation requires manual verification before continuing.');
        }

        const pending = phase === 'PROCESSING' || phase === 'AWAITING_CONFIRM';
        if (attemptCount < MAX_ATTEMPTS || pending) {
          // Navigation remains owned by the existing campaign workflow.
          const drawer = await this.waitForCreativeAssetsDrawer(8000);
          if (!drawer) throw this.addPostVerificationError('Active TikTok posts drawer is unavailable.');
          await this.ensureTikTokPostsTabActive(drawer);

          for (let attempt = pending ? attemptCount : attemptCount + 1; attempt <= MAX_ATTEMPTS; attempt++) {
            this.checkAddPostAbort();
            // Never start another operation while an earlier modal or loading indicator is active.
            if (!await this.waitForAuthorizationToFinish(drawer)) {
              throw this.addPostVerificationError('Authorization is still processing. Verify Add Post before retrying.');
            }
            if (phase !== 'PROCESSING' && phase !== 'AWAITING_CONFIRM') {
              await this.storage.updateJobState({
                addPostAttemptCount: attempt,
                addPostPhase: 'AUTHORIZING',
                stepDescription: `[#${campaignIndex}] Add Post attempt ${attempt}/${MAX_ATTEMPTS}`
              });
              console.log(`[ADD POST] Attempt ${attempt}/${MAX_ATTEMPTS}`);
              this.checkAddPostAbort();
              await this.runAddPostAuthorization(drawer, authCode);
              await this.storage.updateJobState({ addPostPhase: 'PROCESSING' });
              if (!await this.waitForAuthorizationToFinish(drawer)) {
                throw this.addPostVerificationError('Authorization is still processing. Verify Add Post before retrying.');
              }
            }
            await this.storage.updateJobState({ addPostPhase: 'AWAITING_CONFIRM' });
            console.log('[ADD POST] Waiting for Confirm button');
            const confirm = await this.waitForConfirmButtonEnabled(drawer);
            if (confirm) {
              await this.storage.updateJobState({ addPostPhase: 'CONFIRMING' });
              await this.clickConfirmAndVerifyAttachment(drawer, authCode, confirm);
              await this.storage.updateJobState({ addPostPhase: 'COMPLETED' });
              console.log('[ADD POST] Authorization flow completed');
              return { success: true, attempts: attempt, attached: true };
            }
            console.log('[ADD POST] Confirm not enabled');
            phase = 'READY';
            await this.storage.updateJobState({ addPostPhase: phase });
            if (attempt < MAX_ATTEMPTS) {
              await h.sleep(1500);
              console.log('[ADD POST] Restarting Add Post process');
            }
          }
        }
        console.error('[ADD POST ERROR] Confirm unavailable after 5 attempts');
        const error = new Error('Confirm button did not become enabled after 5 Add Post attempts');
        error.code = 'POST_RETRY_EXHAUSTED';
        await this.storage.updateJobState({
          status: 'POST_RETRY_EXHAUSTED', addPostPhase: 'EXHAUSTED',
          lastError: error.message, stepDescription: error.message
        });
        throw error;
      } catch (error) {
        if (error.code === 'ADD_POST_NEEDS_VERIFICATION') {
          await this.storage.updateJobState({
            status: 'NEEDS_VERIFICATION', addPostPhase: 'VERIFY_REQUIRED',
            lastError: error.message, stepDescription: error.message
          });
        } else if (error.code === 'ADD_POST_BLOCKED') {
          await this.storage.updateJobState({ addPostPhase: 'BLOCKED', lastError: error.message });
        }
        throw error;
      } finally {
        this._isAddPostRunning = false;
      }
    }

    get storage() {
      return global.StorageService;
    }

    /**
     * Locate and verify the "Publish all" button
     * Element: <ks-button-923 data-testid="common_next_button"> -> shadowRoot -> button[part="base"]
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<{ hostBtn: HTMLElement, clickableBtn: HTMLElement }|null>}
     */
    async locatePublishAllButton(timeoutMs = 10000) {
      const h = this.helpers;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }

        const candidates = h.queryShadowAll('ks-button-923[data-testid="common_next_button"], ks-button-923, button[data-testid="common_next_button"]');
        for (const host of candidates) {
          const text = (host.innerText || host.textContent || '').trim();
          if (text === 'Publish all' && h.isVisible(host)) {
            const clickable = h.getClickableTarget(host);
            // Verify enabled state
            const hostDisabled = host.hasAttribute('disabled') ||
                                 host.getAttribute('aria-disabled') === 'true' ||
                                 host.classList.contains('is-disabled');
            const innerDisabled = clickable && (
              clickable.hasAttribute('disabled') ||
              clickable.disabled === true ||
              clickable.getAttribute('aria-disabled') === 'true' ||
              clickable.classList.contains('is-disabled')
            );

            if (!hostDisabled && !innerDisabled) {
              return { hostBtn: host, clickableBtn: clickable };
            }
          }
        }

        await h.sleep(250);
      }

      return null;
    }

    /**
     * Step 11: Final Publishing Step (Test Mode vs Live Mode)
     * Test Mode stops immediately before Publish All and never clicks it.
     * Live Mode enforces:
     * - Confirm Live Mode & Authorization
     * - Verify button enabled & text is strictly "Publish all"
     * - Persist SUBMISSION_PENDING before click
     * - Click Publish All exactly once
     * - Wait for TikTok processing (loading spinners, error banners, success modals/toasts)
     * - Detect return to Campaigns page (route + interactive UI)
     * - Settle for 3 seconds
     * - Trigger single Campaigns page refresh
     * @param {object} config
     * @param {number} [campaignIndex=1]
     * @param {number} [totalCampaigns=1]
     * @param {number} [timeoutMs=60000] Configurable publishing timeout
     * @returns {Promise<{ submitted: boolean, testMode?: boolean, reloading?: boolean, success?: boolean, ambiguous?: boolean, error?: string }>}
     */
    async handlePublishStep(config, campaignIndex = 1, totalCampaigns = 1, timeoutMs = 60000) {
      const h = this.helpers;
      const stepName = 'PUBLISH';
      this.diag(stepName, 'Locating "Publish all" button');

      const found = await this.locatePublishAllButton(10000);
      if (!found) {
        this.diag(stepName, 'Locate Publish all button', {
          elementMissing: 'ks-button-923[Publish all]',
          error: 'Publish all button missing or disabled on final page'
        });
        throw new Error('Could not find visible and enabled "Publish all" button on the final page.');
      }

      const { hostBtn, clickableBtn } = found;

      // Check Execution Mode (TASK 2 & TASK 9)
      if (!config.liveMode) {
        this.diag(stepName, 'TEST MODE: Halting before Publish all', {
          elementFound: 'Publish all button',
          verification: 'Test completed — Ready to Publish'
        });
        return { submitted: false, testMode: true, success: true };
      }

      // LIVE MODE: Enforce single-click & state persistence
      const buttonText = (hostBtn.innerText || hostBtn.textContent || '').trim();
      if (buttonText !== 'Publish all') {
        throw new Error(`Unexpected button text: expected "Publish all", got "${buttonText}"`);
      }

      // Record pre-submission campaign identifiers
      const currentJob = await this.storage?.getJobState();
      const detectedName = (h.extractCampaignNameFromPage ? h.extractCampaignNameFromPage() : null) || currentJob?.expectedCampaignName || null;
      const advertiserId = (h.extractAdvertiserIdFromUrl ? h.extractAdvertiserIdFromUrl() : null) || currentJob?.advertiserId || null;

      const preSubmissionData = {
        campaignIndex,
        totalCampaigns,
        websiteUrl: config.websiteUrl,
        targetCountries: config.targetCountries,
        dailyBudget: config.dailyBudget,
        expectedCampaignName: detectedName,
        advertiserId,
        runId: currentJob?.runId || null,
        timestamp: Date.now()
      };

      if (detectedName) {
        console.log(`[PUBLISH] Pre-submission identity captured: Name="${detectedName}", Budget="${config.dailyBudget}"`);
      }

      // Guard: prevent duplicate clicks if submission is already pending for this campaign index
      if (currentJob?.submissionStatus === 'SUBMISSION_PENDING' &&
          currentJob?.currentCampaignIndex === campaignIndex &&
          currentJob?.lastPublishClickTime &&
          Date.now() - currentJob.lastPublishClickTime < 60000) {
        console.warn(`[PUBLISH] Submission already in progress for Campaign ${campaignIndex}. Skipping duplicate click.`);
        return { submitted: true, success: true, reloading: true };
      }

      // Persist SUBMISSION_PENDING state BEFORE clicking (Task 2)
      await this.storage?.updateJobState({
        status: 'RUNNING',
        currentStep: 'PUBLISH_PENDING',
        submissionStatus: 'SUBMISSION_PENDING',
        currentCampaignIndex: campaignIndex,
        stepDescription: `[#${campaignIndex}] Submitting campaign to TikTok...`,
        lastPublishClickTime: Date.now(),
        expectedCampaignName: detectedName,
        advertiserId,
        submissionEvidence: { preSubmission: preSubmissionData }
      });

      // Click Publish All ONLY ONCE
      h.safeClick(clickableBtn, 'Publish all button');
      console.log(`[PUBLISH] Campaign ${campaignIndex}/${totalCampaigns} submitted`);
      console.log('[PUBLISH] Submission pending');

      this.diag(stepName, 'Publish All clicked once in Live Mode', {
        elementFound: 'ks-button-923[Publish all]',
        verification: 'Click dispatched exactly once'
      });

      // TASK 3: Wait for TikTok processing to complete
      const startWait = Date.now();
      let capturedEvidence = null;
      const loggedInfoNotices = new Set();

      while (Date.now() - startWait < timeoutMs) {
        if (h.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }

        console.log('[PUBLISH] Waiting for TikTok processing');

        // 1. Check for blocking genuine error banners or dialogs
        const errorDetails = h.findSubmissionError();
        if (errorDetails && errorDetails.hasError) {
          this.diag(stepName, 'Submission failed: TikTok error detected', {
            error: errorDetails.errorText
          });
          await this.storage?.updateJobState({
            status: 'FAILED',
            submissionStatus: 'FAILED',
            lastError: errorDetails.errorText,
            stepDescription: `[#${campaignIndex}] Submission failed: ${errorDetails.errorText}`
          });
          return { submitted: true, success: false, ambiguous: false, error: errorDetails.errorText };
        }

        // 2. Check for informational notifications (e.g. UTM tracking parameter notice)
        const infoDetails = h.findSubmissionInfo ? h.findSubmissionInfo() : null;
        if (infoDetails && infoDetails.hasInfo) {
          if (!loggedInfoNotices.has(infoDetails.infoText)) {
            loggedInfoNotices.add(infoDetails.infoText);
            console.log(`[PUBLISH INFO] TikTok notification: ${infoDetails.infoText}`);
            console.log('[PUBLISH] Informational notification ignored as failure evidence');
            console.log('[PUBLISH] Continuing submission monitoring');
            this.diag(stepName, 'Informational TikTok notification detected', {
              notification: infoDetails.infoText,
              action: 'Ignored as failure evidence; continuing submission monitoring'
            });
          }
        }

        // 2. Check for loading spinners
        const spinner = h.findLoadingIndicator();
        if (spinner) {
          // Spinners active; TikTok is processing
          await h.sleep(600);
          continue;
        }

        // 3. Monitor for explicit success confirmation evidence before redirect
        if (!capturedEvidence) {
          const evidence = h.findSubmissionEvidence();
          if (evidence && evidence.confirmed) {
            capturedEvidence = evidence;
            console.log('[PUBLISH] Submission evidence detected');
            await this.storage?.updateJobState({
              submissionStatus: 'SUBMITTED',
              submissionEvidence: {
                ...evidence,
                preSubmission: preSubmissionData,
                capturedAt: Date.now()
              }
            });
          }
        }

        // 4. Monitor URL and page state changes for return to Campaigns page
        if (h.isCampaignsManagementUrl() && h.findCampaignsManagementUI()) {
          // Reached Campaigns management page!
          break;
        }

        await h.sleep(600);
      }

      // Check if we arrived at Campaigns page
      const isOnCampaignsPage = h.isCampaignsManagementUrl() && h.findCampaignsManagementUI();
      if (!isOnCampaignsPage) {
        console.log('[VERIFY] Submission could not be confirmed');
        console.log('[RUNNER] NEEDS_VERIFICATION');
        console.log('[RUNNER] Batch paused to prevent duplicates');

        await this.storage?.updateJobState({
          status: 'NEEDS_VERIFICATION',
          currentStep: 'VERIFY_SUBMISSION',
          submissionStatus: 'NEEDS_VERIFICATION',
          lastError: 'Publishing timeout exceeded without returning to Campaigns page.',
          stepDescription: 'Submission outcome ambiguous. Manual verification required in Ads Manager.'
        });

        return {
          submitted: true,
          success: false,
          ambiguous: true,
          error: 'Navigation timeout: Did not return to Campaigns page within 60s'
        };
      }

      // TASK 4: Detect Return to Campaigns Page
      console.log('[NAVIGATION] Campaigns page detected');
      console.log('[NAVIGATION] Waiting 3 seconds');
      await h.sleep(3000);

      // Confirm page is still on Campaigns management view
      if (!h.isCampaignsManagementUrl() || !h.findCampaignsManagementUI()) {
        const confirmed = await h.waitForCampaignsPage(5000);
        if (!confirmed) {
          console.log('[VERIFY] Submission could not be confirmed');
          console.log('[RUNNER] NEEDS_VERIFICATION');
          console.log('[RUNNER] Batch paused to prevent duplicates');
          return { submitted: true, success: false, ambiguous: true, error: 'Left Campaigns page during settling' };
        }
      }

      // Set checkpoint before refreshing: REFRESH_IN_PROGRESS (Task 7)
      console.log('[REFRESH] Saving refresh checkpoint');
      await this.storage?.updateJobState({
        refreshCheckpoint: 'REFRESH_IN_PROGRESS',
        currentStep: 'REFRESH_CAMPAIGNS',
        stepDescription: `Campaign ${campaignIndex} submitted. Refreshing Campaigns page...`
      });

      console.log('[REFRESH] Full page reload initiated');

      // Trigger single refresh
      if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
        window.location.reload();
      }

      return { submitted: true, success: true, reloading: true };
    }

    /**
     * Step 12: Verify Campaign Submission (Post-Refresh)
     * Verifies campaign creation/submission based on reliable positive evidence,
     * independent of ad delivery status (e.g., "Not Delivered", "Active", "Under review").
     *
     * Evidence sources in priority order:
     * 1. Explicit TikTok submission confirmation (toast/modal) captured during submission.
     * 2. Campaign ID tied to current submission (from toast, modal, or URL).
     * 3. Newly created matching campaign record in management table, distinguished from
     *    pre-existing campaigns (not in known preexisting IDs, matching budget, not Completed/Archived/Deleted).
     *
     * A newly created campaign row is acceptable regardless of whether its delivery status
     * is "Not Delivered", "Under review", "Active", or something else.
     *
     * If reliable positive evidence is present: returns { verified: true, campaignId }.
     * If ambiguous (no trustworthy evidence): returns { verified: false, ambiguous: true }.
     *
     * @param {object} jobState
     * @param {number} [timeoutMs=20000]
     * @returns {Promise<{ verified: boolean, ambiguous: boolean, campaignId?: string, error?: string }>}
     */
    /**
     * Step 12: Verify Campaign Submission (Post-Refresh)
     * Verifies campaign creation/submission based on reliable positive evidence,
     * including exact campaign name matching (e.g. Traffic20261013161035),
     * independent of ad delivery status ("Not delivered", "Active", "Under review").
     *
     * Verification priority:
     * - TIER 1: Explicit submission confirmation captured before/after redirect.
     * - TIER 2: Exact published campaign ID match (from submission evidence).
     * - TIER 3: Newly created campaign row identified by:
     *   A. Expected campaign name match + matching budget + non-terminal delivery status
     *   B. New candidate campaign ID (not in baseline) + matching budget + non-terminal delivery status
     *
     * @param {object} jobState
     * @param {number} [timeoutMs=25000]
     * @returns {Promise<{ verified: boolean, ambiguous: boolean, campaignId?: string, error?: string }>}
     */
    async verifySubmittedCampaign(jobState, timeoutMs = 25000) {
      const h = this.helpers;
      const stepName = 'VERIFY_SUBMISSION';
      this.diag(stepName, 'Verifying campaign submission using reliable evidence');

      const evidence = jobState?.submissionEvidence;
      const preSubmission = evidence?.preSubmission;

      const expectedName = (preSubmission?.expectedCampaignName || jobState?.expectedCampaignName || '').trim();
      const expectedBudgetStr = preSubmission?.dailyBudget || jobState?.dailyBudget || null;
      const numericBudget = expectedBudgetStr ? parseFloat(expectedBudgetStr) : null;
      const expectedAdvertiserId = preSubmission?.advertiserId || jobState?.advertiserId || null;

      // Track known previously submitted campaigns in this session
      const previousSessionIds = new Set(
        (jobState?.campaignResults || []).map(r => r.campaignId).filter(Boolean)
      );
      const preExistingIds = new Set([
        ...(jobState?.knownCampaignIds || []),
        ...previousSessionIds
      ].filter(Boolean));

      const preExistingNames = new Set(
        (jobState?.knownCampaignNames || []).map(n => String(n).toLowerCase()).filter(Boolean)
      );

      // TIER 1: Explicit TikTok submission success confirmation captured pre-redirect (modal or toast)
      if (evidence && evidence.confirmed && (evidence.type === 'MODAL' || evidence.type === 'TOAST')) {
        this.diag(stepName, 'Verified via persisted pre-redirect confirmation', {
          evidenceType: evidence.type,
          campaignId: evidence.campaignId || 'N/A',
          campaignName: expectedName || 'N/A'
        });
        console.log('[VERIFY] Campaign submission verified');
        return {
          verified: true,
          ambiguous: false,
          campaignId: evidence.campaignId || null,
          campaignName: expectedName || null
        };
      }

      // TIER 2 & TIER 3: Inspect Campaigns management table
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }

        // Check if on-page toast/modal appeared after refresh
        const onPageEvidence = h.findSubmissionEvidence();
        if (onPageEvidence && onPageEvidence.confirmed) {
          this.diag(stepName, 'Verified via on-page confirmation dialog/toast', {
            campaignId: onPageEvidence.campaignId || 'N/A',
            campaignName: expectedName || 'N/A'
          });
          console.log('[VERIFY] Campaign submission verified');
          return {
            verified: true,
            ambiguous: false,
            campaignId: onPageEvidence.campaignId || null,
            campaignName: expectedName || null
          };
        }

        // Validate Advertiser Account ID if captured
        const currentUrl = (typeof window !== 'undefined' && window.location ? window.location.href : '');
        const currentAdvertiserId = h.extractAdvertiserIdFromUrl ? h.extractAdvertiserIdFromUrl(currentUrl) : null;
        const expectedAdvertiserId = jobState?.advertiserId || null;
        const advertiserAccountMatches = (!expectedAdvertiserId || !currentAdvertiserId) || (expectedAdvertiserId === currentAdvertiserId);

        // Query all candidate table rows (supports native table, Arco, Bytedance, Semi, virtualized rows)
        const rows = h.queryShadowAll('tbody tr, [role="row"], tr[data-row-key], .byted-table-row, .arco-table-row, .semi-table-row, .vi-table-row, [data-testid*="table"] tr, [data-testid*="row"]');
        const tableDetected = !!(h.findCampaignsManagementUI() || rows.length > 0);

        let candidateRowsCount = 0;
        let exactNameMatches = 0;
        let budgetMatchesCount = 0;
        let newCampaignMatches = 0;
        const candidateDiagnostics = [];

        for (const row of rows) {
          if (!h.isVisible(row)) continue;
          const rowText = (row.innerText || row.textContent || '').trim();
          const lower = rowText.toLowerCase();

          // Skip table header rows
          if (row.tagName === 'TH' || (typeof row.closest === 'function' && row.closest('thead')) || (lower.includes('campaign name') && lower.includes('budget') && lower.includes('status'))) {
            continue;
          }

          candidateRowsCount++;

          // Extract Row Key & Attributes
          const rowKey = row.getAttribute('data-row-key') || row.getAttribute('data-id') || row.getAttribute('id') || '';

          // Extract candidate Campaign ID from attributes, text, links, or inputs
          let candidateId = null;
          const keyMatch = rowKey.match(/\b(18\d{14,18})\b/) || rowKey.match(/\b(\d{16,19})\b/);
          if (keyMatch) candidateId = keyMatch[1];

          if (!candidateId) {
            const textMatch = rowText.match(/\b(18\d{14,18})\b/) || rowText.match(/\b(\d{16,19})\b/);
            if (textMatch) candidateId = textMatch[1];
          }

          if (!candidateId && row.querySelectorAll) {
            const links = row.querySelectorAll('a[href]');
            for (const a of links) {
              const href = a.getAttribute('href') || '';
              const m = href.match(/campaign_id=(\d+)/) || href.match(/\/campaign\/(\d+)/);
              if (m) {
                candidateId = m[1];
                break;
              }
            }
          }

          if (!candidateId && row.querySelectorAll) {
            const inputs = row.querySelectorAll('input');
            for (const inp of inputs) {
              const val = inp.getAttribute('value') || inp.value || '';
              const m = val.match(/\b(18\d{14,18})\b/) || val.match(/\b(\d{16,19})\b/);
              if (m) {
                candidateId = m[1];
                break;
              }
            }
          }

          // Exclude terminal dead statuses (Completed, Archived, Deleted, Ended)
          const isTerminalPastStatus = lower.includes('completed') ||
                                       lower.includes('archived') ||
                                       lower.includes('deleted') ||
                                       lower.includes('ended');

          // Check Delivery Status ("Not delivered", "Under review", "In review", "Active", etc.)
          let deliveryStatus = 'Unknown';
          if (lower.includes('not delivered')) deliveryStatus = 'Not delivered';
          else if (lower.includes('under review')) deliveryStatus = 'Under review';
          else if (lower.includes('pending review')) deliveryStatus = 'Pending review';
          else if (lower.includes('in review')) deliveryStatus = 'In review';
          else if (lower.includes('active')) deliveryStatus = 'Active';
          else if (lower.includes('delivering')) deliveryStatus = 'Delivering';
          else if (isTerminalPastStatus) deliveryStatus = 'Terminal';

          // Check Campaign Name match (EXACT, unambiguous match - NOT unsafe prefix/substring)
          let hasNameMatch = false;
          let extractedRowName = null;
          if (expectedName) {
            const expNorm = expectedName.trim().toLowerCase();
            // 1. Check exact cell / child node text
            if (row.querySelectorAll) {
              const textEls = row.querySelectorAll('a, span, div, td, th');
              for (const el of textEls) {
                const elText = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (elText === expNorm) {
                  hasNameMatch = true;
                  extractedRowName = expectedName;
                  break;
                }
              }
            }
            // 2. Strict delimiter / word boundary match on raw row text (prevents unsafe prefix or substring matches)
            if (!hasNameMatch) {
              const escaped = expNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const boundaryRegex = new RegExp(`(?:^|[\\s\\n\\r\\t])${escaped}(?:$|[\\s\\n\\r\\t])`, 'i');
              if (boundaryRegex.test(rowText)) {
                hasNameMatch = true;
                extractedRowName = expectedName;
              }
            }
          }
          if (hasNameMatch) exactNameMatches++;

          // Check Budget match (e.g. 44.00, 44, 44.00 USD, $44.00)
          let budgetMatches = false;
          let extractedBudgetText = 'N/A';
          if (numericBudget !== null && !isNaN(numericBudget)) {
            const formatted2 = numericBudget.toFixed(2);
            const formattedInt = String(numericBudget);
            if (rowText.includes(formatted2) || rowText.includes(formattedInt)) {
              budgetMatches = true;
              extractedBudgetText = formatted2;
            } else {
              const numbers = rowText.match(/[\d,.]+/g) || [];
              for (const numStr of numbers) {
                const parsed = parseFloat(numStr.replace(/,/g, ''));
                if (!isNaN(parsed) && Math.abs(parsed - numericBudget) < 0.01) {
                  budgetMatches = true;
                  extractedBudgetText = numStr;
                  break;
                }
              }
            }
          } else {
            budgetMatches = true;
          }
          if (budgetMatches) budgetMatchesCount++;

          // Check if candidate ID or Name is pre-existing
          const isPreExistingId = candidateId ? preExistingIds.has(candidateId) : false;
          const isPreExistingName = hasNameMatch ? preExistingNames.has(expectedName.toLowerCase()) : false;

          let rejectionReason = null;
          if (!advertiserAccountMatches) rejectionReason = `Advertiser account mismatch (expected ${expectedAdvertiserId}, got ${currentAdvertiserId})`;
          else if (isTerminalPastStatus) rejectionReason = 'Terminal status (archived/completed/deleted)';
          else if (isPreExistingId) rejectionReason = `Pre-existing campaign ID: ${candidateId}`;
          else if (isPreExistingName) rejectionReason = `Pre-existing campaign name: ${expectedName}`;
          else if (!budgetMatches) rejectionReason = `Budget mismatch (expected ${expectedBudgetStr})`;
          else if (expectedName && !hasNameMatch && !candidateId) rejectionReason = `Name mismatch (expected ${expectedName})`;

          // Diagnostic record for this row
          candidateDiagnostics.push({
            name: hasNameMatch ? expectedName : (rowText.slice(0, 30) || 'N/A'),
            rowKey: rowKey || 'N/A',
            campaignId: candidateId || 'N/A',
            budgetText: extractedBudgetText,
            deliveryStatus,
            rejectionReason: rejectionReason || 'None (Match)'
          });

          // TIER 2: Exact published campaign ID match if known from submission evidence
          if (evidence?.campaignId && candidateId === evidence.campaignId && !isTerminalPastStatus && advertiserAccountMatches) {
            this.diag(stepName, 'Verified matching campaign ID in management table', {
              campaignId: candidateId,
              campaignName: expectedName || null,
              deliveryStatus
            });
            console.log('[VERIFY] Campaign submission verified');
            return {
              verified: true,
              ambiguous: false,
              campaignId: candidateId,
              campaignName: expectedName || null
            };
          }

          // TIER 3: Newly created campaign row identified by:
          // A. Expected Campaign Name match (e.g. Traffic20261013161035) + Budget match + Non-terminal status + Advertiser account
          // B. OR: New Candidate ID (not in baseline) + Budget match + Non-terminal status + Advertiser account
          const isVerifiedByName = hasNameMatch && budgetMatches && !isTerminalPastStatus && !isPreExistingName && advertiserAccountMatches;
          const isVerifiedById = candidateId && !isPreExistingId && budgetMatches && !isTerminalPastStatus && advertiserAccountMatches;

          if (isVerifiedByName || isVerifiedById) {
            newCampaignMatches++;
            // STRICT IDENTITY SEPARATION: campaignId is ONLY set if a real numeric candidate ID was extracted
            const verifiedCampaignId = candidateId || null;
            const rowFirstLine = rowText.split(/[\r\n]+/)[0]?.trim() || null;
            const verifiedCampaignName = expectedName || extractedRowName || (rowFirstLine && !/^\d{16,19}$/.test(rowFirstLine) ? rowFirstLine : null);
            this.diag(stepName, 'Campaign submission verified in management table', {
              matchType: isVerifiedByName ? 'EXACT_NAME_AND_BUDGET' : 'NEW_ID_AND_BUDGET',
              campaignName: verifiedCampaignName || 'N/A',
              campaignId: verifiedCampaignId || 'N/A',
              deliveryStatus
            });
            console.log('[VERIFY] Campaign submission verified');
            return {
              verified: true,
              ambiguous: false,
              campaignId: verifiedCampaignId,
              campaignName: verifiedCampaignName
            };
          }
        }

        // Output structured diagnostics (Task 3)
        console.log(`[VERIFY DEBUG] Current URL: ${typeof window !== 'undefined' && window.location ? window.location.href : 'N/A'}`);
        console.log(`[VERIFY DEBUG] Campaign table detected: ${tableDetected}`);
        console.log(`[VERIFY DEBUG] Campaign rows found: ${rows.length}`);
        console.log(`[VERIFY DEBUG] Expected campaign name: ${expectedName || 'N/A'}`);
        console.log(`[VERIFY DEBUG] Expected budget: ${expectedBudgetStr || 'N/A'}`);
        console.log(`[VERIFY DEBUG] Known campaign IDs count: ${preExistingIds.size}`);
        console.log(`[VERIFY DEBUG] Known campaign names count: ${preExistingNames.size}`);
        console.log(`[VERIFY DEBUG] Candidate campaign rows: ${candidateRowsCount}`);
        console.log(`[VERIFY DEBUG] Exact name matches: ${exactNameMatches}`);
        console.log(`[VERIFY DEBUG] Budget matches: ${budgetMatchesCount}`);
        console.log(`[VERIFY DEBUG] New campaign matches: ${newCampaignMatches}`);
        if (candidateDiagnostics.length > 0) {
          candidateDiagnostics.slice(0, 5).forEach(d => {
            console.log(`[VERIFY DEBUG] Candidate: ${JSON.stringify(d)}`);
          });
        }

        await h.sleep(1000);
      }

      // If no trustworthy positive submission evidence was confirmed:
      console.log('[VERIFY] Submission could not be confirmed');
      console.log('[RUNNER] NEEDS_VERIFICATION');
      console.log('[RUNNER] Batch paused to prevent duplicates');

      this.diag(stepName, 'Submission could not be confirmed with reliable evidence', {
        verification: 'Ambiguous outcome - no trustworthy evidence found',
        error: 'Ambiguous submission result',
        expectedName: expectedName || 'N/A',
        expectedBudget: expectedBudgetStr || 'N/A'
      });

      return {
        verified: false,
        ambiguous: true,
        error: 'Submission could not be confirmed with reliable evidence.'
      };
    }

    /**
     * Helper to click standard <ks-button-923 data-testid="common_next_button"> with text "Continue"
     * @param {string} stepName
     */
    async clickCommonNextButton(stepName) {
      const h = this.helpers;
      this.diag(stepName, 'Clicking Continue button');

      const nextCandidates = h.queryShadowAll('ks-button-923[data-testid="common_next_button"]');
      let target = null;

      for (const cand of nextCandidates) {
        const text = (cand.innerText || cand.textContent || '').trim();
        if (text.includes('Continue') && h.isVisible(cand)) {
          target = h.getClickableTarget(cand);
          break;
        }
      }

      if (!target) {
        target = await h.waitForButtonByText('Continue', 8000);
      }

      if (!target) {
        this.diag(stepName, 'Locate Continue button', {
          elementMissing: 'ks-button-923[data-testid="common_next_button"]',
          error: `Could not find Continue button at: ${stepName}`
        });
        throw new Error(`Could not find Continue button at: ${stepName}`);
      }

      h.safeClick(target, stepName);
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
  }

  const campaignAutomationInstance = new CampaignAutomation();

  global.CampaignAutomation = campaignAutomationInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CampaignAutomation: campaignAutomationInstance };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
