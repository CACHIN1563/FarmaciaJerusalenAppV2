import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { jsPDF } = window.jspdf;

// --- REFERENCIAS DEL DOM (Mantenidas) ---
const ventaDiariaSpan = document.getElementById("ventaDiaria");
const ventaMensualSpan = document.getElementById("ventaMensual");
const ventaTotalHistoricaSpan = document.getElementById("ventaTotalHistorica");
const fechaActualSpan = document.getElementById("fechaActual");

const btnExportarPdfDiario = document.getElementById("btnExportarPdfDiario");
const btnExportarExcelTotal = document.getElementById("btnExportarExcelTotal");
const btnExportarPdfTotal = document.getElementById("btnExportarPdfTotal");

// --- ESTADO Y DATOS ---
let todasLasVentas = [];
let inventarioMap = new Map();
const RecargoPorcentaje = 0.05; // 5%
let datosCargadosCompletos = false;

// --- UTILIDADES DE FECHA (Mantenidas) ---
function normalizeDate(dateInput) {
    if (dateInput instanceof Date) return dateInput;
    if (dateInput && typeof dateInput.toDate === 'function') {
        return dateInput.toDate();
    }
    if (typeof dateInput === 'string') {
        try {
            const date = new Date(dateInput.replace(/-/g, '/') + ' 00:00:00');
            if (!isNaN(date)) return date;
        } catch (e) {
            // Error handling
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

function getFormattedDateTime() {
    const now = new Date();
    const datePart = now.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const timePart = now.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
}

function calculateTotalNeto(productosArray) {
    let subtotal = 0;
    if (!Array.isArray(productosArray)) return 0;
    
    productosArray.forEach(producto => {
        // Mejorar la robustez al acceder a los datos
        const lotes = Array.isArray(producto.lotes) ? producto.lotes : 
                      [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0 }]; 
        
        lotes.forEach(lote => {
            const precioBase = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0; 
            const cantidad = parseFloat(lote.cantidad) || 0; 
            if (cantidad > 0 && precioBase > 0) {
                subtotal += (cantidad * precioBase); 
            }
        });
    });
    
    return subtotal;
}


// --- CARGAR DATOS DE FIRESTORE Y CALCULAR KPIS (Mantenidos) ---
async function cargarVentasYCálculos() {
    console.log("1. ✅ Iniciando carga de Ventas e Inventario.");
    datosCargadosCompletos = false;

    const hoy = new Date();
    fechaActualSpan.textContent = formatDate(hoy);
    
    // --- PASO 1: Cargar Inventario para el chequeo de Antibióticos ---
    try {
        const invSnapshot = await getDocs(collection(db, "inventario"));
        inventarioMap.clear();
        
        invSnapshot.forEach(docu => {
            const data = docu.data();
            inventarioMap.set(docu.id, {
                antibiotico: !!data.antibiotico // Asegura que sea booleano
            });
        });
        console.log(`1.1. ✅ Inventario cargado. ${inventarioMap.size} elementos mapeados.`);
    } catch (error) {
        console.error("🛑 Error al cargar el inventario (Colección 'inventario').", error);
        return false;
    }

    // --- PASO 2: Cargar y Procesar Ventas ---
    const hoyStr = formatDate(hoy);
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
            
            const totalVentaBruto = parseFloat(data.totalGeneral) || calculateTotalNeto(productosArray); 
            
            const metodo = (data.metodoPago || '').toLowerCase();
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 

            let totalVentaNetoBase = totalVentaBruto / factorRecargo; 
            
            todasLasVentas.push({ 
                id: docu.id, 
                ...data,
                totalNeto: totalVentaNetoBase, 
                totalBruto: totalVentaBruto,   
                fechaVenta: fechaVenta,
                fechaVentaStr: fechaVentaStr 
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
        console.log("2. ✅ Carga de Ventas completada. KPIs actualizados.");
        datosCargadosCompletos = true;
        return true;
        
    } catch (error) {
        console.error("🛑 Error al cargar los datos de ventas (Colección 'ventas').", error);
        return false;
    }
}


// --- EXPORTACIÓN PDF DIARIO ---

/**
 * Genera el reporte diario en formato PDF.
 * CORRECCIÓN: Se eliminó el filtro de ítems 0 y el resaltado de antibióticos.
 */
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
        const fechaReporte = getFormattedDateTime();

        let totalEfectivo = 0;
        let totalTarjetaNeto = 0; 
        let montoRecargo = 0;
        let totalNetoDia = 0; 
        const detallesVentaTabla = [];
        
        ventasDelDia.forEach(venta => {
            
            const totalVentaNetoBase = parseFloat(venta.totalNeto || 0);
            totalNetoDia += totalVentaNetoBase;
            
            const idVenta = venta.numeroVenta || venta.id.substring(0, 10); 
            const metodo = (venta.metodoPago || '').toLowerCase(); 
            
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 
            const totalVentaBruto = totalVentaNetoBase * factorRecargo; 

            if (metodo.includes('efectivo')) { 
                totalEfectivo += totalVentaNetoBase;
            } else if (esPagoConTarjeta) { 
                totalTarjetaNeto += totalVentaNetoBase;
                montoRecargo += (totalVentaBruto - totalVentaNetoBase);
            }

            // --- RECOLECCIÓN DE DETALLES PARA LA TABLA DEL PDF ---
            if (Array.isArray(venta.productos)) {
                venta.productos.forEach(producto => {
                    const nombreProducto = producto.nombre || 'Producto Desconocido'; 
                    
                    const lotesArray = (Array.isArray(producto.lotes) && producto.lotes.length > 0) ? producto.lotes : 
                                       [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0, loteId: producto.id }];
                    
                    lotesArray.forEach(lote => {
                        // EXTRACCIÓN ROBUSTA DE DATOS (CORRECCIÓN CLAVE DE LECTURA)
                        const cantidad = parseFloat(lote.cantidad) || 0;
                        const precioUnitarioBase = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0;
                        
                        // Si los datos son CERO, aún los incluimos para diagnosticar por qué no aparecen.
                        
                        const precioUnitarioFinal = precioUnitarioBase * factorRecargo;
                        const totalItemConRecargo = cantidad * precioUnitarioFinal; 

                        const loteId = lote.loteId || producto.id;
                        const loteData = inventarioMap.get(loteId); 
                        const esLoteAntibiotico = loteData ? loteData.antibiotico : false; // Mantenemos el flag para revisión, pero no se usa para el estilo

                        detallesVentaTabla.push({
                            numero: idVenta, 
                            cantidad: cantidad,
                            concepto: nombreProducto + (esLoteAntibiotico ? ' (ANTIBIÓTICO)' : ''), // Mostramos el texto sin estilo
                            punitario: precioUnitarioFinal.toFixed(2), 
                            total: totalItemConRecargo.toFixed(2), 
                        });
                    });
                });
            }
        });

        const bodyTabla = detallesVentaTabla.map(d => [d.numero, d.cantidad, d.concepto, `Q ${d.punitario}`, `Q ${d.total}`]);

        // --- GENERACIÓN DEL PDF ---
        doc.setFontSize(16);
        doc.text("FARMACIA JERUSALÉN - REPORTE DE VENTA", 105, 15, null, null, "center");
        doc.setFontSize(10);
        doc.text(`Fecha: ${fechaReporte}`, 200, 20, null, null, "right"); 
        
        let y = 30;
        doc.setFontSize(14);
        doc.text("RESUMEN DEL DÍA", 14, y);
        doc.line(14, y + 2, 80, y + 2); 
        y += 8;

        doc.setFontSize(10);
        doc.text(`Total en Efectivo: Q ${totalEfectivo.toFixed(2)}`, 14, y); y += 6;
        doc.text(`Total con Tarjeta (Neto): Q ${totalTarjetaNeto.toFixed(2)}`, 14, y); y += 6;
        doc.text(`Monto de Recargo por Tarjeta (${(RecargoPorcentaje * 100).toFixed(0)}%): Q ${montoRecargo.toFixed(2)}`, 14, y); y += 8;

        doc.setFontSize(12);
        doc.text(`TOTAL NETO DEL DÍA: Q ${totalNetoDia.toFixed(2)}`, 14, y); 
        doc.line(14, y + 2, 75, y + 2); 
        y += 15;

        doc.setFontSize(14);
        doc.text("DETALLE DE TRANSACCIONES", 14, y);
        doc.line(14, y + 2, 100, y + 2); 
        y += 8;
        
        // CORRECCIÓN: El PDF ya no debería salir en blanco si hay datos en 'bodyTabla'
        doc.autoTable({
            startY: y,
            head: [['No. Venta', 'Cant.', 'Concepto', 'P. Unitario', 'TOTAL']],
            body: bodyTabla,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 2 },
            // SE ELIMINA el didParseCell para no resaltar antibióticos
            columnStyles: { 
                0: { cellWidth: 20 }, 
                1: { cellWidth: 15 }, 
                2: { cellWidth: 90 }, 
                3: { cellWidth: 25, halign: 'right' },
                4: { cellWidth: 25, halign: 'right' } 
            },
        });

        doc.save(`Reporte_Ventas_Diario_${formatDate(new Date())}.pdf`);
        alert("✅ Reporte Diario PDF generado exitosamente. Revise los detalles.");

    } catch (e) {
        console.error("🛑 Error al generar el PDF diario:", e);
        alert(`❌ Error CRÍTICO al generar el PDF. Mensaje: ${e.message}. Revise la consola.`);
    }
}


// --- EXPORTACIÓN EXCEL HISTÓRICO ---

/**
 * Exporta el histórico de ventas a Excel.
 * CORRECCIÓN: Se mejoró la extracción de Cantidad y Precio para evitar ceros.
 */
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
                    // EXTRACCIÓN ROBUSTA DE DATOS (CORRECCIÓN CLAVE)
                    const cantidad = parseFloat(lote.cantidad) || parseFloat(producto.cantidad) || 0; // Prioriza lote, luego producto
                    const precioUnitarioBase = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0;
                    
                    // Si ambos son cero, aún se incluye la línea para no perder el registro de la venta padre
                    
                    const precioUnitarioFinal = precioUnitarioBase * factorRecargo;
                    const totalItem = (cantidad * precioUnitarioFinal);
                    
                    const loteId = lote.loteId || 'N/A';
                    const loteData = inventarioMap.get(loteId);
                    const esAntibiotico = loteData && loteData.antibiotico ? 'Sí' : 'No';
                    
                    datosDetallados.push({
                        ID_Venta: idVenta,
                        No_Transaccion: numeroVenta,
                        Fecha: fechaVenta,
                        Metodo_Pago: metodoPago,
                        Total_Venta_General: totalVentaBruto, 
                        Producto: nombreProducto,
                        Cantidad_Vendida: cantidad, // AHORA usando la extracción robusta
                        Precio_Unitario_Base: precioUnitarioBase.toFixed(2),
                        Precio_Unitario_Final: precioUnitarioFinal.toFixed(2), 
                        Subtotal_Lote: totalItem.toFixed(2), // Subtotal que debe cuadrar con la Venta General
                        ID_Lote: loteId,
                        Es_Antibiotico: esAntibiotico,
                        Precio_Referencia_Producto: precioReferencia.toFixed(2) 
                    });
                });
            });
        } else {
            // Caso para ventas sin detalle de productos
             datosDetallados.push({
                ID_Venta: idVenta, No_Transaccion: numeroVenta, Fecha: fechaVenta, Metodo_Pago: metodoPago, Total_Venta_General: totalVentaBruto,
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

// --- EXPORTACIÓN PDF HISTÓRICO (Mantenida) ---
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


// --- EVENT LISTENERS Y INICIALIZACIÓN (Mantenidos) ---
btnExportarPdfDiario.addEventListener("click", exportarPdfDiario);
btnExportarExcelTotal.addEventListener("click", exportarExcelTotal);
btnExportarPdfTotal.addEventListener("click", exportarPdfTotal);

cargarVentasYCálculos();