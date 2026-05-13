export {};

export type Quality = 'best' | '1080' | '720' | '480';

export interface AppConfig {
  saveDirectory: string;
  quality: Quality;
  audioOnly: boolean;
  subtitle: boolean;
  maxConcurrent: number;
}

export interface DownloadParams {
  id: string;
  title: string;
  url: string;
  saveDirectory: string;
  quality: Quality;
  audioOnly: boolean;
  subtitle: boolean;
}

export interface YtdlpCheck {
  installed: boolean;
  bundled: boolean;
  version: string;
  error?: string;
}

export interface UpdateInfo {
  version: string;
  notes?: string;
  ready: boolean;
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'downloading'; version: string; received: number; total: number; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export interface UpdateApplied {
  from: string;
  to: string;
}

export interface DebugInfo {
  version: string;
  portable: boolean;
  portableExe: string;
  runningExe: string;
  installedExe: string;
  logPath: string;
  lastError: string;
  logTail: string;
  platform: string;
  electron: string;
  node: string;
}

declare global {
  const __APP_VERSION__: string;
  const __BUILD_DATE__: string;
  const __UPDATE_REPO__: string;

  interface Window {
    electronAPI: {
      getConfig: () => Promise<AppConfig>;
      setConfig: (partial: Partial<AppConfig>) => Promise<boolean>;
      selectDirectory: () => Promise<string | null>;
      readClipboard: () => Promise<string>;
      openFolder: (folderPath: string) => Promise<string | null>;
      showFile: (filePath: string) => Promise<boolean>;
      checkYtdlp: () => Promise<YtdlpCheck>;
      startDownload: (params: DownloadParams) => void;
      cancelDownload: (id: string) => Promise<boolean>;
      onDownloadProgress: (cb: (data: { id: string; text: string }) => void) => void;
      onDownloadComplete: (cb: (data: { id: string; code: number; cancelled: boolean }) => void) => void;
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => void;
      onUpdateApplied: (cb: (info: UpdateApplied) => void) => void;
      checkUpdateNow: () => Promise<boolean>;
      getDebugInfo: () => Promise<DebugInfo>;
      openLogFolder: () => Promise<boolean>;
    };
  }
}
