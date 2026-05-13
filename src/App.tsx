import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Clipboard,
  X,
  RotateCw,
  Folder,
  Headphones,
  Captions,
  Plus,
  Minus,
  ArrowRight,
  Globe,
} from 'lucide-react';
import type { AppConfig, Quality, UpdateInfo, UpdateStatus, DebugInfo } from './globals';

// ============================================================
// URL parsing
// ============================================================
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

function cleanUrl(url: string): string {
  let u = url.replace(/[.,;:!?)\]}>'"`]+$/g, '');
  while (/[)\]}]$/.test(u) && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) {
    u = u.slice(0, -1);
  }
  return u;
}

type Platform = {
  key: 'x' | 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'reddit' | 'vimeo' | 'twitch' | 'bilibili' | 'web' | 'invalid';
  label: string;
  hostLabel: string;
};

function detectPlatform(url: string): Platform {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    const hostLabel = h.replace(/^m\./, '').replace(/^mobile\./, '');
    if (/(^|\.)x\.com$/.test(h) || /(^|\.)twitter\.com$/.test(h) || h === 't.co' || h === 'mobile.twitter.com')
      return { key: 'x', label: 'X', hostLabel: 'x.com' };
    if (/youtube\.com$/.test(h) || h === 'youtu.be' || h === 'm.youtube.com' || h === 'music.youtube.com')
      return { key: 'youtube', label: 'YouTube', hostLabel: 'youtube.com' };
    if (/instagram\.com$/.test(h))
      return { key: 'instagram', label: 'Instagram', hostLabel: 'instagram.com' };
    if (/tiktok\.com$/.test(h) || h === 'vm.tiktok.com')
      return { key: 'tiktok', label: 'TikTok', hostLabel: 'tiktok.com' };
    if (/facebook\.com$/.test(h) || h === 'fb.watch')
      return { key: 'facebook', label: 'Facebook', hostLabel: 'facebook.com' };
    if (/reddit\.com$/.test(h) || h === 'v.redd.it')
      return { key: 'reddit', label: 'Reddit', hostLabel: 'reddit.com' };
    if (/vimeo\.com$/.test(h))
      return { key: 'vimeo', label: 'Vimeo', hostLabel: 'vimeo.com' };
    if (/twitch\.tv$/.test(h))
      return { key: 'twitch', label: 'Twitch', hostLabel: 'twitch.tv' };
    if (/bilibili\.com$/.test(h))
      return { key: 'bilibili', label: 'Bilibili', hostLabel: 'bilibili.com' };
    return { key: 'web', label: 'Web', hostLabel };
  } catch {
    return { key: 'invalid', label: '?', hostLabel: 'invalid' };
  }
}

type ParsedItem = { url: string; title: string };

// Matches [제목], 【제목】, 「제목」, 『제목』 — at least one non-bracket char inside.
const BRACKET_REGEX_G = /[\[【「『]\s*([^\[\]【】「」『』]+?)\s*[\]】」』]/g;
const HAS_URL_REGEX = /https?:\/\//i;

function lastBracketIn(s: string): string | null {
  const ms = [...s.matchAll(BRACKET_REGEX_G)];
  if (ms.length === 0) return null;
  const t = ms[ms.length - 1][1].trim();
  return t || null;
}

// Strict rule (user's convention):
//   • Only text inside [brackets] becomes the title.
//   • Body / description lines between [Title] and URL are IGNORED.
//   • Walk back through any number of lines, but STOP at the previous URL
//     (so [Title] of an earlier section doesn't leak into the next URL).
//   • If no [bracket] is found before the URL, leave the title empty and let
//     yt-dlp use the video's own metadata title.
function parseInput(text: string): ParsedItem[] {
  const lines = text.split(/\r?\n/);
  const out: ParsedItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(URL_REGEX)];
    if (matches.length === 0) continue;

    for (const m of matches) {
      // Skip the bogus https inside `blob:https://...` — blob URLs only exist
      // inside the browser session that created them and can't be downloaded.
      const start = m.index ?? 0;
      const precedingFive = line.substring(Math.max(0, start - 5), start);
      if (precedingFive.endsWith('blob:')) continue;

      const url = cleanUrl(m[0]);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      let title = '';

      // 1) [Title] on the same line, BEFORE the URL.
      const before = line.substring(0, m.index ?? 0);
      title = lastBracketIn(before) || '';

      // 2) Walk back lines until previous URL or start; pick nearest [Title].
      if (!title) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = lines[j];
          if (HAS_URL_REGEX.test(prev)) break; // hit previous video's section
          const t = lastBracketIn(prev);
          if (t) { title = t; break; }
        }
      }

      out.push({ url, title });
    }
  }
  return out;
}

// ============================================================
// yt-dlp output parsing
// ============================================================
type ProgressInfo = {
  progress?: number;
  totalSize?: string;
  speed?: string;
  eta?: string;
  filePath?: string;
  errorText?: string;
};

function parseProgressLine(line: string): ProgressInfo | null {
  const pm = line.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+(\S+))?/i
  );
  if (pm) {
    return {
      progress: parseFloat(pm[1]),
      totalSize: pm[2]?.trim(),
      speed: pm[3],
      eta: pm[4],
    };
  }
  const dest = line.match(/^\[download\]\s+Destination:\s+(.+)$/);
  if (dest) return { filePath: dest[1].trim() };
  const merger = line.match(/\[Merger\]\s+Merging formats into\s+"([^"]+)"/);
  if (merger) return { filePath: merger[1].trim() };
  const extract = line.match(/\[ExtractAudio\]\s+Destination:\s+(.+)$/);
  if (extract) return { filePath: extract[1].trim() };
  const err = line.match(/^ERROR:\s*(.+)$/i);
  if (err) return { errorText: err[1].trim() };
  const customErr = line.match(/^\[ERROR\]\s*(.+)$/i);
  if (customErr) return { errorText: customErr[1].trim() };
  return null;
}

function humanizeError(err: string): string {
  const e = err.toLowerCase();
  if (e.includes('private') || e.includes('login') || e.includes('sign in') || e.includes('authentication'))
    return '비공개 또는 로그인 필요 — 인증 없이 받을 수 없는 영상이에요.';
  if (e.includes('unsupported url') || e.includes('not extract'))
    return '지원되지 않는 URL 형식입니다. 영상 페이지 주소가 맞는지 확인해 주세요.';
  if (e.includes('http error 404') || e.includes('not found'))
    return '영상이 삭제되었거나 존재하지 않습니다 (404).';
  if (e.includes('age') && (e.includes('restrict') || e.includes('confirm')))
    return '연령 제한 콘텐츠 — 쿠키 인증이 필요합니다.';
  if (e.includes('geo') || e.includes('not available in your country'))
    return '지역 제한 영상입니다.';
  if (e.includes('network') || e.includes('timed out') || e.includes('connection'))
    return '네트워크 오류 — 잠시 후 다시 시도해 보세요.';
  if (e.includes('ffmpeg'))
    return 'ffmpeg 관련 오류 — 영상 병합에 실패했습니다.';
  return err.slice(0, 240);
}

// ============================================================
// Platform brand marks (inline SVG)
// ============================================================
function PlatformMark({ platform, size = 26 }: { platform: Platform; size?: number }) {
  const box = size;
  const inner = Math.round(size * 0.58);
  const wrap = (bg: string, fg: string, svg: ReactNode) => (
    <div
      className="grid place-items-center rounded-[7px] shrink-0"
      style={{ width: box, height: box, background: bg, color: fg }}
    >
      {svg}
    </div>
  );
  switch (platform.key) {
    case 'x':
      return wrap('#000', '#fff',
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      );
    case 'youtube':
      return wrap('#FF0000', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.546 15.568V8.432L15.818 12l-6.272 3.568z"/></svg>
      );
    case 'tiktok':
      return wrap('#000', '#fff',
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z"/></svg>
      );
    case 'instagram':
      return wrap(
        'linear-gradient(135deg,#feda77 0%,#f58529 25%,#dd2a7b 50%,#8134af 75%,#515bd4 100%)', '#fff',
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41a3.7 3.7 0 0 1 1.38.9 3.7 3.7 0 0 1 .9 1.38c.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23a3.97 3.97 0 0 1-2.28 2.28c-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23a3.7 3.7 0 0 1 .9-1.38 3.7 3.7 0 0 1 1.38-.9c.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07S4.9.34 4.14.63a5.86 5.86 0 0 0-2.13 1.38A5.86 5.86 0 0 0 .63 4.14c-.29.76-.5 1.62-.56 2.9C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95.27 2.15.56 2.9a5.86 5.86 0 0 0 1.38 2.13 5.86 5.86 0 0 0 2.13 1.38c.76.29 1.62.5 2.9.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07 2.15-.27 2.9-.56a6.11 6.11 0 0 0 3.51-3.51c.29-.76.5-1.62.56-2.9.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95-.27-2.15-.56-2.9a5.86 5.86 0 0 0-1.38-2.13A5.86 5.86 0 0 0 19.86.63c-.76-.29-1.62-.5-2.9-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32A6.16 6.16 0 0 0 12 5.84zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.84a1.44 1.44 0 1 1 0 2.88 1.44 1.44 0 0 1 0-2.88z"/></svg>
      );
    case 'facebook':
      return wrap('#1877F2', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M24 12a12 12 0 1 0-13.88 11.85V15.47H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87V12h3.33l-.53 3.47h-2.8v8.38A12 12 0 0 0 24 12z"/></svg>
      );
    case 'reddit':
      return wrap('#FF4500', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.74a1.4 1.4 0 0 1 1.4 1.4 1.4 1.4 0 0 1-1.4 1.4 1.4 1.4 0 0 1-1.4-1.4 1.4 1.4 0 0 1 1.4-1.4zM12 5.39a1.06 1.06 0 0 1 .07.01.45.45 0 0 1 .3.55l-.96 4.5a6.93 6.93 0 0 1 2.94 1.04 1.95 1.95 0 0 1 1.27-.47 1.96 1.96 0 0 1 1.96 1.95 1.95 1.95 0 0 1-1.19 1.79 4 4 0 0 1 .05.61c0 3.1-3.62 5.62-8.08 5.62-4.47 0-8.09-2.51-8.09-5.62 0-.21.02-.42.05-.61a1.95 1.95 0 0 1-1.19-1.78 1.96 1.96 0 0 1 1.96-1.96 1.95 1.95 0 0 1 1.27.47 6.96 6.96 0 0 1 3.83-1.21l1.07-5.02a.45.45 0 0 1 .54-.35l3.51.74A1.04 1.04 0 0 1 12 5.39zm-3.81 7.96a1.27 1.27 0 0 0-1.26 1.27 1.27 1.27 0 0 0 1.26 1.27 1.27 1.27 0 0 0 1.27-1.27 1.27 1.27 0 0 0-1.27-1.27zm7.62 0a1.27 1.27 0 0 0-1.26 1.27 1.27 1.27 0 0 0 1.26 1.27 1.27 1.27 0 0 0 1.27-1.27 1.27 1.27 0 0 0-1.27-1.27zM12 17.82a4.62 4.62 0 0 1-2.93-.93.32.32 0 0 0-.43.04.31.31 0 0 0 .03.43 5.25 5.25 0 0 0 3.33 1.07 5.25 5.25 0 0 0 3.33-1.07.31.31 0 0 0 .03-.43.32.32 0 0 0-.43-.04A4.62 4.62 0 0 1 12 17.82z"/></svg>
      );
    case 'vimeo':
      return wrap('#1AB7EA', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.401 0-2.585-1.287-3.553-3.881L5.322 11.4C4.603 8.806 3.834 7.51 3.01 7.51c-.179 0-.806.378-1.881 1.132L0 7.197a315.065 315.065 0 0 0 3.516-3.144c1.589-1.371 2.78-2.093 3.572-2.165 1.876-.18 3.031 1.106 3.464 3.857.469 2.97.795 4.815.978 5.534.548 2.489 1.151 3.732 1.811 3.732.512 0 1.281-.808 2.308-2.425 1.024-1.617 1.574-2.85 1.649-3.696.149-1.42-.413-2.13-1.649-2.13a4.6 4.6 0 0 0-1.812.402c1.197-3.93 3.487-5.83 6.866-5.738 2.526.07 3.717 1.706 3.574 4.99z"/></svg>
      );
    case 'twitch':
      return wrap('#9146FF', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
      );
    case 'bilibili':
      return wrap('#FB7299', '#fff',
        <svg viewBox="0 0 24 24" width={inner + 2} height={inner + 2} fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773-1.004 1.005-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56C.556 20.116.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.391.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.787 1.894v7.52c.018.764.28 1.395.787 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.787-1.893v-7.52c-.018-.765-.28-1.396-.787-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/></svg>
      );
    case 'web':
    default:
      return wrap('#E7E2D3', '#8B8579', <Globe size={inner} strokeWidth={2} />);
  }
}

// ============================================================
// Types & helpers
// ============================================================
interface DownloadItem {
  id: string;
  title: string;
  url: string;
  platform: Platform;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled';
  speed?: string;
  eta?: string;
  totalSize?: string;
  filePath?: string;
  errorText?: string;
  log: string[];
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function dirOf(filePath?: string) {
  if (!filePath) return '';
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return idx > 0 ? filePath.slice(0, idx) : '';
}

function truncatePath(p: string, len = 32) {
  if (!p) return '';
  if (p.length <= len) return p;
  const head = p.slice(0, 8);
  const tail = p.slice(-(len - 9));
  return `${head}…${tail}`;
}

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: 'best', label: '최고' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
];

// ============================================================
// Component
// ============================================================
function App() {
  const [config, setConfig] = useState<AppConfig>({
    saveDirectory: '',
    quality: 'best',
    audioOnly: false,
    subtitle: false,
    maxConcurrent: 2,
  });
  const [inputText, setInputText] = useState('');
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [ytdlpStatus, setYtdlpStatus] = useState<{ installed: boolean; bundled: boolean; version: string } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'checking' });
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getConfig().then((c) => setConfig(c));
    window.electronAPI.checkYtdlp().then((res) => setYtdlpStatus(res));

    window.electronAPI.onDownloadProgress(({ id, text }) => {
      const info = parseProgressLine(text);
      setDownloads((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const next: DownloadItem = { ...item };
          if (info?.progress != null) {
            next.progress = info.progress;
            next.status = next.status === 'pending' ? 'downloading' : next.status;
          }
          if (info?.speed) next.speed = info.speed;
          if (info?.eta) next.eta = info.eta;
          if (info?.totalSize) next.totalSize = info.totalSize;
          if (info?.filePath) next.filePath = info.filePath;
          if (info?.errorText) next.errorText = info.errorText;
          next.log = [...item.log, text].slice(-4);
          return next;
        })
      );
    });

    window.electronAPI.onDownloadComplete(({ id, code, cancelled }) => {
      setDownloads((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (cancelled) return { ...item, status: 'cancelled' };
          if (code === 0) return { ...item, status: 'completed', progress: 100 };
          return { ...item, status: 'error' };
        })
      );
    });

    window.electronAPI.onUpdateReady((info) => setPendingUpdate(info));
    window.electronAPI.onUpdateStatus((status) => setUpdateStatus(status));
    window.electronAPI.onUpdateApplied(({ from, to }) => {
      showToast(`업데이트 완료 — v${from} → v${to}`, 'ok');
    });
  }, []);

  useEffect(() => {
    const active = downloads.filter((d) => d.status === 'downloading').length;
    const slots = Math.max(1, config.maxConcurrent) - active;
    if (slots <= 0) return;
    const next = downloads.filter((d) => d.status === 'pending').slice(0, slots);
    if (next.length === 0) return;

    next.forEach((d) => {
      window.electronAPI?.startDownload({
        id: d.id,
        title: d.title,
        url: d.url,
        saveDirectory: config.saveDirectory,
        quality: config.quality,
        audioOnly: config.audioOnly,
        subtitle: config.subtitle,
      });
    });
    setDownloads((prev) =>
      prev.map((d) => (next.find((n) => n.id === d.id) ? { ...d, status: 'downloading' } : d))
    );
  }, [downloads, config]);

  const parsedPreview = useMemo(() => parseInput(inputText), [inputText]);
  const hasBlobUrl = useMemo(() => /\bblob:https?:\/\//i.test(inputText), [inputText]);
  const stats = useMemo(() => ({
    active: downloads.filter((d) => d.status === 'downloading' || d.status === 'pending').length,
    completed: downloads.filter((d) => d.status === 'completed').length,
    failed: downloads.filter((d) => d.status === 'error' || d.status === 'cancelled').length,
  }), [downloads]);

  const showToast = (msg: string, type: 'ok' | 'err' | 'info' = 'info') => {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 2400);
  };

  const updateConfig = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    window.electronAPI?.setConfig({ [key]: value } as Partial<AppConfig>);
  }, []);

  const handleSelectDirectory = async () => {
    const newDir = await window.electronAPI?.selectDirectory();
    if (newDir) setConfig((c) => ({ ...c, saveDirectory: newDir }));
  };

  const pasteFromClipboard = async () => {
    const txt = await window.electronAPI?.readClipboard();
    if (!txt) { showToast('클립보드가 비어있어요', 'info'); return; }
    setInputText((cur) => (cur ? cur + '\n' + txt : txt));
    textareaRef.current?.focus();
  };

  const handleAddToQueue = () => {
    const items = parseInput(inputText);
    const hasBlob = /\bblob:https?:\/\//i.test(inputText);
    if (items.length === 0) {
      if (hasBlob) {
        showToast('blob: URL은 브라우저 메모리에만 존재해 받을 수 없어요. 영상 페이지 URL을 쓰세요.', 'err');
      } else {
        showToast('영상 주소를 찾지 못했어요', 'err');
      }
      return;
    }
    if (!config.saveDirectory) { showToast('먼저 저장 폴더를 선택하세요', 'err'); return; }
    if (hasBlob) showToast('blob: URL은 무시되었어요 (다운로드 불가)', 'info');
    const existing = new Set(downloads.map((d) => d.url));
    const fresh = items.filter((i) => !existing.has(i.url));
    if (fresh.length === 0) { showToast('이미 큐에 있는 주소예요', 'info'); setInputText(''); return; }
    const newItems: DownloadItem[] = fresh.map((i, idx) => ({
      id: genId() + idx,
      title: i.title || '',
      url: i.url,
      platform: detectPlatform(i.url),
      progress: 0,
      status: 'pending',
      log: [],
    }));
    setDownloads((prev) => [...prev, ...newItems]);
    setInputText('');
    showToast(`${newItems.length}개 추가됨`, 'ok');
  };

  const cancelOne = async (id: string) => {
    await window.electronAPI?.cancelDownload(id);
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'cancelled' } : d)));
  };
  const retryOne = (id: string) => {
    setDownloads((prev) => prev.map((d) =>
      d.id === id ? { ...d, status: 'pending', progress: 0, errorText: undefined, speed: undefined, eta: undefined, log: [] } : d
    ));
  };
  const removeOne = (id: string) => setDownloads((prev) => prev.filter((d) => d.id !== id));
  const openFolderOfItem = async (item: DownloadItem) => {
    if (item.filePath) {
      const ok = await window.electronAPI?.showFile(item.filePath);
      if (!ok) await window.electronAPI?.openFolder(dirOf(item.filePath) || config.saveDirectory);
    } else {
      await window.electronAPI?.openFolder(config.saveDirectory);
    }
  };
  const clearFinished = () => {
    setDownloads((prev) => prev.filter((d) => d.status === 'downloading' || d.status === 'pending'));
  };
  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const txt = e.dataTransfer.getData('text');
    if (txt) setInputText((cur) => (cur ? cur + '\n' + txt : txt));
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="h-screen flex flex-col bg-[#FAF9F5] text-[#1F1E1B] overflow-hidden">

      {/* ============ Top bar ============ */}
      <header className="shrink-0 h-14 px-6 flex items-center justify-between border-b border-[#1F1E1B]/[0.06]">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg grid place-items-center shadow-[0_2px_8px_rgba(217,119,87,0.28)] overflow-hidden"
            style={{ background: 'linear-gradient(180deg, #E8865F 0%, #C9633E 100%)' }}
          >
            <svg viewBox="0 0 256 256" width="28" height="28" aria-hidden="true">
              <g transform="translate(128 128) rotate(-22)">
                <ellipse cx="0" cy="0" rx="82" ry="22"
                  fill="none" stroke="#FFFFFF" strokeOpacity="0.30" strokeWidth="6" />
              </g>
              <g fill="none" stroke="#FFFFFF" strokeWidth="26"
                 strokeLinecap="round" strokeLinejoin="round">
                <line x1="128" y1="62" x2="128" y2="170" />
                <polyline points="76 122 128 174 180 122" />
              </g>
              <line x1="74" y1="206" x2="182" y2="206"
                stroke="#FFFFFF" strokeWidth="22" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight">Orbit</span>
            <span className="text-[12px] text-[#8B8579]">영상 다운로더</span>
            <button
              onClick={async () => {
                const info = await window.electronAPI?.getDebugInfo();
                if (info) setDebugInfo(info);
              }}
              title="클릭하여 진단 정보 보기"
              className="text-[10px] text-[#A8A29E] font-mono tabular-nums hover:text-[#5C5A52] hover:underline transition-colors"
            >
              v{__APP_VERSION__} · {__BUILD_DATE__}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {stats.active > 0 && (
            <StatusPill tone="accent">
              <Loader2 size={11} className="animate-spin" />
              <span className="tabular-nums">{stats.active}</span>
              <span className="text-[10.5px] opacity-70">진행중</span>
            </StatusPill>
          )}
          {stats.completed > 0 && (
            <StatusPill tone="success">
              <CheckCircle2 size={11} />
              <span className="tabular-nums">{stats.completed}</span>
              <span className="text-[10.5px] opacity-70">완료</span>
            </StatusPill>
          )}
          {ytdlpStatus && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1F1E1B]/[0.04] text-[#5C5A52] text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full ${ytdlpStatus.installed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span className="font-medium">
                {ytdlpStatus.installed ? `yt-dlp ${ytdlpStatus.version}` : 'yt-dlp 없음'}
              </span>
              {ytdlpStatus.bundled && <span className="text-[#D97757]">·내장</span>}
            </div>
          )}
          <UpdateBadge
            status={updateStatus}
            pending={pendingUpdate}
            onRestart={() => window.electronAPI?.restartForUpdate()}
            onCheckNow={() => window.electronAPI?.checkUpdateNow()}
          />
        </div>
      </header>

      {/* ============ Floating download-progress strip (under header) ============ */}
      {updateStatus.status === 'downloading' && (
        <div className="shrink-0 px-4 py-2 bg-[#FBEDE5] border-b border-[#D97757]/20 text-[11.5px] text-[#C9633E] flex items-center gap-3">
          <Loader2 size={12} className="animate-spin shrink-0" />
          <span className="font-medium whitespace-nowrap">
            새 버전 v{updateStatus.version} 다운로드 중
          </span>
          <div className="flex-1 h-1 rounded-full bg-[#D97757]/15 overflow-hidden">
            <div
              className="h-full bg-[#D97757] transition-[width] duration-300"
              style={{ width: `${updateStatus.percent}%` }}
            />
          </div>
          <span className="tabular-nums font-semibold whitespace-nowrap min-w-[3rem] text-right">
            {updateStatus.percent}%
          </span>
        </div>
      )}

      {/* ============ Settings strip ============ */}
      <div className="shrink-0 h-14 px-6 flex items-center gap-5 border-b border-[#1F1E1B]/[0.06] bg-[#F4F1E8]/40 overflow-x-auto">
        {/* Save folder */}
        <button
          onClick={handleSelectDirectory}
          className="group flex items-center gap-2 h-9 px-3 rounded-lg bg-white hover:bg-[#FBEDE5] border border-[#1F1E1B]/[0.08] hover:border-[#D97757]/40 transition-all text-[12.5px] shrink-0"
          title={config.saveDirectory}
        >
          <Folder size={13} className="text-[#D97757]" />
          <span className="text-[#1F1E1B] font-medium">
            {truncatePath(config.saveDirectory, 30) || '폴더 선택'}
          </span>
          <span className="text-[10.5px] text-[#8B8579] group-hover:text-[#D97757]">변경</span>
        </button>

        <Separator />

        {/* Quality */}
        <div className={`flex items-center gap-1.5 shrink-0 ${config.audioOnly ? 'opacity-35 pointer-events-none' : ''}`}>
          <span className="text-[11px] text-[#8B8579] mr-0.5">화질</span>
          <div className="flex bg-white rounded-lg p-0.5 border border-[#1F1E1B]/[0.08]">
            {QUALITY_OPTIONS.map((q) => {
              const active = config.quality === q.value;
              return (
                <button
                  key={q.value}
                  onClick={() => updateConfig('quality', q.value)}
                  className={`px-2.5 h-7 rounded-md text-[11.5px] font-medium transition-all ${
                    active
                      ? 'bg-[#1F1E1B] text-white'
                      : 'text-[#5C5A52] hover:text-[#1F1E1B]'
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Inline switches */}
        <InlineSwitch
          active={config.audioOnly}
          onClick={() => updateConfig('audioOnly', !config.audioOnly)}
          icon={<Headphones size={12.5} />}
          label="MP3로 추출"
        />
        <InlineSwitch
          active={config.subtitle}
          onClick={() => updateConfig('subtitle', !config.subtitle)}
          icon={<Captions size={12.5} />}
          label="자막 포함"
        />

        <Separator />

        {/* Concurrency */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[12px] text-[#5C5A52] font-medium">동시 다운로드</span>
          <div className="flex items-center bg-white rounded-md border border-[#1F1E1B]/[0.08]">
            <button
              onClick={() => updateConfig('maxConcurrent', Math.max(1, config.maxConcurrent - 1))}
              disabled={config.maxConcurrent <= 1}
              className="w-6 h-7 grid place-items-center text-[#8B8579] hover:text-[#D97757] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              aria-label="줄이기"
            >
              <Minus size={11} />
            </button>
            <span className="w-7 text-center text-[12.5px] font-semibold tabular-nums text-[#1F1E1B] border-x border-[#1F1E1B]/[0.06] leading-7">
              {config.maxConcurrent}
            </span>
            <button
              onClick={() => updateConfig('maxConcurrent', Math.min(5, config.maxConcurrent + 1))}
              disabled={config.maxConcurrent >= 5}
              className="w-6 h-7 grid place-items-center text-[#8B8579] hover:text-[#D97757] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              aria-label="늘리기"
            >
              <Plus size={11} />
            </button>
          </div>
          <span className="text-[11px] text-[#A8A29E]">개</span>
        </div>
      </div>

      {/* ============ Main ============ */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-7 flex flex-col gap-6">

          {/* Hero input */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h1 className="text-[19px] font-semibold tracking-tight">영상 주소를 붙여넣으세요</h1>
              <span className="text-[12px] text-[#8B8579]">
                <code className="bg-[#FBEDE5] text-[#D97757] px-1.5 py-0.5 rounded text-[11px] font-mono">[제목]</code>
                {' '}형식으로 적으면 파일명이 됩니다
              </span>
            </div>

            <div
              className={`relative rounded-2xl bg-white transition-all ${
                isDragging
                  ? 'ring-2 ring-[#D97757]/40 ring-offset-2 ring-offset-[#FAF9F5]'
                  : 'border border-[#1F1E1B]/[0.08]'
              } shadow-[0_1px_2px_rgba(31,30,27,0.04)]`}
            >
              <textarea
                ref={textareaRef}
                className="w-full h-[148px] p-5 pb-3 bg-transparent border-0 outline-none resize-none text-[13px] text-[#1F1E1B] placeholder:text-[#A8A29E] leading-relaxed selection:bg-[#D97757]/20"
                placeholder={'[힉스필드 AD 래퍼런스]\n본문 설명은 자유롭게 적어도 됩니다.\nhttps://x.com/i/status/12345\n\n[일레븐랩스 스튜디오]\nhttps://youtu.be/dQw4w9WgXcQ\n\nhttps://www.tiktok.com/@user/video/123   ← 제목 없으면 자동 사용'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              />

              {/* Bottom row */}
              <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-[#1F1E1B]/[0.05]">
                <div className="flex items-center gap-2 text-[12px]">
                  <button
                    onClick={pasteFromClipboard}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-[#1F1E1B]/[0.04] text-[#5C5A52] transition-colors"
                  >
                    <Clipboard size={12} />
                    <span>붙여넣기</span>
                  </button>
                  {inputText && (
                    <button
                      onClick={() => setInputText('')}
                      className="h-8 px-2.5 rounded-md hover:bg-[#1F1E1B]/[0.04] text-[#8B8579] transition-colors"
                    >
                      지우기
                    </button>
                  )}
                  {hasBlobUrl && parsedPreview.length === 0 ? (
                    <div className="ml-1 flex items-center gap-1.5 text-[#A03333]">
                      <AlertCircle size={12} />
                      <span>
                        <code className="bg-[#FEF2F2] px-1 py-0.5 rounded text-[10.5px] font-mono">blob:</code>{' '}
                        URL은 받을 수 없어요 — 영상이 있는 페이지 URL을 붙여넣으세요
                      </span>
                    </div>
                  ) : (
                    <div className="ml-1 text-[#8B8579]">
                      감지된 영상
                      <span className={`ml-1.5 font-semibold tabular-nums ${parsedPreview.length > 0 ? 'text-[#D97757]' : 'text-[#C2BBA7]'}`}>
                        {parsedPreview.length}
                      </span>
                      {hasBlobUrl && (
                        <span className="ml-2 text-[10.5px] text-[#A03333]">· blob URL은 무시됨</span>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAddToQueue}
                  disabled={parsedPreview.length === 0 || !config.saveDirectory}
                  className="group flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#D97757] hover:bg-[#C9633E] disabled:bg-[#E5E0D2] disabled:text-[#A8A29E] disabled:cursor-not-allowed text-white text-[12.5px] font-semibold shadow-[0_1px_2px_rgba(217,119,87,0.3)] transition-all active:scale-[0.98]"
                >
                  <span>다운로드 시작</span>
                  {parsedPreview.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded bg-white/25 text-[10.5px] tabular-nums">
                      {parsedPreview.length}
                    </span>
                  )}
                  <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          </section>

          {/* Queue */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[14px] font-semibold tracking-tight text-[#1F1E1B]">큐</h2>
                <span className="text-[11.5px] text-[#8B8579] tabular-nums">{downloads.length}개</span>
              </div>
              {(stats.completed > 0 || stats.failed > 0) && (
                <button
                  onClick={clearFinished}
                  className="flex items-center gap-1 text-[11.5px] text-[#8B8579] hover:text-[#1F1E1B] transition-colors"
                >
                  <Trash2 size={11} />
                  완료/실패 정리
                </button>
              )}
            </div>

            {downloads.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-1.5">
                {downloads.map((dl) => (
                  <DownloadRow
                    key={dl.id}
                    item={dl}
                    onCancel={() => cancelOne(dl.id)}
                    onRetry={() => retryOne(dl.id)}
                    onRemove={() => removeOne(dl.id)}
                    onOpen={() => openFolderOfItem(dl)}
                  />
                ))}
              </div>
            )}
          </section>

        </div>
      </main>

      {/* ============ Toast ============ */}
      {debugInfo && (
        <DebugModal info={debugInfo} onClose={() => setDebugInfo(null)} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-[fadeUp_0.2s_ease-out]">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-medium border shadow-[0_8px_24px_rgba(31,30,27,0.12)] backdrop-blur ${
            toast.type === 'ok' ? 'bg-[#ECFDF5] text-[#0F7B5A] border-[#0F7B5A]/20' :
            toast.type === 'err' ? 'bg-[#FEF2F2] text-[#A03333] border-[#A03333]/20' :
            'bg-white text-[#1F1E1B] border-[#1F1E1B]/10'
          }`}>
            {toast.type === 'ok' && <CheckCircle2 size={13} />}
            {toast.type === 'err' && <AlertCircle size={13} />}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================
function DebugModal({ info, onClose }: { info: DebugInfo; onClose: () => void }) {
  const summary =
`Orbit Downloader 진단
─────────────────────────────
버전        v${info.version}
플랫폼      ${info.platform}
Electron    ${info.electron}
Node        ${info.node}

설치 정보
─────────────────────────────
Portable     ${info.portable ? 'yes' : 'no'}
포터블 EXE   ${info.portableExe}
실행 중 EXE  ${info.runningExe}
업데이트 대상 ${info.installedExe}
로그 파일    ${info.logPath}

마지막 에러
─────────────────────────────
${info.lastError}

최근 로그
─────────────────────────────
${info.logTail || '(없음)'}
`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(summary); } catch (_) {}
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-[#1F1E1B]/10 flex flex-col overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#1F1E1B]/[0.06] flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-[#1F1E1B]">진단 정보</h2>
            <p className="text-[11.5px] text-[#8B8579] mt-0.5">문제 보고 시 아래 내용을 복사해 첨부해 주세요.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-md text-[#8B8579] hover:bg-[#1F1E1B]/[0.05] hover:text-[#1F1E1B] transition-colors"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <pre className="flex-1 overflow-auto p-5 text-[11.5px] font-mono text-[#1F1E1B] leading-relaxed bg-[#F4F1E8]/40 whitespace-pre-wrap break-all">
          {summary}
        </pre>

        <div className="px-5 py-3 border-t border-[#1F1E1B]/[0.06] flex items-center justify-end gap-2">
          <button
            onClick={() => window.electronAPI?.openLogFolder()}
            className="h-9 px-3.5 rounded-lg bg-white border border-[#1F1E1B]/[0.1] text-[12px] font-medium text-[#5C5A52] hover:bg-[#1F1E1B]/[0.04] hover:text-[#1F1E1B] transition-colors flex items-center gap-1.5"
          >
            <FolderOpen size={13} />
            로그 폴더 열기
          </button>
          <button
            onClick={copy}
            className="h-9 px-3.5 rounded-lg bg-[#D97757] hover:bg-[#C9633E] text-white text-[12px] font-semibold transition-colors flex items-center gap-1.5"
          >
            <Clipboard size={13} />
            복사
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateBadge({
  status, pending, onRestart, onCheckNow,
}: {
  status: UpdateStatus;
  pending: UpdateInfo | null;
  onRestart: () => void;
  onCheckNow: () => void;
}) {
  // Pending update wins over any transient status — always offer the restart action.
  if (pending) {
    return (
      <button
        onClick={onRestart}
        title={`v${pending.version} 다운로드 완료 · 클릭하면 재시작하며 적용`}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#D97757] text-white text-[11px] font-semibold shadow-[0_1px_4px_rgba(217,119,87,0.4)] hover:bg-[#C9633E] transition-colors active:scale-95"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
        </span>
        업데이트 준비됨 · 재시작
      </button>
    );
  }

  const baseClass =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors';

  switch (status.status) {
    case 'checking':
      return (
        <button
          onClick={onCheckNow}
          title="GitHub Releases 확인 중 · 클릭하면 즉시 재확인"
          className={`${baseClass} bg-[#1F1E1B]/[0.04] text-[#5C5A52] hover:bg-[#1F1E1B]/[0.08]`}
        >
          <Loader2 size={11} className="animate-spin" />
          <span>업데이트 확인 중</span>
        </button>
      );
    case 'downloading':
      return (
        <button
          onClick={onCheckNow}
          title={`v${status.version} 다운로드 중 (${status.percent}%)`}
          className={`${baseClass} bg-[#FBEDE5] text-[#C9633E]`}
        >
          <Loader2 size={11} className="animate-spin" />
          <span className="tabular-nums">다운로드 {status.percent}%</span>
        </button>
      );
    case 'current':
      return (
        <button
          onClick={onCheckNow}
          title={`v${status.version} · 클릭하면 최신 버전 즉시 재확인`}
          className={`${baseClass} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          <CheckCircle2 size={11} />
          <span>최신 버전</span>
        </button>
      );
    case 'error':
      return (
        <button
          onClick={onCheckNow}
          title={`업데이트 확인 실패: ${status.message} · 클릭하면 다시 시도`}
          className={`${baseClass} bg-amber-50 text-amber-700 hover:bg-amber-100`}
        >
          <AlertCircle size={11} />
          <span>업데이트 확인 실패</span>
        </button>
      );
    case 'ready':
      // 'ready' without pendingUpdate happens if the renderer reconnects later; same UI as pending.
      return (
        <button
          onClick={onRestart}
          className={`${baseClass} bg-[#D97757] text-white shadow-[0_1px_4px_rgba(217,119,87,0.4)] hover:bg-[#C9633E] font-semibold`}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
          </span>
          v{status.version} 준비됨 · 재시작
        </button>
      );
  }
}

function Separator() {
  return <div className="w-px h-5 bg-[#1F1E1B]/[0.08] shrink-0" />;
}

function StatusPill({ children, tone }: { children: ReactNode; tone: 'accent' | 'success' }) {
  const cls =
    tone === 'accent'
      ? 'bg-[#FBEDE5] text-[#C9633E] border-[#D97757]/20'
      : 'bg-[#ECFDF5] text-[#0F7B5A] border-[#0F7B5A]/20';
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold ${cls}`}>
      {children}
    </div>
  );
}

function InlineSwitch({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={active}
      className="group flex items-center gap-2 h-9 px-2.5 rounded-lg hover:bg-[#1F1E1B]/[0.035] transition-colors shrink-0"
    >
      <span className={`transition-colors ${active ? 'text-[#D97757]' : 'text-[#A8A29E]'}`}>
        {icon}
      </span>
      <span className={`text-[12px] font-medium transition-colors ${active ? 'text-[#1F1E1B]' : 'text-[#5C5A52]'}`}>
        {label}
      </span>
      <span
        className={`relative w-[26px] h-[15px] rounded-full transition-colors ${
          active ? 'bg-[#D97757]' : 'bg-[#E5E0D2] group-hover:bg-[#D6D3D1]'
        }`}
      >
        <span
          className={`absolute top-[2px] w-[11px] h-[11px] bg-white rounded-full shadow-[0_1px_2px_rgba(31,30,27,0.18)] transition-all ${
            active ? 'left-[12px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="min-h-[220px] grid place-items-center rounded-2xl bg-white border border-dashed border-[#1F1E1B]/[0.1]">
      <div className="text-center max-w-sm py-8">
        <div className="mx-auto w-12 h-12 rounded-full bg-[#FBEDE5] grid place-items-center mb-3">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#D97757" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div className="text-[13.5px] font-semibold text-[#1F1E1B]">큐가 비어있어요</div>
        <div className="text-[11.5px] text-[#8B8579] mt-1.5 leading-relaxed">
          위 입력창에 영상 주소를 붙여넣어 보세요.<br />
          <span className="text-[#A8A29E]">X · YouTube · TikTok · Instagram · 그 외 어디든 OK</span>
        </div>
      </div>
    </div>
  );
}

function DownloadRow({
  item, onCancel, onRetry, onRemove, onOpen,
}: {
  item: DownloadItem;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const isError = item.status === 'error' || item.status === 'cancelled';
  const isDone = item.status === 'completed';
  const isActive = item.status === 'downloading' || item.status === 'pending';

  const displayTitle = item.title || (() => {
    try { return new URL(item.url).pathname.split('/').filter(Boolean).pop() || item.url; }
    catch { return item.url; }
  })();

  const ringCls =
    item.status === 'completed' ? 'border-[#0F7B5A]/15 bg-[#F0FAF5]' :
    item.status === 'error' ? 'border-[#A03333]/20 bg-[#FEF7F7]' :
    item.status === 'cancelled' ? 'border-amber-500/15 bg-amber-50/40' :
    item.status === 'downloading' ? 'border-[#D97757]/25 bg-white' :
    'border-[#1F1E1B]/[0.08] bg-white';

  return (
    <div className={`group rounded-xl border transition-all p-3 hover:shadow-[0_1px_3px_rgba(31,30,27,0.06)] ${ringCls}`}>
      <div className="flex items-center gap-3">
        <PlatformMark platform={item.platform} size={28} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h4 className="text-[13px] font-medium text-[#1F1E1B] truncate" title={displayTitle}>
              {displayTitle}
            </h4>
            <StatusIndicator item={item} />
          </div>

          <div className="text-[10.5px] text-[#8B8579] truncate mt-0.5" title={item.url}>
            {item.platform.hostLabel}
            <span className="mx-1.5 text-[#C2BBA7]">·</span>
            <span className="font-mono">
              {item.url.length > 64 ? item.url.slice(0, 64) + '…' : item.url}
            </span>
          </div>

          {isActive && (
            <div className="mt-2">
              <div className="h-1 rounded-full bg-[#1F1E1B]/[0.06] overflow-hidden">
                <div
                  className="h-full bg-[#D97757] transition-all duration-300 relative rounded-full"
                  style={{ width: `${Math.max(item.progress, 2)}%` }}
                >
                  {item.status === 'downloading' && (
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                        animation: 'shimmer 1.6s linear infinite',
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-[#8B8579] tabular-nums">
                <div className="flex items-center gap-2.5">
                  <span className="text-[#1F1E1B] font-medium">{item.progress.toFixed(1)}%</span>
                  {item.totalSize && <span>{item.totalSize}</span>}
                  {item.speed && <span className="text-[#D97757] font-medium">↓ {item.speed}</span>}
                </div>
                {item.eta && <span>{item.eta} 남음</span>}
              </div>
            </div>
          )}

          {isError && (
            <div className={`mt-1.5 text-[11px] leading-snug ${
              item.status === 'cancelled' ? 'text-amber-700' : 'text-[#A03333]'
            }`}>
              {item.status === 'cancelled'
                ? '사용자가 취소함'
                : (item.errorText ? humanizeError(item.errorText) : (item.log[item.log.length - 1] || '알 수 없는 오류'))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {isActive && (
            <RowAction onClick={onCancel} tone="rose" title="취소"><X size={13} /></RowAction>
          )}
          {(item.status === 'error' || item.status === 'cancelled') && (
            <RowAction onClick={onRetry} tone="accent" title="재시도"><RotateCw size={13} /></RowAction>
          )}
          {isDone && (
            <RowAction onClick={onOpen} tone="success" title="파일 위치 열기"><FolderOpen size={13} /></RowAction>
          )}
          {!isActive && (
            <RowAction onClick={onRemove} tone="neutral" title="삭제"><Trash2 size={13} /></RowAction>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ item }: { item: DownloadItem }) {
  switch (item.status) {
    case 'pending':
      return <span className="text-[10px] text-[#8B8579] uppercase tracking-wider shrink-0">대기</span>;
    case 'downloading':
      return (
        <span className="flex items-center gap-1 text-[10px] text-[#D97757] font-medium shrink-0">
          <Loader2 size={9} className="animate-spin" />
          진행중
        </span>
      );
    case 'completed':
      return <span className="flex items-center gap-1 text-[10px] text-[#0F7B5A] font-medium shrink-0"><CheckCircle2 size={10} />완료</span>;
    case 'cancelled':
      return <span className="text-[10px] text-amber-700 font-medium shrink-0">취소됨</span>;
    case 'error':
      return <span className="flex items-center gap-1 text-[10px] text-[#A03333] font-medium shrink-0"><AlertCircle size={10} />실패</span>;
  }
}

function RowAction({
  children, onClick, tone, title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone: 'rose' | 'accent' | 'success' | 'neutral';
  title: string;
}) {
  const map = {
    rose: 'text-[#A03333] hover:bg-[#FEF2F2]',
    accent: 'text-[#D97757] hover:bg-[#FBEDE5]',
    success: 'text-[#0F7B5A] hover:bg-[#ECFDF5]',
    neutral: 'text-[#5C5A52] hover:bg-[#1F1E1B]/[0.05]',
  } as const;
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 grid place-items-center rounded-md transition-colors active:scale-95 ${map[tone]}`}
    >
      {children}
    </button>
  );
}

export default App;
