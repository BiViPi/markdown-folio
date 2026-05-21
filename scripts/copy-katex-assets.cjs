const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceCss = path.join(root, 'node_modules', 'katex', 'dist', 'katex.min.css');
const sourceFonts = path.join(root, 'node_modules', 'katex', 'dist', 'fonts');
const distDir = path.join(root, 'dist');
const targetCss = path.join(distDir, 'katex.css');
const targetFonts = path.join(distDir, 'fonts');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

fs.copyFileSync(sourceCss, targetCss);
fs.cpSync(sourceFonts, targetFonts, { recursive: true, force: true });

// Copy mermaid.min.js for PDF export
const sourceMermaid = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const targetMermaid = path.join(distDir, 'mermaid.min.js');
fs.copyFileSync(sourceMermaid, targetMermaid);

// Copy DM Sans, DM Serif Display, and Merriweather fonts for PDF export
const fontSources = [
    { pkg: '@fontsource/dm-sans', weights: ['300', '400', '500'], styles: ['normal'], subsets: ['latin'] },
    { pkg: '@fontsource/dm-serif-display', weights: ['400'], styles: ['normal', 'italic'], subsets: ['latin', 'latin-ext'] },
    { pkg: '@fontsource/merriweather', weights: ['400', '700'], styles: ['normal'], subsets: ['latin', 'latin-ext'] },
];
for (const { pkg, weights, styles, subsets } of fontSources) {
    const filesDir = path.join(root, 'node_modules', pkg, 'files');
    const pkgShort = pkg.replace('@fontsource/', '');
    for (const subset of subsets) {
        for (const weight of weights) {
            for (const style of styles) {
                const styleTag = style === 'normal' ? 'normal' : 'italic';
                for (const ext of ['woff2', 'woff']) {
                    const fname = `${pkgShort}-${subset}-${weight}-${styleTag}.${ext}`;
                    const src = path.join(filesDir, fname);
                    if (fs.existsSync(src)) {
                        fs.copyFileSync(src, path.join(targetFonts, fname));
                    }
                }
            }
        }
    }
}

// Copy PDF stylesheet
const sourcePdfCss = path.join(root, 'webview', 'styles', 'document.pdf.css');
const targetPdfCss = path.join(distDir, 'document.pdf.css');
fs.copyFileSync(sourcePdfCss, targetPdfCss);

// Copy webview theme + document CSS for HTML export
const sourceThemeCss = path.join(root, 'webview', 'styles', 'theme.css');
const sourceDocumentCss = path.join(root, 'webview', 'styles', 'document.css');
const sourceToolbarCss = path.join(root, 'webview', 'styles', 'toolbar.css');
const sourceSidebarCss = path.join(root, 'webview', 'styles', 'sidebar.css');
fs.copyFileSync(sourceThemeCss, path.join(distDir, 'theme.css'));
fs.copyFileSync(sourceDocumentCss, path.join(distDir, 'document.css'));
fs.copyFileSync(sourceToolbarCss, path.join(distDir, 'toolbar.css'));
fs.copyFileSync(sourceSidebarCss, path.join(distDir, 'sidebar.css'));

function readPackageJson(packageRoot) {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
}

function packageNameToPath(nodeModulesRoot, packageName) {
    return path.join(nodeModulesRoot, ...packageName.split('/'));
}

function copyPackageDirectory(sourceDir, targetDir) {
    fs.cpSync(sourceDir, targetDir, {
        recursive: true,
        force: true
    });
}

function copyRuntimeDependencyTree(packageName, sourceNodeModulesRoot, targetNodeModulesRoot, seen = new Set()) {
    if (seen.has(packageName)) {
        return;
    }
    seen.add(packageName);

    const sourcePackageDir = packageNameToPath(sourceNodeModulesRoot, packageName);
    if (!fs.existsSync(sourcePackageDir)) {
        throw new Error(`Missing runtime dependency package: ${packageName}`);
    }

    const targetPackageDir = packageNameToPath(targetNodeModulesRoot, packageName);
    fs.mkdirSync(path.dirname(targetPackageDir), { recursive: true });
    copyPackageDirectory(sourcePackageDir, targetPackageDir);

    const pkg = readPackageJson(sourcePackageDir);
    for (const dependencyName of Object.keys(pkg.dependencies || {})) {
        copyRuntimeDependencyTree(dependencyName, sourceNodeModulesRoot, targetNodeModulesRoot, seen);
    }
}

// Copy node-tikzjax runtime assets and its runtime dependency tree for shaded TikZ rendering.
const sourceNodeModulesRoot = path.join(root, 'node_modules');
const tikzJaxRoot = path.join(sourceNodeModulesRoot, 'node-tikzjax');
const tikzJaxTargetRoot = path.join(distDir, 'vendor', 'node-tikzjax');
if (fs.existsSync(tikzJaxRoot)) {
    fs.rmSync(tikzJaxTargetRoot, { recursive: true, force: true });
    fs.mkdirSync(tikzJaxTargetRoot, { recursive: true });
    copyPackageDirectory(tikzJaxRoot, tikzJaxTargetRoot);

    const tikzJaxNodeModulesTarget = path.join(tikzJaxTargetRoot, 'node_modules');
    fs.mkdirSync(tikzJaxNodeModulesTarget, { recursive: true });

    const tikzJaxPkg = readPackageJson(tikzJaxRoot);
    const seenDependencies = new Set();
    for (const dependencyName of Object.keys(tikzJaxPkg.dependencies || {})) {
        copyRuntimeDependencyTree(dependencyName, sourceNodeModulesRoot, tikzJaxNodeModulesTarget, seenDependencies);
    }
}

console.log('Copied KaTeX assets, mermaid.min.js, DM fonts, Merriweather, node-tikzjax runtime assets, document.pdf.css, and webview CSS to dist/');
