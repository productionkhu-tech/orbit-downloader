// Quick sanity test for extractStreamInfo against a real page.
import https from 'node:https';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString()));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

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
  return 1000;
}

function extractStreamInfo(html) {
  const normalized = html
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\"/g, '"');

  let pageTitle = '';
  const pairRegex = /"title"\s*:\s*"([^"\\]{1,120})"\s*,\s*"(?:chapter|headline|subtitle|tagline)"\s*:\s*"([^"\\]{1,200})"/gi;
  const pairs = [];
  let pm;
  while ((pm = pairRegex.exec(normalized)) !== null) {
    pairs.push({ title: pm[1].trim(), chapter: pm[2].trim(), pos: pm.index });
  }
  console.log('pairs found:', pairs.length);
  pairs.forEach((p) => console.log('  at', p.pos, '→', `"${p.title}" + "${p.chapter}"`));
  if (pairs.length > 0) {
    const streamProbe = normalized.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mpd|mp4)/i);
    const anchor = streamProbe ? streamProbe.index : normalized.length;
    pairs.sort((a, b) => Math.abs(a.pos - anchor) - Math.abs(b.pos - anchor));
    pageTitle = `${pairs[0].title}_${pairs[0].chapter}`;
  }
  if (!pageTitle) {
    const og = normalized.match(/<meta\s+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) pageTitle = og[1].trim();
  }
  if (!pageTitle) {
    const tm = normalized.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) {
      pageTitle = tm[1].replace(/\s+/g, ' ').trim();
      pageTitle = pageTitle.replace(/\s*[-|·:]\s*[^-|·:]{1,40}$/, '').trim();
    }
  }

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
    const re = /https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>\\]*)?/gi;
    const candidates = [...new Set(normalized.match(re) || [])];
    const pickBest = (filter) => {
      const filtered = candidates.filter(filter);
      return filtered.sort((a, b) => scoreStreamUrl(b) - scoreStreamUrl(a))[0] || null;
    };
    stream =
      pickBest((u) => /\.m3u8(\?|$)/i.test(u)) ||
      pickBest((u) => /\.mpd(\?|$)/i.test(u)) ||
      pickBest((u) => /\.mp4(\?|$)/i.test(u));
  }

  return { stream, pageTitle, labeled };
}

const url = process.argv[2] || 'https://tvcf.co.kr/play/ai2224-1012022';
const html = await fetchText(url);
const info = extractStreamInfo(html);
console.log('Page title :', JSON.stringify(info.pageTitle));
console.log('Picked     :', info.stream);
console.log('Labeled:');
info.labeled.forEach((l) => console.log(`  - [${l.label} → ${l.score}]`, l.url));
