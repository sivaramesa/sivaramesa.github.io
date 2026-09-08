# Requirements Document

## Introduction

This feature adds multi-theme support (Dark, Light, and Purple) to the License Generator PWA, along with UI refinements on the History tab. Users will be able to switch between themes with their preference persisted across sessions. The History tab will receive button normalization, removal of the Copy button from expanded entries, and a compact inline Delete button on each row.

## Glossary

- **Theme_Switcher**: The UI control that allows the user to select between available themes (Dark, Light, Purple)
- **Theme_Engine**: The JavaScript module responsible for applying theme CSS variables, persisting the selected theme, and restoring it on page load
- **History_Tab**: The tab panel (`panel-history`) displaying grouped license generation history entries
- **History_Entry_Row**: A single collapsed row in the History tab showing user name, key preview, and date
- **Entry_Details**: The expanded section shown when a History_Entry_Row is clicked, containing the full license key
- **License_History**: The complete license history system including storage, display, and management
- **LocalStorage**: The browser Web Storage API used to persist user preferences and application data

## Requirements

### Requirement 1: Theme Definition

**User Story:** As a user, I want to have three distinct visual themes available, so that I can choose the appearance that best suits my preference.

#### Acceptance Criteria

1. THE Theme_Engine SHALL provide a Dark theme defining CSS custom properties with background color #1e1e1e, surface/card color #2d2d2d, accent color #64b5f6, text color #e0e0e0, secondary text color #9e9e9e, and border color #444444
2. THE Theme_Engine SHALL provide a Light theme defining CSS custom properties with background color #f5f5f5, surface/card color #ffffff, accent color #1976d2, text color #212121, secondary text color #616161, and border color #e0e0e0
3. THE Theme_Engine SHALL provide a Purple theme defining CSS custom properties with background color #1a0033, surface/card color #2d1b4e, accent color #ce93d8, text color #f3e5f5, secondary text color #b39ddb, and border color #4a148c
4. THE Theme_Engine SHALL implement each theme by setting CSS custom properties through a class applied to the body element (e.g., `body.theme-dark`, `body.theme-light`, `body.theme-purple`), where each theme class overrides the base custom property values
5. WHEN a theme is applied, THE Theme_Engine SHALL define at minimum the following CSS custom properties: --color-bg, --color-surface, --color-text, --color-text-secondary, --color-border, and --color-accent
6. THE Theme_Engine SHALL ensure that each theme maintains a minimum WCAG AA contrast ratio of 4.5:1 between the text color and background color, and between the text color and surface/card color

### Requirement 2: Theme Switching

**User Story:** As a user, I want a visible control to switch between themes, so that I can easily change the app appearance at any time.

#### Acceptance Criteria

1. THE Theme_Switcher SHALL be displayed in the Manage Apps tab as a labeled section titled "Theme" containing a `<select>` dropdown with options for Dark, Light, and Purple
2. WHEN the user selects a theme from the Theme_Switcher, THE Theme_Engine SHALL apply the selected theme immediately without page reload by updating the body class and CSS custom properties
3. WHILE a theme is the active theme, THE Theme_Switcher dropdown SHALL reflect the currently active theme as the selected value
4. THE Theme_Switcher SHALL be placed at the top of the Manage Apps tab, before the Add App section

### Requirement 3: Theme Persistence

**User Story:** As a user, I want my theme preference to persist across sessions, so that the app looks the same each time I open it.

#### Acceptance Criteria

1. WHEN the user selects a theme, THE Theme_Engine SHALL store the selected theme identifier (one of "dark", "light", "purple") in localStorage under the key "license_gen_theme"
2. WHEN the application loads, THE Theme_Engine SHALL read the stored theme identifier from localStorage and apply the corresponding theme class to the body element before the first visible content is painted, preventing any flash of an incorrect theme
3. IF the stored theme identifier is missing, invalid, or does not match any of the supported theme identifiers ("dark", "light", "purple"), THEN THE Theme_Engine SHALL apply the Dark theme as the default
4. IF localStorage is unavailable or access to it throws an error, THEN THE Theme_Engine SHALL apply the Dark theme as the default without displaying an error to the user

### Requirement 4: History Tab Button Normalization

**User Story:** As a user, I want buttons on the History tab to be consistently sized, so that the interface looks clean and uniform.

#### Acceptance Criteria

1. THE History_Tab SHALL render the "Clear All" button in each group header with `width: auto` and `display: inline-block` so that the button width fits its text content rather than stretching to full container width
2. THE History_Tab SHALL render all action buttons ("Clear All" in group headers, "Delete" in entry details) with uniform padding of 8px vertical and 14px horizontal, and a font size of 0.8125rem
3. THE History_Tab SHALL NOT render any action button with `width: 100%` or `display: block` layout — all buttons shall be content-width

### Requirement 5: Remove Copy Button from History Entry Details

**User Story:** As a user, I do not need a Copy button in expanded history entries, so that the interface is simplified.

#### Acceptance Criteria

1. WHILE a History_Entry is in its expanded state, THE License_History SHALL NOT display a Copy button within the expanded details area
2. WHILE a History_Entry is in its expanded state, THE License_History SHALL display exactly two interactive elements within the expanded details area: a read-only textarea containing the complete license key string and a "Delete" button
3. THE License_History SHALL render the license key textarea as selectable text so that users can manually select and copy the license key using native browser selection

### Requirement 6: Inline Delete Button on History Rows

**User Story:** As a user, I want a small Delete button visible directly on each history row, so that I can quickly remove entries without expanding them.

#### Acceptance Criteria

1. THE History_Entry_Row SHALL display a compact Delete button (🗑️ icon) on the right side of the entry summary row, visible in the collapsed state without needing to expand the entry
2. WHEN the user clicks the inline Delete button, THE License_History SHALL display a confirmation dialog asking the user to confirm deletion of that History_Entry
3. WHEN the user confirms the inline deletion, THE License_History SHALL remove the entry from localStorage and re-render the history list without requiring a page reload
4. IF the user cancels the inline deletion confirmation, THEN THE License_History SHALL take no action and the History_Entry SHALL remain displayed in its current state
5. WHEN the inline Delete button is clicked, THE History_Entry_Row SHALL NOT toggle the expanded/collapsed state of the entry (the click event must stop propagation to the row's expand/collapse handler)
6. THE inline Delete button SHALL have a compact visual size (approximately 28x28px) with sufficient padding to maintain a 44x44px touch target area
