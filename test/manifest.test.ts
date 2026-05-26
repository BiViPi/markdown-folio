import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 2 manifest test — guards the orphaned-settings removal.
 *
 * Audit 03 #4 and the v1.5.4 master plan §8 remove `markdownFolio.showToc` and
 * `markdownFolio.tocPosition` from `contributes.configuration.properties`. The
 * runtime never read those keys, but they showed up in the VS Code Settings
 * UI as no-op toggles. This test fails if either key reappears, so a future
 * maintainer cannot accidentally re-add them without a deliberate test update.
 */

describe('package.json contributes.configuration.properties', () => {
    const manifestPath = path.resolve(__dirname, '..', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        contributes?: {
            configuration?: {
                properties?: Record<string, unknown>;
            };
        };
    };
    const properties = manifest.contributes?.configuration?.properties ?? {};

    it('does not declare markdownFolio.showToc', () => {
        expect(properties).not.toHaveProperty('markdownFolio.showToc');
    });

    it('does not declare markdownFolio.tocPosition', () => {
        expect(properties).not.toHaveProperty('markdownFolio.tocPosition');
    });

    it('still declares markdownFolio.showTocSidebar (the live runtime setting)', () => {
        expect(properties).toHaveProperty('markdownFolio.showTocSidebar');
    });
});
