@echo off
title Orbit Downloader Installer

setlocal EnableExtensions EnableDelayedExpansion

set "REPO=productionkhu-tech/orbit-downloader"
set "INSTALL_DIR=%LOCALAPPDATA%\Orbit Downloader"
set "EXE_PATH=%INSTALL_DIR%\OrbitDownloader.exe"
set "URL=https://github.com/%REPO%/releases/latest/download/OrbitDownloader.exe"
set "LOG=%TEMP%\orbit-install.log"
set "MIN_SIZE=52428800"

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
    mkdir "%INSTALL_DIR%" 2>>"%LOG%"
    if errorlevel 1 goto :err_mkdir
)

REM ---------- Pre-flight: kill running Orbit Downloader so we can overwrite ----------
tasklist /FI "IMAGENAME eq OrbitDownloader.exe" /NH 2>nul | find /I "OrbitDownloader.exe" >nul
if not errorlevel 1 (
    echo  실행 중인 Orbit Downloader가 감지됐어요.
    echo  업데이트하려면 종료해야 합니다. 자동으로 닫을게요...
    taskkill /F /IM OrbitDownloader.exe /T >nul 2>&1
    echo [INFO] taskkill OrbitDownloader.exe >> "%LOG%"
    powershell -NoProfile -Command "Start-Sleep -Seconds 2"
)

REM Clean leftover partial files. If del still fails after taskkill, the file is
REM locked by something else ? bail with a clear message.
if exist "%EXE_PATH%" (
    del /F /Q "%EXE_PATH%" 2>>"%LOG%"
    if exist "%EXE_PATH%" goto :err_locked
)
if exist "%EXE_PATH%.new" del /F /Q "%EXE_PATH%.new" 2>nul
if exist "%EXE_PATH%.old" del /F /Q "%EXE_PATH%.old" 2>nul

echo [1/3] 최신 EXE 다운로드 (약 130MB)
echo       - 사이즈가 크니 30초~수분 걸릴 수 있어요.
echo       - 에러가 나면 그대로 보여집니다.
echo.

REM ---------- METHOD 1: PowerShell Invoke-WebRequest (가장 안정적) ----------
set "PSOUT=%TEMP%\orbit-ps-out.txt"
echo --- attempt 1: PowerShell Invoke-WebRequest --- >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue';" ^
  "try {" ^
  "  Invoke-WebRequest -Uri '%URL%' -OutFile '%EXE_PATH%' -UseBasicParsing -MaximumRedirection 10 -ErrorAction Stop;" ^
  "  Write-Host ('OK ' + (Get-Item '%EXE_PATH%').Length + ' bytes')" ^
  "} catch {" ^
  "  Write-Host ('ERR ' + $_.Exception.Message); exit 1" ^
  "}" > "%PSOUT%" 2>&1
set "PSRC=%ERRORLEVEL%"
type "%PSOUT%"
type "%PSOUT%" >> "%LOG%"
echo PowerShell exit=%PSRC% >> "%LOG%"

if "%PSRC%"=="0" if exist "%EXE_PATH%" goto :verify_size

REM ---------- METHOD 2: curl --------
where curl >nul 2>&1
if errorlevel 1 goto :err_download

echo.
echo  PowerShell 실패, curl로 재시도...
echo --- attempt 2: curl --- >> "%LOG%"
curl -L --connect-timeout 15 -A "orbit-installer" -o "%EXE_PATH%" "%URL%"
set "CRC=%ERRORLEVEL%"
echo curl exit=%CRC% >> "%LOG%"
if "%CRC%"=="0" goto :curl_ok

echo.
echo  curl 종료 코드 %CRC% 의 뜻:
if "%CRC%"=="6"  echo    6  = DNS 해석 실패. 인터넷 또는 DNS 설정 확인.
if "%CRC%"=="7"  echo    7  = 연결 실패. 방화벽/프록시 차단 가능성.
if "%CRC%"=="23" echo    23 = 파일 쓰기 실패. EXE가 다른 프로세스에 잠겨있어요.
if "%CRC%"=="35" echo    35 = TLS 핸드셰이크 실패. 시스템 시간/인증서 확인.
if "%CRC%"=="60" echo    60 = SSL 인증서 검증 실패. 시간/CA 확인.
if "%CRC%"=="22" echo    22 = HTTP 4xx/5xx 응답. URL 또는 권한 확인.
if "%CRC%"=="28" echo    28 = 타임아웃. 네트워크 느림 또는 차단.
goto :err_download

:curl_ok
if not exist "%EXE_PATH%" goto :err_download

:verify_size
for %%A in ("%EXE_PATH%") do set "EXE_SIZE=%%~zA"
echo [INFO] downloaded bytes=%EXE_SIZE% >> "%LOG%"
if %EXE_SIZE% LSS %MIN_SIZE% goto :err_too_small

echo  다운로드 OK (%EXE_SIZE% bytes)
echo.
echo [2/3] 바탕화면 단축 아이콘 생성...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Orbit Downloader.lnk');" ^
  "$s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()" 2>>"%LOG%"
if errorlevel 1 echo   (바탕화면 단축아이콘은 생략됨)

echo [3/3] 시작메뉴 등록...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Orbit Downloader.lnk');" ^
  "$s.TargetPath='%EXE_PATH%'; $s.IconLocation='%EXE_PATH%'; $s.WorkingDirectory='%INSTALL_DIR%'; $s.Save()" 2>>"%LOG%"
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
echo [ERROR] 설치 폴더를 만들 수 없어요. 권한/디스크 공간 확인.
echo         %INSTALL_DIR%
goto :report

:err_locked
echo [FATAL] cannot delete existing %EXE_PATH% ? locked >> "%LOG%"
echo.
echo [ERROR] 기존 OrbitDownloader.exe 파일이 잠겨있어 덮어쓸 수 없어요.
echo         원인:
echo           - Orbit Downloader가 아직 실행 중 (자동 종료 시도했지만 실패)
echo           - 백신/실시간 보호가 파일을 검사 중
echo           - 다른 사용자 세션이 잡고 있음
echo         조치:
echo           1. 작업관리자 → 'OrbitDownloader.exe' 모두 종료
echo           2. 잠시 기다린 뒤 install.bat 다시 실행
goto :report

:err_download
echo [FATAL] all download attempts failed >> "%LOG%"
echo.
echo [ERROR] EXE 다운로드 실패.
echo.
echo  체크리스트:
echo    1. 인터넷 연결되어 있나요? (브라우저에서 github.com 열어보기)
echo    2. 백신/방화벽이 curl·powershell의 다운로드를 막고 있나요?
echo    3. 회사·학교 네트워크라면 프록시 설정이 필요할 수 있어요.
echo.
echo  수동 다운로드:
echo    %URL%
echo    → 받은 OrbitDownloader.exe 를 %INSTALL_DIR%\ 에 직접 넣으세요.
goto :report

:err_too_small
echo [FATAL] downloaded file is %EXE_SIZE% bytes (expected ^>= %MIN_SIZE%) >> "%LOG%"
echo.
echo [ERROR] 받아진 파일이 너무 작아요 (%EXE_SIZE% bytes).
echo         네트워크가 HTML 에러 페이지로 응답했거나 중간에 끊긴 거예요.
goto :report

:report
echo.
echo --- 로그 마지막 20줄 ---
powershell -NoProfile -Command "Get-Content -Path '%LOG%' -Tail 20 -Encoding UTF8"
echo --- 로그 전체: %LOG%
echo.
echo  로그 전체를 보고 싶으면 메모장이 열립니다.
choice /C YN /N /T 8 /D Y /M "로그를 메모장으로 열까요 (Y/N, 8초 후 Y)? "
if not errorlevel 2 start "" notepad "%LOG%"
echo.
pause
endlocal
exit /b 1
