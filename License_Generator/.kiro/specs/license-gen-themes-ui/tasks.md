# Implementation Plan: License Generator Themes & UI Refinements

## Overview

Add multi-theme support (Dark, Light, Purple) to the License Generator PWA and refine the History tab UI. Changes span three files: `styles.css` (theme definitions + CSS variable migration), `app.js` (theme engine + history modifications), and `index.html` (theme switcher dropdown). Service worker gets a cache version bump.

## Tasks

- [x] 1. Define CSS custom properties and theme classes
  - [x] 1.1 Add theme class definitions to styles.css
    - Add `body.theme-dark`, `body.theme-light`, and `body.theme-purple` class rules at the top of `styles.css` (after the reset block)
    - Each class defines: `--color-bg`, `--color-surface`, `--color-text`, `--color-text-secondary`, `--color-border`, `--color-accent`
    - Dark: bg #1e1e1e, surface #2d2d2d, text #e0e0e0, text-secondary #9e9e9e, border #444444, accent #64b5f6
    - Light: bg #f5f5f5, surface #ffffff, text #212121, text-secondary #616161, border #e0e0e0, accent #1976d2
    - Purple: bg #1a0033, surface #2d1b4e, text #f3e5f5, text-secondary #b39ddb, border #4a148c, accent #ce93d8
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Migrate hardcoded colors to CSS custom properties
  - [x] 2.1 Replace background and surface color values in styles.css
    - Replace all `#1e1e1e` background references with `var(--color-bg)`
    - Replace all `#2d2d2d` surface/card references with `var(--color-surface)`
    - Applies to: `body`, `input[type="text"]`, `textarea`, `select`, `.tab-bar`, `.tab-panel`
    - _Requirements: 1.4, 1.5_

  - [x] 2.2 Replace text and accent color values in styles.css
    - Replace `#e0e0e0` text color references with `var(--color-text)`
    - Replace `#9e9e9e` secondary text references with `var(--color-text-secondary)`
    - Replace `#64b5f6` accent references with `var(--color-accent)`
    - Replace `#666` muted text with `var(--color-text-secondary)`
    - Applies to: `body color`, `.title`, `.subtitle`, `label`, `.tab`, `.tab.active`, `.btn-primary`, `.btn-secondary`, `.app-name-label`, `.entry-user`, `.entry-key-preview`, `.entry-date`, `.history-empty`, `.manage-subtitle`, `.manage-hint`, `.history-group-header h3`, `.manage-title`
    - _Requirements: 1.4, 1.5_

  - [x] 2.3 Replace border color values in styles.css
    - Replace `#444` / `#444444` border references with `var(--color-border)`
    - Replace `#333` subtle border references with `var(--color-border)`
    - Applies to: `input[type="text"]`, `textarea`, `select`, `.tab-bar`, `.output-section`, `.manage-section`, `.history-group`, `.history-entry`, `.entry-details`
    - _Requirements: 1.4, 1.5_

  - [x] 2.4 Update focus and hover states to use CSS variables
    - Replace `#64b5f6` in `:focus` and `:hover` rules with `var(--color-accent)`
    - Update `.btn-primary` hover state (`#42a5f5`) to use a slightly different shade or opacity of accent
    - Update `.btn-secondary` hover background to use `rgba()` based on accent color
    - Update `.history-entry:hover` background to use a subtle surface highlight
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 3. Implement Theme Engine in app.js
  - [x] 3.1 Add Theme Engine functions to app.js
    - Add `THEME_KEY`, `VALID_THEMES`, and `DEFAULT_THEME` constants inside the IIFE
    - Implement `_getStoredTheme()`: reads localStorage, validates against VALID_THEMES, returns DEFAULT_THEME on error
    - Implement `_setStoredTheme(themeId)`: writes to localStorage, fails silently on error
    - Implement `_applyTheme(themeId)`: validates input, removes all theme classes from body, adds correct class, calls `_setStoredTheme`, updates `meta[name="theme-color"]` content attribute
    - Place these functions near the top of the IIFE, after constants but before registry functions
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Apply theme on page load (synchronous, before DOM interactions)
    - Call `_applyTheme(_getStoredTheme())` immediately after the theme engine function definitions, before any DOM element queries or event bindings
    - This ensures the correct theme class is on the body before the browser paints DOM content
    - _Requirements: 3.2, 3.3, 3.4_

- [x] 4. Add theme switcher UI and event handling
  - [x] 4.1 Add theme switcher dropdown HTML in index.html
    - Insert a new `<div class="manage-section">` at the top of `panel-manage`, before the "Add App" section
    - Contains `<h3 class="manage-subtitle">Theme</h3>`, a form-group with label "Appearance" and `<select id="theme-select">` with options: Dark (value="dark"), Light (value="light"), Purple (value="purple")
    - _Requirements: 2.1, 2.4_

  - [x] 4.2 Add theme switcher event handler in app.js
    - Query `#theme-select` element
    - Set its initial value to `_getStoredTheme()` so it reflects the active theme
    - Add `change` event listener that calls `_applyTheme(this.value)`
    - Place this code in the DOM-ready section alongside other element queries
    - _Requirements: 2.2, 2.3_

- [x] 5. Checkpoint - Verify themes work end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. History tab UI refinements
  - [x] 6.1 Normalize History tab button sizes in styles.css
    - Add CSS rules for history action buttons: `width: auto`, `display: inline-block`
    - Set uniform padding `8px 14px` and font-size `0.8125rem` for `.history-group-header .btn-danger` and `.entry-actions .btn-delete`
    - Override `.btn-danger` default `width: 100%` and `display: block` when inside history context
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Remove Copy button from _toggleEntry expanded view in app.js
    - Modify `_toggleEntry` function: remove the `copyBtn` creation and its event listener
    - The expanded details should contain only the textarea and a Delete button
    - Remove the `.btn-copy` related code from `.entry-actions`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 6.3 Add inline delete button to _renderHistoryEntry row in app.js
    - Create a compact `<button class="btn-inline-delete">` with 🗑️ text and `aria-label="Delete entry"`
    - Append it to the `.entry-summary` div after the date span
    - Add click handler with `e.stopPropagation()` to prevent expand/collapse toggle
    - Handler calls `_deleteFromHistory(idx)` with confirmation dialog
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.4 Add inline delete button styles in styles.css
    - Style `.btn-inline-delete`: width/height 28px, no border, transparent background, font-size ~1rem, cursor pointer, border-radius 4px
    - Add padding/margin to ensure 44x44px touch target area
    - Add hover state with subtle background highlight
    - _Requirements: 6.6_

- [x] 7. Service worker cache version bump
  - [x] 7.1 Update CACHE_NAME in sw.js
    - Change `CACHE_NAME` from `'license-generator-v2'` to `'license-generator-v3'`
    - No other structural changes needed — existing activate handler handles old cache deletion
    - _Requirements: 3.2 (ensures updated assets are served)_

- [x] 8. Update meta theme-color dynamically
  - [x] 8.1 Verify meta theme-color updates in _applyTheme
    - Confirm that `_applyTheme` (implemented in task 3.1) includes the logic to query `meta[name="theme-color"]` and set its `content` attribute to the background color of the active theme
    - Dark → #1e1e1e, Light → #f5f5f5, Purple → #1a0033
    - _Requirements: 2.2_

- [x] 9. Final checkpoint - Ensure all changes work together
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 10. Write property tests for Theme Engine
  - [ ]* 10.1 Write property test for theme storage round-trip
    - **Property 1: Theme storage round-trip**
    - For any valid theme identifier, `_setStoredTheme(t)` followed by `_getStoredTheme()` returns the same value
    - **Validates: Requirements 3.1**

  - [ ]* 10.2 Write property test for invalid theme defaults
    - **Property 2: Invalid theme identifier defaults to dark**
    - For any string not in ["dark", "light", "purple"], `_applyTheme(s)` results in body having `theme-dark` class
    - **Validates: Requirements 3.3**

  - [ ]* 10.3 Write property test for history entry deletion
    - **Property 3: History entry deletion reduces count by one**
    - For any non-empty history array and valid index, `_deleteHistoryEntry(index)` reduces array length by exactly one
    - **Validates: Requirements 6.3**

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The CSS migration (task 2) depends on task 1 completing first (custom properties must be defined before they are referenced)
- Theme Engine (task 3) can be implemented in parallel with CSS migration (task 2)
- History UI refinements (task 6) are independent of theme work and can proceed in parallel
- No build tools, no npm, no frameworks — all changes are to the three existing files plus sw.js
- Property tests validate universal correctness properties from the design document

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.2", "6.2", "6.3"] },
    { "id": 2, "tasks": ["2.4", "4.1", "6.1", "6.4"] },
    { "id": 3, "tasks": ["4.2", "7.1", "8.1"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.3"] }
  ]
}
```
