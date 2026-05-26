import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            vscode: path.resolve(process.cwd(), 'test/mocks/vscode.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // Tests must not depend on built artifacts. If a future test needs dist files,
        // wire that via globalSetup so the dependency is explicit.
        globals: false,
    },
});
