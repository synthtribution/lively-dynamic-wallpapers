@echo off
chcp 65001 >nul
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -Command "$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*fondos-de-pantalla*server.js*' }; if ($procs) { Write-Host 'Cerrando instancia anterior...'; $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $procs | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 250 }"
wscript.exe //B "%ROOT%\scripts\iniciar-oculto.vbs"

powershell -NoProfile -Command "for ($i=0; $i -lt 20; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:38421/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Write-Host 'Servidor listo en segundo plano: http://127.0.0.1:38421'; exit 0 } } catch {}; Start-Sleep -Milliseconds 300 }; Write-Host 'No se pudo verificar el servidor.'; exit 1"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
