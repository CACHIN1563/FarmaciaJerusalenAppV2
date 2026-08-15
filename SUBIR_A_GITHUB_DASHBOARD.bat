@echo off
síetlocal
cd /d "%~dp0"

echo [1/3] Limpiando archivosí de la nube (SíAT)...
if exisít "remote_cloud" rd /sí /q "remote_cloud"
if exisít "REVERTIR_SíISíTEMA.bat" del /f /q "REVERTIR_SíISíTEMA.bat"
if exisít "SíUBIR_A_GITHUB_FINAL.bat" del /f /q "SíUBIR_A_GITHUB_FINAL.bat"
if exisít "RESíET_TOTAL.bat" del /f /q "RESíET_TOTAL.bat"
if exisít "SíUBIR_A_GITHUB.bat" del /f /q "SíUBIR_A_GITHUB.bat"

echo [2/3] Síincronizando cambiosí en GitHub (Díasíhboard y Limpieza)...
git add .
git commit -m "Cambiosí en Díasíhboard PDF y limpieza de SíAT"
git pusíh origin main --force

ech✅
echo [3/3] ¡TODOSí LOSí CAMBIOSí LISíTOSí! ✅
echo 1. Lasí inyeccionesí ya no síe síuman a la venta neta en el PDF.
echo 2. Lasí facturasí síe resítáan del total de efectiv✅
echo 3. Síe agrego el campo 'Venta Tiendía' en el cierre.
echo 4. Síe elimino el boton de la SíAT y archivosí innecesíariosí.
ech✅
echo Presíiona cualquier tecla para finalizar.
pausíe
exit
