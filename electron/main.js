import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { spawn } from 'child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import os from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store();

let mainWindow;
const activeDownloads = new Map();

// ---------------- Auto-update (custom, GitHub Releases) ----------------
const UPDATE_REPO = 'productionkhu-tech/orbit-downloader';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Log file lives next to the installed EXE when possible, otherwise userData.
function updateLogPath() {
  try {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (exe) return path.join(path.dirname(exe), 'update.log');
  } catch (_) {}
  return path.join(app.getPath('userData'), 'update.log');
}

function appendUpdateLog(level, msg) {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(updateLogPath(), line, 'utf8');
  } catch (_) {}
}

const ulog = {
  info: (m) => { console.log('[update]', m); appendUpdateLog('INFO', m); },
  warn: (m) => { console.warn('[update]', m); appendUpdateLog('WARN', m); },
  error: (m) => { console.error('[update]', m); appendUpdateLog('ERROR', m); },
};

let lastUpdateError = ''; // surfaced in About dialog

// Path of the actual on-disk EXE the user double-clicked. For an
// electron-builder "portable" target the running process lives in a temp
// extract — but PORTABLE_EXECUTABLE_FILE points to the original .exe, which
// is what we want to overwrite for the update to stick.
function installedExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

let pendingUpdate = null; // { version, notes, newExePath }

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'orbit-downloader-updater', Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadToFile(url, dest, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'orbit-downloader-updater', Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  let received = 0;
  const file = fs.createWriteStream(dest);
  const reader = Readable.fromWeb(res.body);
  reader.on('data', (chunk) => {
    received += chunk.length;
    if (onProgress) onProgress(received, total);
  });
  await pipeline(reader, file);
}

function sendUpdateStatus(status, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...extra });
  }
}

async function checkForUpdate() {
  if (pendingUpdate) {
    sendUpdateStatus('ready', { version: pendingUpdate.version });
    return;
  }
  ulog.info(`check start  current=${app.getVersion()}  exe=${installedExePath()}`);
  sendUpdateStatus('checking');
  const release = await fetchLatestRelease();
  if (!release || !release.tag_name) {
    const m = 'GitHub Releases API에 도달하지 못했어요. (네트워크/방화벽 확인)';
    lastUpdateError = m; ulog.error(m);
    sendUpdateStatus('error', { message: m });
    return;
  }
  const latest = release.tag_name.replace(/^v/, '');
  const current = app.getVersion();
  ulog.info(`server tag=${latest}  current=${current}`);
  if (compareSemver(latest, current) <= 0) {
    sendUpdateStatus('current', { version: current });
    return;
  }

  const asset = (release.assets || []).find((a) => /^OrbitDownloader\.exe$/i.test(a.name));
  if (!asset) {
    const m = `릴리즈 v${latest}에 OrbitDownloader.exe 자산이 없습니다.`;
    lastUpdateError = m; ulog.error(m);
    sendUpdateStatus('error', { message: m });
    return;
  }

  const targetExe = installedExePath();
  if (!process.env.PORTABLE_EXECUTABLE_FILE) {
    ulog.warn(`PORTABLE_EXECUTABLE_FILE not set — falling back to ${targetExe}.  Update may not persist if this points to a temp directory.`);
  }
  const newPath = `${targetExe}.new`;
  ulog.info(`download start  asset=${asset.browser_download_url}  size=${asset.size}  → ${newPath}`);
  sendUpdateStatus('downloading', { version: latest, received: 0, total: asset.size || 0, percent: 0 });
  try {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    let lastSent = 0;
    await downloadToFile(asset.browser_download_url, newPath, (received, total) => {
      const now = Date.now();
      if (now - lastSent > 300) {
        lastSent = now;
        const percent = total ? Math.floor((received / total) * 100) : 0;
        sendUpdateStatus('downloading', { version: latest, received, total, percent });
      }
    });
    const newSize = fs.statSync(newPath).size;
    ulog.info(`download done  bytes=${newSize}`);
    if (newSize < 50 * 1024 * 1024) {
      throw new Error(`다운로드된 파일이 비정상적으로 작아요 (${newSize} bytes). HTML 에러 페이지일 수 있어요.`);
    }
    pendingUpdate = { version: latest, notes: release.body || '', newExePath: newPath };
    sendUpdateStatus('ready', { version: latest });
    ulog.info(`ready  v${latest} staged at ${newPath}`);

    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: 'Orbit Downloader',
          body: `v${latest} 새 버전이 다운로드됐어요. 앱을 끄면 자동으로 적용 후 다시 켜집니다.`,
          silent: false,
        });
        n.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show(); mainWindow.focus();
          }
        });
        n.show();
      }
    } catch (e) { ulog.warn(`notification failed: ${e.message}`); }
  } catch (e) {
    lastUpdateError = e.message;
    ulog.error(`download failed: ${e.message}`);
    sendUpdateStatus('error', { message: `다운로드 실패: ${e.message}` });
  }
}

function startUpdateScheduler() {
  // First check 2 seconds after launch — fast enough to feel responsive,
  // late enough that the renderer has registered its listeners.
  setTimeout(checkForUpdate, 2_000);
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
}

// Spawn a detached helper batch that, after this process exits, replaces the
// portable exe with the staged .new file.
//
// The portable launcher keeps the .exe file locked for some time after the
// inner app quits (it has to clean up its temp extraction first). So instead
// of a fixed wait, we POLL: try to rename every 2 seconds, up to 60 seconds.
// Once rename succeeds the launcher has definitely released the handle.
//
// All steps are logged to swap.log next to the exe so failures are diagnosable.
// The swap helper itself is also written next to the exe (not %TEMP%) so it
// isn't touched by aggressive temp-cleaners or quarantined by AV.
function applyPendingUpdateOnExit({ relaunch }) {
  if (!pendingUpdate) return;
  const target = installedExePath();
  const src = pendingUpdate.newExePath;
  if (!fs.existsSync(src)) {
    ulog.error(`swap aborted — staged file missing: ${src}`);
    return;
  }
  if (!process.env.PORTABLE_EXECUTABLE_FILE) {
    ulog.error(`swap aborted — PORTABLE_EXECUTABLE_FILE not set, target=${target} looks like a temp extraction and won't survive`);
    return;
  }

  try {
    store.set('pendingAppliedFrom', app.getVersion());
    store.set('pendingAppliedTo', pendingUpdate.version);
  } catch (_) {}

  const dir = path.dirname(target);
  const targetBase = path.basename(target);
  const oldBase = `${targetBase}.old`;
  const oldPath = path.join(dir, oldBase);
  const swapLog = path.join(dir, 'swap.log');
  const swapBat = path.join(dir, 'orbit-swap.bat');

  // Use GOTO-based flow control instead of nested ifs — cmd's nested-if
  // parsing inside parentheses is notoriously buggy.
  const lines = [
    '@echo off',
    'setlocal',
    `set "TARGET=${target}"`,
    `set "SRC=${src}"`,
    `set "OLD=${oldPath}"`,
    `set "OLD_BASE=${oldBase}"`,
    `set "TARGET_BASE=${targetBase}"`,
    `set "LOG=${swapLog}"`,
    '',
    'echo. >> "%LOG%"',
    'echo ============================================================ >> "%LOG%"',
    'echo [%date% %time%] swap.bat START >> "%LOG%"',
    'echo target = %TARGET% >> "%LOG%"',
    'echo src    = %SRC% >> "%LOG%"',
    '',
    'REM Clean up any leftover .old from a previous successful swap.',
    'if exist "%OLD%" (',
    '  del /F /Q "%OLD%" >nul 2>&1',
    '  echo [%date% %time%] removed leftover .old >> "%LOG%"',
    ')',
    '',
    'REM Poll for file unlock — try to rename every 2 seconds, up to ~60 seconds.',
    'set /A ATTEMPTS=0',
    ':try_rename',
    'set /A ATTEMPTS+=1',
    'ren "%TARGET%" "%OLD_BASE%" >nul 2>&1',
    'if not errorlevel 1 goto :renamed',
    'if %ATTEMPTS% GEQ 30 goto :rename_failed',
    'ping 127.0.0.1 -n 3 >nul',
    'goto :try_rename',
    '',
    ':rename_failed',
    'echo [%date% %time%] FATAL rename failed after %ATTEMPTS% attempts >> "%LOG%"',
    'goto :end',
    '',
    ':renamed',
    'echo [%date% %time%] rename ok on attempt %ATTEMPTS% >> "%LOG%"',
    'move /Y "%SRC%" "%TARGET%" >> "%LOG%" 2>&1',
    'if errorlevel 1 goto :move_failed',
    'echo [%date% %time%] swap complete >> "%LOG%"',
    'goto :relaunch',
    '',
    ':move_failed',
    'echo [%date% %time%] FATAL move failed, rolling back >> "%LOG%"',
    'ren "%OLD%" "%TARGET_BASE%" >nul 2>&1',
    'goto :end',
    '',
    ':relaunch',
  ];
  if (relaunch) {
    lines.push('ping 127.0.0.1 -n 2 >nul');
    lines.push('start "" "%TARGET%"');
    lines.push('echo [%date% %time%] relaunched >> "%LOG%"');
  }
  lines.push('');
  lines.push(':end');
  lines.push('endlocal');

  try {
    fs.writeFileSync(swapBat, lines.join('\r\n'), 'utf8');
    ulog.info(`spawning swap helper: ${swapBat}  relaunch=${relaunch}  swap.log=${swapLog}`);
    spawn('cmd', ['/c', swapBat], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch (e) {
    ulog.error(`swap spawn failed: ${e.message}`);
  }
}

// On startup, clean up `.old` from a previous successful swap.
function cleanupAfterSwap() {
  try {
    const exe = installedExePath();
    const oldPath = `${exe}.old`;
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      ulog.info(`cleaned up leftover ${oldPath}`);
    }
  } catch (e) {
    ulog.warn(`leftover .old cleanup failed: ${e.message}`);
  }
}

// Was an update applied just before this launch? If so, show a toast.
function consumePendingAppliedToast() {
  try {
    const from = store.get('pendingAppliedFrom');
    const to = store.get('pendingAppliedTo');
    const current = app.getVersion();
    if (from && to && to === current) {
      store.delete('pendingAppliedFrom');
      store.delete('pendingAppliedTo');
      return { from, to };
    }
    // If the recorded "to" doesn't match the current running version, the
    // swap probably failed silently — clear stale state but don't toast.
    if (from || to) {
      store.delete('pendingAppliedFrom');
      store.delete('pendingAppliedTo');
    }
  } catch (_) {}
  return null;
}

// Restart-for-update IPC is intentionally removed in v1.5.5.
// User intent: "버튼 누르지 말고 알아서 끄고 켜라" — updates apply only on
// the natural before-quit, then auto-relaunch.

ipcMain.handle('check-update-now', async () => {
  await checkForUpdate();
  return true;
});

ipcMain.handle('get-debug-info', () => {
  let logTail = '';
  try {
    const p = updateLogPath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.trim().split('\n');
      logTail = lines.slice(-25).join('\n');
    }
  } catch (e) { logTail = `(로그 읽기 실패: ${e.message})`; }
  return {
    version: app.getVersion(),
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    portableExe: process.env.PORTABLE_EXECUTABLE_FILE || '(not set)',
    runningExe: app.getPath('exe'),
    installedExe: installedExePath(),
    logPath: updateLogPath(),
    lastError: lastUpdateError || '(none)',
    logTail,
    platform: `${process.platform} ${os.release()}`,
    electron: process.versions.electron,
    node: process.versions.node,
  };
});

ipcMain.handle('open-log-folder', () => {
  const p = updateLogPath();
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(path.dirname(p));
  return true;
});

// ---------------- Bundled binaries ----------------
// In dev, bin/ lives next to electron/. In a packaged app, electron-builder
// puts it under resources/bin/.
function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', 'bin');
}

function ytdlpPath() {
  const candidate = path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return fs.existsSync(candidate) ? candidate : 'yt-dlp';
}

function ffmpegPath() {
  const candidate = path.join(binDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(candidate) ? candidate : '';
}

function appIconPath() {
  // In dev, the icon lives in <repo>/public. In a packaged build,
  // electron-builder copies it next to the main exe via the win.icon config,
  // but a runtime icon helps for the taskbar / Alt-Tab thumbnail.
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, '..', 'icon.ico'),
        path.join(path.dirname(app.getPath('exe')), 'icon.ico'),
      ]
    : [path.join(__dirname, '..', 'public', 'icon.ico')];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#FAF9F5',
    show: false,
    autoHideMenuBar: true,
    icon: appIconPath(),
    title: 'Orbit Downloader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (app.isPackaged) {
      cleanupAfterSwap();
      startUpdateScheduler();
    }

    // If we just came back from an auto-applied update, tell the renderer.
    const applied = consumePendingAppliedToast();
    if (applied && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        mainWindow.webContents.send('update-applied', applied);
      }, 1500);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevLoad = process.env.NODE_ENV === 'development' && url.startsWith('http://localhost:');
    if (!isDevLoad && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const child of activeDownloads.values()) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
  activeDownloads.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // User closed the app while an update was pending → swap + auto-relaunch
  // (matches the "끄면 자동으로 새 버전이 실행됨" mental model).
  applyPendingUpdateOnExit({ relaunch: true });
});

// ---------------- Config ----------------
function defaultSaveDir() {
  return path.join(os.homedir(), 'Downloads');
}

ipcMain.handle('get-config', () => {
  return {
    saveDirectory: store.get('saveDirectory', defaultSaveDir()),
    quality: store.get('quality', 'best'),
    audioOnly: store.get('audioOnly', false),
    subtitle: store.get('subtitle', false),
    maxConcurrent: store.get('maxConcurrent', 2),
  };
});

ipcMain.handle('set-config', (_e, partial) => {
  for (const [k, v] of Object.entries(partial || {})) {
    store.set(k, v);
  }
  return true;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedDir = result.filePaths[0];
    store.set('saveDirectory', selectedDir);
    return selectedDir;
  }
  return null;
});

ipcMain.handle('read-clipboard', () => clipboard.readText() || '');

ipcMain.handle('open-folder', (_e, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) return shell.openPath(folderPath);
  return null;
});

ipcMain.handle('show-file', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// ---------------- yt-dlp probe ----------------
ipcMain.handle('check-ytdlp', () => {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const bin = ytdlpPath();
    const bundled = bin !== 'yt-dlp';
    const p = spawn(bin, ['--version'], { windowsHide: true });
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => {
      resolve({ installed: code === 0, bundled, version: stdout.trim(), error: stderr.trim() });
    });
    p.on('error', (err) => {
      resolve({ installed: false, bundled, version: '', error: err.message });
    });
  });
});

// ---------------- Download ----------------
function sanitizeFilename(name) {
  if (!name) return '';
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned;
}

function buildArgs({ url, saveDirectory, title, quality, audioOnly, subtitle, referer }) {
  const safeTitle = sanitizeFilename(title);
  // Title present → use as filename. Empty → let yt-dlp pick from video metadata.
  const outputTemplate = path.join(
    saveDirectory,
    safeTitle
      ? `${safeTitle}.%(ext)s`
      : '%(title).100s [%(id)s].%(ext)s'
  );

  const args = [
    '-o', outputTemplate,
    '--retries', '10',
    '--fragment-retries', '10',
    '--extractor-retries', '3',
    '--no-playlist',
    '--no-mtime',
    '--newline',
    '--progress',
    '--restrict-filenames',
    '--no-warnings',
    '--add-header',
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  if (referer) {
    args.push('--add-header', `Referer:${referer}`);
  }

  const ff = ffmpegPath();
  if (ff) args.push('--ffmpeg-location', ff);

  if (audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    let format;
    switch (quality) {
      case '1080':
        format = 'bv*[height<=1080]+ba/b[height<=1080]/best';
        break;
      case '720':
        format = 'bv*[height<=720]+ba/b[height<=720]/best';
        break;
      case '480':
        format = 'bv*[height<=480]+ba/b[height<=480]/best';
        break;
      case 'best':
      default:
        format = 'bv*+ba/b';
        break;
    }
    args.push('-f', format, '--merge-output-format', 'mp4');
  }

  if (subtitle) {
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'ko,en', '--embed-subs');
  }

  args.push(url);
  return args;
}

// ----- Generic page-scrape fallback -----
async function fetchPage(url, refererUrl) {
  // Electron 42 ships with Node 22 → global fetch available, handles gzip automatically.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko,en;q=0.9',
        ...(refererUrl ? { Referer: refererUrl } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Quality score from a JSON-style label (e.g. "HD", "FHD", "1080p", "SD").
function scoreLabel(label) {
  const l = label.toLowerCase();
  if (/2160|uhd|4k/.test(l)) return 2160;
  if (/1440|qhd/.test(l)) return 1440;
  if (/1080|fhd|full[_\-]?hd/.test(l)) return 1080;
  if (/720|^hd$/.test(l)) return 720;
  if (/480|^sd$/.test(l)) return 480;
  if (/360|^md$/.test(l)) return 360;
  if (/240|^ld$|mobile|low/.test(l)) return 240;
  return 0;
}

// Heuristic score from URL itself when no explicit label is around.
function scoreStreamUrl(url) {
  const m = url.match(/[_\-./](\d{3,4})p(?:[_\-./]|$)/i);
  if (m) return parseInt(m[1], 10);
  const lower = url.toLowerCase();
  if (/[_\-/](orig|original|source|master)/.test(lower)) return 9999;
  if (/[_\-/](uhd|4k|2160)/.test(lower)) return 2160;
  if (/[_\-/](fhd|1080)/.test(lower)) return 1080;
  if (/[_\-/](hd|720)/.test(lower)) return 720;
  if (/[_\-/](sd|480)/.test(lower)) return 480;
  if (/[_\-/](med|medium)/.test(lower)) return 480;
  if (/[_\-/](lo|low|240|360)/.test(lower)) return 300;
  if (/[_\-/]i\.(mp4|m3u8|mpd)/.test(lower)) return 240;
  return 1000; // unknown: prefer over labeled-low but below explicit hi-res
}

function extractStreamInfo(html) {
  // Many sites embed a JSON blob inside a JS string literal, so both slashes
  // and quotes are doubly escaped (`\/`, `\"`). Unescape so our regexes can
  // see "title": "..." and "HD": "https://..." patterns naturally.
  const normalized = html
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\"/g, '"');

  // ---- Title extraction ----
  // Many sites embed a JSON blob with a `title` (often brand/category) and a
  // `chapter`/`headline`/`subtitle` (the actual headline). Find ALL adjacent
  // pairs and pick the one positionally closest to a stream URL — that's most
  // likely the active video's metadata, not a nav item.
  let pageTitle = '';
  const pairRegex = /"title"\s*:\s*"([^"\\]{1,120})"\s*,\s*"(?:chapter|headline|subtitle|tagline)"\s*:\s*"([^"\\]{1,200})"/gi;
  const pairs = [];
  let pm;
  while ((pm = pairRegex.exec(normalized)) !== null) {
    pairs.push({ title: pm[1].trim(), chapter: pm[2].trim(), pos: pm.index });
  }
  if (pairs.length > 0) {
    // Find the first stream URL position to anchor against
    const streamProbe = normalized.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mpd|mp4)/i);
    const anchor = streamProbe ? streamProbe.index : normalized.length;
    pairs.sort((a, b) => Math.abs(a.pos - anchor) - Math.abs(b.pos - anchor));
    const best = pairs[0];
    pageTitle = `${best.title}_${best.chapter}`;
  }
  if (!pageTitle) {
    const og = normalized.match(/<meta\s+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) pageTitle = og[1].trim();
  }
  if (!pageTitle) {
    const tm = normalized.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) {
      pageTitle = tm[1]
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      pageTitle = pageTitle.replace(/\s*[-|·:]\s*[^-|·:]{1,40}$/, '').trim();
    }
  }

  // ---- Stream URL extraction ----
  // Stage 1: sites that explicitly label their qualities in JSON
  //   { "HD": "https://...", "SD": "https://...", "mobile": "..." }
  const labelRegex = /"(UHD|4K|2160p?|QHD|1440p?|FHD|1080p?|HD|720p?|SD|480p?|MD|360p?|LD|240p?|mobile|low)"\s*:\s*"(https?:\/\/[^"]+\.(?:m3u8|mpd|mp4)[^"]*)"/gi;
  const labeled = [];
  let mm;
  while ((mm = labelRegex.exec(normalized)) !== null) {
    labeled.push({ label: mm[1], url: mm[2], score: scoreLabel(mm[1]) });
  }

  let stream = null;
  if (labeled.length > 0) {
    labeled.sort((a, b) => b.score - a.score);
    stream = labeled[0].url;
  } else {
    // Stage 2: blind URL scan + URL-suffix heuristic
    const re = /https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>\\]*)?/gi;
    const candidates = [...new Set(normalized.match(re) || [])];
    const pickBest = (filter) => {
      const filtered = candidates.filter(filter);
      if (filtered.length === 0) return null;
      return filtered.sort((a, b) => scoreStreamUrl(b) - scoreStreamUrl(a))[0];
    };
    stream =
      pickBest((u) => /\.m3u8(\?|$)/i.test(u)) ||
      pickBest((u) => /\.mpd(\?|$)/i.test(u)) ||
      pickBest((u) => /\.mp4(\?|$)/i.test(u)) ||
      null;
  }

  return { stream, pageTitle };
}

function spawnYtdlp(event, payload, urlOverride, refererOverride) {
  return new Promise((resolve) => {
    const { id } = payload;
    const args = buildArgs({
      ...payload,
      url: urlOverride || payload.url,
      referer: refererOverride,
    });
    const send = (text) => event.sender.send('download-progress', { id, text });
    const ytdlp = spawn(ytdlpPath(), args, { windowsHide: true });
    activeDownloads.set(id, ytdlp);

    let stderrBuf = '';
    ytdlp.stdout.on('data', (data) => {
      data.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) send(line); });
    });
    ytdlp.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuf += text;
      text.split(/\r?\n/).forEach((line) => { if (line.trim()) send(line); });
    });
    ytdlp.on('error', (err) => {
      send(`[ERROR] yt-dlp 실행 실패: ${err.message}`);
      activeDownloads.delete(id);
      resolve({ code: -1, cancelled: false, stderr: stderrBuf });
    });
    ytdlp.on('close', (code, signal) => {
      const cancelled = signal === 'SIGTERM' || signal === 'SIGKILL';
      activeDownloads.delete(id);
      resolve({ code, cancelled, stderr: stderrBuf });
    });
  });
}

ipcMain.on('start-download', async (event, payload) => {
  const { id, url } = payload;
  const send = (text) => event.sender.send('download-progress', { id, text });

  // First pass: yt-dlp on the URL as given.
  let result = await spawnYtdlp(event, payload);

  // Fallback: if yt-dlp couldn't extract anything from a "generic" page, try to
  // pull a stream URL out of the page HTML ourselves and retry.
  const looksUnsupported =
    !result.cancelled &&
    result.code !== 0 &&
    /Unsupported URL|Unable to extract|Unable to download webpage|no suitable extractor/i.test(result.stderr);

  if (looksUnsupported) {
    send('[Orbit] 페이지에서 스트림 URL을 직접 찾는 중…');
    try {
      const html = await fetchPage(url);
      const { stream, pageTitle } = extractStreamInfo(html);
      if (stream) {
        send(`[Orbit] 발견: ${stream}`);
        const userTitle = (payload.title || '').trim();
        const titleForFile = userTitle || pageTitle || '';
        if (!userTitle && pageTitle) {
          send(`[Orbit] 페이지 제목 사용: ${pageTitle}`);
        }
        result = await spawnYtdlp(event, { ...payload, title: titleForFile }, stream, url);
      } else {
        // Distinguish "stream URL is hidden because the content is gated" from
        // "page has no recognizable video data at all".
        const gatedSignals = [
          /"streams"\s*:\s*"\$undefined"/i,
          /restrictedContent|paywall|paid[_\-]?content|premium[_\-]?only/i,
          /로그인.{0,30}(필요|해야|이후|후에)|회원.{0,30}(가입|로그인|전용)|구독.{0,30}(필요|전용)|PRO.{0,30}(전용|회원)/i,
          /이\s*컨텐츠는\s*현재\s*이\s*코너에서만/i,
        ];
        const isGated = gatedSignals.some((re) => re.test(html));
        if (isGated) {
          send('[ERROR] 이 영상은 무료로 받을 수 없는 콘텐츠입니다 (로그인·구독·코너 제한). 사이트에서 직접 확인하세요.');
        } else {
          send('[Orbit] 페이지 HTML에서 영상 스트림을 찾지 못했습니다.');
        }
      }
    } catch (e) {
      send(`[Orbit] 페이지 가져오기 실패: ${e.message}`);
    }
  }

  event.sender.send('download-complete', {
    id,
    code: result.code,
    cancelled: result.cancelled,
  });
});

ipcMain.handle('cancel-download', (_e, id) => {
  const child = activeDownloads.get(id);
  if (child) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      } else {
        child.kill('SIGTERM');
      }
    } catch (_) {
      try { child.kill('SIGTERM'); } catch (_) {}
    }
    activeDownloads.delete(id);
    return true;
  }
  return false;
});
