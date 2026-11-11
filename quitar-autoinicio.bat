@echo off
chcp 65001 >nul
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FondosDePantalla.lnk"

if exist "%LNK%" (
  del /f /q "%LNK%"
  echo Autoinicio eliminado correctamente.
) else (
  echo El autoinicio no estaba instalado.
)
pause
