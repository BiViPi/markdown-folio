const fs = require('fs');
const path = require('path');

const ROOT_PACKAGES = ['string_decoder'];
const SOURCE_NODE_MODULES = path.join(__dirname, '..', 'node_modules');
const TARGET_NODE_MODULES = path.join(__dirname, '..', 'dist', 'node_modules');

const seen = new Set();

function packagePath(name, baseDir) {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return path.join(baseDir, scope, pkg);
  }
  return path.join(baseDir, name);
}

function readPackageJson(name) {
  const dir = packagePath(name, SOURCE_NODE_MODULES);
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Runtime dependency is missing from node_modules: ${name}`);
  }
  return { dir, pkg: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function visit(name) {
  if (seen.has(name)) {
    return;
  }

  const { pkg } = readPackageJson(name);
  seen.add(name);

  for (const dep of Object.keys(pkg.dependencies || {})) {
    visit(dep);
  }
}

function copyPackage(name) {
  const source = packagePath(name, SOURCE_NODE_MODULES);
  const target = packagePath(name, TARGET_NODE_MODULES);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: p => !p.includes(`${path.sep}.cache${path.sep}`),
  });
}

fs.rmSync(TARGET_NODE_MODULES, { recursive: true, force: true });
for (const name of ROOT_PACKAGES) {
  visit(name);
}
for (const name of seen) {
  copyPackage(name);
}

console.log(`Copied ${seen.size} runtime package(s) to dist/node_modules.`);
