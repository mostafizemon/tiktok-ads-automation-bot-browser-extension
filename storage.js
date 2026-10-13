/**
 * storage.js
 * Centralized Chrome Storage Local persistence layer for TikTok Ads Automation Bot.
 * Compatible with Background Service Worker, Content Scripts, and Popup context.
 */

(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    CONFIG: 'tiktok_ads_config',
    JOB_STATE: 'tiktok_ads_job_state',
    LOGS: 'tiktok_ads_logs'
  };

  const SESSION_KEYS = {
    AUTH_CODE: 'tiktok_ads_session_auth_code'
  };

  const DEFAULT_CONFIG = {
    websiteUrl: '',
    dailyBudget: '50.00',
    targetCountries: ['United States'],
    authCode: '',
    campaignCount: 1,
    liveMode: false, // Default to Test Mode for safety
    callToAction: '' // Default CTA - required field
  };

  const DEFAULT_JOB_STATE = {
    runId: null,
    status: 'IDLE', // 'IDLE' | 'PREFLIGHT' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'FAILED' | 'NEEDS_ATTENTION' | 'NEEDS_VERIFICATION'
    currentCampaignIndex: 0,
    totalCampaigns: 0,
    successfulCampaigns: 0,
    failedCampaigns: 0,
    currentStep: 'IDLE',
    stepDescription: 'Idle - Ready for configuration',
    lastError: null,
    startedAt: null,
    updatedAt: null,
    liveMode: false,
    campaignResults: [],
    knownCampaignIds: [],
    knownCampaignNames: [],
    expectedCampaignName: null,
    advertiserId: null,
    submissionStatus: 'NONE', // 'NONE' | 'SUBMISSION_PENDING' | 'SUBMITTED' | 'FAILED' | 'NEEDS_VERIFICATION'
    submissionEvidence: null,
    refreshCheckpoint: 'NONE', // 'NONE' | 'REFRESH_IN_PROGRESS' | 'REFRESH_COMPLETED'
    lastPublishClickTime: null,
    addPostAttemptCount: 0,
    addPostRunId: null,
    addPostCampaignIndex: null,
    addPostPhase: 'READY'
  };

  const StorageService = {
    KEYS: STORAGE_KEYS,
    SESSION_KEYS,
    DEFAULT_CONFIG,
    DEFAULT_JOB_STATE,

    /**
     * Get sensitive Spark Ads auth code from session storage (fallback to local if session unavailable)
     * @returns {Promise<string>}
     */
    async getSessionAuthCode() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
          chrome.storage.session.get([SESSION_KEYS.AUTH_CODE], (res) => {
            if (chrome.runtime.lastError) {
              resolve('');
              return;
            }
            resolve(res?.[SESSION_KEYS.AUTH_CODE] || '');
          });
        } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([SESSION_KEYS.AUTH_CODE], (res) => {
            resolve(res?.[SESSION_KEYS.AUTH_CODE] || '');
          });
        } else {
          resolve('');
        }
      });
    },

    /**
     * Save sensitive Spark Ads auth code to session storage
     * @param {string} code
     * @returns {Promise<boolean>}
     */
    async saveSessionAuthCode(code) {
      const trimmed = (code || '').trim();
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
          chrome.storage.session.set({ [SESSION_KEYS.AUTH_CODE]: trimmed }, () => {
            resolve(!chrome.runtime.lastError);
          });
        } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [SESSION_KEYS.AUTH_CODE]: trimmed }, () => {
            resolve(!chrome.runtime.lastError);
          });
        } else {
          resolve(false);
        }
      });
    },

    /**
     * Check if the Chrome extension runtime context is valid
     * @returns {boolean}
     */
    isContextValid() {
      try {
        return typeof chrome !== 'undefined' &&
               !!chrome.runtime &&
               !!chrome.runtime.id;
      } catch (e) {
        return false;
      }
    },

    /**
     * Get stored configuration or fallback to defaults
     * Normalizes targetCountries to array
     * @returns {Promise<typeof DEFAULT_CONFIG>}
     */
    async getConfig() {
      if (!this.isContextValid()) {
        console.warn('[TikTokAdsBot:Storage] Extension context invalidated. Returning default configuration.');
        return { ...DEFAULT_CONFIG };
      }

      const sessionAuth = await this.getSessionAuthCode();

      return new Promise((resolve) => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.CONFIG], (result) => {
            if (chrome.runtime?.lastError) {
              console.error('[TikTokAdsBot:Storage] Error loading config:', chrome.runtime.lastError);
              resolve({ ...DEFAULT_CONFIG, authCode: sessionAuth || DEFAULT_CONFIG.authCode });
              return;
            }
            const raw = result?.[STORAGE_KEYS.CONFIG] || {};
            let targetCountries = raw.targetCountries;
            if (!Array.isArray(targetCountries)) {
              if (raw.targetCountry && typeof raw.targetCountry === 'string') {
                targetCountries = [raw.targetCountry.trim()];
              } else {
                targetCountries = [...DEFAULT_CONFIG.targetCountries];
              }
            }

            // Prioritize sessionAuth if present, else fallback to raw.authCode
            const authCode = sessionAuth || raw.authCode || '';

            resolve({
              ...DEFAULT_CONFIG,
              ...raw,
              authCode,
              targetCountries
            });
          });
        } catch (err) {
          console.warn('[TikTokAdsBot:Storage] Failed reading config (context invalidated):', err);
          resolve({ ...DEFAULT_CONFIG, authCode: sessionAuth || DEFAULT_CONFIG.authCode });
        }
      });
    },

    /**
     * Save configuration
     * @param {Partial<typeof DEFAULT_CONFIG>} config
     * @returns {Promise<boolean>}
     */
    async saveConfig(config) {
      if (!this.isContextValid()) {
        console.warn('[TikTokAdsBot:Storage] Extension context invalidated. Cannot save config.');
        return false;
      }

      if (config.authCode !== undefined) {
        await this.saveSessionAuthCode(config.authCode);
      }

      const current = await this.getConfig();
      let targetCountries = config.targetCountries;
      if (!Array.isArray(targetCountries)) {
        if (config.targetCountry && typeof config.targetCountry === 'string') {
          targetCountries = [config.targetCountry.trim()];
        } else {
          targetCountries = current.targetCountries;
        }
      }

      const mergedConfig = {
        ...current,
        ...config,
        targetCountries
      };

      return new Promise((resolve) => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: mergedConfig }, () => {
            if (chrome.runtime?.lastError) {
              console.error('[TikTokAdsBot:Storage] Error saving config:', chrome.runtime.lastError);
              resolve(false);
              return;
            }
            // Mask authCode in console output
            const safeLog = {
              ...mergedConfig,
              authCode: mergedConfig.authCode ? '***' + mergedConfig.authCode.slice(-4) : ''
            };
            console.log('[TikTokAdsBot:Storage] Configuration persisted:', safeLog);
            resolve(true);
          });
        } catch (err) {
          console.warn('[TikTokAdsBot:Storage] Failed saving config (context invalidated):', err);
          resolve(false);
        }
      });
    },

    /**
     * Get current job state or fallback to default
     * @returns {Promise<typeof DEFAULT_JOB_STATE>}
     */
    async getJobState() {
      if (!this.isContextValid()) {
        console.warn('[TikTokAdsBot:Storage] Extension context invalidated. Returning default job state.');
        return { ...DEFAULT_JOB_STATE };
      }

      return new Promise((resolve) => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.JOB_STATE], (result) => {
            if (chrome.runtime?.lastError) {
              console.error('[TikTokAdsBot:Storage] Error loading job state:', chrome.runtime.lastError);
              resolve({ ...DEFAULT_JOB_STATE });
              return;
            }
            resolve({ ...DEFAULT_JOB_STATE, ...(result?.[STORAGE_KEYS.JOB_STATE] || {}) });
          });
        } catch (err) {
          console.warn('[TikTokAdsBot:Storage] Failed reading job state (context invalidated):', err);
          resolve({ ...DEFAULT_JOB_STATE });
        }
      });
    },

    /**
     * Save whole job state
     * @param {typeof DEFAULT_JOB_STATE} jobState
     * @returns {Promise<boolean>}
     */
    async saveJobState(jobState) {
      if (!this.isContextValid()) {
        console.warn('[TikTokAdsBot:Storage] Extension context invalidated. Cannot save job state.');
        return false;
      }

      const stateToSave = {
        ...DEFAULT_JOB_STATE,
        ...jobState,
        updatedAt: new Date().toISOString()
      };
      return new Promise((resolve) => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.JOB_STATE]: stateToSave }, () => {
            if (chrome.runtime?.lastError) {
              console.error('[TikTokAdsBot:Storage] Error saving job state:', chrome.runtime.lastError);
              resolve(false);
              return;
            }
            resolve(true);
          });
        } catch (err) {
          console.warn('[TikTokAdsBot:Storage] Failed saving job state (context invalidated):', err);
          resolve(false);
        }
      });
    },

    /**
     * Update partial job state
     * @param {Partial<typeof DEFAULT_JOB_STATE>} partialState
     * @returns {Promise<typeof DEFAULT_JOB_STATE>}
     */
    async updateJobState(partialState) {
      if (!this.isContextValid()) {
        console.warn('[TikTokAdsBot:Storage] Extension context invalidated. Cannot update job state.');
        return { ...DEFAULT_JOB_STATE, ...partialState };
      }

      const currentState = await this.getJobState();
      const updatedState = {
        ...currentState,
        ...partialState,
        updatedAt: new Date().toISOString()
      };
      await this.saveJobState(updatedState);
      return updatedState;
    },

    /**
     * Reset job state to default IDLE
     * @returns {Promise<typeof DEFAULT_JOB_STATE>}
     */
    async resetJobState() {
      await this.saveJobState(DEFAULT_JOB_STATE);
      return { ...DEFAULT_JOB_STATE };
    },

    /**
     * Append a log entry to chrome.storage.local
     * Sanitizes sensitive fields like raw authorization codes
     * @param {'INFO' | 'WARN' | 'ERROR' | 'DEBUG'} level
     * @param {string} message
     * @param {any} [meta]
     */
    async addLog(level, message, meta = null) {
      let sanitizedMeta = meta;
      if (meta && typeof meta === 'object') {
        sanitizedMeta = { ...meta };
        if (sanitizedMeta.authCode) {
          sanitizedMeta.authCode = '***' + String(sanitizedMeta.authCode).slice(-4);
        }
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        meta: sanitizedMeta
      };

      return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.LOGS], (result) => {
          const logs = result[STORAGE_KEYS.LOGS] || [];
          logs.unshift(logEntry);
          // Keep the last 150 log entries to prevent storage bloat
          const trimmedLogs = logs.slice(0, 150);

          chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: trimmedLogs }, () => {
            resolve(logEntry);
          });
        });
      });
    },

    /**
     * Get recent logs
     * @param {number} [limit=50]
     * @returns {Promise<Array<object>>}
     */
    async getLogs(limit = 50) {
      return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.LOGS], (result) => {
          const logs = result[STORAGE_KEYS.LOGS] || [];
          resolve(logs.slice(0, limit));
        });
      });
    },

    /**
     * Clear all persisted logs
     * @returns {Promise<boolean>}
     */
    async clearLogs() {
      return new Promise((resolve) => {
        chrome.storage.local.remove([STORAGE_KEYS.LOGS], () => {
          resolve(true);
        });
      });
    },

    /**
     * Subscribe to changes in chrome.storage.local
     * @param {Function} callback (changes, areaName) => void
     */
    onChanged(callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            callback(changes);
          }
        });
      }
    }
  };

  // Expose globally
  global.StorageService = StorageService;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageService;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
