@echo off
REM ============================================================
REM  Arranca el servidor del CRM de Alquiler Vacacional
REM  Doble clic para iniciar. Deja esta ventana abierta.
REM ============================================================
title CRM Alquiler Vacacional
cd /d "%~dp0"

REM Buscar Node en el PATH; si no esta, usar la ruta de instalacion habitual.
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
) else if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" server.js
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
  "C:\Program Files (x86)\nodejs\node.exe" server.js
) else (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org
  echo y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

pause
