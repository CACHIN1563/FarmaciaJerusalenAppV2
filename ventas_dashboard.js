import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    addDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (cargadas en el HTML)
const { jsPDF } = window.jspdf;
const { XLSX } = window; 

// --- REFERENCIAS DEL DOM ---
const ventaDiariaSpan = document.getElementById("ventaDiaria");
const ventaMensualSpan = document.getElementById("ventaMensual");
const ventaTotalHistoricaSpan = document.getElementById("ventaTotalHistorica");
const fechaActualSpan = document.getElementById("fechaActual");

const btnExportarPdfDiario = document.getElementById("btnExportarPdfDiario");
const btnExportarExcelTotal = document.getElementById("btnExportarExcelTotal");
const btnExportarPdfTotal = document.getElementById("btnExportarPdfTotal");
const btnExportarExcelCierres = document.getElementById("btnExportarExcelCierres"); 

// --- REFERENCIAS DEL DOM PARA CIERRE ---
const retiroDraDiaSpan = document.getElementById("retiroDraDia");
const btnCierreManana = document.getElementById("btnCierreManana");
const btnCierreTarde = document.getElementById("btnCierreTarde");
const cierreMananaInputDiv = document.getElementById("cierreMananaInput");
const montoRetiroDraInput = document.getElementById("montoRetiroDra");
const btnConfirmarRetiro = document.getElementById("btnConfirmarRetiro");


// --- ESTADO Y DATOS ---
let todasLasVentas = [];
let inventarioMap = new Map();
const RecargoPorcentaje = 0.05; // 5%
let datosCargadosCompletos = false;

// ESTADOS DE CIERRE
let todosLosCierres = []; // Guarda todos los cierres históricos
let retirosDraHoy = []; // Guarda solo los cierres de hoy
let totalRetiradoDra = 0;
let cierreMananaRealizado = false;
let cierreTardeRealizado = false;
let timestampPrimerCierreManana = null; // CLAVE: Momento exacto del primer cierre para dividir AM/PM

// --- UTILIDADES DE FECHA ---
function normalizeDate(dateInput) {
    if (dateInput instanceof Date) return dateInput;
    if (dateInput && typeof dateInput.toDate === 'function') {
        return dateInput.toDate();
    }
    if (typeof dateInput === 'string') {
        try {
            // Asegura que la cadena de fecha se interprete como local (Guatemala - CST)
            const date = new Date(dateInput.replace(/-/g, '/') + ' 00:00:00'); 
            if (!isNaN(date.getTime())) return date;
        } catch (e) {
             // Ignorar error de normalización si falla.
        }
    }
    return null;
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

function getFormattedDateTime(date) {
    if (!date) return '';
    const now = new Date(date);
    const datePart = now.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const timePart = now.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
}

function calculateTotalNeto(productosArray) {
    let subtotal = 0;
    if (!Array.isArray(productosArray)) return 0;
    
    productosArray.forEach(producto => {
        const lotes = Array.isArray(producto.lotes) ? producto.lotes : 
                      [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0 }]; 
        
        lotes.forEach(lote => {
            // Usamos el precio del lote si existe, o del producto
            const precioBase = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0; 
            const cantidad = parseFloat(lote.cantidad) || parseFloat(producto.cantidad) || 0;
            
            if (cantidad > 0 && precioBase > 0) {
                subtotal += (cantidad * precioBase); 
            }
        });
    });
    
    return subtotal;
}


// --- CARGAR DATOS DE FIRESTORE Y CALCULAR KPIS ---
async function cargarVentasYCálculos() {
    console.log("1. ✅ Iniciando carga de Ventas e Inventario.");
    datosCargadosCompletos = false;

    const hoy = new Date();
    fechaActualSpan.textContent = formatDate(hoy);
    
    // --- PASO 1: Cargar Inventario ---
    try {
        const invSnapshot = await getDocs(collection(db, "inventario"));
        inventarioMap.clear();
        
        invSnapshot.forEach(docu => {
            const data = docu.data();
            inventarioMap.set(docu.id, {
                antibiotico: !!data.antibiotico
            });
        });
        console.log(`1.1. ✅ Inventario cargado. ${inventarioMap.size} elementos mapeados.`);
    } catch (error) {
        console.error("🛑 Error al cargar el inventario (Colección 'inventario').", error);
        return false;
    }

    // --- PASO 2: Cargar Retiros/Cierres del día y establecer el TIMESTAMP divisor AM/PM ---
    const hoyStr = formatDate(hoy);
    try {
        const cierresSnapshot = await getDocs(collection(db, "cierres_caja"));
        retirosDraHoy = [];
        todosLosCierres = [];
        totalRetiradoDra = 0;
        cierreMananaRealizado = false;
        cierreTardeRealizado = false;
        timestampPrimerCierreManana = null;

        cierresSnapshot.forEach(docu => {
            const data = docu.data();
            const timestampCierre = normalizeDate(data.timestamp).getTime();
            const fechaCierreStr = data.fechaStr || formatDate(normalizeDate(data.timestamp));
            
            // Guarda todos los cierres para el reporte de Excel
            todosLosCierres.push({
                ...data,
                id: docu.id,
                fecha: fechaCierreStr,
                hora: normalizeDate(data.timestamp).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            });

            if (fechaCierreStr === hoyStr) {
                if (data.tipo === 'manana') {
                    retirosDraHoy.push(data);
                    totalRetiradoDra += parseFloat(data.montoRetiro || 0);
                    cierreMananaRealizado = true;
                    
                    // Si es el primer cierre de mañana del día, guarda su timestamp
                    if (!timestampPrimerCierreManana || timestampCierre < timestampPrimerCierreManana) {
                        timestampPrimerCierreManana = timestampCierre;
                    }
                }
                if (data.tipo === 'tarde') {
                    cierreTardeRealizado = true;
                }
            }
        });
        
        retiroDraDiaSpan.textContent = `Q ${totalRetiradoDra.toFixed(2)}`;
        console.log(`1.2. ✅ Cierres cargados. Total retirado: Q ${totalRetiradoDra.toFixed(2)}.`);

        // Actualizar el estado de los botones
        actualizarBotonesCierre();

    } catch (error) {
        console.error("🛑 Error al cargar los cierres de caja (Colección 'cierres_caja').", error);
        // Continuamos
    }

    // --- PASO 3: Cargar y Procesar Ventas ---
    const mesActual = hoy.getMonth();
    const añoActual = hoy.getFullYear();

    try {
        const querySnapshot = await getDocs(collection(db, "ventas"));
        
        todasLasVentas = [];
        let totalDiario = 0;
        let totalMensual = 0;
        let totalHistorico = 0;

        querySnapshot.forEach(docu => {
            const data = docu.data();
            const fechaVenta = normalizeDate(data.fecha);
            
            if (!fechaVenta) return; 
            
            const fechaVentaStr = formatDate(fechaVenta);
            const productosArray = data.productos || [];
            
            // Si la venta tiene totalGeneral, lo usamos como BRUTO (incluye recargo)
            const totalVentaBruto = parseFloat(data.totalGeneral) || calculateTotalNeto(productosArray); 
            
            const metodo = (data.metodoPago || '').toLowerCase();
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 

            // Calculamos el NETO (base sin recargo) para los KPIs
            let totalVentaNetoBase = totalVentaBruto / factorRecargo; 
            
            // Añadir el segmento (AM/PM) a la data de la venta
            const segmentoDia = (fechaVentaStr === hoyStr && timestampPrimerCierreManana && fechaVenta.getTime() >= timestampPrimerCierreManana) 
                                ? 'PM' : 'AM';
            
            todasLasVentas.push({ 
                id: docu.id, 
                ...data,
                totalNeto: totalVentaNetoBase, 
                totalBruto: totalVentaBruto,   
                fechaVenta: fechaVenta,
                fechaVentaStr: fechaVentaStr,
                segmentoDia: segmentoDia // Nueva propiedad
            });

            totalHistorico += totalVentaNetoBase;
            if (fechaVenta.getMonth() === mesActual && fechaVenta.getFullYear() === añoActual) {
                totalMensual += totalVentaNetoBase;
                if (fechaVentaStr === hoyStr) {
                    totalDiario += totalVentaNetoBase;
                }
            }
        });

        ventaDiariaSpan.textContent = `Q ${totalDiario.toFixed(2)}`;
        ventaMensualSpan.textContent = `Q ${totalMensual.toFixed(2)}`;
        ventaTotalHistoricaSpan.textContent = `Q ${totalHistorico.toFixed(2)}`;
        console.log("3. ✅ Carga de Ventas completada. KPIs actualizados.");
        datosCargadosCompletos = true;
        return true;
        
    } catch (error) {
        console.error("🛑 Error al cargar los datos de ventas (Colección 'ventas').", error);
        return false;
    }
}

// --- FUNCIONES DE CIERRE DE CAJA ---

function actualizarBotonesCierre() {
    btnCierreManana.style.display = 'block';
    btnCierreTarde.style.display = 'none';
    cierreMananaInputDiv.style.display = 'none';
    
    const colorSuccess = '#ffc107'; // Amarillo
    const colorDisabled = '#6c757d'; // Gris
    const colorPrimary = '#007bff'; // Azul

    // Si ya se hizo el cierre de la tarde, se deshabilitan todos los botones
    if (cierreTardeRealizado) {
        btnCierreManana.textContent = 'Cierre de Mañana COMPLETO';
        btnCierreManana.disabled = true;
        btnCierreManana.style.backgroundColor = colorDisabled; 
        
        btnCierreTarde.textContent = 'Cierre Final COMPLETO';
        btnCierreTarde.style.display = 'block';
        btnCierreTarde.disabled = true;
        btnCierreTarde.style.backgroundColor = colorDisabled; 
        
    // Si solo se hizo el cierre de la mañana, se habilita el cierre de la tarde
    } else if (cierreMananaRealizado) {
        btnCierreManana.textContent = `Cierre de Mañana REALIZADO (Retiro Q ${totalRetiradoDra.toFixed(2)})`;
        btnCierreManana.disabled = true;
        btnCierreManana.style.backgroundColor = colorDisabled; 
        
        btnCierreTarde.style.display = 'block';
        btnCierreTarde.disabled = false;
        btnCierreTarde.style.backgroundColor = colorPrimary; // Reestablece el color azul
        
    // Si no hay cierres, se muestra el de la mañana
    } else {
        btnCierreManana.textContent = 'Cierre de Mañana';
        btnCierreManana.disabled = false;
        btnCierreManana.style.backgroundColor = colorSuccess; // Amarillo
    }
}


// --- EXPORTACIÓN PDF DIARIO (VERSIÓN CON TABLA DE RESUMEN - Estilo Profesional) ---
async function exportarPdfDiario() {
    
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }
    
    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === formatDate(new Date()));

    if (ventasDelDia.length === 0) {
        alert("No hay ventas registradas para el día de hoy.");
        return;
    }

    try {
        const doc = new jsPDF();
        const fechaReporte = getFormattedDateTime(new Date());

        // Inicialización de totales
        let totalEfectivoAM = 0;
        let totalEfectivoPM = 0;
        let totalTarjetaNetoAM = 0;
        let totalTarjetaNetoPM = 0; 
        let montoRecargoTotal = 0;
        let totalNetoDia = 0; 
        const detallesVentaTabla = [];
        
        // Procesamiento de ventas
        ventasDelDia.forEach(venta => {
            
            const totalVentaNetoBase = parseFloat(venta.totalNeto || 0);
            totalNetoDia += totalVentaNetoBase;
            
            const idVenta = venta.numeroVenta || venta.id.substring(0, 10); 
            const metodo = (venta.metodoPago || '').toLowerCase(); 
            const segmento = venta.segmentoDia || 'AM'; 
            
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const totalVentaBruto = parseFloat(venta.totalBruto) || (esPagoConTarjeta ? totalVentaNetoBase * (1 + RecargoPorcentaje) : totalVentaNetoBase); 

            // Cálculo de totales segmentados (USANDO NETO)
            if (metodo.includes('efectivo')) { 
                if (segmento === 'AM') totalEfectivoAM += totalVentaNetoBase;
                else totalEfectivoPM += totalVentaNetoBase;
            } else if (esPagoConTarjeta) { 
                if (segmento === 'AM') totalTarjetaNetoAM += totalVentaNetoBase;
                else totalTarjetaNetoPM += totalVentaNetoBase; 
                
                montoRecargoTotal += (totalVentaBruto - totalVentaNetoBase);
            }

            // --- RECOLECCIÓN DE DETALLES PARA LA TABLA DEL PDF ---
            if (Array.isArray(venta.productos)) {
                // Iterar sobre los productos y USAR SU ÍNDICE para mantener el orden
                venta.productos.forEach((producto, indexProducto) => {
                    const nombreProducto = producto.nombre || 'Producto Desconocido'; 
                    
                    const lotesArray = (Array.isArray(producto.lotes) && producto.lotes.length > 0) ? producto.lotes : 
                                             [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0, loteId: producto.id }];
                    
                    lotesArray.forEach(lote => {
                        const cantidad = parseFloat(lote.cantidad) || parseFloat(producto.cantidad) || 0; 
                        
                        // **** CORRECCIÓN CRÍTICA DE CÁLCULO DE TOTALES ****
                        // Se toma el precio final/bruto de la base de datos (lote.precio o producto.precioUnitario).
                        const precioUnitarioFinal = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0;
                        const totalItemConRecargo = cantidad * precioUnitarioFinal; 

                        const loteId = lote.loteId || producto.id;
                        const loteData = inventarioMap.get(loteId); 
                        const esLoteAntibiotico = loteData ? loteData.antibiotico : false; 

                        detallesVentaTabla.push({
                            numero: idVenta, 
                            cantidad: cantidad, 
                            concepto: nombreProducto + (esLoteAntibiotico ? ' (ANTIBIÓTICO)' : ''),
                            punitario: precioUnitarioFinal.toFixed(2), 
                            total: totalItemConRecargo.toFixed(2), 
                            segmento: segmento,
                            // *** CLAVE PARA ORDENAR: Guardamos el ID de la Venta y el índice del producto ***
                            ordenVenta: venta.fechaVenta.getTime(),
                            ordenProducto: indexProducto
                        });
                    });
                });
            }
        });
        
        // --- Cálculo de Totales y Resumen ---
        const totalEfectivoDia = totalEfectivoAM + totalEfectivoPM;
        const totalTarjetaNetoDia = totalTarjetaNetoAM + totalTarjetaNetoPM;
        const efectivoEnCaja = totalEfectivoDia - totalRetiradoDra;

        // *** APLICAR ORDENAMIENTO FINAL ***
        detallesVentaTabla.sort((a, b) => {
            // Primero ordenar por venta (fecha/hora) para agrupar ventas
            if (a.ordenVenta !== b.ordenVenta) {
                // Si la venta 'a' es anterior a 'b', 'a' va primero
                return a.ordenVenta - b.ordenVenta; 
            }
            // Luego ordenar por el índice del producto dentro de esa venta
            return a.ordenProducto - b.ordenProducto;
        });

        // Mapeo final para la tabla de detalles
        const bodyTablaDetalles = detallesVentaTabla
            .filter(d => d.cantidad > 0)
            .map(d => [d.numero, d.cantidad.toFixed(0), `[${d.segmento}] ${d.concepto}`, `Q ${d.punitario}`, `Q ${d.total}`]);

        // --- GENERACIÓN DEL PDF ---
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text("FARMACIA JERUSALÉN - REPORTE DE VENTA", 105, 15, null, null, "center");
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Generado: ${fechaReporte}`, 200, 20, null, null, "right"); 
        
        let y = 30;
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("RESUMEN DE CAJA DEL DÍA", 14, y);
        doc.line(14, y + 2, 70, y + 2); 
        y += 8;
        
        // -----------------------------------------------------------
        // INICIO: RESUMEN DE VENTAS POR SEGMENTO (usando autoTable)
        // -----------------------------------------------------------
        const resumenVentas = [
            // Segmentos
            ['Ventas Mañana (AM)', `Q ${totalEfectivoAM.toFixed(2)}`, `Q ${totalTarjetaNetoAM.toFixed(2)}`],
            ['Ventas Tarde (PM)', `Q ${totalEfectivoPM.toFixed(2)}`, `Q ${totalTarjetaNetoPM.toFixed(2)}`],
            // Totales
            [{ content: 'TOTAL NETO VENDIDO (DÍA)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } }, 
             { content: `Q ${totalEfectivoDia.toFixed(2)}`, styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } },
             { content: `Q ${totalTarjetaNetoDia.toFixed(2)}`, styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } }],
        ];

        doc.autoTable({
            startY: y,
            head: [['Detalle de Ventas', 'MONTO EFECTIVO NETO (Q)', 'MONTO TARJETA NETO (Q)']],
            body: resumenVentas,
            theme: 'grid', 
            headStyles: { fillColor: [0, 123, 255], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'right' }, 2: { halign: 'right' } }
        });
        
        y = doc.autoTable.previous.finalY + 5; 

        // -----------------------------------------------------------
        // MOVIMIENTOS DE CAJA Y TOTALES FINALES (usando otra autoTable)
        // -----------------------------------------------------------
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("MOVIMIENTOS Y CIERRES", 14, y);
        doc.line(14, y + 2, 70, y + 2); 
        y += 8;

        const movimientosCaja = [
            ['GRAN TOTAL VENTA NETA DEL DÍA', `Q ${totalNetoDia.toFixed(2)}`, { content: 'VENTA TOTAL', styles: { fontStyle: 'bold', fillColor: [220, 240, 255] } }],
            ['Monto de Recargo por Tarjeta (5%)', `Q ${montoRecargoTotal.toFixed(2)}`, { content: 'RECARGO', styles: { fillColor: [240, 255, 240] } }],
            ['MONTO RETIRADO POR DRA.', `Q ${totalRetiradoDra.toFixed(2)}`, { content: 'RETIRO', styles: { fillColor: [255, 240, 220] } }],
            ['EFECTIVO RESTANTE EN CAJA', `Q ${efectivoEnCaja.toFixed(2)}`, { content: 'FINAL', styles: { fontStyle: 'bold', fillColor: [255, 200, 200] } }],
        ];
        
        doc.autoTable({
            startY: y,
            head: [['Concepto', 'Monto (Q)', 'Etiqueta']],
            body: movimientosCaja,
            theme: 'striped', 
            headStyles: { fillColor: [52, 58, 64], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 2 },
            columnStyles: { 
                0: { cellWidth: 90 }, 
                1: { halign: 'right', fontStyle: 'bold' }, 
                2: { cellWidth: 30, halign: 'center', fontStyle: 'bold' } 
            }
        });

        y = doc.autoTable.previous.finalY + 15;

        // -----------------------------------------------------------
        // DETALLE DE TRANSACCIONES
        // -----------------------------------------------------------
        doc.setFontSize(14);
        doc.text("DETALLE DE TRANSACCIONES", 14, y);
        doc.line(14, y + 2, 85, y + 2); 
        y += 8;
        
        doc.autoTable({
            startY: y,
            head: [['No. Venta', 'Cant.', 'Concepto [AM/PM]', 'P. Unitario', 'TOTAL']],
            body: bodyTablaDetalles,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: { 
                0: { cellWidth: 20 }, 
                1: { cellWidth: 15, halign: 'center' }, 
                2: { cellWidth: 90 }, 
                3: { cellWidth: 25, halign: 'right' },
                4: { cellWidth: 25, halign: 'right' } 
            },
        });

        doc.save(`Reporte_Ventas_Diario_${formatDate(new Date())}.pdf`);
        alert("✅ Reporte Diario PDF generado con formato tabular y orden correcto.");

    } catch (e) {
        console.error("🛑 Error al generar el PDF diario:", e);
        alert(`❌ Error CRÍTICO al generar el PDF. Mensaje: ${e.message}. Revise la consola.`);
    }
}


// --- NUEVA FUNCIÓN: EXPORTACIÓN EXCEL DE CIERRES ---
async function exportarExcelCierres() {
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }
    
    if (todosLosCierres.length === 0) {
        alert("No hay registros de cierres de caja en el histórico para exportar.");
        return;
    }

    const datosCierres = todosLosCierres.map(cierre => ({
        ID_Cierre: cierre.id,
        Tipo: cierre.tipo.toUpperCase(),
        Fecha: cierre.fecha,
        Hora: cierre.hora,
        Monto_Retirado: parseFloat(cierre.montoRetiro || 0).toFixed(2),
        Registrado_Por: cierre.registradoPor || 'N/A'
    }));

    try {
        const ws = XLSX.utils.json_to_sheet(datosCierres);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "ReporteCierresCaja");
        XLSX.writeFile(wb, "Reporte_Historico_CIERRES_CAJA.xlsx");
        alert("✅ Reporte Histórico de Cierres de Caja exportado a Excel exitosamente.");
    } catch (e) {
        console.error("Error al exportar reporte de cierres a Excel:", e);
        alert("❌ Error al exportar el reporte de cierres a Excel. Revise la consola.");
    }
}

// --- EXPORTACIÓN EXCEL HISTÓRICO ---
async function exportarExcelTotal() {
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }
    
    if (todasLasVentas.length === 0) {
        alert("No hay ventas en el histórico para exportar.");
        return;
    }
    
    const datosDetallados = [];
    
    todasLasVentas.forEach(venta => {
        const idVenta = venta.id;
        const fechaVenta = venta.fechaVentaStr;
        const metodoPago = venta.metodoPago || 'N/A';
        const totalVentaBruto = parseFloat(venta.totalBruto || 0).toFixed(2); 
        const numeroVenta = venta.numeroVenta || idVenta.substring(0, 10); 
        const segmentoDia = venta.segmentoDia || 'N/A';

        const metodo = (venta.metodoPago || '').toLowerCase(); 
        const esPagoConTarjeta = metodo.includes('tarjeta');
        const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 

        if (Array.isArray(venta.productos) && venta.productos.length > 0) {
            
            venta.productos.forEach(producto => {
                const nombreProducto = producto.nombre || 'Producto Desconocido';
                const precioReferencia = parseFloat(producto.precioReferencia || 0);

                const lotesArray = (Array.isArray(producto.lotes) && producto.lotes.length > 0) ? producto.lotes : 
                                         [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0, loteId: producto.id }];
                
                lotesArray.forEach(lote => {
                    const cantidad = parseFloat(lote.cantidad) || parseFloat(producto.cantidad) || 0;
                    const precioUnitarioBase = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0;
                    
                    const precioUnitarioFinal = precioUnitarioBase * factorRecargo;
                    const totalItem = (cantidad * precioUnitarioFinal);
                    
                    const loteId = lote.loteId || 'N/A';
                    const loteData = inventarioMap.get(loteId);
                    const esAntibiotico = loteData && loteData.antibiotico ? 'Sí' : 'No';
                    
                    datosDetallados.push({
                        ID_Venta: idVenta,
                        No_Transaccion: numeroVenta,
                        Fecha: fechaVenta,
                        Segmento_Dia: segmentoDia, 
                        Metodo_Pago: metodoPago,
                        Total_Venta_General: totalVentaBruto, 
                        Producto: nombreProducto,
                        Cantidad_Vendida: cantidad, 
                        Precio_Unitario_Base: precioUnitarioBase.toFixed(2),
                        Precio_Unitario_Final: precioUnitarioFinal.toFixed(2), 
                        Subtotal_Lote: totalItem.toFixed(2), 
                        ID_Lote: loteId,
                        Es_Antibiotico: esAntibiotico,
                        Precio_Referencia_Producto: precioReferencia.toFixed(2) 
                    });
                });
            });
        } else {
            // Caso para ventas sin detalle de productos
             datosDetallados.push({
                ID_Venta: idVenta, No_Transaccion: numeroVenta, Fecha: fechaVenta, Segmento_Dia: segmentoDia, Metodo_Pago: metodoPago, Total_Venta_General: totalVentaBruto,
                Producto: 'SIN DETALLE DE PRODUCTOS', Cantidad_Vendida: 0, Precio_Unitario_Base: 0, Precio_Unitario_Final: 0, 
                Subtotal_Lote: 0, ID_Lote: 'N/A', Es_Antibiotico: 'N/A', Precio_Referencia_Producto: 0
            });
        }
    });

    try {
        const ws = XLSX.utils.json_to_sheet(datosDetallados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "DetalleHistoricoVentas");
        XLSX.writeFile(wb, "Reporte_Historico_DETALLADO.xlsx");
        alert("✅ Histórico detallado de ventas exportado a Excel exitosamente.");
    } catch (e) {
        console.error("Error al exportar a Excel:", e);
        alert("❌ Error al exportar a Excel. Revise la consola.");
    }
}


// --- EXPORTACIÓN PDF HISTÓRICO ---
async function exportarPdfTotal() {
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }
    
    if (todasLasVentas.length === 0) {
        alert("No hay ventas en el histórico para exportar.");
        return;
    }
    
    const ventasOrdenadas = todasLasVentas.sort((a, b) => b.fechaVenta.getTime() - a.fechaVenta.getTime());

    const doc = new jsPDF({ orientation: 'portrait' }); 
    const datosTabla = ventasOrdenadas.map(venta => [
        venta.id.substring(0, 10), 
        venta.fechaVentaStr,
        `Q ${venta.totalNeto.toFixed(2)}`, 
        venta.metodoPago || 'N/A',
    ]);

    doc.autoTable({
        head: [['ID Venta', 'Fecha', 'Total Neto', 'Método de Pago']],
        body: datosTabla,
        startY: 20,
        theme: 'striped',
        headStyles: { fillColor: [0, 123, 255] },
        didDrawPage: function (data) {
            doc.setFontSize(16);
            doc.setTextColor(40);
            doc.text("Reporte Histórico de Ventas", data.settings.margin.left, 15);
        }
    });

    doc.save('Reporte_Historico_Ventas_Resumen.pdf');
    alert("✅ Reporte Histórico PDF generado exitosamente.");
}


// --- EVENT LISTENERS E INICIALIZACIÓN ---

// 1. Manejo del Cierre de Mañana (Muestra el campo de texto)
btnCierreManana.addEventListener("click", () => {
    if (!cierreMananaRealizado) {
        cierreMananaInputDiv.style.display = 'block';
        montoRetiroDraInput.value = '';
    }
});

// 2. Confirmación y guardado del Retiro (Cierre de Mañana)
btnConfirmarRetiro.addEventListener("click", async () => {
    const monto = parseFloat(montoRetiroDraInput.value);
    
    if (isNaN(monto) || monto < 0) {
        alert("Por favor, ingrese un monto de retiro válido (cero o mayor).");
        return;
    }

    if (!confirm(`¿Confirmar retiro de Q ${monto.toFixed(2)} por parte de la DRA? Este monto se restará del efectivo en caja.`)) {
        return;
    }

    try {
        const now = new Date();
        // Guardamos en Firebase
        await addDoc(collection(db, "cierres_caja"), {
            tipo: 'manana',
            timestamp: now,
            fechaStr: formatDate(now),
            montoRetiro: monto,
            registradoPor: 'Usuario'
        });

        alert(`✅ Cierre de Mañana y Retiro de Q ${monto.toFixed(2)} registrado exitosamente.`);
        await cargarVentasYCálculos(); // Recarga para actualizar KPIs, botones y el divisor AM/PM
    } catch (e) {
        console.error("Error al registrar cierre de mañana:", e);
        alert("❌ Error al guardar el cierre en Firebase.");
    }
});

// 3. Manejo del Cierre de Tarde (Solo registro, sin monto)
btnCierreTarde.addEventListener("click", async () => {
    if (cierreTardeRealizado) return;

    if (!confirm("¿Confirmar el Cierre Final del Día? Esto inhabilita el resto de cierres de hoy.")) {
        return;
    }

    try {
        const now = new Date();
        await addDoc(collection(db, "cierres_caja"), {
            tipo: 'tarde',
            timestamp: now,
            fechaStr: formatDate(now),
            montoRetiro: 0, 
            registradoPor: 'Usuario'
        });

        alert("✅ Cierre Final del Día registrado exitosamente.");
        await cargarVentasYCálculos(); // Recarga para actualizar botones
    } catch (e) {
        console.error("Error al registrar cierre de tarde:", e);
        alert("❌ Error al guardar el cierre final en Firebase.");
    }
});


// Otros Event Listeners
btnExportarPdfDiario.addEventListener("click", exportarPdfDiario);
btnExportarExcelTotal.addEventListener("click", exportarExcelTotal);
btnExportarPdfTotal.addEventListener("click", exportarPdfTotal);
btnExportarExcelCierres.addEventListener("click", exportarExcelCierres);

cargarVentasYCálculos();