@echo off
title Orbit Downloader Installer

setlocal

set "REPO=productionkhu-tech/orbit-downloader"
set "INSTALL_DIR=%LOCALAPPDATA%\Orbit Downloader"
set "EXE_PATH=%INSTALL_DIR%\OrbitDownloader.exe"
set "URL=https://github.com/%REPO%/releases/latest/download/OrbitDownloader.exe"

echo.
echo ============================================
echo    Orbit Downloader 설치
echo ============================================
echo.
echo  설치 위치: %INSTALL_DIR%
echo.

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" 2>nul
    if errorlevel 1 (
        echo [ERROR] 설치 폴더 생성 실패. 권한을 확인하세요.
        echo.
        pause
        exit /b 1
    )
)

echo [1/3] 최신 EXE 다운로드 ^(약 130MB^)...
echo.

where curl >nul 2>&1
if errorlevel 1 goto :use_powershell

curl -L --fail -o "%EXE_PATH%" "%URL%"
if errorlevel 1 (
    echo.
    echo [ERROR] curl 다운로드 실패.
    echo URL: %URL%
    echo.
    pause
    exit /b 1
)
goto :downloaded

:use_powershell
echo  curl이 없어 PowerShell로 다운로드합니다...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='Continue'; try { Invoke-WebRequest -Uri '%URL%' -OutFile '%EXE_PATH%' -UseBasicParsing -ErrorAction Stop } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo.
    echo [ERROR] PowerShell 다운로드 실패.
    echo URL: %URL%
    echo.
    pause
    exit /b 1
)

:downloaded
if not exist "%EXE_PATH%" (
    echo.
    echo [ERROR] 다운로드 직후 파일을 찾을 수 없습니다.
    echo Expected: %EXE_PATH%
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] 바탕화면 단축 아이콘 생성...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Orbit Downloader.lnk'); $s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()"
if errorlevel 1 echo   ^(바탕화면 단축아이콘은 생략됨^)

echo [3/3] 시작메뉴 등록...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Orbit Downloader.lnk'); $s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()"
if errorlevel 1 echo   ^(시작메뉴 등록은 생략됨^)

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
