# Orbit Downloader

영상 링크 붙여넣기 → 다운로드. X · YouTube · TikTok · Instagram · Vimeo 외에도 일반 사이트의 m3u8/mp4 자동 추출까지.

![logo](public/icon.png)

## 설치 (사용자용)

**[install.bat 다운로드](https://raw.githubusercontent.com/productionkhu-tech/orbit-downloader/main/install.bat)** → 더블클릭하면 자동으로:
- `%LOCALAPPDATA%\Orbit Downloader` 폴더에 최신 EXE 설치
- 바탕화면 + 시작메뉴 단축 아이콘 생성

이후 앱이 실행될 때마다 GitHub Releases에서 최신 버전을 자동 확인하고, 새 버전이 있으면 백그라운드에서 받아 둡니다. 재시작 시 적용됩니다.

## 기능

- **다양한 사이트 지원**: X, YouTube, TikTok, Instagram, Facebook, Reddit, Vimeo, Twitch, Bilibili
- **자동 fallback**: 위 외 사이트도 페이지 HTML에서 스트림 URL 자동 추출
- **스마트 파서**: 채팅 로그를 통째로 붙여넣어도 URL + `[제목]` 매칭
- **화질 옵션**: 최고 / 1080p / 720p / 480p, MP3 추출, 자막 임베드
- **동시 다운로드**: 1~5개 큐 제어
- **취소 / 재시도 / 파일 위치 열기** 액션
- **모든 다운로드는 로컬 처리** — 외부 서버 안 거침
- **자동 업데이트**: GitHub Releases 기반

## 개발 (메인테이너용)

```bash
npm install
npm run dev               # 개발 모드 (Vite + Electron)
npm run build:icon        # public/icon.ico 재생성
npm run dist:portable     # release/OrbitDownloader.exe 빌드
```

### 새 버전 릴리즈

```bash
# 1. 버전 올리고 커밋
npm version patch         # or minor / major
git push --follow-tags

# 2. EXE 빌드
npm run dist:portable

# 3. GitHub Release 생성 (gh CLI)
gh release create v1.5.1 release/OrbitDownloader.exe \
  --title "v1.5.1" --notes "변경사항..."
```

릴리즈가 GitHub에 올라가면, 사용자들이 다음에 앱을 켤 때 자동으로 받아져 재시작 시 적용됩니다.

## 기술 스택

Electron 42 · React 19 · TypeScript 6 · Tailwind v4 · Vite 8

번들된 의존성: yt-dlp 2026.x · ffmpeg 8.x (essentials build)
