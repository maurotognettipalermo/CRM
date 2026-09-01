@echo off
REM ============================================================
REM  Arranca el bot de Telegram del CRM (requiere que el CRM
REM  ya este corriendo en localhost:3000)
REM  Doble clic para iniciar. Deja esta ventana abierta.
REM ============================================================
title Bot Telegram - CRM
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node bot-telegram.js
) else if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" bot-telegram.js
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
  "C:\Program Files (x86)\nodejs\node.exe" bot-telegram.js
) else (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org
  pause
  exit /b 1
)

pause
