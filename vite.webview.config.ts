import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false, // extension build clears dist first
        rollupOptions: {
            input: resolve(__dirname, 'webview/main.ts'),
            output: {
                format: 'iife',
                name: 'webviewBundle', // needed for iife
                entryFileNames: 'webview.js',
                assetFileNames: '[name].[ext]'
            }
        },
        target: 'es2020',
        minify: 'esbuild',
        sourcemap: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    }
});
