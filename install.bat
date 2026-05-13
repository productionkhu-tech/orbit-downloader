@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Orbit Downloader 설치

set "REPO=productionkhu-tech/orbit-downloader"
set "INSTALL_DIR=%LOCALAPPDATA%\Orbit Downloader"
set "EXE_PATH=%INSTALL_DIR%\OrbitDownloader.exe"
set "RELEASE_URL=https://github.com/%REPO%/releases/latest/download/OrbitDownloader.exe"

echo.
echo  ┌──────────────────────────────────────────────────┐
echo  │   Orbit Downloader 설치                          │
echo  └──────────────────────────────────────────────────┘
echo.
echo  설치 위치 : %INSTALL_DIR%
echo  최신 버전 : %REPO%
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo  [1/3] 최신 EXE 다운로드 중... (약 130MB, 잠시 기다려주세요)
echo.

REM curl is built into Windows 10+ (since build 17063). -L follows redirects.
where curl >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%RELEASE_URL%' -OutFile '%EXE_PATH%' -UseBasicParsing"
) else (
    curl -L --progress-bar -o "%EXE_PATH%" "%RELEASE_URL%"
)

if not exist "%EXE_PATH%" (
    echo.
    echo  [오류] 다운로드 실패. 인터넷 연결 또는 저장소 주소를 확인하세요.
    echo.
    pause
    exit /b 1
)

echo.
echo  [2/3] 바탕화면 단축 아이콘 생성 중...
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Orbit Downloader.lnk');" ^
  "$s.TargetPath='%EXE_PATH%';" ^
  "$s.IconLocation='%EXE_PATH%';" ^
  "$s.Description='Orbit Downloader - 영상 다운로더';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.Save()"

echo  [3/3] 시작 메뉴 등록 중...
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%START_MENU%\Orbit Downloader.lnk');" ^
  "$s.TargetPath='%EXE_PATH%';" ^
  "$s.IconLocation='%EXE_PATH%';" ^
  "$s.Description='Orbit Downloader - 영상 다운로더';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.Save()"

echo.
echo  ┌──────────────────────────────────────────────────┐
echo  │   설치 완료!                                     │
echo  └──────────────────────────────────────────────────┘
echo.
echo   • 바탕화면의 [Orbit Downloader] 아이콘을 더블클릭하거나
echo   • 시작메뉴에서 "Orbit"으로 검색해 실행하세요.
echo.
echo   업데이트는 앱이 실행될 때마다 자동으로 확인되며,
echo   재시작 시 새 버전이 적용됩니다.
echo.

choice /C YN /N /T 10 /D Y /M "지금 실행하시겠습니까? (Y/N, 10초 후 자동 실행)"
if errorlevel 2 goto end
start "" "%EXE_PATH%"

:end
endlocal
exit /b 0
