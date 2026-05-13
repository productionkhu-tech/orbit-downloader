// Generates install.bat from install.template.bat (UTF-8) → CP949 + CRLF.
// CP949 because Korean Windows reads .bat files with the ANSI codepage,
// which is 949 on Korean systems. UTF-8 .bat content shows up as mojibake.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'install.template.bat');
const DST = path.join(ROOT, 'install.bat');

if (!fs.existsSync(SRC)) {
  console.error('install.template.bat not found');
  process.exit(1);
}

const utf8 = fs.readFileSync(SRC, 'utf8');
// Normalize line endings to CRLF (Windows cmd requires this)
const crlf = utf8.replace(/\r?\n/g, '\r\n');

// Node 24+ ships TextEncoder/Decoder, but they don't speak CP949. Use the
// modern WHATWG TextDecoder with 'euc-kr' label which falls through to CP949
// (Windows CP949 is a strict superset of EUC-KR).
//
// For encoding, we need cp949 → only iconv-lite or @kayahr/text-encoder.
// Stay dependency-free: write via Buffer + Windows native PowerShell as a
// last resort. Easiest portable path: use Node's built-in iconv when
// available. As of Node 21+, `Buffer.from(str, 'utf16le')` exists but no
// CP949 encoder. Drop down to executing PowerShell, which always has CP949.
import { execFileSync } from 'node:child_process';

// Write UTF-8 first, then have PowerShell re-encode in place.
fs.writeFileSync(DST, crlf, 'utf8');

const psScript = `
$path = '${DST.replace(/'/g, "''")}'
$utf8 = Get-Content -Raw -Encoding UTF8 $path
[System.IO.File]::WriteAllText($path, $utf8, [System.Text.Encoding]::GetEncoding(949))
`;
execFileSync('powershell', ['-NoProfile', '-Command', psScript], { stdio: 'inherit' });

const final = fs.statSync(DST);
console.log(`Wrote install.bat (${final.size} bytes, CP949 + CRLF)`);
