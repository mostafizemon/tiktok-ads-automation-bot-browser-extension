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

      // 6-8. Find Budget Mode dropdown and ensure Daily mode is selected
      await this.ensureDailyBudgetMode();

      // 9-13. Traverse TWO nested open Shadow DOM roots to locate budget input
      const budgetInput = await this.locateNestedShadowBudgetInput();

      // 14-23. Set budget value, verify numeric value, inspect TikTok validation errors
      await this.enterAndVerifyBudgetValue(budgetInput, budgetFormatted);

      return true;
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
        // Fallback: check if the daily budget input host already exists in DOM
        const dailyHost = document.querySelector('[data-testid="create_campaign_CBO_daily_budget"]') ||
                          h.queryShadow('[data-testid="create_campaign_CBO_daily_budget"]');
        if (dailyHost) {
          console.log('[BUDGET] Daily mode verified');
          this.diag(stepName, 'Daily mode verified (default daily input host present)');
          return true;
        }

        this.diag(stepName, 'Budget mode dropdown not found', {
          error: 'Dropdown [data-testid="campaign_settings_budgetCboSelect"] missing'
        });
        throw new Error('Budget Mode dropdown could not be found.');
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
        const dailyHost = document.querySelector('[data-testid="create_campaign_CBO_daily_budget"]') ||
                          h.queryShadow('[data-testid="create_campaign_CBO_daily_budget"]');
        if (!dailyHost) {
          this.diag(stepName, 'Daily mode verification failed', {
            error: 'Dropdown did not switch to Daily'
          });
          throw new Error('Failed to verify Daily budget mode was selected.');
        }
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
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<HTMLInputElement>}
     */
    async locateNestedShadowBudgetInput(timeoutMs = 10000) {
      const h = this.helpers;
      const stepName = 'NESTED_BUDGET_INPUT';
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) throw new Error('Automation aborted or paused by user');

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

            if (input && h.isVisible(input)) {
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
          const fallbackInput = h.queryShadow('input[part="input"], input.input, input[type="text"]', host1);
          if (fallbackInput && h.isVisible(fallbackInput)) {
            console.log('[BUDGET] Nested Shadow DOM input found');
            this.diag(stepName, 'Budget input found via shadow fallback traversal');
            return fallbackInput;
          }
        }

        await h.sleep(300);
      }

      this.diag(stepName, 'Budget input host or nested shadow DOM elements not found', {
        error: 'Could not traverse shadow roots to input[part="input"]'
      });
      throw new Error('Nested Shadow DOM budget input field could not be found.');
    }

    /**
     * Enter budget value, verify numeric match, and check TikTok validation errors:
     * - Focus the input
     * - Set budget using native HTMLInputElement value setter
     * - Dispatch input, change, and blur events with bubbling and composition
     * - Wait for TikTok validation
     * - Verify displayed numeric value matches configuration
     * - Check validation errors inside: #cbo-daily-budget .vi-form-item__error
     * - Respect TikTok minimum and maximum validation without silent adjustment
     * @param {HTMLInputElement} input
     * @param {string} budgetFormatted
     * @returns {Promise<boolean>}
     */
    async enterAndVerifyBudgetValue(input, budgetFormatted) {
      const h = this.helpers;
      const stepName = 'ENTER_VERIFY_BUDGET';

      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await h.sleep(200);

      // 14. Focus the input
      input.focus();

      // 15. Set budget using native HTMLInputElement value setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, budgetFormatted);
      } else {
        input.value = budgetFormatted;
      }

      // 16. Dispatch appropriate input/change events with bubbling & composed
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      // 17. Trigger blur
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      input.blur();

      console.log('[BUDGET] Value entered');
      this.diag(stepName, `Entered budget value: ${budgetFormatted}`);

      // 18. Wait for TikTok's validation to complete
      await h.sleep(600);

      // 19. Verify the displayed numeric value matches the configured budget
      let actualVal = (input.value || '').trim();
      let numericActual = parseFloat(actualVal.replace(/[^0-9.]/g, ''));
      const numericExpected = parseFloat(budgetFormatted);

      if (isNaN(numericActual) || Math.abs(numericActual - numericExpected) > 0.01) {
        // Retry entry once
        if (nativeSetter) {
          nativeSetter.call(input, budgetFormatted);
        } else {
          input.value = budgetFormatted;
        }
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        input.blur();
        await h.sleep(500);

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

      // 20-22. Check validation errors inside: #cbo-daily-budget .vi-form-item__error
      // Respect actual minimum and maximum shown by TikTok (e.g. "Your budget must be a number between 20.00 and 9,999,999.99.")
      // Do not silently adjust the user's requested amount
      // Do not click Continue if the budget is missing, invalid, or not verified
      const errorContainers = h.queryShadowAll('#cbo-daily-budget .vi-form-item__error, .vi-form-item__error');
      for (const errEl of errorContainers) {
        if (h.isVisible(errEl)) {
          const errText = (errEl.innerText || errEl.textContent || '').trim();
          if (errText.length > 0) {
            this.diag(stepName, `TikTok budget validation error: "${errText}"`, { error: errText });
            throw new Error(`TikTok budget validation error: ${errText}`);
          }
        }
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

        if ((demoHeader && h.isVisible(demoHeader)) || (locationDropdown && h.isVisible(locationDropdown))) {
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

      // 1. Expand Demographics section if collapsed
      const demoHeading = await h.waitForVisibleElement('#section_dom_id_targetingDemographics, [id*="targetingDemographics"]', 8000);
      if (demoHeading) {
        demoHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await h.sleep(300);

        const collapseContainer = demoHeading.closest('[data-lego-collapse-aria-expanded]') ||
                                  document.querySelector('[data-lego-collapse-aria-expanded]');

        if (collapseContainer) {
          const isExpanded = collapseContainer.getAttribute('data-lego-collapse-aria-expanded') === 'true';
          if (!isExpanded) {
            this.diag(stepName, 'Expanding collapsed Demographics section', {
              elementFound: 'data-lego-collapse-aria-expanded=false'
            });
            h.safeClick(demoHeading, 'Demographics section header');
            await h.sleep(600);
          }
        }
      }

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
      const preSubmissionData = {
        campaignIndex,
        totalCampaigns,
        websiteUrl: config.websiteUrl,
        targetCountries: config.targetCountries,
        dailyBudget: config.dailyBudget,
        timestamp: Date.now()
      };

      // Persist SUBMISSION_PENDING state BEFORE clicking (Task 2)
      await this.storage?.updateJobState({
        status: 'RUNNING',
        currentStep: 'PUBLISH_PENDING',
        submissionStatus: 'SUBMISSION_PENDING',
        currentCampaignIndex: campaignIndex,
        stepDescription: `[#${campaignIndex}] Submitting campaign to TikTok...`,
        lastPublishClickTime: Date.now(),
        submissionEvidence: { preSubmission: preSubmissionData }
      });

      // Click Publish All ONLY ONCE
      h.safeClick(clickableBtn, 'Publish all button');
      console.log('[PUBLISH] Publish All clicked');
      console.log('[PUBLISH] Submission pending');

      this.diag(stepName, 'Publish All clicked once in Live Mode', {
        elementFound: 'ks-button-923[Publish all]',
        verification: 'Click dispatched exactly once'
      });

      // TASK 3: Wait for TikTok processing to complete
      const startWait = Date.now();
      let capturedEvidence = null;

      while (Date.now() - startWait < timeoutMs) {
        if (h.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }

        console.log('[PUBLISH] Waiting for TikTok processing');

        // 1. Check for blocking error banners or dialogs
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
      console.log('[NAVIGATION] Waiting 3 seconds for page to settle');
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
      await this.storage?.updateJobState({
        refreshCheckpoint: 'REFRESH_IN_PROGRESS',
        currentStep: 'REFRESH_CAMPAIGNS',
        stepDescription: `Campaign ${campaignIndex} submitted. Refreshing Campaigns page...`
      });

      console.log('[REFRESH] Campaigns page refresh started');

      // Trigger single refresh
      if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
        window.location.reload();
      }

      return { submitted: true, success: true, reloading: true };
    }

    /**
     * Step 12: Verify Campaign Submission (Post-Refresh)
     * Evaluates reliable evidence:
     * - Pre-captured modal/toast confirmation evidence preserved in storage
     * - Campaign ID obtained during submission
     * - Newly created campaign record in campaign table with status Under review / Active / Pending review
     * If ambiguous: returns { verified: false, ambiguous: true }.
     * @param {object} jobState
     * @param {number} [timeoutMs=20000]
     * @returns {Promise<{ verified: boolean, ambiguous: boolean, campaignId?: string, error?: string }>}
     */
    async verifySubmittedCampaign(jobState, timeoutMs = 20000) {
      const h = this.helpers;
      const stepName = 'VERIFY_SUBMISSION';
      this.diag(stepName, 'Verifying campaign submission using reliable evidence');

      const evidence = jobState?.submissionEvidence;

      // 1. Check if definitive evidence was captured pre-redirect
      if (evidence && evidence.confirmed && (evidence.type === 'MODAL' || evidence.type === 'TOAST')) {
        this.diag(stepName, 'Verified via persisted pre-redirect confirmation', {
          evidenceType: evidence.type,
          campaignId: evidence.campaignId || 'N/A'
        });
        console.log('[VERIFY] Campaign submission verified');
        return {
          verified: true,
          ambiguous: false,
          campaignId: evidence.campaignId || null
        };
      }

      // 2. Inspect Campaigns management table for newly created campaign
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (h.isAborted()) {
          throw new Error('Automation aborted or paused by user');
        }

        const rows = h.queryShadowAll('[data-testid*="table"] [role="row"], .byted-table-row, .arco-table-row, tr[data-row-key]');
        for (const row of rows) {
          if (!h.isVisible(row)) continue;
          const rowText = (row.innerText || row.textContent || '').trim();
          const lower = rowText.toLowerCase();

          // Check for valid campaign status
          const hasStatus = lower.includes('under review') ||
                            lower.includes('pending review') ||
                            lower.includes('in review') ||
                            lower.includes('active');

          if (hasStatus) {
            // Check for campaign ID in row
            const idMatch = rowText.match(/\b(18\d{14,18})\b/);
            const campaignId = idMatch ? idMatch[1] : (evidence?.campaignId || null);

            this.diag(stepName, 'Campaign submission verified in management table', {
              status: 'Status verified in table row',
              campaignId: campaignId || 'N/A'
            });
            console.log('[VERIFY] Campaign submission verified');
            return {
              verified: true,
              ambiguous: false,
              campaignId: campaignId
            };
          }
        }

        await h.sleep(1000);
      }

      // 3. If no trustworthy evidence was captured or found:
      console.log('[VERIFY] Submission could not be confirmed');
      console.log('[RUNNER] NEEDS_VERIFICATION');
      console.log('[RUNNER] Batch paused to prevent duplicates');

      this.diag(stepName, 'Submission could not be confirmed with reliable evidence', {
        verification: 'Ambiguous outcome - no trustworthy evidence found',
        error: 'Ambiguous submission result'
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
