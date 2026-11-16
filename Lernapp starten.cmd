@echo off
chcp 65001 >nul
title KV-Lernapp
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte zuerst von https://nodejs.org die Version LTS installieren.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Erster Start: Die benötigten Teile werden installiert. Das dauert etwa eine Minute ...
  call npm.cmd install
  if errorlevel 1 (
    echo Die Installation ist fehlgeschlagen. Bitte die Meldung oben als Screenshot schicken.
    pause
    exit /b 1
  )
)
echo.
echo Die Lernapp startet. Dieses Fenster offen lassen, solange du lernst. Zum Beenden das Fenster schliessen.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173"
call npm.cmd start
echo.
echo Die Lernapp wurde beendet.
pause
