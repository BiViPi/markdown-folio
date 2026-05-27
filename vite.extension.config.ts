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
                // bufferutil & utf-8-validate are optional native addons for ws (used by puppeteer-core).
                // They must not be bundled — Electron ABI differs from Node.js ABI and causes
                // "t.mask is not a function" at runtime. Marking them external lets ws fall back to JS.
                const nativeOptional = ['bufferutil', 'utf-8-validate'];
                const isBuiltin = builtins.some(b => id === b || id.startsWith(b + '/') || id.startsWith('node:'));
                return nativeOptional.includes(id) || isBuiltin;
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
            '@': resolve(__dirname, 'src'),
            // Some Node-oriented deps still import `string_decoder/` with a
            // trailing slash. In an extension host we want the builtin module,
            // not a package lookup that can fail at activation time.
            'string_decoder/': 'string_decoder',
        },
        conditions: ['node', 'require', 'default'],
        mainFields: ['main', 'module'],
    }
});
