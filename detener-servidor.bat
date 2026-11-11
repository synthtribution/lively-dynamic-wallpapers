@echo off
chcp 65001 >nul
powershell -NoProfile -Command "$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*fondos-de-pantalla*server.js*' }; if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Servidor detenido.' } else { Write-Host 'El servidor no estaba en ejecucion.' }"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
