import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
            input: resolve(__dirname, 'src/extension.ts'),
            preserveEntrySignatures: 'strict',
            external: (id: string) => {
                const builtins = ['vscode', 'path', 'fs', 'url', 'buffer', 'stream', 'util', 'os',
                    'child_process', 'constants', 'crypto', 'events', 'net', 'http', 'https',
                    'tls', 'zlib', 'assert', 'dns', 'tty', 'readline', 'worker_threads', 'perf_hooks'];
                // bufferutil & utf-8-validate are optional native addons for ws (used by puppeteer-core).
                // They must not be bundled — Electron ABI differs from Node.js ABI and causes
                // "t.mask is not a function" at runtime. Marking them external lets ws fall back to JS.
                const nativeOptional = ['bufferutil', 'utf-8-validate'];
                return nativeOptional.includes(id) || builtins.some(b => id === b || id.startsWith(b + '/') || id.startsWith('node:'));
            },
            output: {
                format: 'cjs',
                entryFileNames: 'extension.js',
                inlineDynamicImports: true,
            }
        },
        target: 'node18',
        minify: 'esbuild',
        sourcemap: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        },
        conditions: ['node', 'require', 'default'],
        mainFields: ['main', 'module'],
    }
});
