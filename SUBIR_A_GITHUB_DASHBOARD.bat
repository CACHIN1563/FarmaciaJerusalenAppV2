@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Limpiando archivos de la nube (SAT)...
if exist "remote_cloud" rd /s /q "remote_cloud"
if exist "REVERTIR_SISTEMA.bat" del /f /q "REVERTIR_SISTEMA.bat"
if exist "SUBIR_A_GITHUB_FINAL.bat" del /f /q "SUBIR_A_GITHUB_FINAL.bat"
if exist "RESET_TOTAL.bat" del /f /q "RESET_TOTAL.bat"
if exist "SUBIR_A_GITHUB.bat" del /f /q "SUBIR_A_GITHUB.bat"

echo [2/3] Sincronizando cambios en GitHub (Dashboard y Limpieza)...
git add .
git commit -m "Cambios en Dashboard PDF y limpieza de SAT"
git push origin main --force

echo.
echo [3/3] ¡TODOS LOS CAMBIOS LISTOS! ✅
echo 1. Las inyecciones ya no se suman a la venta neta en el PDF.
echo 2. Las facturas se restan del total de efectivo.
echo 3. Se agrego el campo 'Venta Tienda' en el cierre.
echo 4. Se elimino el boton de la SAT y archivos innecesarios.
echo.
echo Presiona cualquier tecla para finalizar.
pause
exit
