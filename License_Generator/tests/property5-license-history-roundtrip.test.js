/**
 * Property 5: License History Export/Import Round-Trip
 * Feature: date-restricted-license-keys
 * 
 * **Validates: Requirements 5.1, 5.3, 6.1, 6.3, 6.4**
 * 
 * For any valid License History (array of entries with appName, userName, licenseKey, timestamp),
 * exporting the history and then importing the resulting file into an empty history SHALL produce
 * a history equivalent to the original. Importing into a non-empty history SHALL merge entries,
 * skipping duplicates (matching timestamp + appName + userName), and the reported counts
 * (added + skipped) SHALL equal the number of entries in the imported file.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildLicenseHistoryExport, importLicenseHistory } from './license-history-io.js';

// --- Arbitraries ---

/** Generate a valid ISO 8601 date string (YYYY-MM-DD) using integer components */
const arbISODate = fc.record({
  year: fc.integer({ min: 2020, max: 2030 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 })
}).map(({ year, month, day }) => {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
});

/** Generate a valid ISO 8601 datetime string */
const arbTimestamp = fc.record({
  year: fc.integer({ min: 2020, max: 2030 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  second: fc.integer({ min: 0, max: 59 })
}).map(({ year, month, day, hour, minute, second }) => {
  var d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return d.toISOString();
});

/** Generate a non-empty app name */
const arbAppName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,19}$/);

/** Generate a non-empty user name */
const arbUserName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ._-]{0,19}$/);

/** Generate a base64-like license key string */
const arbLicenseKey = fc.string({ minLength: 5, maxLength: 40 }).map(s => {
  var safe = s.replace(/[^\x20-\x7E]/g, 'x');
  try {
    return btoa(safe);
  } catch (e) {
    return btoa('fallback-key');
  }
});

/** Generate a license type */
const arbLicenseType = fc.constantFrom('perpetual', 'date-restricted');

/** Generate a valid license history entry */
const arbHistoryEntry = fc.record({
  appName: arbAppName,
  userName: arbUserName,
  licenseKey: arbLicenseKey,
  timestamp: arbTimestamp,
  licenseType: arbLicenseType,
  validFrom: fc.option(arbISODate, { nil: null }),
  validTo: fc.option(arbISODate, { nil: null })
});

/** Generate a unique history entry array (unique by timestamp + appName + userName) */
const arbUniqueHistoryEntries = fc.array(arbHistoryEntry, { minLength: 1, maxLength: 5 }).map(entries => {
  const seen = new Set();
  return entries.filter(e => {
    const key = e.timestamp + '|' + e.appName + '|' + e.userName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}).filter(arr => arr.length > 0);

// --- Property Tests ---

describe('Feature: date-restricted-license-keys, Property 5: License History Export/Import Round-Trip', () => {

  it('export then import into empty history produces equivalent history', () => {
    /**
     * **Validates: Requirements 5.1, 5.3, 6.1, 6.3**
     */
    fc.assert(
      fc.property(arbUniqueHistoryEntries, (history) => {
        // Export the history
        const exportFile = buildLicenseHistoryExport(history);
        const fileContent = JSON.stringify(exportFile);

        // Import into empty history
        const result = importLicenseHistory(fileContent, []);

        // Should succeed
        expect(result.success).toBe(true);
        expect(result.added).toBe(history.length);
        expect(result.skipped).toBe(0);

        // Merged result should contain all entries from original
        expect(result.merged).toHaveLength(history.length);

        // Verify all original entries are present (match by key fields)
        for (const entry of history) {
          const found = result.merged.find(m =>
            m.timestamp === entry.timestamp &&
            m.appName === entry.appName &&
            m.userName === entry.userName
          );
          expect(found).toBeDefined();
          expect(found.licenseKey).toBe(entry.licenseKey);
          expect(found.licenseType).toBe(entry.licenseType);
          expect(found.validFrom).toBe(entry.validFrom);
          expect(found.validTo).toBe(entry.validTo);
        }
      }),
      { numRuns: 5 }
    );
  });

  it('importing into non-empty history merges correctly and skips duplicates', () => {
    /**
     * **Validates: Requirements 6.3, 6.4**
     */
    fc.assert(
      fc.property(
        arbUniqueHistoryEntries,
        arbUniqueHistoryEntries,
        (existingHistory, importedHistory) => {
          // Export the imported history
          const exportFile = buildLicenseHistoryExport(importedHistory);
          const fileContent = JSON.stringify(exportFile);

          // Import into existing history
          const result = importLicenseHistory(fileContent, existingHistory);

          expect(result.success).toBe(true);

          // added + skipped must equal the number of imported entries
          expect(result.added + result.skipped).toBe(importedHistory.length);

          // Count expected duplicates
          const existingKeys = new Set(
            existingHistory.map(e => e.timestamp + '|' + e.appName + '|' + e.userName)
          );
          let expectedSkipped = 0;
          let expectedAdded = 0;
          for (const entry of importedHistory) {
            const key = entry.timestamp + '|' + entry.appName + '|' + entry.userName;
            if (existingKeys.has(key)) {
              expectedSkipped++;
            } else {
              expectedAdded++;
              existingKeys.add(key);
            }
          }
          expect(result.skipped).toBe(expectedSkipped);
          expect(result.added).toBe(expectedAdded);

          // Merged result contains all existing entries plus new unique ones
          expect(result.merged.length).toBe(existingHistory.length + expectedAdded);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('duplicate detection uses timestamp + appName + userName matching', () => {
    /**
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(arbUniqueHistoryEntries, (history) => {
        // Export the history
        const exportFile = buildLicenseHistoryExport(history);
        const fileContent = JSON.stringify(exportFile);

        // Import the same history into itself (all should be duplicates)
        const result = importLicenseHistory(fileContent, history);

        expect(result.success).toBe(true);
        expect(result.added).toBe(0);
        expect(result.skipped).toBe(history.length);
        expect(result.merged).toHaveLength(history.length);
      }),
      { numRuns: 5 }
    );
  });

  it('export file contains correct meta header (type, version, count, exportDate)', () => {
    /**
     * **Validates: Requirements 5.1, 5.3**
     */
    fc.assert(
      fc.property(arbUniqueHistoryEntries, (history) => {
        const exportFile = buildLicenseHistoryExport(history);

        // Meta header validation
        expect(exportFile.meta).toBeDefined();
        expect(exportFile.meta.type).toBe('license_gen_license_history');
        expect(exportFile.meta.version).toBe('2.0');
        expect(exportFile.meta.count).toBe(history.length);
        expect(exportFile.meta.exportDate).toBeDefined();

        // Export date must be a valid ISO string
        const parsedDate = new Date(exportFile.meta.exportDate);
        expect(parsedDate.toISOString()).toBe(exportFile.meta.exportDate);

        // Data section contains all entries
        expect(exportFile.data).toHaveLength(history.length);
      }),
      { numRuns: 5 }
    );
  });

  it('import rejects invalid file types/formats', () => {
    /**
     * **Validates: Requirements 6.1**
     */
    // Test with random strings (invalid JSON)
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (randomContent) => {
        const result = importLicenseHistory(randomContent, []);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 5 }
    );

    // Test with valid JSON but wrong type
    fc.assert(
      fc.property(
        fc.constantFrom(
          'license_gen_app_registry',
          'license_gen_full_backup',
          'wrong_type'
        ),
        (wrongType) => {
          const badFile = JSON.stringify({
            meta: { type: wrongType, exportDate: new Date().toISOString(), version: '2.0', count: 0 },
            data: []
          });
          const result = importLicenseHistory(badFile, []);
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 3 }
    );
  });

  it('round-trip preserves all entry properties including date-restricted fields', () => {
    /**
     * **Validates: Requirements 5.1, 5.3, 6.1, 6.3, 6.4**
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            appName: arbAppName,
            userName: arbUserName,
            licenseKey: arbLicenseKey,
            timestamp: arbTimestamp,
            licenseType: fc.constant('date-restricted'),
            validFrom: arbISODate,
            validTo: arbISODate
          }),
          { minLength: 1, maxLength: 5 }
        ).map(entries => {
          const seen = new Set();
          return entries.filter(e => {
            const key = e.timestamp + '|' + e.appName + '|' + e.userName;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }).filter(arr => arr.length > 0),
        (history) => {
          // Export
          const exportFile = buildLicenseHistoryExport(history);
          const fileContent = JSON.stringify(exportFile);

          // Import into empty
          const result = importLicenseHistory(fileContent, []);

          expect(result.success).toBe(true);
          expect(result.merged).toHaveLength(history.length);

          // Verify each entry's date-restricted fields are preserved
          for (const original of history) {
            const imported = result.merged.find(m =>
              m.timestamp === original.timestamp &&
              m.appName === original.appName &&
              m.userName === original.userName
            );
            expect(imported).toBeDefined();
            expect(imported.licenseType).toBe('date-restricted');
            expect(imported.validFrom).toBe(original.validFrom);
            expect(imported.validTo).toBe(original.validTo);
            expect(imported.licenseKey).toBe(original.licenseKey);
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});
