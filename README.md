# TikTok Ads Automation Bot

A production-quality Chrome Extension (Manifest V3) built for automated campaign creation inside GoLogin's Orbita Chromium browser on TikTok Ads Manager (`https://ads.tiktok.com/*`).

---

## 🌟 Project Overview

TikTok Ads Automation Bot automates repetitive campaign creation workflows on TikTok Ads Manager. It operates directly within an existing logged-in session in GoLogin / Orbita browser profiles without external databases, servers, or credential transmission.

### Key Architectural Features
- **Manifest V3 Compliant:** Pure ES6+ modular architecture using modern background service worker and restricted host permissions (`https://ads.tiktok.com/*`).
- **Open Shadow DOM Traversal:** Pierces open shadow roots in TikTok's web components (such as `<ks-button-923>` and `<ks-tag-923>`) to locate and click actual inner elements.
- **Verified Tree Country Selection:** Targets TikTok's actual location tree selectors (`[role="treeitem"]` $\rightarrow$ `[role="checkbox"]` with `aria-checked` check), retaining requested default tags and pruning unrequested countries.
- **Sequential Multi-Campaign Loop:** Creates $N$ campaigns in sequence ($1 \rightarrow 2 \rightarrow \dots \rightarrow N$). Upon each confirmed submission in Live Mode, returns to `/manage/campaign`, refreshes once, and starts the next campaign.
- **Strict Submission Verification:** A redirect alone never counts as success. Requires explicit TikTok confirmation indicators (success modal, toast, or campaign ID). Ambiguous outcomes halt with `NEEDS_VERIFICATION` without duplicating campaigns.
- **Reliable Test Mode:** Executes every setup step (Traffic, Budget, Demographics, Website URL, Creative Assets, Spark Ads post authorization, Confirm drawer) and halts immediately before "Publish all", displaying **"Test completed — Ready to Publish"** without publishing or looping.
- **Page Reload & Navigation Resilience:** Uses persistent checkpoints in `chrome.storage.local`. If a page reloads or navigates, the content script automatically detects the checkpoint and resumes execution seamlessly.
- **Immediate Pause / Stop Responsiveness:** Wait loops and polling are abort-aware; clicking Pause or Stop interrupts execution in milliseconds rather than waiting for timeouts.
- **Closing Popup Independence:** The automation executes inside the TikTok tab via content script and service worker; closing the extension popup does not interrupt running bots.
- **Profile Isolation:** Dedicated execution in each GoLogin browser profile with zero cross-talk between profiles.
- **Safe Popup Detection:** Continuous `MutationObserver` monitors modals, safely dismissing verified informational overlays while strictly protecting workflow dialogs (Custom Mode Stay/Exit, Spark Ads auth, Publish confirmation). Pauses automatically on security/CAPTCHA challenges.

---

## 📂 Project Structure

```text
tiktok-ads-automation-bot/
├── manifest.json              # Extension Manifest V3 configuration
├── popup.html                 # Modern dark theme popup UI
├── popup.css                  # Stylesheet with country tags, mode toggles, and modal
├── popup.js                   # Popup controller: validation, tagging, storage sync, controls
├── background.js              # Service worker router & tab coordinator
├── content.js                 # Injected content script for ads.tiktok.com
├── storage.js                 # Shared persistence layer (chrome.storage.local)
├── automation/
│   ├── helpers.js             # Utilities (sleep, queryShadow, safeClick, diagnostic logging)
│   ├── popup-handler.js       # MutationObserver with dialog classification & allowlist
│   ├── custom-mode.js         # Handler for simplified vs custom mode dialogs & Stay/Exit modal
│   ├── campaign.js            # End-to-end campaign creation pipeline (Steps 1-12)
│   └── runner.js              # Sequential loop orchestrator & checkpoint state machine
├── icons/
│   ├── icon16.png             # Extension toolbar icon (16x16)
│   ├── icon48.png             # Extension management icon (48x48)
│   └── icon128.png            # High-resolution icon (128x128)
└── README.md                  # Project documentation & operational manual
```

---

## 🎯 Verified Real TikTok DOM Elements

| Workflow Step | Element / Target | Implementation & Selector |
| :--- | :--- | :--- |
| **1. Create Button** | `<ks-button-923>` ("Create") | `ks-button-923` pierced to inner `<button part="base">` matching text "Create" |
| **2. Custom Mode** | "Switch to custom mode" | Text-based search + scoped dialog handling clicking "Exit" on Stay/Exit confirmation |
| **3. Traffic Objective** | `<span class="index_title_Nvlf1">Traffic</span>` | Targeted click on container card + verifies selection |
| **4. Campaign Budget** | `<div>Campaign budget</div>` + `<input part="input">` | Checks toggle state before clicking (prevents disable), sets value via native descriptor |
| **5. Demographics** | `<span id="section_dom_id_targetingDemographics">` | Inspects `data-lego-collapse-aria-expanded` and expands if collapsed |
| **6. Location Container** | `#fieldRenderer-particleLocations` | Parent container for location targeting |
| **7. Location Dropdown** | `[data-testid="lego-antd-select"]` | Trigger for location search dropdown |
| **8. Country Search Input**| `input[data-testid="lego-antd-select-popover-content-input"]` | Search input field for typing exact country names |
| **9. Country Tree Item** | `[role="treeitem"]` | Contains `[data-testid="lego-antd-tree-title"]` with exact country name |
| **10. Country Checkbox** | `[role="checkbox"]` inside tree item | Inspected for `aria-checked="true"`; clicked only if `false`, waits for `true` |
| **11. Country Tags** | `<ks-tag-923 data-testid="lego-tag-list-tag">` | Verified final tags; unrequested tags removed via shadow `[part="closeIcon"]` |
| **12. Website URL** | `textarea[data-testid="ks-text-field-index-aZM5M2"]` | Fills landing page URL using native descriptor and dispatches synthetic events |
| **13. Creative Assets Add**| `ks-button-923[data-testid="image-list-add-button-8fEZK3"]` | Pierces shadowRoot to click inner button "Add" (avoids "Create new videos") |
| **14. TikTok Posts Tab** | `<p class="tab-item-text vi-tooltip">TikTok posts</p>` | Finds tab matching exact text "TikTok posts" and clicks |
| **15. Add Post Button** | `button[data-testid="tab-mixed-post-tab-mixed-post-kQtpVD"]` | Clicks "Add post" button in TikTok posts panel |
| **16. Auth Code Input** | `textarea[data-testid="multiple-input-to-tag-index-wSVv3f"]` | Injects Spark Ads authorization code (masked in logs) |
| **17. Batch Authorize** | `button[data-testid="native-batch-authorize-index-wZkvDo"]` | Clicks Continue on batch authorization modal |
| **18. Add Posts Confirm** | `button[data-testid="native-batch-authorize-index-qXWhEZ"]` | Clicks "Add TikTok posts" |
| **19. Drawer Confirm** | `button[data-testid="hybrid-drawer-footer-submit-button"]` | Verifies post and clicks Confirm in drawer footer |
| **20. Publish All** | `ks-button-923[data-testid="common_next_button"]` | Pierces shadowRoot to inner `<button part="base">` matching text "Publish all" |
| **21. Tutorial Popup** | `.modal` ("Got it" + "Take a tour") | `[part="closeIcon"][data-testid="ks-modal-index-qPKzsp"]` -> shadowRoot `button[part="base"]` |

---

## 🚀 How to Load the Extension in GoLogin / Orbita

1. Launch your target **GoLogin browser profile** (Orbita Chromium).
2. In the browser address bar, navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left toolbar.
5. Select the project directory:
   `/Users/mostafizemon/Project/tiktok-ads-automation-bot`
6. Pin **TikTok Ads Automation Bot** to your browser toolbar.

---

## 🧪 Manual Testing Procedure

### Preflight Setup:
1. In your GoLogin profile, navigate to:
   `https://ads.tiktok.com/i18n/manage/campaign`
2. Ensure you are logged into your TikTok Ads account and the Campaigns dashboard is visible.
3. Click the **TikTok Ads Automation Bot** icon in the toolbar.
4. The live badge will display `Campaigns Page Ready` (green).

### Test Mode Execution (Recommended Initial Verification):
1. In the extension popup, enter:
   - **Website URL:** e.g. `https://example.com/promo`
   - **Daily Budget:** `50.00`
   - **Campaigns:** `1`
   - **Target Countries:** Add `United States` and `Bangladesh`
   - **Spark Ads Auth Code:** Paste valid post authorization code
2. Keep **Test Mode** selected (default).
3. Click **Start Automation**.
4. Confirm details in the summary modal.
5. Observe the automated execution:
   - Clicks Create.
   - Handles Custom Mode if prompted.
   - Selects Traffic objective and sets budget to $50.00.
   - Expands Demographics, searches and verifies checkboxes for United States and Bangladesh in `[role="treeitem"]`.
   - Populates Website URL.
   - Opens Creative Assets drawer $\rightarrow$ TikTok posts $\rightarrow$ Inputs code $\rightarrow$ Confirms post.
   - Halts immediately before clicking "Publish all".
   - Status updates to **"Test completed — Ready to Publish"**.
   - No campaigns are published, and no loop is triggered.
