/**
 * electron-builder `spawn EPERM` workaround.
 *
 * This machine blocks script (.bat/.cmd) execution from user-writable dirs
 * (SRP/AppLocker). electron-builder 26's npm module collector writes a temp
 * .bat and runs it through cmd.exe, which dies with `spawn EPERM` and kills
 * the whole build — silently leaving a stale EXE behind.
 *
 * Patch it to invoke `node npm-cli.js` directly instead: node.exe is allowed
 * to run, and the .js is read as data rather than executed as a script.
 * Harmless on machines without the policy, and idempotent. `npm install`
 * restores the original file, so this runs before every build.
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const f = path.join(root, 'node_modules/app-builder-lib/out/node-module-collector/nodeModulesCollector.js');

if (!fs.existsSync(f)) {
  console.warn('[patch-builder] collector not found — skip');
  process.exit(0);
}

let s = fs.readFileSync(f, 'utf8');
if (s.includes('LOCAL WORKAROUND (orbit-downloader)')) {
  console.log('[patch-builder] already patched');
  process.exit(0);
}

const findA =
  '        const execName = path.basename(command, path.extname(command));\n' +
  '        const isWindowsScriptFile = process.platform === "win32" && path.extname(command).toLowerCase() === ".cmd";\n' +
  '        if (isWindowsScriptFile) {';

if (!s.includes(findA)) {
  console.warn('[patch-builder] anchor not found (electron-builder changed?) — skip, build may fail');
  process.exit(0);
}

const replA =
  '        const execName = path.basename(command, path.extname(command));\n' +
  '        let useShell = true;\n' +
  '        // LOCAL WORKAROUND (orbit-downloader): machine blocks script execution from\n' +
  '        // user-writable dirs (SRP/AppLocker) -> temp .bat trick fails with EPERM. For\n' +
  '        // npm, run node + npm-cli.js directly. Reapplied by scripts/patch-builder.cjs.\n' +
  '        const npmCliJs = process.platform === "win32" && execName === "npm"\n' +
  '            ? path.join(path.dirname(command), "node_modules", "npm", "bin", "npm-cli.js")\n' +
  '            : null;\n' +
  '        const isWindowsScriptFile = process.platform === "win32" && path.extname(command).toLowerCase() === ".cmd";\n' +
  '        if (npmCliJs && require("fs").existsSync(npmCliJs)) {\n' +
  '            command = process.execPath;\n' +
  '            args = [npmCliJs, ...args];\n' +
  '            useShell = false;\n' +
  '        }\n' +
  '        else if (isWindowsScriptFile) {';

s = s.replace(findA, replA).replace('shell: true,', 'shell: useShell,');
fs.writeFileSync(f, s);
console.log('[patch-builder] patched -> node + npm-cli.js (no temp script)');
