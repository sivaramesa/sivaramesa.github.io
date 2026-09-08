(function() {
  'use strict';

  // --- Theme Engine ---
  var THEME_KEY = 'license_gen_theme';
  var VALID_THEMES = ['dark', 'light', 'purple'];
  var DEFAULT_THEME = 'dark';

  function _getStoredTheme() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (stored && VALID_THEMES.indexOf(stored) !== -1) {
        return stored;
      }
    } catch (e) { /* localStorage unavailable */ }
    return DEFAULT_THEME;
  }

  function _setStoredTheme(themeId) {
    try {
      localStorage.setItem(THEME_KEY, themeId);
    } catch (e) { /* fail silently */ }
  }

  function _applyTheme(themeId) {
    if (VALID_THEMES.indexOf(themeId) === -1) {
      themeId = DEFAULT_THEME;
    }
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-purple');
    document.body.classList.add('theme-' + themeId);
    _setStoredTheme(themeId);

    // Update meta theme-color for mobile browsers
    var metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      var bgColors = { dark: '#1e1e1e', light: '#f5f5f5', purple: '#1a0033' };
      metaThemeColor.setAttribute('content', bgColors[themeId]);
    }
  }

  // Apply stored theme immediately on load
  _applyTheme(_getStoredTheme());

  // --- Constants ---
  var STORAGE_KEY = 'license_gen_apps';
  var DEFAULT_APPS = [
    { name: "Pay Up Partners", secret: [80,85,80,95,76,73,67,95,50,48,50,53,95,36,101,99,114,51,116,95,75,51,121,33] },
    { name: "ABC Store", secret: [65,66,67,95,76,73,67,95,50,48,50,53,95,36,116,48,114,51,95,75,51,121,33] },
    { name: "Build Calc", secret: [66,117,105,108,100,67,97,108,99] },
    { name: "Pay Your Shuttle", secret: [80,97,121,89,111,117,114,83,104,117,116,116,108,101] },
    { name: "Patient Queue Management", secret: [80,97,116,105,101,110,116,81,117,101,117,101,77,97,110,97,103,101,109,101,110,116] },
    { name: "Track Your Fitness", secret: [84,114,97,99,107,89,111,117,114,70,105,116,110,101,115,115,50,48,50,53], restricted: true },
    { name: "Lights On", secret: [76,105,103,104,116,115,79,110,95,76,73,67,95,50,48,50,53,95,36,101,99,114,51,116,95,75,51,121,33] },
    { name: "R-Facility Pulse", secret: [82,79,79,77,67,84,82,76,95,76,73,67,95,50,48,50,53,95,36,101,99,114,51,116,95,75,51,121,33] }
  ];

  // Protected app names that cannot be modified or deleted (case-insensitive)
  var PROTECTED_APPS = ["pay up partners", "abc store", "build calc", "pay your shuttle", "patient queue management", "track your fitness", "lights on", "r-facility pulse"];

  // Backup metadata localStorage key
  var BACKUP_META_KEY = 'license_gen_backup_meta';

  // Reminder thresholds for backup notifications
  var REMINDER_THRESHOLDS = {
    licensesGenerated: 10,
    daysSinceBackup: 30,
    firstBackupLicenses: 3,
    dismissDuration: 7,
    snoozeDuration: 3
  };

  // --- Sync Layer Bridge ---
  // When window.LicenseSync (Firestore) is present, it owns persistence and
  // mirrors to localStorage. When it's absent (e.g. tests, or Firebase failed
  // to load), we fall back to direct localStorage access below.
  function _sync() {
    return (typeof window !== 'undefined' && window.LicenseSync) ? window.LicenseSync : null;
  }

  // --- Registry Functions ---

  function _loadRegistry() {
    var s = _sync();
    if (s) {
      var apps = s.getApps();
      return (apps && apps.length) ? apps : null;
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function _saveRegistry(registry) {
    var s = _sync();
    if (s) {
      // Fire-and-forget: sync layer updates its cache synchronously and
      // mirrors to localStorage + Firestore. Real-time listener will re-render.
      s.saveApps(registry);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
    } catch (e) {
      console.error('Failed to save app registry:', e);
    }
  }

  function _seedDefaults() {
    _saveRegistry(DEFAULT_APPS.slice());
    return DEFAULT_APPS.slice();
  }

  function _getRegistry() {
    var registry = _loadRegistry();
    if (!registry || registry.length === 0) {
      registry = _seedDefaults();
    } else {
      // Ensure all default apps exist in the registry (handles new additions)
      var changed = false;
      for (var i = 0; i < DEFAULT_APPS.length; i++) {
        var defApp = DEFAULT_APPS[i];
        var found = false;
        for (var j = 0; j < registry.length; j++) {
          if (registry[j].name.toLowerCase() === defApp.name.toLowerCase()) {
            found = true;
            break;
          }
        }
        if (!found) {
          var newEntry = { name: defApp.name, secret: defApp.secret.slice() };
          registry.push(newEntry);
          changed = true;
        }
      }
      if (changed) _saveRegistry(registry);
    }
    return registry;
  }

  function _populateAppDropdown() {
    var select = document.getElementById('app-select');
    if (!select) return;
    var registry = _getRegistry();
    select.innerHTML = '';
    for (var i = 0; i < registry.length; i++) {
      var option = document.createElement('option');
      option.value = i;
      option.textContent = registry[i].name;
      select.appendChild(option);
    }
    // Also populate the remove-app dropdown
    _populateRemoveAppDropdown();
  }

  function _populateRemoveAppDropdown() {
    var select = document.getElementById('remove-app-select');
    if (!select) return;
    var registry = _getRegistry();
    select.innerHTML = '';
    for (var i = 0; i < registry.length; i++) {
      var option = document.createElement('option');
      option.value = i;
      option.textContent = registry[i].name;
      if (PROTECTED_APPS.indexOf(registry[i].name.toLowerCase()) !== -1) {
        option.textContent += ' (protected)';
      }
      select.appendChild(option);
    }
  }

  function _addApp(name, secretStr) {
    if (!name || !name.trim()) {
      alert('Please enter an application name.');
      return false;
    }
    if (!secretStr || !secretStr.trim()) {
      alert('Please enter a secret string.');
      return false;
    }
    name = name.trim();
    secretStr = secretStr.trim();

    // Check for duplicate app name (case-insensitive)
    var registry = _getRegistry();
    var nameLower = name.toLowerCase();
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].name.toLowerCase() === nameLower) {
        alert('An application named "' + registry[i].name + '" already exists. Please use a different name.');
        return false;
      }
    }

    var secretArray = secretStr.split('').map(function(c) { return c.charCodeAt(0); });
    registry.push({ name: name, secret: secretArray });
    _saveRegistry(registry);
    _populateAppDropdown();
    // Select the newly added app
    var select = document.getElementById('app-select');
    if (select) select.value = registry.length - 1;
    return true;
  }

  function _removeApp(index) {
    var registry = _getRegistry();
    if (index < 0 || index >= registry.length) return false;
    var appName = registry[index].name;

    // Prevent deletion of protected apps
    if (PROTECTED_APPS.indexOf(appName.toLowerCase()) !== -1) {
      alert('"' + appName + '" is a protected application and cannot be removed.');
      return false;
    }

    if (!confirm('Remove "' + appName + '" from the registry?')) return false;
    registry.splice(index, 1);
    if (registry.length === 0) {
      registry = _seedDefaults();
    } else {
      _saveRegistry(registry);
    }
    _populateAppDropdown();
    return true;
  }

  // --- HMAC-SHA256 via Web Crypto API ---

  function _getSecretFromCodes(codes) {
    return codes.map(function(c) { return String.fromCharCode(c); }).join('');
  }

  async function hmacHex(message, secretCodes) {
    var secret = _getSecretFromCodes(secretCodes);
    var enc = new TextEncoder();
    var keyData = enc.encode(secret);
    var msgData = enc.encode(message);

    var cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    var sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    var bytes = new Uint8Array(sig);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex;
  }

  // --- Generate License Key ---

  async function generateLicense(name, secretCodes) {
    var hash = await hmacHex(name, secretCodes);
    var payload = JSON.stringify({ n: name, h: hash });
    return btoa(payload);
  }

  // --- Validation Engine ---

  /**
   * Validates that a date string is in ISO 8601 date format (YYYY-MM-DD)
   * and represents a real calendar date.
   * @param {string} dateStr - The date string to validate
   * @returns {boolean} True if valid ISO date format
   */
  function isValidISODate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    // Check format: YYYY-MM-DD
    var regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    // Check that it's a real date (e.g., not 2025-02-30)
    var parts = dateStr.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    var d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  /**
   * Validates date-restricted license inputs.
   * Checks that both dates are present, valid format, and toDate > fromDate.
   * @param {string} fromDate - The "Valid From" date (YYYY-MM-DD)
   * @param {string} toDate - The "Valid To" date (YYYY-MM-DD)
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateDateRestrictedInputs(fromDate, toDate) {
    if (!fromDate) {
      return { valid: false, error: 'Please enter a Valid From date.' };
    }
    if (!toDate) {
      return { valid: false, error: 'Please enter a Valid To date.' };
    }
    if (!isValidISODate(fromDate)) {
      return { valid: false, error: 'Please enter a valid date.' };
    }
    if (!isValidISODate(toDate)) {
      return { valid: false, error: 'Please enter a valid date.' };
    }
    // toDate must be on or after fromDate (same-day licenses are valid)
    if (toDate < fromDate) {
      return { valid: false, error: 'Valid To date must be on or after the Valid From date.' };
    }
    return { valid: true };
  }

  /**
   * Checks if an app is restricted (date-restricted only).
   * @param {number} appIndex - The index of the app in the registry
   * @returns {boolean} True if the app is restricted
   */
  function isAppRestricted(appIndex) {
    var registry = _getRegistry();
    if (appIndex < 0 || appIndex >= registry.length) return false;
    return registry[appIndex].restricted === true;
  }

  // --- Generate Date-Restricted License Key ---

  async function generateDateRestrictedLicense(name, secretCodes, fromDate, toDate) {
    var message = name + fromDate + toDate;
    var hash = await hmacHex(message, secretCodes);
    var payload = JSON.stringify({ n: name, f: fromDate, t: toDate, h: hash });
    return btoa(payload);
  }

  // --- History Manager ---

  var HISTORY_KEY = 'license_gen_history';
  var MAX_HISTORY = 500;

  function _loadHistory() {
    var s = _sync();
    if (s) {
      return s.getHistory();
    }
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Normalize entries for backward compatibility:
      // Old entries may lack licenseType, validFrom, validTo
      for (var i = 0; i < parsed.length; i++) {
        if (!parsed[i].licenseType) {
          parsed[i].licenseType = 'perpetual';
        }
        if (parsed[i].validFrom === undefined) {
          parsed[i].validFrom = null;
        }
        if (parsed[i].validTo === undefined) {
          parsed[i].validTo = null;
        }
      }
      return parsed;
    } catch (e) {
      console.warn('Corrupted history data in localStorage:', e);
      return [];
    }
  }

  function _saveHistory(history) {
    // Only used in localStorage-only fallback mode. When the sync layer is
    // present, individual add/delete/clear operations go through it directly.
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return true;
    } catch (e) {
      return false;
    }
  }

  function _addHistoryEntry(appName, userName, licenseKey, licenseType, validFrom, validTo) {
    // Default licenseType to "perpetual" if not provided (backward compat with old 3-arg calls)
    if (!licenseType) {
      licenseType = 'perpetual';
    }
    // Default validFrom and validTo to null if not provided
    if (validFrom === undefined || validFrom === null) {
      validFrom = null;
    }
    if (validTo === undefined || validTo === null) {
      validTo = null;
    }
    var entry = {
      appName: appName,
      userName: userName,
      licenseKey: licenseKey,
      timestamp: new Date().toISOString(),
      licenseType: licenseType,
      validFrom: validFrom,
      validTo: validTo
    };

    var s = _sync();
    if (s) {
      // Sync layer enforces the MAX_HISTORY cap and mirrors to localStorage.
      s.addHistoryEntry(entry);
      return true;
    }

    var history = _loadHistory();
    if (history.length >= MAX_HISTORY) {
      // Remove oldest entry (earliest timestamp)
      var oldestIndex = 0;
      for (var i = 1; i < history.length; i++) {
        if (history[i].timestamp < history[oldestIndex].timestamp) {
          oldestIndex = i;
        }
      }
      history.splice(oldestIndex, 1);
    }
    history.push(entry);
    return _saveHistory(history);
  }

  // Deletes a history entry. In sync mode `ref` is the entry's stable id
  // (string); in localStorage-only mode it is the numeric array index.
  function _deleteHistoryEntry(ref) {
    var s = _sync();
    if (s) {
      s.deleteHistoryEntry(ref);
      return true;
    }
    var history = _loadHistory();
    var index = parseInt(ref, 10);
    if (index < 0 || index >= history.length) return false;
    history.splice(index, 1);
    return _saveHistory(history);
  }

  function _clearAppHistory(appName) {
    var s = _sync();
    if (s) {
      s.clearAppHistory(appName);
      return true;
    }
    var history = _loadHistory();
    var filtered = history.filter(function(entry) {
      return entry.appName !== appName;
    });
    return _saveHistory(filtered);
  }

  function _getGroupedHistory() {
    var history = _loadHistory();
    var groups = {};
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (!groups[entry.appName]) {
        groups[entry.appName] = [];
      }
      groups[entry.appName].push(entry);
    }
    // Sort entries within each group by timestamp descending (newest first)
    var appNames = Object.keys(groups);
    for (var j = 0; j < appNames.length; j++) {
      groups[appNames[j]].sort(function(a, b) {
        return a.timestamp < b.timestamp ? 1 : (a.timestamp > b.timestamp ? -1 : 0);
      });
    }
    // Sort groups alphabetically by appName (case-insensitive)
    appNames.sort(function(a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    var sorted = {};
    for (var k = 0; k < appNames.length; k++) {
      sorted[appNames[k]] = groups[appNames[k]];
    }
    return sorted;
  }

  function _formatDate(isoString) {
    var d = new Date(isoString);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var day = String(d.getDate()).padStart(2, '0');
    return day + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function _truncateKey(key) {
    if (key.length <= 20) return key;
    return key.substring(0, 20) + '\u2026';
  }

  function _showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'success');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, type === 'error' ? 3000 : 2000);
  }

  // --- Import/Export Engine ---

  function _triggerDownload(content, filename) {
    var blob = new Blob([content], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportAppRegistry() {
    var registry = _getRegistry();
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10);
    var exportFile = {
      meta: {
        type: 'license_gen_app_registry',
        exportDate: now.toISOString(),
        version: '2.0',
        count: registry.length
      },
      data: registry
    };
    var content = JSON.stringify(exportFile, null, 2);
    var filename = 'app_registry_' + dateStr + '.json';
    _triggerDownload(content, filename);
  }

  /**
   * Exports the License History as a JSON file download.
   * Filename format: license_history_YYYY-MM-DD.json
   * Meta header includes: type "license_gen_license_history", exportDate (ISO string),
   * version "2.0", count (number of history entries).
   * Data section contains the full License History array from localStorage.
   * Validates: Requirements 5.1, 5.2, 5.3
   */
  function exportLicenseHistory() {
    var history = _loadHistory();
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10);
    var exportFile = {
      meta: {
        type: 'license_gen_license_history',
        exportDate: now.toISOString(),
        version: '2.0',
        count: history.length
      },
      data: history
    };
    var content = JSON.stringify(exportFile, null, 2);
    var filename = 'license_history_' + dateStr + '.json';
    _triggerDownload(content, filename);
  }

  // --- Tab Controller ---

  function _switchTab(tabId) {
    var tabs = document.querySelectorAll('[role="tab"]');
    var panels = document.querySelectorAll('[role="tabpanel"]');
    var targetTab = null;

    // Deactivate all tabs
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('active');
      tabs[i].setAttribute('aria-selected', 'false');
      tabs[i].setAttribute('tabindex', '-1');
      if (tabs[i].getAttribute('aria-controls') === tabId) {
        targetTab = tabs[i];
      }
    }

    // Hide all panels
    for (var j = 0; j < panels.length; j++) {
      panels[j].setAttribute('hidden', '');
    }

    // Activate target tab
    if (targetTab) {
      targetTab.classList.add('active');
      targetTab.setAttribute('aria-selected', 'true');
      targetTab.setAttribute('tabindex', '0');
    }

    // Show target panel
    var targetPanel = document.getElementById(tabId);
    if (!targetPanel) return;
    targetPanel.removeAttribute('hidden');

    // If switching to history tab, refresh the history display
    if (tabId === 'panel-history') {
      if (typeof _renderHistory === 'function') _renderHistory();
    }
  }

  function _handleTabKeydown(e) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    var currentIndex = tabs.indexOf(e.currentTarget);
    var newIndex;

    if (e.key === 'ArrowLeft') {
      newIndex = currentIndex - 1;
      if (newIndex < 0) newIndex = tabs.length - 1;
      tabs[newIndex].focus();
    } else if (e.key === 'ArrowRight') {
      newIndex = currentIndex + 1;
      if (newIndex >= tabs.length) newIndex = 0;
      tabs[newIndex].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      var panelId = e.currentTarget.getAttribute('aria-controls');
      _switchTab(panelId);
    }
  }

  function _initTabs() {
    var tabs = document.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        var panelId = this.getAttribute('aria-controls');
        _switchTab(panelId);
      });
      tabs[i].addEventListener('keydown', _handleTabKeydown);
    }
  }

  // --- History Renderer ---

  function _renderHistory() {
    var historyList = document.querySelector('.history-list');
    var historyEmpty = document.querySelector('.history-empty');
    if (!historyList || !historyEmpty) return;

    var grouped = _getGroupedHistory();
    var appNames = Object.keys(grouped);

    if (appNames.length === 0) {
      historyEmpty.style.display = '';
      historyList.style.display = 'none';
      return;
    }

    historyEmpty.style.display = 'none';
    historyList.style.display = '';
    historyList.innerHTML = '';

    for (var i = 0; i < appNames.length; i++) {
      var groupEl = _renderAppGroup(appNames[i], grouped[appNames[i]]);
      historyList.appendChild(groupEl);
    }
  }

  function _renderAppGroup(appName, entries) {
    var group = document.createElement('div');
    group.className = 'history-group';

    var header = document.createElement('div');
    header.className = 'history-group-header';

    var heading = document.createElement('h3');
    heading.textContent = appName;
    header.appendChild(heading);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'btn-danger btn-small';
    clearBtn.textContent = 'Clear All';
    clearBtn.addEventListener('click', function() {
      _clearAllForApp(appName);
    });
    header.appendChild(clearBtn);

    group.appendChild(header);

    var fullHistory = _loadHistory();

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      // Reference used for delete/lookup:
      //  - sync mode: the entry's stable id (string)
      //  - localStorage-only mode: the global array index (number)
      var ref;
      if (entry.id) {
        ref = entry.id;
      } else {
        ref = -1;
        for (var j = 0; j < fullHistory.length; j++) {
          if (fullHistory[j].timestamp === entry.timestamp &&
              fullHistory[j].appName === entry.appName &&
              fullHistory[j].userName === entry.userName) {
            ref = j;
            break;
          }
        }
      }
      var entryEl = _renderHistoryEntry(entry, ref);
      group.appendChild(entryEl);
    }

    return group;
  }

  function _renderHistoryEntry(entry, idx) {
    var entryDiv = document.createElement('div');
    entryDiv.className = 'history-entry collapsed';
    entryDiv.setAttribute('data-index', idx);
    // Stash the full key on the element so expand doesn't depend on array index.
    entryDiv.__fullKey = entry.licenseKey;

    var summary = document.createElement('div');
    summary.className = 'entry-summary';

    var userSpan = document.createElement('span');
    userSpan.className = 'entry-user';
    userSpan.textContent = entry.userName;

    // License type badge
    var isDateRestricted = entry.licenseType === 'date-restricted';
    var badge = document.createElement('span');
    if (isDateRestricted) {
      badge.className = 'badge-date-restricted';
      badge.textContent = 'Date-Restricted';
    } else {
      badge.className = 'badge-perpetual';
      badge.textContent = 'Perpetual';
    }

    var keySpan = document.createElement('span');
    keySpan.className = 'entry-key-preview';
    keySpan.textContent = _truncateKey(entry.licenseKey);

    var dateSpan = document.createElement('span');
    dateSpan.className = 'entry-date';
    dateSpan.textContent = _formatDate(entry.timestamp);

    // Inline delete button - visible in collapsed state
    var inlineDeleteBtn = document.createElement('button');
    inlineDeleteBtn.className = 'btn-inline-delete';
    inlineDeleteBtn.setAttribute('aria-label', 'Delete entry');
    inlineDeleteBtn.textContent = '🗑️';
    inlineDeleteBtn.addEventListener('click', function(e) {
      e.stopPropagation(); // Prevent expand/collapse toggle
      _deleteFromHistory(idx);
    });

    summary.appendChild(userSpan);
    summary.appendChild(badge);
    summary.appendChild(keySpan);
    summary.appendChild(dateSpan);
    summary.appendChild(inlineDeleteBtn);

    // For date-restricted entries, show validity range
    if (isDateRestricted && entry.validFrom && entry.validTo) {
      var validitySpan = document.createElement('span');
      validitySpan.className = 'entry-validity';
      validitySpan.textContent = 'Valid: ' + entry.validFrom + ' \u2013 ' + entry.validTo;
      summary.appendChild(validitySpan);
    }

    entryDiv.appendChild(summary);

    entryDiv.addEventListener('click', function(e) {
      if (e.target.closest('.btn-inline-delete')) return;
      if (e.target.closest('.entry-actions')) return;
      _toggleEntry(entryDiv);
    });

    return entryDiv;
  }

  function _toggleEntry(entryEl) {
    if (entryEl.classList.contains('collapsed')) {
      entryEl.classList.remove('collapsed');
      entryEl.classList.add('expanded');

      var details = document.createElement('div');
      details.className = 'entry-details';

      var textarea = document.createElement('textarea');
      textarea.className = 'entry-full-key';
      textarea.setAttribute('readonly', '');
      textarea.setAttribute('rows', '3');
      // Prefer the full key stashed on the element; fall back to the preview.
      var idx = entryEl.getAttribute('data-index');
      if (entryEl.__fullKey) {
        textarea.value = entryEl.__fullKey;
      } else {
        textarea.value = entryEl.querySelector('.entry-key-preview').textContent;
      }

      details.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'entry-actions';

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-danger btn-small btn-delete';
      deleteBtn.textContent = '\ud83d\uddd1\ufe0f Delete';
      deleteBtn.addEventListener('click', function() {
        _deleteFromHistory(idx);
      });

      actions.appendChild(deleteBtn);
      details.appendChild(actions);

      entryEl.appendChild(details);
    } else if (entryEl.classList.contains('expanded')) {
      entryEl.classList.remove('expanded');
      entryEl.classList.add('collapsed');

      var existingDetails = entryEl.querySelector('.entry-details');
      if (existingDetails) {
        existingDetails.remove();
      }
    }
  }

  function _copyFromHistory(licenseKey, btn) {
    var originalText = btn.textContent;
    navigator.clipboard.writeText(licenseKey).then(function() {
      btn.textContent = '\u2705 Copied!';
      setTimeout(function() { btn.textContent = originalText; }, 2000);
    }).catch(function() {
      btn.textContent = '\u274c Copy failed';
      setTimeout(function() { btn.textContent = originalText; }, 2000);
    });
  }

  function _deleteFromHistory(ref) {
    if (!confirm('Delete this license entry?')) return;
    // ref is a stable id (sync mode) or numeric index (localStorage-only).
    _deleteHistoryEntry(ref);
    // In sync mode the real-time listener re-renders; re-render here too so
    // localStorage-only mode updates immediately.
    _renderHistory();
  }

  function _clearAllForApp(appName) {
    if (!confirm('Clear all history for "' + appName + '"?')) return;
    _clearAppHistory(appName);
    _renderHistory();
  }

  // --- DOM Ready ---

  // DOM elements
  var nameInput = document.getElementById('user-name');
  var generateBtn = document.getElementById('generate-btn');
  var outputSection = document.getElementById('output-section');
  var licenseOutput = document.getElementById('license-output');
  var copyBtn = document.getElementById('copy-btn');
  var statusMsg = document.getElementById('status-msg');
  var appSelect = document.getElementById('app-select');
  var appNameLabel = document.getElementById('app-name-label');
  var addAppBtn = document.getElementById('add-app-btn');
  var removeAppBtn = document.getElementById('remove-app-btn');
  var addAppName = document.getElementById('add-app-name');
  var addAppSecret = document.getElementById('add-app-secret');

  // Initialize app dropdown (from cache/localStorage first, for instant paint)
  _populateAppDropdown();

  // --- Firestore Sync Initialization ---
  // If the sync layer is present, initialize it. It seeds caches from
  // localStorage synchronously, then connects to Firestore, runs the one-time
  // local->cloud migration, and drives live updates via callbacks.
  if (typeof window !== 'undefined' && window.LicenseSync) {
    // Firebase mode: show the auth gate up front so the app isn't usable until
    // the auth listener confirms a signed-in user (onAuth hides it again).
    var _authOverlay = document.getElementById('auth-overlay');
    if (_authOverlay) _authOverlay.removeAttribute('hidden');

    var _preserveSelection = function () {
      return appSelect ? appSelect.value : null;
    };
    var _restoreSelection = function (prev) {
      if (appSelect && prev !== null && appSelect.querySelector('option[value="' + prev + '"]')) {
        appSelect.value = prev;
      }
      if (typeof _enforceAppRestriction === 'function') _enforceAppRestriction();
    };

    window.LicenseSync.init({
      onApps: function (apps) {
        // If cloud+local are both empty on first run, seed the defaults.
        // Only seed once we're authenticated so the write isn't rejected.
        if ((!apps || apps.length === 0)) {
          var existing = _loadRegistry();
          if ((!existing || existing.length === 0) && window.LicenseSync.currentUser()) {
            _saveRegistry(DEFAULT_APPS.slice());
            return; // saveApps triggers another onApps with the seeded data
          }
        }
        var prev = _preserveSelection();
        _populateAppDropdown();
        _restoreSelection(prev);
      },
      onHistory: function () {
        // Re-render history only when its panel is visible (cheap + avoids churn).
        var panel = document.getElementById('panel-history');
        if (panel && !panel.hasAttribute('hidden')) {
          _renderHistory();
        }
      },
      onStatus: function (state) {
        _updateSyncStatusUI(state);
      },
      onAuth: function (user) {
        _updateAuthUI(user);
      }
    });
  }

  // --- Auth Gate UI ---

  function _updateAuthUI(user) {
    var overlay = document.getElementById('auth-overlay');
    var accountEmail = document.getElementById('account-email');
    var signOutBtn = document.getElementById('sign-out-btn');

    if (user) {
      if (overlay) overlay.setAttribute('hidden', '');
      if (accountEmail) accountEmail.textContent = 'Signed in as ' + (user.email || 'user');
      if (signOutBtn) signOutBtn.removeAttribute('hidden');
      // Refresh views now that we're authenticated and data may be arriving.
      var prev = appSelect ? appSelect.value : null;
      _populateAppDropdown();
      if (appSelect && prev !== null && appSelect.querySelector('option[value="' + prev + '"]')) {
        appSelect.value = prev;
      }
      if (typeof _enforceAppRestriction === 'function') _enforceAppRestriction();
    } else {
      if (overlay) overlay.removeAttribute('hidden');
      if (accountEmail) accountEmail.textContent = 'Not signed in.';
      if (signOutBtn) signOutBtn.setAttribute('hidden', '');
    }
  }

  // Wire the sign-in form.
  var authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailEl = document.getElementById('auth-email');
      var passEl = document.getElementById('auth-password');
      var errEl = document.getElementById('auth-error');
      var submitBtn = document.getElementById('auth-submit');
      var email = emailEl ? emailEl.value.trim() : '';
      var password = passEl ? passEl.value : '';
      if (errEl) { errEl.setAttribute('hidden', ''); errEl.textContent = ''; }
      if (!window.LicenseSync || typeof window.LicenseSync.signIn !== 'function') {
        if (errEl) { errEl.textContent = 'Sign-in unavailable (Firebase not loaded).'; errEl.removeAttribute('hidden'); }
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in\u2026'; }
      window.LicenseSync.signIn(email, password).then(function () {
        if (passEl) passEl.value = '';
        // onAuth callback hides the overlay.
      }).catch(function (err) {
        var msg;
        if (err && err.code === 'auth/invalid-credential') msg = 'Invalid email or password.';
        else if (err && err.code === 'auth/wrong-password') msg = 'Invalid email or password.';
        else if (err && err.code === 'auth/user-not-found') msg = 'No account found for that email.';
        else if (err && err.code === 'auth/invalid-email') msg = 'Invalid email address.';
        else if (err && err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later.';
        else if (err && err.code === 'auth/network-request-failed') msg = 'Network error. Check your connection.';
        else if (err && err.code === 'auth/operation-not-allowed') msg = 'Email/Password sign-in is not enabled in Firebase.';
        else if (err && err.code === 'auth/unauthorized-domain') msg = 'This domain is not authorized in Firebase Auth settings.';
        else msg = 'Sign-in failed: ' + ((err && (err.code || err.message)) || 'unknown error');
        console.error('[auth] sign-in error:', err && err.code, err && err.message);
        if (errEl) { errEl.textContent = msg; errEl.removeAttribute('hidden'); }
      }).finally(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign In'; }
      });
    });
  }

  // Wire the sign-out button.
  var signOutBtnEl = document.getElementById('sign-out-btn');
  if (signOutBtnEl) {
    signOutBtnEl.addEventListener('click', function () {
      if (window.LicenseSync && typeof window.LicenseSync.signOut === 'function') {
        window.LicenseSync.signOut();
      }
    });
  }

  // --- Sync Status Indicator ---
  function _updateSyncStatusUI(state) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var map = {
      'online':     { cls: 'sync-online',    text: '\u25cf Synced',   title: 'Connected to Firebase' },
      'syncing':    { cls: 'sync-syncing',   text: '\u21ba Syncing',  title: 'Syncing with Firebase' },
      'offline':    { cls: 'sync-offline',   text: '\u25cf Offline',  title: 'No connection — changes cached locally' },
      'local-only': { cls: 'sync-local',     text: '\u25cf Local',    title: 'Local-only mode (Firebase not connected)' }
    };
    var info = map[state] || map['local-only'];
    el.className = 'sync-status ' + info.cls;
    el.textContent = info.text;
    el.setAttribute('title', info.title);
  }

  // Theme switcher
  var themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = _getStoredTheme();
    themeSelect.addEventListener('change', function() {
      _applyTheme(this.value);
    });
  }

  // --- License Type Selector & Restriction Enforcement ---

  var licenseTypeSelect = document.getElementById('license-type');
  var dateFieldsContainer = document.getElementById('date-fields-container');

  /**
   * Shows or hides the date fields based on the selected license type.
   * Requirements: 1.1, 1.2
   */
  function _updateDateFieldsVisibility() {
    if (!licenseTypeSelect || !dateFieldsContainer) return;
    if (licenseTypeSelect.value === 'date-restricted') {
      dateFieldsContainer.removeAttribute('hidden');
    } else {
      dateFieldsContainer.setAttribute('hidden', '');
    }
  }

  /**
   * Checks the selected app's restriction flag and enforces license type constraints.
   * If restricted: force "Date-Restricted", disable "Perpetual" option.
   * If non-restricted: re-enable "Perpetual" option.
   * Requirements: 11.1, 11.2, 11.3, 12.5
   */
  function _enforceAppRestriction() {
    if (!licenseTypeSelect || !appSelect) return;
    var selectedIndex = parseInt(appSelect.value, 10);
    var perpetualOption = licenseTypeSelect.querySelector('option[value="perpetual"]');
    if (!perpetualOption) return;

    if (isAppRestricted(selectedIndex)) {
      // Force Date-Restricted and disable Perpetual
      licenseTypeSelect.value = 'date-restricted';
      perpetualOption.disabled = true;
    } else {
      // Re-enable Perpetual option
      perpetualOption.disabled = false;
    }
    _updateDateFieldsVisibility();
  }

  // Event listener: license type change shows/hides date fields
  if (licenseTypeSelect) {
    licenseTypeSelect.addEventListener('change', _updateDateFieldsVisibility);
  }

  // Event listener: app selection enforces restriction
  if (appSelect) {
    appSelect.addEventListener('change', _enforceAppRestriction);
  }

  // Default license type to "Perpetual" on page load (Requirement 1.3)
  if (licenseTypeSelect) {
    licenseTypeSelect.value = 'perpetual';
  }
  _updateDateFieldsVisibility();

  // Enforce restriction for initially selected app on load
  _enforceAppRestriction();

  // Generate button click
  generateBtn.addEventListener('click', async function() {
    var name = (nameInput.value || '').trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    var registry = _getRegistry();
    var selectedIndex = parseInt(appSelect.value, 10);
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= registry.length) {
      alert('Please select an application.');
      return;
    }

    var selectedApp = registry[selectedIndex];

    try {
      var licenseType = licenseTypeSelect ? licenseTypeSelect.value : 'perpetual';
      var key;

      if (licenseType === 'date-restricted') {
        // Validate date inputs
        var fromDate = document.getElementById('date-from') ? document.getElementById('date-from').value : '';
        var toDate = document.getElementById('date-to') ? document.getElementById('date-to').value : '';
        var validation = validateDateRestrictedInputs(fromDate, toDate);
        if (!validation.valid) {
          alert(validation.error);
          return;
        }
        key = await generateDateRestrictedLicense(name, selectedApp.secret, fromDate, toDate);
        var saved = _addHistoryEntry(selectedApp.name, name, key, 'date-restricted', fromDate, toDate);
        if (!saved) {
          _showToast('\u26a0\ufe0f History entry could not be saved.', 'error');
        }
      } else {
        key = await generateLicense(name, selectedApp.secret);
        var saved = _addHistoryEntry(selectedApp.name, name, key, 'perpetual', null, null);
        if (!saved) {
          _showToast('\u26a0\ufe0f History entry could not be saved.', 'error');
        }
      }

      licenseOutput.value = key;
      outputSection.removeAttribute('hidden');
      // Display selected app name alongside generated key
      if (appNameLabel) {
        appNameLabel.textContent = 'Generated for: ' + selectedApp.name;
        appNameLabel.removeAttribute('hidden');
      }
      statusMsg.setAttribute('hidden', '');
    } catch (e) {
      alert('Error generating license: ' + e.message);
    }
  });

  // Copy button click
  copyBtn.addEventListener('click', async function() {
    var text = licenseOutput.value;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      statusMsg.textContent = '✅ Copied to clipboard!';
      statusMsg.removeAttribute('hidden');
      setTimeout(function() { statusMsg.setAttribute('hidden', ''); }, 3000);
    } catch (e) {
      // Fallback
      licenseOutput.select();
      document.execCommand('copy');
      statusMsg.textContent = '✅ Copied to clipboard!';
      statusMsg.removeAttribute('hidden');
      setTimeout(function() { statusMsg.setAttribute('hidden', ''); }, 3000);
    }
  });

  // Add App button click
  if (addAppBtn) {
    addAppBtn.addEventListener('click', function() {
      var name = addAppName ? addAppName.value : '';
      var secret = addAppSecret ? addAppSecret.value : '';
      if (_addApp(name, secret)) {
        if (addAppName) addAppName.value = '';
        if (addAppSecret) addAppSecret.value = '';
      }
    });
  }

  // Remove App button click
  if (removeAppBtn) {
    removeAppBtn.addEventListener('click', function() {
      var removeSelect = document.getElementById('remove-app-select');
      if (!removeSelect) return;
      var selectedIndex = parseInt(removeSelect.value, 10);
      _removeApp(selectedIndex);
    });
  }

  // Allow Enter key to generate
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      generateBtn.click();
    }
  });

  // Initialize tab navigation
  _initTabs();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(function(reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function(err) {
      console.log('SW registration failed:', err);
    });
  }

  // Expose functions for testing (Node.js / test environment)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isValidISODate: isValidISODate,
      validateDateRestrictedInputs: validateDateRestrictedInputs,
      isAppRestricted: isAppRestricted,
      generateLicense: generateLicense,
      generateDateRestrictedLicense: generateDateRestrictedLicense,
      exportAppRegistry: exportAppRegistry,
      exportLicenseHistory: exportLicenseHistory
    };
  }
})();
