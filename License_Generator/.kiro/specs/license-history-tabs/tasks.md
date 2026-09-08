# Implementation Plan: License History Tabs

## Overview

Transform the License Generator PWA from a vertically-stacked card layout into a tab-based single-page interface with three panels (Generate, History, Manage Apps) and a persistent license history system. All changes are within the existing vanilla HTML/CSS/JS architecture — no new files, no build tools.

## Tasks

- [x] 1. Tab navigation HTML structure
  - [x] 1.1 Add tab bar and ARIA attributes to index.html
    - Add a `<div class="tab-bar" role="tablist" aria-label="Main Navigation">` before existing content
    - Create three `<button role="tab">` elements: "Generate" (active by default), "History", "Manage Apps"
    - Set `aria-selected`, `aria-controls`, `tabindex`, and `id` attributes per WAI-ARIA tabs pattern
    - Wrap existing body content in a `<div class="tab-panels">` container
    - _Requirements: 1.1, 1.4, 1.6_

- [x] 2. Migrate existing card content into tab panels
  - [x] 2.1 Restructure index.html to use tab panels
    - Replace `<div class="card">` wrapper with `<div class="tab-panel active" role="tabpanel" id="panel-generate" aria-labelledby="tab-generate">`
    - Replace `<div class="card manage-card">` with `<div class="tab-panel" role="tabpanel" id="panel-manage" aria-labelledby="tab-manage" hidden>`
    - Add empty `<div class="tab-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden>` between Generate and Manage panels
    - Move `.title` and `.subtitle` elements into `panel-generate` to serve as the panel header
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 3. Tab navigation CSS
  - [x] 3.1 Add tab bar and tab panel styles to styles.css
    - Add `.tab-bar` styles: `position: fixed`, `top: 0`, `left: 0`, `right: 0`, `z-index: 100`, flex layout, dark background (#2d2d2d), bottom border
    - Add `.tab` button styles: `flex: 1`, `min-height: 44px`, `min-width: 44px`, transparent border-bottom 3px, color #9e9e9e, ellipsis overflow
    - Add `.tab.active` styles: color #64b5f6, border-bottom-color #64b5f6
    - Add `.tab:focus-visible` outline style
    - Add `.tab-panel` styles inheriting card padding/background/border-radius
    - Add `.tab-panel[hidden]` to ensure `display: none`
    - Add `body` padding-top to account for fixed tab bar height
    - Remove old `.card` centering from body (no longer flex center)
    - _Requirements: 1.3, 1.5, 6.2_

- [x] 4. Tab switching JS logic and keyboard navigation
  - [x] 4.1 Implement tab controller in app.js
    - Add `_switchTab(tabId)` function: sets `aria-selected`, toggles `.active` class, manages `tabindex`, shows/hides panels via `hidden` attribute
    - Add `_handleTabKeydown(e)` function: ArrowLeft/ArrowRight moves focus (wrapping), Enter/Space activates focused tab
    - Add `_initTabs()` function: attaches click and keydown listeners to all `[role="tab"]` elements
    - Call `_initTabs()` at the end of the IIFE
    - When switching to History tab, call `_renderHistory()` to refresh display
    - _Requirements: 1.2, 1.4, 1.6_

  - [ ]* 4.2 Write property test for tab activation invariant
    - **Property 1: Tab Activation Invariant**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 4.3 Write property test for keyboard navigation correctness
    - **Property 2: Keyboard Navigation Correctness**
    - **Validates: Requirements 1.6**

- [x] 5. History manager functions
  - [x] 5.1 Implement history manager in app.js
    - Add `HISTORY_KEY = 'license_gen_history'` and `MAX_HISTORY = 500` constants
    - Implement `_loadHistory()`: parses localStorage, returns array (empty array on parse error)
    - Implement `_saveHistory(history)`: wraps `localStorage.setItem` in try/catch, returns boolean
    - Implement `_addHistoryEntry(appName, userName, licenseKey)`: creates entry with ISO 8601 timestamp, enforces 500 cap (removes oldest), calls `_saveHistory`, returns success boolean
    - Implement `_deleteHistoryEntry(index)`: removes entry at index, saves, returns boolean
    - Implement `_clearAppHistory(appName)`: filters out all entries for appName, saves, returns boolean
    - Implement `_getGroupedHistory()`: groups by appName, sorts groups alphabetically (case-insensitive), sorts entries newest-first within each group
    - Implement `_formatDate(isoString)`: converts to "DD MMM YYYY" format
    - Implement `_truncateKey(key)`: returns first 20 chars + "…" or full key if ≤20 chars
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.2, 3.4_

  - [ ]* 5.2 Write property test for history entry completeness
    - **Property 3: History Entry Completeness**
    - **Validates: Requirements 2.1, 2.4**

  - [ ]* 5.3 Write property test for history capacity invariant
    - **Property 4: History Capacity Invariant**
    - **Validates: Requirements 2.6**

  - [ ]* 5.4 Write property test for grouping alphabetical order
    - **Property 5: History Grouping Alphabetical Order**
    - **Validates: Requirements 3.1**

  - [ ]* 5.5 Write property test for reverse chronological order within groups
    - **Property 7: Reverse Chronological Order Within Groups**
    - **Validates: Requirements 3.4**

- [x] 6. Checkpoint - Ensure tab switching and history manager work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. History panel HTML
  - [x] 7.1 Add history panel markup to index.html
    - Inside `#panel-history`, add empty state `<div class="history-empty">` with message "No licenses have been generated yet." and hint text
    - Add `<div class="history-list">` container where grouped entries will be rendered by JS
    - _Requirements: 3.3_

- [x] 8. History renderer JS
  - [x] 8.1 Implement history renderer in app.js
    - Implement `_renderHistory()`: calls `_getGroupedHistory()`, builds DOM. Shows empty state if no entries, otherwise renders app groups
    - Implement `_renderAppGroup(appName, entries)`: creates group container with app name heading and "Clear All" button, renders each entry
    - Implement `_renderHistoryEntry(entry, idx)`: creates collapsed entry DOM with user name, truncated key preview, formatted date; attaches click for expand/collapse
    - Implement `_toggleEntry(entryEl)`: toggles between collapsed/expanded states; expanded state shows full key textarea + Copy and Delete buttons
    - Implement `_copyFromHistory(licenseKey, btn)`: uses Clipboard API, shows "Copied!" feedback for 2s on success, shows "Copy failed" on error
    - Implement `_deleteFromHistory(index)`: shows confirm dialog, on confirm calls `_deleteHistoryEntry(index)` and re-renders
    - Implement `_clearAllForApp(appName)`: shows confirm dialog, on confirm calls `_clearAppHistory(appName)` and re-renders
    - Implement `_showToast(message, type)`: creates temporary toast element, auto-removes after 2-3s
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 8.2 Write property test for entry display format
    - **Property 6: History Entry Display Format**
    - **Validates: Requirements 3.2**

  - [ ]* 8.3 Write property test for expand/collapse toggle round-trip
    - **Property 8: Expand/Collapse Toggle Round-Trip**
    - **Validates: Requirements 3.5, 3.6**

  - [ ]* 8.4 Write property test for deletion removes entry from storage
    - **Property 9: Deletion Removes Entry from Storage**
    - **Validates: Requirements 4.3, 4.7**

  - [ ]* 8.5 Write property test for copy places exact key on clipboard
    - **Property 10: Copy Places Exact Key on Clipboard**
    - **Validates: Requirements 5.2**

- [x] 9. History panel CSS
  - [x] 9.1 Add history panel styles to styles.css
    - Style `.history-empty` with centered text, muted color, padding
    - Style `.history-empty-hint` with smaller font, lighter color
    - Style `.history-group` with section separators, group heading (app name), "Clear All" button
    - Style `.history-entry` with bottom border, padding, cursor pointer
    - Style `.entry-summary` as flex row with user name, key preview (monospace, truncated), date
    - Style `.entry-details` with padding-top, textarea for full key, action buttons row
    - Style `.btn-copy` and `.btn-delete` inline action buttons
    - Style `.toast` and `.toast-success` / `.toast-error` with fixed bottom positioning, auto-fade
    - _Requirements: 3.2, 3.3, 3.5, 4.1, 5.1, 5.3_

- [x] 10. Integration: hook into existing generate flow
  - [x] 10.1 Add history save call to generate button handler in app.js
    - After `licenseOutput.value = key` line, add call to `_addHistoryEntry(selectedApp.name, name, key)`
    - If `_addHistoryEntry` returns false, call `_showToast('⚠️ History entry could not be saved.', 'error')`
    - Ensure the generated license key is still displayed regardless of history save outcome
    - _Requirements: 2.1, 2.3, 2.5_

- [x] 11. Responsive CSS
  - [x] 11.1 Add responsive layout rules to styles.css
    - Update body styles: remove flex centering, add `padding-top` for fixed tab bar
    - Add `.tab-panels` container: full-width on mobile, max-width 500px centered on desktop
    - Add media query for viewport ≤500px: full-width layout, max 16px horizontal padding
    - Add media query for viewport >500px: constrain `.tab-panels` to max-width 500px, center horizontally
    - Ensure tabs fit single row at 320px viewport (use flex with min-width 0, ellipsis)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 12. Service worker cache version bump
  - [x] 12.1 Update cache version in sw.js
    - Change `CACHE_NAME` from `'license-generator-v1'` to `'license-generator-v2'`
    - Verify `FILES_TO_CACHE` array still covers all files (no new files added)
    - _Requirements: (service worker update for returning users)_

- [x] 13. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Update README with new feature documentation
  - [x] 14.1 Create or update README.md with feature documentation
    - Document the three-tab layout (Generate, History, Manage Apps)
    - Document keyboard navigation (arrow keys + Enter/Space)
    - Document history feature: auto-save, grouped view, expand/collapse, copy, delete, clear all
    - Document the 500-entry history limit behavior
    - Note the localStorage keys used: `license_gen_apps`, `license_gen_history`
    - _Requirements: (documentation)_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- All code stays within the existing IIFE in app.js — no new JS files
- No build tools, frameworks, or npm packages needed for implementation
- The service worker cache bump ensures returning users get the updated app

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "5.1"] },
    { "id": 3, "tasks": ["4.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["4.2", "4.3", "7.1", "10.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "8.4", "8.5", "9.1"] },
    { "id": 7, "tasks": ["11.1", "12.1"] },
    { "id": 8, "tasks": ["14.1"] }
  ]
}
```
