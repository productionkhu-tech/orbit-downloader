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
      onUpdateReady: (cb: (info: UpdateInfo) => void) => void;
      restartForUpdate: () => void;
    };
  }
}
