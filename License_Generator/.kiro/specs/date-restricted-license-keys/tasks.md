# Implementation Plan: Date-Restricted License Keys

## Overview

This plan implements date-restricted license key generation, granular import/export, full backup/recovery, backup reminders, and per-app restriction flags for the License Generator PWA. All changes are made within the existing single-file vanilla JS architecture (`index.html`, `app.js`, `styles.css`), using localStorage for persistence.

## Tasks

- [x] 1. Extend data model and constants
  - [x] 1.1 Update DEFAULT_APPS and constants for date-restricted support
    - Add `restricted: true` to Patient Queue Management in `DEFAULT_APPS` array
    - Add `HISTORY_KEY`, `BACKUP_META_KEY` constants
    - Add `REMINDER_THRESHOLDS` object with `licensesGenerated: 10`, `daysSinceBackup: 30`, `firstBackupLicenses: 3`, `dismissDuration: 7`, `snoozeDuration: 3`
    - Ensure `_getRegistry()` seeds `restricted` flag for Patient Queue Management on existing installs
    - _Requirements: 12.1, 12.2, 12.3, 10.6, 10.9_

- [ ] 2. Implement license type selector UI and date fields
  - [x] 2.1 Add license type selector and date inputs to Generate tab in `index.html`
    - Add a `<select id="license-type">` with options "Perpetual" and "Date-Restricted" between app selector and user name input
    - Add `<input type="date" id="date-from">` and `<input type="date" id="date-to">` fields, initially hidden
    - Add appropriate labels and `aria-` attributes for accessibility
    - _Requirements: 1.1, 1.2, 1.3_

  - [-] 2.2 Add show/hide logic and restriction enforcement in `app.js`
    - Add event listener on `license-type` select to show/hide date fields
    - Add event listener on `app-select` to check `restricted` flag and force "Date-Restricted" selection when applicable
    - Disable "Perpetual" option when restricted app is selected; re-enable when non-restricted app is selected
    - Default license type to "Perpetual" on page load
    - _Requirements: 1.1, 1.2, 1.3, 11.1, 11.2, 11.3, 12.5_

- [ ] 3. Implement Validation Engine and date-restricted key generation
  - [-] 3.1 Implement validation functions in `app.js`
    - Add `validateDateRestrictedInputs(fromDate, toDate)` returning `{ valid, error }`
    - Add `isValidISODate(dateStr)` helper
    - Add `isAppRestricted(appIndex)` helper
    - Validate: both dates present, valid format, toDate >= fromDate
    - _Requirements: 1.6, 1.7, 1.8_

  - [x] 3.2 Implement `generateDateRestrictedLicense(name, secretCodes, fromDate, toDate)` in `app.js`
    - Compute HMAC-SHA256 over concatenation of `name + fromDate + toDate`
    - Build payload `{ n: name, f: fromDate, t: toDate, h: hmacHex }`
    - Return base64-encoded JSON payload
    - _Requirements: 1.4, 1.5, 1.8_

  - [ ] 3.3 Update Generate button handler to support both license types
    - Check selected license type before generation
    - If date-restricted: run validation, call `generateDateRestrictedLicense`
    - If perpetual: call existing `generateLicense`
    - Save extended history entry with `licenseType`, `validFrom`, `validTo` fields
    - Increment backup reminder license counter
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 10.9_

  - [x] 3.4 Write property test for date-restricted key payload integrity
    - **Property 1: Date-Restricted Key Payload Integrity**
    - **Validates: Requirements 1.4, 1.5, 1.8**

  - [x] 3.5 Write property test for date validation rejects invalid ranges
    - **Property 2: Date Validation Rejects Invalid Ranges**
    - **Validates: Requirements 1.6**

  - [x] 3.6 Write property test for perpetual key backward compatibility
    - **Property 3: Perpetual Key Backward Compatibility**
    - **Validates: Requirements 2.1**

- [ ] 4. Checkpoint - Verify core license generation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement extended history display
  - [x] 5.1 Update history entry data model and save logic in `app.js`
    - Extend `_addHistoryEntry` to accept and store `licenseType`, `validFrom`, `validTo`
    - Ensure existing history entries without these fields display correctly (backward compat)
    - _Requirements: 2.2, 2.3, 2.4_

  - [-] 5.2 Update `_renderHistoryEntry` to show license type and date info
    - Display "Perpetual" or "Date-Restricted" badge/label
    - For date-restricted entries, show "Valid: fromDate – toDate" in the summary row
    - Style the badges in `styles.css`
    - _Requirements: 2.3, 2.4_

- [ ] 6. Implement Import/Export Engine
  - [x] 6.1 Implement App Registry export function in `app.js`
    - Add `exportAppRegistry()` that builds export file with meta header and triggers download
    - Filename format: `app_registry_YYYY-MM-DD.json`
    - Meta includes: type `license_gen_app_registry`, exportDate, version `2.0`, count
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 6.2 Implement App Registry import function in `app.js`
    - Add `importAppRegistry(fileContent)` with JSON parsing, type validation, merge logic
    - Merge: skip duplicates by case-insensitive name match
    - Return `{ success, added, skipped, error? }`
    - Display summary toast on completion
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.3 Implement License History export function in `app.js`
    - Add `exportLicenseHistory()` that builds export file with meta header and triggers download
    - Filename format: `license_history_YYYY-MM-DD.json`
    - Meta includes: type `license_gen_license_history`, exportDate, version `2.0`, count
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 6.4 Implement License History import function in `app.js`
    - Add `importLicenseHistory(fileContent)` with JSON parsing, type validation, merge logic
    - Merge: skip duplicates by matching timestamp + appName + userName
    - Return `{ success, added, skipped, error? }`
    - Display summary toast on completion
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.5 Write property test for app registry export/import round-trip
    - **Property 4: App Registry Export/Import Round-Trip**
    - **Validates: Requirements 3.1, 3.3, 4.1, 4.3, 4.4**

  - [x] 6.6 Write property test for license history export/import round-trip
    - **Property 5: License History Export/Import Round-Trip**
    - **Validates: Requirements 5.1, 5.3, 6.1, 6.3, 6.4**

- [ ] 7. Implement Full Backup & Recovery Engine
  - [ ] 7.1 Implement full backup function in `app.js`
    - Add `createFullBackup()` that builds backup file with all data sections and meta
    - Include: appRegistry, licenseHistory, settings (theme)
    - Filename format: `license_gen_backup_YYYY-MM-DD.json`
    - Record backup timestamp in backup meta
    - Reset `licensesSinceBackup` counter
    - _Requirements: 7.1, 7.2, 7.3, 10.6_

  - [ ] 7.2 Implement full recovery function in `app.js`
    - Add `restoreFromBackup(fileContent)` with validation, confirmation dialog, destructive restore
    - Validate file structure and type identifier
    - Show overwrite warning via `confirm()`
    - Replace all localStorage keys on confirmation
    - Reload UI after successful restore
    - Handle cancellation gracefully
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 7.3 Write property test for full backup/restore round-trip
    - **Property 6: Full Backup/Restore Round-Trip**
    - **Validates: Requirements 7.1, 7.3, 8.1, 8.4**

- [ ] 8. Checkpoint - Verify import/export and backup/recovery
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Backup Reminder Engine
  - [ ] 9.1 Implement reminder evaluation and state management in `app.js`
    - Add `getBackupMeta()` to read/initialize backup meta from localStorage
    - Add `evaluateReminderConditions()` returning `{ shouldShow, reason }`
    - Add `incrementLicenseCounter()` called after each license generation
    - Add `recordBackupTimestamp()` called after each successful backup
    - Add `dismissReminder()` setting `dismissedUntil` to now + 7 days
    - Add `snoozeReminder()` setting `dismissedUntil` to now + 3 days
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [ ] 9.2 Implement reminder banner UI in `index.html` and `app.js`
    - Add a dismissible banner element at top of page (above tab-bar or within tab panels)
    - Banner includes: message text, "Backup Now" link, "Dismiss" button, "Snooze" button
    - Wire buttons to `dismissReminder()`, `snoozeReminder()`, and navigate to backup section
    - Evaluate and show/hide on app load and after each license generation
    - Style banner in `styles.css` as non-intrusive notification
    - _Requirements: 10.3, 10.4, 10.5, 10.7_

  - [ ] 9.3 Write property test for backup reminder threshold evaluation
    - **Property 7: Backup Reminder Threshold Evaluation**
    - **Validates: Requirements 10.1, 10.2, 10.8**

  - [ ] 9.4 Write property test for reminder suppression duration
    - **Property 8: Reminder Suppression Duration**
    - **Validates: Requirements 10.4, 10.5**

- [ ] 10. Implement per-app restriction management UI
  - [ ] 10.1 Add restriction toggle controls in Manage Apps section
    - Add a restriction toggle/checkbox for each non-protected app in the Manage Apps tab
    - For protected apps with `restricted: true`, show read-only "Restricted" badge
    - Wire toggle to update `restricted` flag in registry and save
    - Update `index.html` with new section or inline controls in app list
    - _Requirements: 11.4, 11.5, 11.6, 11.7_

  - [ ] 10.2 Write property test for license type restriction enforcement
    - **Property 9: License Type Restriction Enforcement**
    - **Validates: Requirements 11.1, 11.3, 11.4**

- [ ] 11. Add Import/Export and Backup/Recovery UI to Manage Apps tab
  - [ ] 11.1 Add Import/Export section UI in `index.html`
    - Add "Import / Export" section with heading in Manage Apps tab
    - Add "Export App Registry" button, "Import App Registry" button with hidden file input
    - Add "Export License History" button, "Import License History" button with hidden file input
    - Style buttons consistently with existing UI in `styles.css`
    - _Requirements: 9.1, 9.2, 9.4_

  - [ ] 11.2 Add Backup & Recovery section UI in `index.html`
    - Add "Backup & Recovery" section with heading in Manage Apps tab
    - Add "Create Full Backup" button and "Restore from Backup" button with hidden file input
    - Style buttons consistently with existing UI in `styles.css`
    - _Requirements: 9.1, 9.3, 9.4_

  - [ ] 11.3 Wire Import/Export and Backup/Recovery buttons to engine functions in `app.js`
    - Connect export buttons to `exportAppRegistry()`, `exportLicenseHistory()`, `createFullBackup()`
    - Connect import buttons to file input triggers and route file content to import/restore functions
    - Handle file reading via `FileReader` API
    - _Requirements: 9.4_

- [ ] 12. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code is vanilla JavaScript — no build tools, no modules, no bundler
- All persistence uses localStorage with the existing key naming convention
- The existing `app.js` IIFE structure is maintained; new functions are added as logical sections

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "5.2"] },
    { "id": 3, "tasks": ["3.2", "6.1", "6.3"] },
    { "id": 4, "tasks": ["3.3", "6.2", "6.4"] },
    { "id": 5, "tasks": ["3.4", "3.5", "3.6", "6.5", "6.6"] },
    { "id": 6, "tasks": ["7.1", "9.1", "10.1"] },
    { "id": 7, "tasks": ["7.2", "9.2", "10.2"] },
    { "id": 8, "tasks": ["7.3", "9.3", "9.4"] },
    { "id": 9, "tasks": ["11.1", "11.2"] },
    { "id": 10, "tasks": ["11.3"] }
  ]
}
```
