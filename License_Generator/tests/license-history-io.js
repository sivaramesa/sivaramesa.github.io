/**
 * License History Import/Export Logic (extracted for testing)
 * 
 * This module re-implements the export/import logic from app.js
 * in a testable, side-effect-free manner.
 */

/**
 * Builds a license history export file object from a history array.
 * Mirrors the logic in app.js exportLicenseHistory().
 * 
 * @param {Array} history - Array of history entry objects
 * @returns {object} Export file object with meta and data
 */
export function buildLicenseHistoryExport(history) {
  var now = new Date();
  return {
    meta: {
      type: 'license_gen_license_history',
      exportDate: now.toISOString(),
      version: '2.0',
      count: history.length
    },
    data: history
  };
}

/**
 * Imports license history from a file content string.
 * Merges imported entries with existing history, skipping duplicates.
 * Duplicates are detected by matching: timestamp + appName + userName
 * 
 * Mirrors the logic specified for importLicenseHistory() in app.js (task 6.4).
 * 
 * @param {string} fileContent - JSON string of the export file
 * @param {Array} existingHistory - Current history entries in storage
 * @returns {{ success: boolean, added: number, skipped: number, error?: string, merged?: Array }}
 */
export function importLicenseHistory(fileContent, existingHistory) {
  var parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch (e) {
    return { success: false, added: 0, skipped: 0, error: 'The selected file is not valid JSON.' };
  }

  // Validate file type
  if (!parsed || !parsed.meta || parsed.meta.type !== 'license_gen_license_history') {
    return { success: false, added: 0, skipped: 0, error: 'This file is not a valid license history export.' };
  }

  // Validate data section
  if (!parsed.data || !Array.isArray(parsed.data)) {
    return { success: false, added: 0, skipped: 0, error: 'The file does not contain valid license history data.' };
  }

  var importedData = parsed.data;
  var added = 0;
  var skipped = 0;

  // Build a set of existing entry keys for duplicate detection
  var existingKeys = {};
  for (var i = 0; i < existingHistory.length; i++) {
    var e = existingHistory[i];
    var key = (e.timestamp || '') + '|' + (e.appName || '') + '|' + (e.userName || '');
    existingKeys[key] = true;
  }

  var merged = existingHistory.slice(); // copy existing

  for (var j = 0; j < importedData.length; j++) {
    var entry = importedData[j];
    var entryKey = (entry.timestamp || '') + '|' + (entry.appName || '') + '|' + (entry.userName || '');
    if (existingKeys[entryKey]) {
      skipped++;
    } else {
      merged.push(entry);
      existingKeys[entryKey] = true;
      added++;
    }
  }

  return { success: true, added: added, skipped: skipped, merged: merged };
}
