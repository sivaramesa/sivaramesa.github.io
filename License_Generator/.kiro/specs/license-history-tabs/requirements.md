# Requirements Document

## Introduction

The License Generator app currently displays a "Generate License" card and a "Manage Apps" card stacked vertically with a side-by-side feel on wider screens. This layout is not mobile-friendly. This feature replaces the current layout with a tab-based navigation system and adds a "License History" tab that stores, displays, and allows management (view/delete) of all previously generated licenses per product/app. The goal is a cleaner mobile experience and full traceability of generated licenses.

## Glossary

- **License_Generator**: The PWA application that generates HMAC-SHA256-based license keys for registered applications.
- **Tab_Navigation**: A horizontal tab bar that switches between content panels within the single-page app.
- **License_History**: A persistent record of all generated license keys stored in localStorage, grouped by application.
- **History_Entry**: A single record containing the application name, user name, generated license key, and timestamp.
- **App_Registry**: The localStorage-backed list of registered applications with their names and secrets.

## Requirements

### Requirement 1: Tab-Based Navigation Layout

**User Story:** As the app owner, I want the UI to use a tabbed layout, so that the interface is mobile-friendly and each section gets dedicated screen space.

#### Acceptance Criteria

1. THE Tab_Navigation SHALL display three tabs in left-to-right order: "Generate", "History", and "Manage Apps"
2. WHEN a tab is activated by tap, click, or keyboard selection, THE Tab_Navigation SHALL display the corresponding content panel and hide all other content panels
3. THE Tab_Navigation SHALL distinguish the currently active tab by applying the accent color (#64b5f6) to the active tab's text and bottom border, while inactive tabs use the default text color
4. WHEN the app is loaded, THE Tab_Navigation SHALL display the "Generate" tab as the default active tab with its content panel visible
5. THE Tab_Navigation SHALL remain fixed at the top of the viewport so content scrolls beneath it
6. THE Tab_Navigation SHALL support keyboard navigation using left/right arrow keys to move focus between tabs and Enter or Space key to activate the focused tab

### Requirement 2: License History Storage

**User Story:** As the app owner, I want every generated license to be automatically saved, so that I have a record of all licenses issued per product.

#### Acceptance Criteria

1. WHEN a license key is generated, THE License_Generator SHALL append a History_Entry to the history array in localStorage containing the application name, user name, license key, and generation timestamp in ISO 8601 format (UTC)
2. THE License_Generator SHALL store History_Entry records in a JSON array under the localStorage key "license_gen_history", separate from the App_Registry key "license_gen_apps"
3. THE License_Generator SHALL persist History_Entry records across browser sessions by writing to localStorage immediately upon generation, with no expiration or automatic deletion
4. THE License_Generator SHALL associate each History_Entry with the application it was generated for by including the application name as stored in the App_Registry entry selected at generation time
5. IF localStorage is unavailable or the write operation throws an error when saving a History_Entry, THEN THE License_Generator SHALL display an error message indicating the history entry could not be saved, while still displaying the generated license key to the user
6. THE License_Generator SHALL store a maximum of 500 History_Entry records, and WHEN the limit is reached, THE License_Generator SHALL remove the oldest entry (earliest timestamp) before appending the new entry

### Requirement 3: License History Display

**User Story:** As the app owner, I want to view all generated licenses grouped by product, so that I can track which licenses have been issued.

#### Acceptance Criteria

1. WHEN the "History" tab is active, THE License_History SHALL display all stored History_Entry records grouped by application name, with application groups sorted alphabetically by name
2. THE License_History SHALL display each History_Entry with the user name, the first 20 characters of the license key followed by an ellipsis ("…") as a preview, and the generation date formatted as "DD MMM YYYY" (e.g., "15 Jun 2025")
3. IF no History_Entry records exist, THEN THE License_History SHALL display a message indicating no licenses have been generated yet
4. THE License_History SHALL display History_Entry records in reverse chronological order (newest first) within each application group
5. WHEN a collapsed History_Entry is tapped, THE License_History SHALL expand the entry to reveal the full license key
6. WHEN an expanded History_Entry is tapped, THE License_History SHALL collapse the entry back to show only the truncated preview

### Requirement 4: License History Management

**User Story:** As the app owner, I want to delete individual licenses or clear all history for an app, so that I can manage and clean up old records.

#### Acceptance Criteria

1. WHEN a History_Entry is expanded, THE License_History SHALL display a "Delete" button for that entry
2. WHEN the "Delete" button is tapped, THE License_History SHALL display a confirmation dialog asking the user to confirm deletion of that History_Entry
3. WHEN the user confirms the single-entry deletion, THE License_History SHALL remove that History_Entry from localStorage and update the displayed list within 1 second without requiring a page reload
4. IF the user cancels the single-entry deletion confirmation, THEN THE License_History SHALL take no action and the History_Entry SHALL remain displayed in its expanded state
5. THE License_History SHALL display a "Clear All" button for each application group
6. WHEN the "Clear All" button is tapped for an application group, THE License_History SHALL display a confirmation dialog asking the user to confirm removal of all History_Entry records for that application
7. WHEN the user confirms the Clear All action, THE License_History SHALL remove all History_Entry records for that application from localStorage and update the displayed list within 1 second without requiring a page reload
8. IF the user cancels the Clear All confirmation, THEN THE License_History SHALL take no action and all History_Entry records for that application group SHALL remain displayed

### Requirement 5: Copy License from History

**User Story:** As the app owner, I want to copy a previously generated license from history, so that I can re-issue a key without regenerating it.

#### Acceptance Criteria

1. WHEN a History_Entry is expanded, THE License_History SHALL display a "Copy" button adjacent to the full license key and the "Delete" button
2. WHEN the "Copy" button is tapped, THE License_History SHALL copy the full license key string to the system clipboard using the Clipboard API
3. WHEN the license key is successfully copied to the clipboard, THE License_History SHALL display a confirmation message (e.g., "Copied!") that automatically dismisses after 2 seconds
4. IF the clipboard write operation fails or the Clipboard API is unavailable, THEN THE License_History SHALL display an error message indicating the copy failed and the confirmation message SHALL NOT appear

### Requirement 6: Responsive Tab Layout

**User Story:** As the app owner, I want the tabbed layout to work well on both mobile and desktop, so that the app remains usable on any device.

#### Acceptance Criteria

1. THE Tab_Navigation SHALL render all tabs in a single horizontal row without horizontal scrolling on viewports 320px wide and above, with each tab label truncated via ellipsis if text exceeds the available width
2. THE Tab_Navigation SHALL use touch-friendly tap targets with a minimum height of 44px and a minimum width of 44px per tab
3. WHILE the viewport width is 500px or less, THE License_Generator SHALL display content in a full-width single-column layout beneath the tabs with no horizontal padding exceeding 16px per side
4. WHILE the viewport width exceeds 500px, THE License_Generator SHALL constrain the content area width to a maximum of 500px and center it horizontally within the viewport
5. WHEN the viewport is resized or the device orientation changes, THE License_Generator SHALL re-apply the layout rules defined in criteria 3 and 4 without requiring a page reload
