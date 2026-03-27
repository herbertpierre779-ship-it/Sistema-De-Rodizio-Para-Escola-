@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%back-end"
set "FRONTEND_DIR=%ROOT_DIR%Front-end"

if not exist "%BACKEND_DIR%\app\main.py" (
  echo Backend nao encontrado em:
  echo %BACKEND_DIR%
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo Frontend nao encontrado em:
  echo %FRONTEND_DIR%
  pause
  exit /b 1
)

where python >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_CMD=python"
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    set "PYTHON_CMD=py"
  ) else (
    echo Python nao foi encontrado no PATH.
    pause
    exit /b 1
  )
)

set "ADB_CMD="
where adb >nul 2>nul
if %errorlevel%==0 set "ADB_CMD=adb"

if not defined ADB_CMD if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  set "ADB_CMD=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
)
if not defined ADB_CMD if exist "%USERPROFILE%\Downloads\platform-tools-latest-windows\platform-tools\adb.exe" (
  set "ADB_CMD=%USERPROFILE%\Downloads\platform-tools-latest-windows\platform-tools\adb.exe"
)
if not defined ADB_CMD if exist "%USERPROFILE%\Downloads\platform-tools\adb.exe" (
  set "ADB_CMD=%USERPROFILE%\Downloads\platform-tools\adb.exe"
)
if not defined ADB_CMD if exist "%ROOT_DIR%platform-tools\adb.exe" (
  set "ADB_CMD=%ROOT_DIR%platform-tools\adb.exe"
)
if not defined ADB_CMD if exist "%ROOT_DIR%tools\platform-tools\adb.exe" (
  set "ADB_CMD=%ROOT_DIR%tools\platform-tools\adb.exe"
)

if not defined ADB_CMD (
  echo adb nao encontrado.
  echo Caminhos testados:
  echo - PATH do sistema
  echo - %LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
  echo - %USERPROFILE%\Downloads\platform-tools-latest-windows\platform-tools\adb.exe
  echo - %USERPROFILE%\Downloads\platform-tools\adb.exe
  echo.
  echo Instale Android Platform Tools e tente novamente.
  echo Download: https://developer.android.com/tools/releases/platform-tools
  pause
  exit /b 1
)

echo Usando adb: %ADB_CMD%

start "Cantina Backend ADB" cmd /k "cd /d ""%BACKEND_DIR%"" && %PYTHON_CMD% -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
start "Cantina Frontend ADB" cmd /k "cd /d ""%FRONTEND_DIR%"" && set ""VITE_API_URL="" && set ""VITE_PROXY_TARGET=http://127.0.0.1:8000"" && npm run dev"

echo.
echo Aguardando subida dos servidores...
timeout /t 3 /nobreak >nul

"%ADB_CMD%" start-server >nul 2>nul

set "HAS_DEVICE=0"
set "HAS_UNAUTHORIZED=0"
for /f "skip=1 tokens=1,2" %%A in ('"%ADB_CMD%" devices') do (
  if "%%B"=="device" set "HAS_DEVICE=1"
  if "%%B"=="unauthorized" set "HAS_UNAUTHORIZED=1"
)

if "%HAS_UNAUTHORIZED%"=="1" (
  echo.
  echo Celular encontrado, mas nao autorizado.
  echo Desbloqueie o celular e aceite "Permitir depuracao USB".
  echo Depois rode este arquivo novamente.
  pause
  exit /b 1
)

if not "%HAS_DEVICE%"=="1" (
  echo.
  echo Nenhum celular autorizado encontrado no adb.
  echo Passos:
  echo 1^) Ative Opcoes do desenvolvedor e Depuracao USB no celular.
  echo 2^) Conecte por cabo USB.
  echo 3^) Aceite "Permitir depuracao USB" no celular.
  echo 4^) Rode este arquivo novamente.
  pause
  exit /b 1
)

"%ADB_CMD%" reverse tcp:5173 tcp:5173 >nul 2>nul
if not %errorlevel%==0 (
  echo Falha ao criar reverse para porta 5173.
  pause
  exit /b 1
)

"%ADB_CMD%" reverse tcp:8000 tcp:8000 >nul 2>nul
if not %errorlevel%==0 (
  echo Falha ao criar reverse para porta 8000.
  pause
  exit /b 1
)

echo.
echo adb reverse configurado com sucesso:
echo 5173 -> 5173
echo 8000 -> 8000
echo.
echo No celular, abra:
echo http://localhost:5173
echo.
echo Backend no PC:  http://127.0.0.1:8000
echo Swagger no PC:  http://127.0.0.1:8000/docs
echo.
pause
