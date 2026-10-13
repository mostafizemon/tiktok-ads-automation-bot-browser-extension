/**
 * popup.js
 * Controller script for TikTok Ads Automation Bot Popup UI.
 * Handles validation, multi-country selection, test/live mode,
 * confirmation modal, runtime controls, and real-time state synchronization.
 */

(function () {
  'use strict';

  const MODULE_NAME = 'Popup';

  // Selected countries state
  let selectedCountries = ['United States'];

  // DOM Elements
  const elements = {
    form: document.getElementById('configForm'),
    websiteUrl: document.getElementById('websiteUrl'),
    dailyBudget: document.getElementById('dailyBudget'),
    campaignCount: document.getElementById('campaignCount'),
    authCode: document.getElementById('authCode'),
    toggleAuthCodeVisibility: document.getElementById('toggleAuthCodeVisibility'),

    // Countries
    countriesContainer: document.getElementById('countriesContainer'),
    selectedCountriesList: document.getElementById('selectedCountriesList'),
    countrySearchInput: document.getElementById('countrySearchInput'),
    addCountryBtn: document.getElementById('addCountryBtn'),

    // Modes
    modeTestRadio: document.getElementById('modeTestRadio'),
    modeLiveRadio: document.getElementById('modeLiveRadio'),
    modeBadge: document.getElementById('modeBadge'),

    // Buttons
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    startAutomationBtn: document.getElementById('startAutomationBtn'),
    runtimeControls: document.getElementById('runtimeControls'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),

    // Status & Feedback
    connectionBadge: document.getElementById('connectionBadge'),
    connectionText: document.getElementById('connectionText'),
    tabNoticeBanner: document.getElementById('tabNoticeBanner'),
    tabNoticeText: document.getElementById('tabNoticeText'),
    feedbackBanner: document.getElementById('feedbackBanner'),
    botStateBadge: document.getElementById('botStateBadge'),
    progressText: document.getElementById('progressText'),
    currentStepText: document.getElementById('currentStepText'),
    lastErrorRow: document.getElementById('lastErrorRow'),
    lastErrorText: document.getElementById('lastErrorText'),

    // Modal
    confirmationModal: document.getElementById('confirmationModal'),
    modalTitle: document.getElementById('modalTitle'),
    summaryCount: document.getElementById('summaryCount'),
    summaryBudget: document.getElementById('summaryBudget'),
    summaryCountries: document.getElementById('summaryCountries'),
    summaryExposure: document.getElementById('summaryExposure'),
    summaryMode: document.getElementById('summaryMode'),
    cancelConfirmBtn: document.getElementById('cancelConfirmBtn'),
    proceedConfirmBtn: document.getElementById('proceedConfirmBtn')
  };

  let autoSaveTimer = null;
  let isInitialConfigLoaded = false;

  function log(message, data = null) {
    const time = new Date().toLocaleTimeString();
    if (data !== null) {
      console.log(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ${message}`, data);
    } else {
      console.log(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ${message}`);
    }
  }

  function error(message, err = null) {
    const time = new Date().toLocaleTimeString();
    if (err !== null) {
      console.error(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ❌ ${message}`, err);
    } else {
      console.error(`[TikTokAdsBot:${MODULE_NAME}] [${time}] ❌ ${message}`);
    }
  }

  /**
   * Automatically persists currently entered input configuration
   * Separates regular inputs (chrome.storage.local) and sensitive auth code (chrome.storage.session)
   */
  async function autoSaveCurrentConfig() {
    if (!window.StorageService || !isInitialConfigLoaded) return;

    const websiteUrl = (elements.websiteUrl.value || '').trim();
    const dailyBudget = (elements.dailyBudget.value || '').trim();
    const campaignCountRaw = parseInt(elements.campaignCount.value, 10);
    const campaignCount = isNaN(campaignCountRaw) || campaignCountRaw < 1 ? 1 : campaignCountRaw;
    const liveMode = elements.modeLiveRadio.checked;
    const authCode = (elements.authCode.value || '').trim();

    // Save regular configuration to chrome.storage.local (and authCode to chrome.storage.session)
    await window.StorageService.saveConfig({
      websiteUrl,
      dailyBudget,
      campaignCount,
      targetCountries: [...selectedCountries],
      liveMode,
      authCode
    });

    log('Auto-saved configuration to profile storage');
  }

  /**
   * Debounced trigger for auto-saving text inputs (350ms)
   */
  function debouncedAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveCurrentConfig();
    }, 350);
  }

  /**
   * Display feedback toast
   * @param {string} message
   * @param {'success'|'error'} type
   * @param {number} duration
   */
  function showFeedback(message, type = 'success', duration = 3500) {
    if (!elements.feedbackBanner) return;

    elements.feedbackBanner.textContent = message;
    elements.feedbackBanner.className = `feedback-banner feedback-${type}`;
    elements.feedbackBanner.classList.remove('hidden');

    if (showFeedback.timer) {
      clearTimeout(showFeedback.timer);
    }

    showFeedback.timer = setTimeout(() => {
      elements.feedbackBanner.classList.add('hidden');
    }, duration);
  }

  /**
   * Render selected countries as badges
   */
  function renderCountryBadges() {
    if (!elements.selectedCountriesList) return;

    elements.selectedCountriesList.innerHTML = '';
    selectedCountries.forEach((country, index) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `
        <span>${escapeHtml(country)}</span>
        <span class="tag-close" data-index="${index}" title="Remove country">&times;</span>
      `;
      elements.selectedCountriesList.appendChild(badge);
    });

    // Attach click handlers to close buttons
    elements.selectedCountriesList.querySelectorAll('.tag-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          selectedCountries.splice(idx, 1);
          renderCountryBadges();
          autoSaveCurrentConfig(); // Immediate auto-save on country removal
        }
      });
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Add a country from input
   */
  function handleAddCountry() {
    const val = (elements.countrySearchInput.value || '').trim();
    if (!val) return;

    // Check duplicate
    if (selectedCountries.some(c => c.toLowerCase() === val.toLowerCase())) {
      showFeedback(`"${val}" is already added.`, 'error');
      elements.countrySearchInput.value = '';
      return;
    }

    selectedCountries.push(val);
    elements.countrySearchInput.value = '';
    renderCountryBadges();
    autoSaveCurrentConfig(); // Immediate auto-save on country addition
  }

  /**
   * Toggle auth code input masking
   */
  function toggleAuthCodeVisibility() {
    if (elements.authCode.type === 'password') {
      elements.authCode.type = 'text';
      elements.toggleAuthCodeVisibility.textContent = '🔒';
    } else {
      elements.authCode.type = 'password';
      elements.toggleAuthCodeVisibility.textContent = '👁️';
    }
  }

  /**
   * Update mode badge
   * @param {boolean} [triggerAutoSave=true]
   */
  function updateModeBadge(triggerAutoSave = true) {
    const isLive = elements.modeLiveRadio.checked;
    if (isLive) {
      elements.modeBadge.textContent = 'LIVE MODE';
      elements.modeBadge.className = 'mode-pill mode-live';
    } else {
      elements.modeBadge.textContent = 'TEST MODE';
      elements.modeBadge.className = 'mode-pill mode-test';
    }

    if (triggerAutoSave && isInitialConfigLoaded) {
      autoSaveCurrentConfig();
    }
  }

  /**
   * Load saved configuration from storage
   */
  async function loadConfiguration() {
    try {
      if (!window.StorageService) return;

      const config = await window.StorageService.getConfig();
      log('Loaded configuration from storage:', {
        ...config,
        authCode: config.authCode ? '***' + config.authCode.slice(-4) : ''
      });

      // Prevent stale async reads from overwriting actively focused inputs
      if (document.activeElement !== elements.websiteUrl && config.websiteUrl !== undefined) {
        elements.websiteUrl.value = config.websiteUrl;
      }
      if (document.activeElement !== elements.dailyBudget && config.dailyBudget !== undefined) {
        elements.dailyBudget.value = config.dailyBudget;
      }
      if (document.activeElement !== elements.campaignCount && config.campaignCount !== undefined) {
        elements.campaignCount.value = config.campaignCount;
      }
      if (document.activeElement !== elements.authCode && config.authCode !== undefined) {
        elements.authCode.value = config.authCode;
      }

      if (Array.isArray(config.targetCountries) && config.targetCountries.length > 0) {
        selectedCountries = [...config.targetCountries];
      } else {
        selectedCountries = ['United States'];
      }
      renderCountryBadges();

      if (config.liveMode) {
        elements.modeLiveRadio.checked = true;
      } else {
        elements.modeTestRadio.checked = true;
      }
      updateModeBadge(false);

      isInitialConfigLoaded = true;

      const jobState = await window.StorageService.getJobState();
      updateJobStateDisplay(jobState);
    } catch (err) {
      error('Failed to load configuration:', err);
    }
  }

  /**
   * Update visual status and progress dashboard
   */
  function updateJobStateDisplay(jobState) {
    if (!jobState) return;

    const status = jobState.status || 'IDLE';
    const isTestCompleted = jobState.currentStep === 'TEST_COMPLETED' || (jobState.stepDescription && jobState.stepDescription.includes('Test completed'));

    if (isTestCompleted) {
      elements.botStateBadge.textContent = 'TEST COMPLETED';
      elements.botStateBadge.className = 'badge badge-test_completed';
    } else if (status === 'NEEDS_VERIFICATION') {
      elements.botStateBadge.textContent = 'NEEDS VERIFICATION';
      elements.botStateBadge.className = 'badge badge-needs_verification';
    } else {
      elements.botStateBadge.textContent = status;
      elements.botStateBadge.className = `badge badge-${status.toLowerCase()}`;
    }

    // Progress text
    const current = jobState.currentCampaignIndex || 0;
    const total = jobState.totalCampaigns || 0;
    const successes = jobState.successfulCampaigns || 0;

    if (isTestCompleted) {
      elements.progressText.textContent = 'Test completed — Ready to Publish';
    } else if (status === 'NEEDS_VERIFICATION') {
      elements.progressText.textContent = `Campaign ${current} needs manual verification`;
    } else if (total > 0) {
      elements.progressText.textContent = `Campaign ${current} of ${total} (${successes} submitted)`;
    } else {
      elements.progressText.textContent = `0 / 0 Completed`;
    }

    // Step text
    elements.currentStepText.textContent = jobState.stepDescription || 'Ready';

    // Errors
    if (jobState.lastError) {
      elements.lastErrorRow.classList.remove('hidden');
      elements.lastErrorText.textContent = jobState.lastError;
    } else {
      elements.lastErrorRow.classList.add('hidden');
    }

    // Toggle Runtime Controls vs Start Button
    if (status === 'RUNNING') {
      elements.startAutomationBtn.disabled = true;
      elements.runtimeControls.classList.remove('hidden');
      elements.pauseBtn.classList.remove('hidden');
      elements.resumeBtn.classList.add('hidden');
    } else if (status === 'PAUSED') {
      elements.startAutomationBtn.disabled = true;
      elements.runtimeControls.classList.remove('hidden');
      elements.pauseBtn.classList.add('hidden');
      elements.resumeBtn.classList.remove('hidden');
    } else {
      elements.startAutomationBtn.disabled = false;
      elements.runtimeControls.classList.add('hidden');
    }
  }

  /**
   * Check active TikTok tab
   */
  async function checkActiveTikTokTab() {
    elements.connectionBadge.className = 'connection-badge status-checking';
    elements.connectionText.textContent = 'Checking Tab...';

    try {
      chrome.runtime.sendMessage({ action: 'CHECK_TIKTOK_TAB' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          setTabStatus(false, 'Worker Inactive');
          return;
        }

        if (response.found) {
          if (response.isCampaignsPage) {
            setTabStatus(true, 'Campaigns Page Ready');
          } else {
            setTabStatus(true, 'TikTok Ads Tab Found');
          }
        } else {
          setTabStatus(false, 'Not on TikTok Ads');
        }
      });
    } catch (err) {
      setTabStatus(false, 'Detection Error');
    }
  }

  function setTabStatus(isConnected, text) {
    elements.connectionText.textContent = text;
    if (isConnected) {
      elements.connectionBadge.className = 'connection-badge status-connected';
      elements.tabNoticeBanner.classList.add('hidden');
    } else {
      elements.connectionBadge.className = 'connection-badge status-disconnected';
      elements.tabNoticeBanner.classList.remove('hidden');
    }
  }

  /**
   * Validate user input fields
   */
  function validateInputs() {
    const websiteUrl = elements.websiteUrl.value.trim();
    const dailyBudget = elements.dailyBudget.value.trim();
    const campaignCount = elements.campaignCount.value.trim();
    const authCode = elements.authCode.value.trim();
    const liveMode = elements.modeLiveRadio.checked;

    [elements.websiteUrl, elements.dailyBudget, elements.campaignCount, elements.authCode]
      .forEach(inp => inp.classList.remove('is-invalid'));

    // 1. Website URL
    if (!websiteUrl) {
      elements.websiteUrl.classList.add('is-invalid');
      return { isValid: false, error: 'Please enter a Website URL.' };
    }
    try {
      const url = new URL(websiteUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        elements.websiteUrl.classList.add('is-invalid');
        return { isValid: false, error: 'Website URL must begin with http:// or https://' };
      }
    } catch {
      elements.websiteUrl.classList.add('is-invalid');
      return { isValid: false, error: 'Please enter a valid Website URL.' };
    }

    // 2. Budget
    const budgetNum = Number(dailyBudget);
    if (!dailyBudget || isNaN(budgetNum) || budgetNum <= 0) {
      elements.dailyBudget.classList.add('is-invalid');
      return { isValid: false, error: 'Please enter a valid daily budget greater than 0.' };
    }
    if (budgetNum < 20) {
      elements.dailyBudget.classList.add('is-invalid');
      return { isValid: false, error: 'TikTok minimum daily budget is usually $20.00 USD.' };
    }

    // 3. Campaign Count
    const countNum = parseInt(campaignCount, 10);
    if (!campaignCount || isNaN(countNum) || countNum < 1 || countNum > 100) {
      elements.campaignCount.classList.add('is-invalid');
      return { isValid: false, error: 'Campaigns count must be between 1 and 100.' };
    }

    // 4. Target Countries
    if (!selectedCountries || selectedCountries.length === 0) {
      return { isValid: false, error: 'Please add at least one Target Country.' };
    }

    // 5. Auth Code
    if (!authCode) {
      elements.authCode.classList.add('is-invalid');
      return { isValid: false, error: 'Please enter the TikTok Spark Ads Post Authorization Code.' };
    }

    return {
      isValid: true,
      values: {
        websiteUrl,
        dailyBudget: budgetNum.toFixed(2),
        campaignCount: countNum,
        targetCountries: [...selectedCountries],
        authCode,
        liveMode
      }
    };
  }

  /**
   * Save configuration
   */
  async function handleSaveConfig(e) {
    if (e) e.preventDefault();

    const validation = validateInputs();
    if (!validation.isValid) {
      showFeedback(validation.error, 'error');
      return false;
    }

    try {
      elements.saveConfigBtn.disabled = true;
      const success = await window.StorageService.saveConfig(validation.values);

      if (success) {
        log('Configuration saved successfully.');
        showFeedback('Configuration saved to local profile storage.', 'success');
        return true;
      } else {
        showFeedback('Failed to save configuration.', 'error');
        return false;
      }
    } catch (err) {
      error('Error saving config:', err);
      showFeedback('Storage error occurred.', 'error');
      return false;
    } finally {
      elements.saveConfigBtn.disabled = false;
    }
  }

  /**
   * Start Automation Button Handler
   */
  async function handleStartAutomation() {
    console.log('[POPUP] Start button clicked');

    // Prevent duplicate start if already running
    const currentJob = await window.StorageService?.getJobState();
    if (currentJob && currentJob.status === 'RUNNING') {
      showFeedback('Automation is already running in TikTok tab.', 'error');
      return;
    }

    const validation = validateInputs();
    if (!validation.isValid) {
      showFeedback(validation.error, 'error');
      return;
    }

    console.log('[POPUP] Configuration validated');

    // Auto-save configuration immediately
    await autoSaveCurrentConfig();

    const values = validation.values;
    const totalExposure = (Number(values.dailyBudget) * Number(values.campaignCount)).toFixed(2);

    // Populate modal summary & adapt title
    if (elements.modalTitle) {
      elements.modalTitle.textContent = values.liveMode
        ? 'Confirm Live Campaign Creation'
        : 'Confirm Campaign Automation (Test Mode)';
    }
    elements.summaryCount.textContent = values.campaignCount;
    elements.summaryBudget.textContent = `$${values.dailyBudget}`;
    elements.summaryCountries.textContent = values.targetCountries.join(', ');
    elements.summaryExposure.textContent = `$${totalExposure} / day`;
    elements.summaryMode.textContent = values.liveMode ? 'LIVE MODE (Publishing Enabled)' : 'TEST MODE (Safe: No Publish)';
    elements.summaryMode.className = values.liveMode ? 'text-danger' : 'text-accent';

    // Show Confirmation Modal
    elements.confirmationModal.classList.remove('hidden');
  }

  /**
   * Confirmed start execution from modal
   */
  function handleProceedConfirmed() {
    console.log('[POPUP] Confirmation accepted');
    elements.confirmationModal.classList.add('hidden');

    const validation = validateInputs();
    if (!validation.isValid) {
      showFeedback(validation.error, 'error');
      return;
    }

    // Disable start button to prevent duplicate clicks
    elements.startAutomationBtn.disabled = true;
    showFeedback('Connecting to TikTok Ads Manager...', 'success');

    log('Dispatching START_AUTOMATION message...');

    // Forward START_AUTOMATION to background worker
    chrome.runtime.sendMessage({
      action: 'START_AUTOMATION',
      config: validation.values
    }, async (response) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        error('Background messaging error:', err);
        showFeedback(`Connection error: ${err}`, 'error', 5000);
        elements.startAutomationBtn.disabled = false;
        return;
      }

      if (!response || !response.success) {
        const errMsg = response?.error || 'Could not start automation';
        error('Start automation failed:', errMsg);
        showFeedback(`Failed to start: ${errMsg}`, 'error', 5000);
        elements.startAutomationBtn.disabled = false;
        return;
      }

      log('Automation acknowledged by runner:', response);
      showFeedback('Automation running on TikTok Ads Manager!', 'success');

      // Update status immediately from storage or response
      const updatedJobState = await window.StorageService?.getJobState();
      if (updatedJobState) {
        updateJobStateDisplay(updatedJobState);
      } else {
        updateJobStateDisplay({
          status: 'RUNNING',
          currentCampaignIndex: 1,
          totalCampaigns: validation.values.campaignCount,
          stepDescription: 'Starting Campaign 1...'
        });
      }
    });
  }

  function handleCancelConfirm() {
    elements.confirmationModal.classList.add('hidden');
  }

  /**
   * Runtime Controls
   */
  function handlePause() {
    chrome.runtime.sendMessage({ action: 'PAUSE_AUTOMATION' }, () => {
      showFeedback('Pause requested...', 'success');
    });
  }

  function handleResume() {
    chrome.runtime.sendMessage({ action: 'RESUME_AUTOMATION' }, () => {
      showFeedback('Resuming automation...', 'success');
    });
  }

  function handleStop() {
    chrome.runtime.sendMessage({ action: 'STOP_AUTOMATION' }, () => {
      showFeedback('Automation stopped.', 'error');
    });
  }

  /**
   * Initialize popup controllers
   */
  async function init() {
    log('Popup opened. Initializing...');

    // Event listeners
    elements.form.addEventListener('submit', handleSaveConfig);
    elements.saveConfigBtn.addEventListener('click', handleSaveConfig);
    elements.startAutomationBtn.addEventListener('click', handleStartAutomation);

    // Auto-save input changes
    elements.websiteUrl.addEventListener('input', debouncedAutoSave);
    elements.dailyBudget.addEventListener('input', debouncedAutoSave);
    elements.campaignCount.addEventListener('input', debouncedAutoSave);
    elements.authCode.addEventListener('input', debouncedAutoSave);

    elements.addCountryBtn.addEventListener('click', handleAddCountry);
    elements.countrySearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddCountry();
      }
    });

    elements.toggleAuthCodeVisibility.addEventListener('click', toggleAuthCodeVisibility);

    elements.modeTestRadio.addEventListener('change', () => updateModeBadge(true));
    elements.modeLiveRadio.addEventListener('change', () => updateModeBadge(true));

    elements.cancelConfirmBtn.addEventListener('click', handleCancelConfirm);
    elements.proceedConfirmBtn.addEventListener('click', handleProceedConfirmed);

    elements.pauseBtn.addEventListener('click', handlePause);
    elements.resumeBtn.addEventListener('click', handleResume);
    elements.stopBtn.addEventListener('click', handleStop);

    // Load data
    await loadConfiguration();
    await checkActiveTikTokTab();

    // Listen to real-time storage updates
    if (window.StorageService?.onChanged) {
      window.StorageService.onChanged((changes) => {
        if (changes[window.StorageService.KEYS.JOB_STATE]) {
          updateJobStateDisplay(changes[window.StorageService.KEYS.JOB_STATE].newValue);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
