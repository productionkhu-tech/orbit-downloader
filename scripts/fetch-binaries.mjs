// Downloads bundled yt-dlp.exe + ffmpeg.exe into ./bin so electron-builder
// can pack them via extraResources. Skips when files are already present.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');

fs.mkdirSync(BIN, { recursive: true });

function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const fetch = (location, hops = 0) => {
      if (hops > 6) return reject(new Error('Too many redirects'));
      https.get(location, { headers: { 'User-Agent': 'orbit-downloader-build' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          return fetch(new URL(res.headers.location, location).toString(), hops + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${location}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        let last = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          const now = Date.now();
          if (now - last > 250) {
            process.stdout.write(`\r  ${mb(received)}${total ? ` / ${mb(total)}` : ''}        `);
            last = now;
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          process.stdout.write(`\r  ${mb(received)} done                       \n`);
          file.close(() => resolve());
        });
      }).on('error', reject);
    };
    fetch(url);
  });
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const r = findFile(full, name);
      if (r) return r;
    } else if (entry.toLowerCase() === name) {
      return full;
    }
  }
  return null;
}

async function ensureYtdlp() {
  const dst = path.join(BIN, 'yt-dlp.exe');
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1024 * 1024) {
    console.log('* yt-dlp.exe already present');
    return;
  }
  console.log('* Downloading yt-dlp.exe...');
  await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', dst);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const fetch = (location, hops = 0) => {
      if (hops > 6) return reject(new Error('Too many redirects'));
      https.get(location, { headers: { 'User-Agent': 'orbit-downloader-build', 'Accept': 'application/vnd.github+json' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          return fetch(new URL(res.headers.location, location).toString(), hops + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${location}`));
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    };
    fetch(url);
  });
}

async function resolveFfmpegAsset() {
  const release = await fetchJson('https://api.github.com/repos/GyanD/codexffmpeg/releases/latest');
  const asset = (release.assets || []).find((a) => /essentials_build\.zip$/i.test(a.name));
  if (!asset) throw new Error('Could not find essentials_build.zip asset in latest Gyan FFmpeg release');
  return asset.browser_download_url;
}

async function ensureFfmpeg() {
  const dst = path.join(BIN, 'ffmpeg.exe');
  if (fs.existsSync(dst) && fs.statSync(dst).size > 10 * 1024 * 1024) {
    console.log('* ffmpeg.exe already present');
    return;
  }
  console.log('* Resolving latest ffmpeg release...');
  const ffmpegUrl = await resolveFfmpegAsset();
  console.log('* Downloading ffmpeg from', ffmpegUrl);
  const zip = path.join(BIN, '_ffmpeg.zip');
  const tmp = path.join(BIN, '_ffmpeg_tmp');
  await download(ffmpegUrl, zip);

  console.log('* Extracting ffmpeg.exe...');
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force"`,
    { stdio: 'inherit' }
  );
  const src = findFile(tmp, 'ffmpeg.exe');
  if (!src) throw new Error('ffmpeg.exe not found in archive');
  fs.copyFileSync(src, dst);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(zip);
  console.log('* ffmpeg.exe ready');
}

await ensureYtdlp();
await ensureFfmpeg();
console.log('\nAll binaries ready in bin/');
