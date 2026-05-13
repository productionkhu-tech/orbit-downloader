@echo off
title Orbit Downloader Installer

setlocal EnableExtensions

set "REPO=productionkhu-tech/orbit-downloader"
set "INSTALL_DIR=%LOCALAPPDATA%\Orbit Downloader"
set "EXE_PATH=%INSTALL_DIR%\OrbitDownloader.exe"
set "URL=https://github.com/%REPO%/releases/latest/download/OrbitDownloader.exe"
set "LOG=%TEMP%\orbit-install.log"

REM Reset log
echo ============================================================ > "%LOG%"
echo  Orbit Downloader 설치 로그 - %date% %time% >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo INSTALL_DIR=%INSTALL_DIR% >> "%LOG%"
echo EXE_PATH=%EXE_PATH% >> "%LOG%"
echo URL=%URL% >> "%LOG%"
echo. >> "%LOG%"

echo.
echo ============================================
echo    Orbit Downloader 설치
echo ============================================
echo.
echo  설치 위치: %INSTALL_DIR%
echo  로그 파일: %LOG%
echo.

if not exist "%INSTALL_DIR%" (
    echo [INFO] mkdir %INSTALL_DIR% >> "%LOG%"
    mkdir "%INSTALL_DIR%" 2>>"%LOG%"
    if errorlevel 1 goto :err_mkdir
)

echo [1/3] 최신 EXE 다운로드 (약 130MB)...
echo.

where curl >nul 2>&1
if errorlevel 1 goto :use_powershell

echo [INFO] curl >> "%LOG%"
curl -L --fail -o "%EXE_PATH%" "%URL%" 2>>"%LOG%"
if errorlevel 1 goto :err_download
goto :downloaded

:use_powershell
echo  curl이 없어 PowerShell로 다운로드합니다...
echo [INFO] powershell >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%URL%' -OutFile '%EXE_PATH%' -UseBasicParsing -ErrorAction Stop } catch { Write-Host $_.Exception.Message; exit 1 }" 2>>"%LOG%"
if errorlevel 1 goto :err_download

:downloaded
if not exist "%EXE_PATH%" goto :err_download

REM Sanity check: file should be at least 50 MB. Smaller usually means an HTML error page was saved.
for %%A in ("%EXE_PATH%") do set "EXE_SIZE=%%~zA"
echo [INFO] downloaded bytes=%EXE_SIZE% >> "%LOG%"
if %EXE_SIZE% LSS 52428800 goto :err_too_small

echo.
echo [2/3] 바탕화면 단축 아이콘 생성...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Orbit Downloader.lnk'); $s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()" 2>>"%LOG%"
if errorlevel 1 echo   (바탕화면 단축아이콘은 생략됨)

echo [3/3] 시작메뉴 등록...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Orbit Downloader.lnk'); $s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()" 2>>"%LOG%"
if errorlevel 1 echo   (시작메뉴 등록은 생략됨)

echo [OK] install complete >> "%LOG%"
echo.
echo ============================================
echo    설치 완료!
echo ============================================
echo.
echo  바탕화면의 'Orbit Downloader' 아이콘을 더블클릭하세요.
echo  업데이트는 앱이 켜질 때 자동으로 확인됩니다.
echo.

choice /C YN /N /T 10 /D Y /M "지금 실행하시겠습니까 (Y/N, 10초 후 자동 실행)? "
if errorlevel 2 goto :end

start "" "%EXE_PATH%"

:end
echo.
echo  완료. 아무 키나 누르면 창이 닫힙니다.
pause >nul
endlocal
exit /b 0

REM ============================================================
REM Error handlers
REM ============================================================

:err_mkdir
echo [FATAL] mkdir failed >> "%LOG%"
echo.
echo [ERROR] 설치 폴더를 만들 수 없습니다.
echo         %INSTALL_DIR%
echo         권한 또는 디스크 공간을 확인해 주세요.
goto :report

:err_download
echo [FATAL] download failed >> "%LOG%"
echo.
echo [ERROR] EXE 다운로드 실패.
echo         URL: %URL%
echo         인터넷 연결 또는 GitHub 접근 가능 여부를 확인해 주세요.
goto :report

:err_too_small
echo [FATAL] downloaded file is suspiciously small: %EXE_SIZE% bytes >> "%LOG%"
echo.
echo [ERROR] 다운로드된 파일이 너무 작습니다 (%EXE_SIZE% bytes).
echo         네트워크가 HTML 에러 페이지를 반환했을 가능성이 있어요.
goto :report

:report
echo.
echo  ─────────────────────────────────────────────
echo  자세한 로그가 아래 경로에 저장되었습니다:
echo  %LOG%
echo  ─────────────────────────────────────────────
echo.
choice /C YN /N /M "로그 파일을 열어보시겠습니까 (Y/N)? "
if errorlevel 2 goto :err_end
start "" notepad "%LOG%"
:err_end
echo.
pause
endlocal
exit /b 1
