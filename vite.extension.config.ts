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
                    'tls', 'zlib', 'assert', 'dns', 'tty', 'readline', 'worker_threads', 'perf_hooks',
                    'vm', 'module', 'querystring', 'string_decoder', 'timers', 'process'];
                const runtimeModuleTrees = [
                    // Phase 3 sanitizer: bundling jsdom into extension.js breaks its relative
                    // worker/module resolution (`./xhr-sync-worker.js`) during activation.
                    // Keep this chain in node_modules so the extension host loads the package
                    // with its original on-disk layout.
                    'isomorphic-dompurify',
                    'dompurify',
                    'jsdom',
                ];
                // bufferutil & utf-8-validate are optional native addons for ws (used by puppeteer-core).
                // They must not be bundled — Electron ABI differs from Node.js ABI and causes
                // "t.mask is not a function" at runtime. Marking them external lets ws fall back to JS.
                const nativeOptional = ['bufferutil', 'utf-8-validate'];
                const isBuiltin = builtins.some(b => id === b || id.startsWith(b + '/') || id.startsWith('node:'));
                const isRuntimeTree = runtimeModuleTrees.some(pkg => id === pkg || id.startsWith(pkg + '/'));
                return nativeOptional.includes(id) || isBuiltin || isRuntimeTree;
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
