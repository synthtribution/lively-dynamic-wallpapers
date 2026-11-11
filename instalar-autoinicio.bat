@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FondosDePantalla.lnk"

powershell -NoProfile -Command "$q = [char]34; $ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%LNK%'); $sc.TargetPath = 'wscript.exe'; $sc.Arguments = '//B ' + $q + '%ROOT%\scripts\iniciar-oculto.vbs' + $q; $sc.WorkingDirectory = '%ROOT%'; $sc.WindowStyle = 7; $sc.Save(); Write-Host 'Autoinicio silencioso instalado en:' '%LNK%'"
pause
