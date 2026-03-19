import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
            input: resolve(__dirname, 'src/extension.ts'),
            preserveEntrySignatures: 'strict',
            external: [
                'vscode', 'path', 'fs', 'url', 'buffer', 'stream', 'util', 'os', 'child_process', 'constants',
                'puppeteer-core', 'html-to-docx'
            ],
            output: {
                format: 'cjs',
                entryFileNames: 'extension.js',
            }
        },
        target: 'node18',
        minify: 'esbuild',
        sourcemap: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    }
});
