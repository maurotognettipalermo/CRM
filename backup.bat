@echo off
REM ============================================================
REM  Copia de seguridad de la base de datos del CRM
REM  Crea una carpeta backups\AAAA-MM-DD_HH-MM-SS con la BD.
REM ============================================================
cd /d "%~dp0"

REM Fecha y hora fiables mediante PowerShell (independiente del idioma de Windows)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set FECHA=%%i

set DEST=backups\%FECHA%
if not exist "backups" mkdir "backups"
mkdir "%DEST%" 2>nul

if not exist "db\crm.db" (
  echo No se encuentra db\crm.db. Arranca el programa al menos una vez antes de hacer copia.
  echo.
  pause
  exit /b 1
)

copy /Y "db\crm.db"     "%DEST%\" >nul 2>nul
copy /Y "db\crm.db-wal" "%DEST%\" >nul 2>nul
copy /Y "db\crm.db-shm" "%DEST%\" >nul 2>nul

echo.
echo  Copia de seguridad creada correctamente en:
echo    %CD%\%DEST%
echo.
echo  Para restaurar: cierra el programa y copia los archivos de esa
echo  carpeta de vuelta a la carpeta "db".
echo.
pause
