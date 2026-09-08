# Requirements Document

## Introduction

This document specifies requirements for enhancing the License Generator PWA with three new capabilities: date-restricted license key generation (time-bound licenses with "Valid From" and "Valid To" dates), granular import/export of app registry and license history, and full backup/recovery of all application data. All new functionality must be backward compatible with existing perpetual license keys.

## Glossary

- **License_Generator**: The PWA application that generates, manages, and stores license keys for registered applications.
- **License_Key**: A base64-encoded string containing a JSON payload with a user name and HMAC-SHA256 signature.
- **Perpetual_Key**: A license key with no date restrictions that remains valid indefinitely. This is the existing key format.
- **Date_Restricted_Key**: A license key that includes a "Valid From" date and a "Valid To" date embedded in the signed payload, restricting the key's validity to that date range.
- **App_Registry**: The collection of registered applications stored in localStorage, each with a name and secret key used for HMAC signing.
- **License_History**: The chronological record of all generated license keys stored in localStorage.
- **Payload**: The JSON object that is base64-encoded to form the license key. For perpetual keys: `{ n, h }`. For date-restricted keys: `{ n, f, t, h }`.
- **HMAC_Signature**: The HMAC-SHA256 hash generated from the payload data using the application's secret key.
- **Backup_File**: A JSON file containing all application data (App_Registry, License_History, and Settings) for full backup and recovery.
- **Export_File**: A JSON file containing a specific subset of application data (either App_Registry or License_History).
- **Settings**: Application preferences including the selected theme.
- **Restricted_App**: An application in the App_Registry that only permits Date_Restricted_Key generation. The license type selector is forced to "Date-Restricted" when a Restricted_App is selected.

## Requirements

### Requirement 1: Date-Restricted License Key Generation

**User Story:** As a license administrator, I want to generate license keys with a defined validity period, so that I can issue time-bound licenses that expire on a specific date.

#### Acceptance Criteria

1. WHEN the user selects "Date-Restricted" as the license type, THE License_Generator SHALL display "Valid From" and "Valid To" date input fields.
2. WHEN the user selects "Perpetual" as the license type, THE License_Generator SHALL hide the "Valid From" and "Valid To" date input fields.
3. THE License_Generator SHALL default the license type selection to "Perpetual" to maintain backward-compatible behavior.
4. WHEN a date-restricted license is generated, THE License_Generator SHALL include the "Valid From" date and "Valid To" date in the signed HMAC payload as `{ n: name, f: fromDate, t: toDate, h: hash }`.
5. WHEN a date-restricted license is generated, THE License_Generator SHALL compute the HMAC-SHA256 signature over the concatenation of the user name, the "Valid From" date, and the "Valid To" date.
6. WHEN the user attempts to generate a date-restricted license with a "Valid To" date earlier than the "Valid From" date, THE License_Generator SHALL display a validation error and prevent key generation.
7. WHEN the user attempts to generate a date-restricted license without specifying both "Valid From" and "Valid To" dates, THE License_Generator SHALL display a validation error and prevent key generation.
8. THE License_Generator SHALL encode dates in ISO 8601 date format (YYYY-MM-DD) within the payload.

### Requirement 2: Backward Compatibility with Existing Keys

**User Story:** As a license administrator, I want existing perpetual license keys to remain valid after the update, so that current licensees are not disrupted.

#### Acceptance Criteria

1. THE License_Generator SHALL continue to generate perpetual keys using the existing payload format `{ n: name, h: hash }` when the "Perpetual" license type is selected.
2. THE License_Generator SHALL display existing License_History entries (perpetual keys without date fields) without errors.
3. WHEN a License_History entry contains a date-restricted key, THE License_Generator SHALL display the "Valid From" and "Valid To" dates alongside the key in the history view.
4. WHEN a License_History entry contains a perpetual key, THE License_Generator SHALL display "Perpetual" as the license type in the history view.

### Requirement 3: Export App Registry

**User Story:** As a license administrator, I want to export the app registry to a file, so that I can transfer registered applications to another device or create a backup of app configurations.

#### Acceptance Criteria

1. WHEN the user activates the "Export App Registry" action, THE License_Generator SHALL generate a JSON Export_File containing the complete App_Registry data.
2. WHEN the Export_File is generated, THE License_Generator SHALL trigger a file download with a descriptive filename that includes a timestamp (e.g., `app_registry_2025-07-01.json`).
3. THE License_Generator SHALL include a metadata header in the Export_File containing the export date, file type identifier, and application version.

### Requirement 4: Import App Registry

**User Story:** As a license administrator, I want to import an app registry from a file, so that I can restore or merge registered applications from another device.

#### Acceptance Criteria

1. WHEN the user selects an Export_File for app registry import, THE License_Generator SHALL validate that the file contains valid App_Registry data and a correct file type identifier.
2. IF the imported file contains invalid data or an unrecognized format, THEN THE License_Generator SHALL display a descriptive error message and abort the import.
3. WHEN a valid App_Registry Export_File is imported, THE License_Generator SHALL merge the imported applications with the existing App_Registry, skipping duplicates based on application name (case-insensitive comparison).
4. WHEN the import operation completes successfully, THE License_Generator SHALL display a summary indicating the number of applications added and the number of duplicates skipped.

### Requirement 5: Export License History

**User Story:** As a license administrator, I want to export the license generation history to a file, so that I can archive records or transfer history to another device.

#### Acceptance Criteria

1. WHEN the user activates the "Export License History" action, THE License_Generator SHALL generate a JSON Export_File containing the complete License_History data.
2. WHEN the Export_File is generated, THE License_Generator SHALL trigger a file download with a descriptive filename that includes a timestamp (e.g., `license_history_2025-07-01.json`).
3. THE License_Generator SHALL include a metadata header in the Export_File containing the export date, file type identifier, and total entry count.

### Requirement 6: Import License History

**User Story:** As a license administrator, I want to import license generation history from a file, so that I can restore historical records on a new device.

#### Acceptance Criteria

1. WHEN the user selects an Export_File for license history import, THE License_Generator SHALL validate that the file contains valid License_History data and a correct file type identifier.
2. IF the imported file contains invalid data or an unrecognized format, THEN THE License_Generator SHALL display a descriptive error message and abort the import.
3. WHEN a valid License_History Export_File is imported, THE License_Generator SHALL merge the imported entries with the existing License_History, skipping duplicate entries based on matching timestamp, application name, and user name.
4. WHEN the import operation completes successfully, THE License_Generator SHALL display a summary indicating the number of entries added and the number of duplicates skipped.

### Requirement 7: Full Backup

**User Story:** As a license administrator, I want to create a full backup of all application data in a single file, so that I can recover the entire application state if data is lost.

#### Acceptance Criteria

1. WHEN the user activates the "Full Backup" action, THE License_Generator SHALL generate a single JSON Backup_File containing the App_Registry, License_History, and Settings.
2. WHEN the Backup_File is generated, THE License_Generator SHALL trigger a file download with a descriptive filename that includes a timestamp (e.g., `license_gen_backup_2025-07-01.json`).
3. THE License_Generator SHALL include a metadata header in the Backup_File containing the backup date, file type identifier, application version, and data section counts.

### Requirement 8: Full Recovery

**User Story:** As a license administrator, I want to restore all application data from a backup file, so that I can recover the application to a previous state.

#### Acceptance Criteria

1. WHEN the user selects a Backup_File for recovery, THE License_Generator SHALL validate that the file contains valid backup data and a correct file type identifier.
2. IF the selected file contains invalid data or an unrecognized format, THEN THE License_Generator SHALL display a descriptive error message and abort the recovery.
3. WHEN a valid Backup_File is selected, THE License_Generator SHALL display a confirmation warning stating that recovery will overwrite all existing data (App_Registry, License_History, and Settings).
4. WHEN the user confirms the recovery operation, THE License_Generator SHALL replace the existing App_Registry, License_History, and Settings with the data from the Backup_File.
5. WHEN recovery completes successfully, THE License_Generator SHALL reload the application interface to reflect the restored data.
6. IF the user cancels the recovery confirmation, THEN THE License_Generator SHALL abort the recovery and retain existing data unchanged.

### Requirement 9: Import/Export and Backup UI Placement

**User Story:** As a license administrator, I want clear access to import, export, and backup actions, so that I can easily manage my data without confusion.

#### Acceptance Criteria

1. THE License_Generator SHALL provide the Import/Export and Backup/Recovery actions within the "Manage Apps" tab.
2. THE License_Generator SHALL group Import/Export actions in a distinct section labeled "Import / Export".
3. THE License_Generator SHALL group Backup/Recovery actions in a distinct section labeled "Backup & Recovery".
4. THE License_Generator SHALL present each action as a clearly labeled button with a descriptive icon or label.

### Requirement 10: Backup/Recovery Reminders

**User Story:** As a license administrator, I want the application to remind me to create backups periodically, so that I do not lose important license data due to accidental deletion or device failure.

#### Acceptance Criteria

1. WHEN the user has generated 10 or more licenses since the last backup, THE License_Generator SHALL display a non-intrusive reminder notification suggesting the user create a backup.
2. WHEN 30 or more days have elapsed since the last backup, THE License_Generator SHALL display a non-intrusive reminder notification suggesting the user create a backup.
3. THE License_Generator SHALL present backup reminders as a dismissible banner within the application interface, without blocking user interaction with other features.
4. WHEN the user dismisses a backup reminder, THE License_Generator SHALL hide the reminder and suppress further reminders for 7 days.
5. WHEN the user activates the "Snooze" action on a backup reminder, THE License_Generator SHALL hide the reminder and suppress further reminders for 3 days.
6. THE License_Generator SHALL record the timestamp of the last successful backup in localStorage.
7. WHEN the application loads, THE License_Generator SHALL evaluate the backup reminder conditions (licenses generated since last backup, days since last backup) to determine whether to display a reminder.
8. IF no backup has ever been taken and the user has generated 3 or more licenses, THEN THE License_Generator SHALL display a non-intrusive notification suggesting the user create a first backup.
9. THE License_Generator SHALL track the cumulative count of licenses generated since the last backup in localStorage.

### Requirement 11: Per-App License Type Restriction

**User Story:** As a license administrator, I want to flag specific applications as "Date-Restricted Only", so that those applications can only have time-bound license keys generated for them, preventing accidental issuance of perpetual licenses.

#### Acceptance Criteria

1. WHEN a Restricted_App is selected in the application dropdown, THE License_Generator SHALL force the license type selector to "Date-Restricted" and disable the "Perpetual" option.
2. WHEN a Restricted_App is selected, THE License_Generator SHALL require the user to provide both "Valid From" and "Valid To" dates before generating a key.
3. WHEN a non-restricted application is selected in the application dropdown, THE License_Generator SHALL allow the user to choose between "Perpetual" and "Date-Restricted" license types.
4. THE License_Generator SHALL store the restriction flag as a `restricted` boolean property on each App_Registry entry (value `true` for restricted applications, `false` or absent for unrestricted applications).
5. WHEN the user views the Manage Apps section, THE License_Generator SHALL display a toggle control to change the `restricted` status of each non-protected application.
6. WHEN a protected application has a `restricted` flag set by default, THE License_Generator SHALL display the restriction status as read-only in the Manage Apps section without allowing the user to modify the flag.
7. THE License_Generator SHALL permit protected applications to be flagged as restricted via default configuration.

### Requirement 12: Default Restricted Application - Patient Queue Management

**User Story:** As a license administrator, I want "Patient Queue Management" to be a pre-configured restricted application, so that license keys for this application are always time-bound and cannot be issued as perpetual licenses.

#### Acceptance Criteria

1. THE License_Generator SHALL include "Patient Queue Management" in the DEFAULT_APPS array with the secret key derived from the character code array of the string "PatientQueueManagement" (value: [80,97,116,105,101,110,116,81,117,101,117,101,77,97,110,97,103,101,109,101,110,116]).
2. THE License_Generator SHALL include "Patient Queue Management" in the PROTECTED_APPS list, preventing the user from modifying or deleting the application.
3. THE License_Generator SHALL set the `restricted` property to `true` for "Patient Queue Management" in the DEFAULT_APPS configuration.
4. WHEN the application loads, THE License_Generator SHALL display "Patient Queue Management" in the application dropdown alongside existing default applications.
5. WHEN the user selects "Patient Queue Management" from the application dropdown, THE License_Generator SHALL force the license type to "Date-Restricted" and disable the "Perpetual" option.
6. THE License_Generator SHALL prevent the user from changing the restriction status of "Patient Queue Management" in the Manage Apps section.
