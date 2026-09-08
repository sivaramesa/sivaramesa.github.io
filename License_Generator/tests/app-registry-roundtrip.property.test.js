/**
 * Property 4: App Registry Export/Import Round-Trip
 * Validates: Requirements 3.1, 3.3, 4.1, 4.3, 4.4
 *
 * For any valid App Registry (non-empty array of app entries with name, secret,
 * and optional restricted flag), exporting the registry and then importing the
 * resulting file into an empty registry SHALL produce a registry that is equivalent
 * to the original. Furthermore, importing into a non-empty registry SHALL result
 * in a merged registry containing all unique apps from both, with duplicates
 * (case-insensitive name match) skipped, and the reported counts (added + skipped)
 * SHALL equal the number of entries in the imported file.
 *
 * Feature: date-restricted-license-keys, Property 4: App Registry Export/Import Round-Trip
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ============================================================================
// Pure logic extracted from app.js for testability
// These replicate the exact logic from the IIFE in app.js
// ============================================================================

/**
 * Builds the export file structure for app registry (mirrors exportAppRegistry in app.js)
 */
function buildAppRegistryExportFile(registry) {
  var now = new Date();
  return {
    meta: {
      type: 'license_gen_app_registry',
      exportDate: now.toISOString(),
      version: '2.0',
      count: registry.length
    },
    data: registry
  };
}

/**
 * Imports app registry from file content (mirrors importAppRegistry in app.js)
 * Merges imported apps into existing registry, skipping duplicates by case-insensitive name match
 */
function importAppRegistry(fileContent, existingRegistry) {
  // Parse JSON
  var parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch (e) {
    return { success: false, added: 0, skipped: 0, error: 'The selected file is not valid JSON.' };
  }

  // Validate type identifier
  if (!parsed || !parsed.meta || parsed.meta.type !== 'license_gen_app_registry') {
    return { success: false, added: 0, skipped: 0, error: 'This file is not a valid app registry export.' };
  }

  // Validate data section
  if (!parsed.data || !Array.isArray(parsed.data)) {
    return { success: false, added: 0, skipped: 0, error: 'The file does not contain valid app registry data.' };
  }

  // Merge logic: skip duplicates by case-insensitive name match
  var added = 0;
  var skipped = 0;
  var mergedRegistry = existingRegistry.slice(); // copy existing

  for (var i = 0; i < parsed.data.length; i++) {
    var importedApp = parsed.data[i];
    var isDuplicate = false;

    for (var j = 0; j < mergedRegistry.length; j++) {
      if (mergedRegistry[j].name.toLowerCase() === importedApp.name.toLowerCase()) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      skipped++;
    } else {
      mergedRegistry.push(importedApp);
      added++;
    }
  }

  return { success: true, added: added, skipped: skipped, registry: mergedRegistry };
}

// ============================================================================
// Arbitraries (generators)
// ============================================================================

/**
 * Generates a valid app name (non-empty, printable ASCII, trimmed)
 */
const appNameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0)
  .map(s => s.trim());

/**
 * Generates a valid secret code array (non-empty array of char codes 32-126)
 */
const secretCodesArb = fc.array(
  fc.integer({ min: 32, max: 126 }),
  { minLength: 1, maxLength: 30 }
);

/**
 * Generates a valid app registry entry
 */
const appEntryArb = fc.record({
  name: appNameArb,
  secret: secretCodesArb,
  restricted: fc.boolean()
});

/**
 * Generates a valid app registry with unique names (case-insensitive)
 */
const uniqueRegistryArb = fc.array(appEntryArb, { minLength: 1, maxLength: 15 })
  .map(apps => {
    // Deduplicate by case-insensitive name
    const seen = new Set();
    return apps.filter(app => {
      const lower = app.name.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  })
  .filter(apps => apps.length > 0);

// ============================================================================
// Property Tests
// ============================================================================

describe('Feature: date-restricted-license-keys, Property 4: App Registry Export/Import Round-Trip', () => {

  it('Export and import into empty registry produces equivalent registry', () => {
    fc.assert(
      fc.property(uniqueRegistryArb, (registry) => {
        // Export
        const exportFile = buildAppRegistryExportFile(registry);
        const fileContent = JSON.stringify(exportFile);

        // Import into empty registry
        const result = importAppRegistry(fileContent, []);

        // Verify success
        expect(result.success).toBe(true);
        expect(result.added).toBe(registry.length);
        expect(result.skipped).toBe(0);

        // Verify the resulting registry contains all original apps
        expect(result.registry.length).toBe(registry.length);

        // Each original app should be in the result
        for (const app of registry) {
          const found = result.registry.find(
            r => r.name.toLowerCase() === app.name.toLowerCase()
          );
          expect(found).toBeDefined();
          expect(found.name).toBe(app.name);
          expect(found.secret).toEqual(app.secret);
          expect(found.restricted).toBe(app.restricted);
        }
      }),
      { numRuns: 5 }
    );
  });

  it('Duplicate detection works correctly with case-insensitive name matching', () => {
    fc.assert(
      fc.property(uniqueRegistryArb, (registry) => {
        // Export
        const exportFile = buildAppRegistryExportFile(registry);
        const fileContent = JSON.stringify(exportFile);

        // Import into existing registry that already has the same apps
        const result = importAppRegistry(fileContent, registry.slice());

        // All should be skipped as duplicates
        expect(result.success).toBe(true);
        expect(result.added).toBe(0);
        expect(result.skipped).toBe(registry.length);

        // Registry size should remain the same
        expect(result.registry.length).toBe(registry.length);
      }),
      { numRuns: 5 }
    );
  });

  it('Export format contains correct meta header (type, version, count)', () => {
    fc.assert(
      fc.property(uniqueRegistryArb, (registry) => {
        const exportFile = buildAppRegistryExportFile(registry);

        // Verify meta header
        expect(exportFile.meta.type).toBe('license_gen_app_registry');
        expect(exportFile.meta.version).toBe('2.0');
        expect(exportFile.meta.count).toBe(registry.length);
        expect(exportFile.meta.exportDate).toBeDefined();

        // Verify exportDate is valid ISO string
        const parsedDate = new Date(exportFile.meta.exportDate);
        expect(parsedDate.toISOString()).toBe(exportFile.meta.exportDate);

        // Verify data section
        expect(exportFile.data).toEqual(registry);
      }),
      { numRuns: 5 }
    );
  });

  it('Import rejects invalid file types/formats', () => {
    // Test with invalid JSON
    const invalidJsonResult = importAppRegistry('not valid json{{{', []);
    expect(invalidJsonResult.success).toBe(false);
    expect(invalidJsonResult.error).toContain('not valid JSON');

    // Test with wrong type identifier
    fc.assert(
      fc.property(uniqueRegistryArb, (registry) => {
        const wrongType = {
          meta: { type: 'wrong_type', exportDate: new Date().toISOString(), version: '2.0', count: registry.length },
          data: registry
        };
        const result = importAppRegistry(JSON.stringify(wrongType), []);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not a valid app registry export');
      }),
      { numRuns: 3 }
    );

    // Test with missing data section
    const missingData = {
      meta: { type: 'license_gen_app_registry', exportDate: new Date().toISOString(), version: '2.0', count: 0 }
    };
    const missingDataResult = importAppRegistry(JSON.stringify(missingData), []);
    expect(missingDataResult.success).toBe(false);
    expect(missingDataResult.error).toContain('does not contain valid');

    // Test with null meta
    const nullMeta = { meta: null, data: [] };
    const nullMetaResult = importAppRegistry(JSON.stringify(nullMeta), []);
    expect(nullMetaResult.success).toBe(false);
  });

  it('Round-trip preserves all app properties (name, codes, restricted flag)', () => {
    fc.assert(
      fc.property(uniqueRegistryArb, (registry) => {
        // Export
        const exportFile = buildAppRegistryExportFile(registry);
        const fileContent = JSON.stringify(exportFile);

        // Import into empty registry
        const result = importAppRegistry(fileContent, []);

        expect(result.success).toBe(true);

        // Verify every property is preserved for each app
        for (let i = 0; i < registry.length; i++) {
          const original = registry[i];
          const imported = result.registry.find(
            r => r.name.toLowerCase() === original.name.toLowerCase()
          );

          expect(imported).toBeDefined();
          // Name preserved exactly
          expect(imported.name).toBe(original.name);
          // Secret codes preserved exactly
          expect(imported.secret).toEqual(original.secret);
          // Restricted flag preserved
          expect(imported.restricted).toBe(original.restricted);
        }
      }),
      { numRuns: 5 }
    );
  });

  it('Merging into non-empty registry: added + skipped equals imported count', () => {
    fc.assert(
      fc.property(
        uniqueRegistryArb,
        uniqueRegistryArb,
        (existingRegistry, importedRegistry) => {
          // Export the imported registry
          const exportFile = buildAppRegistryExportFile(importedRegistry);
          const fileContent = JSON.stringify(exportFile);

          // Import into existing registry
          const result = importAppRegistry(fileContent, existingRegistry.slice());

          // Verify added + skipped = total in imported file
          expect(result.success).toBe(true);
          expect(result.added + result.skipped).toBe(importedRegistry.length);

          // Verify the merged registry contains all unique apps from both
          const allUniqueNames = new Set();
          for (const app of existingRegistry) {
            allUniqueNames.add(app.name.toLowerCase());
          }
          for (const app of importedRegistry) {
            allUniqueNames.add(app.name.toLowerCase());
          }
          expect(result.registry.length).toBe(allUniqueNames.size);

          // Verify skipped count equals the number of duplicates
          let expectedDuplicates = 0;
          for (const app of importedRegistry) {
            const existsInOriginal = existingRegistry.some(
              e => e.name.toLowerCase() === app.name.toLowerCase()
            );
            if (existsInOriginal) expectedDuplicates++;
          }
          expect(result.skipped).toBe(expectedDuplicates);
          expect(result.added).toBe(importedRegistry.length - expectedDuplicates);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('Case-insensitive duplicate detection: same name with different casing is a duplicate', () => {
    fc.assert(
      fc.property(
        appNameArb,
        secretCodesArb,
        fc.boolean(),
        (name, secret, restricted) => {
          // Create existing registry with original name
          const existing = [{ name: name, secret: secret, restricted: restricted }];

          // Create import with same name but different case
          const altCaseName = name.split('').map((c, i) =>
            i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()
          ).join('');

          // Only test if the case transformation actually produces a different string
          // (same case-insensitive match)
          if (altCaseName.toLowerCase() !== name.toLowerCase()) return;

          const importData = {
            meta: { type: 'license_gen_app_registry', exportDate: new Date().toISOString(), version: '2.0', count: 1 },
            data: [{ name: altCaseName, secret: [65, 66], restricted: false }]
          };

          const result = importAppRegistry(JSON.stringify(importData), existing);

          expect(result.success).toBe(true);
          expect(result.skipped).toBe(1);
          expect(result.added).toBe(0);
          expect(result.registry.length).toBe(1);
        }
      ),
      { numRuns: 5 }
    );
  });
});
