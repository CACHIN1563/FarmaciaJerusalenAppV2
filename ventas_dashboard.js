import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { jsPDF } = window.jspdf;

// --- REFERENCIAS DEL DOM ---
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
const RecargoPorcentaje = 0.05;
let datosCargadosCompletos = false;

// --- UTILIDADES DE FECHA ---
function normalizeDate(dateInput) {
    if (dateInput instanceof Date) return dateInput;
    if (dateInput && typeof dateInput.toDate === 'function') {
        return dateInput.toDate();
    }
    if (typeof dateInput === 'string') {
        try {
            let date = new Date(dateInput);
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
        if (Array.isArray(producto.lotes)) { 
            producto.lotes.forEach(lote => {
                const cantidad = parseFloat(lote.cantidad || 0) || 0;
                const precio = parseFloat(lote.precio || 0) || 0; 
                if (cantidad > 0 && precio > 0) {
                    subtotal += (cantidad * precio); 
                }
            });
        }
    });
    
    return subtotal;
}


// --- CARGAR DATOS DE FIRESTORE Y CALCULAR KPIS ---

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
                antibiotico: !!data.antibiotico
            });
        });
        console.log(`1.1. ✅ Inventario cargado. ${inventarioMap.size} elementos mapeados.`);
    } catch (error) {
        console.error("🛑 Error al cargar el inventario (Colección 'inventario').", error);
        alert(`Error CRÍTICO al cargar el inventario (Colección 'inventario'). Mensaje: ${error.message}`);
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
            const totalVenta = parseFloat(data.totalGeneral) || calculateTotalNeto(productosArray); 
            
            todasLasVentas.push({ 
                id: docu.id, 
                ...data,
                totalNeto: totalVenta, 
                fechaVenta: fechaVenta,
                fechaVentaStr: fechaVentaStr 
            });

            totalHistorico += totalVenta;
            if (fechaVenta.getMonth() === mesActual && fechaVenta.getFullYear() === añoActual) {
                totalMensual += totalVenta;
                if (fechaVentaStr === hoyStr) {
                    totalDiario += totalVenta;
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
        alert(`Error CRÍTICO al cargar los datos de ventas (Colección 'ventas'). Mensaje: ${error.message}`);
        return false;
    }
}


// --- EXPORTACIONES ---

/**
 * Genera el reporte diario en formato PDF.
 * Se corrigió el precio unitario para mostrar el precio base del producto.
 * Se ajustaron los anchos de columna para hacer la tabla más larga.
 */
async function exportarPdfDiario() {
    
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) {
            console.error("🛑 El reporte no se puede generar porque la carga de datos falló.");
            return;
        }
    }
    
    if (todasLasVentas.length === 0) {
        alert("No hay ventas registradas para el día de hoy, o la carga de datos fue incompleta.");
        return;
    }
    
    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === formatDate(new Date()));

    if (ventasDelDia.length === 0) {
        alert("No hay ventas registradas para el día de hoy.");
        return;
    }

    try {
        const doc = new jsPDF();
        const fechaReporte = getFormattedDateTime();

        // --- CÁLCULOS GLOBALES DEL REPORTE ---
        let totalEfectivo = 0;
        let totalTarjetaNeto = 0; 
        let montoRecargo = 0;
        let totalNetoDia = 0;
        const detallesVentaTabla = [];
        
        ventasDelDia.forEach(venta => {
            
            const totalVentaBruto = parseFloat(venta.totalNeto || 0); 
            totalNetoDia += totalVentaBruto;
            
            const idVenta = venta.numeroVenta || venta.id; 
            const metodo = (venta.metodoPago || '').toLowerCase(); 
            
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 

            if (metodo.includes('efectivo')) { 
                totalEfectivo += totalVentaBruto;
            } else if (esPagoConTarjeta) { 
                const totalSinRecargo = totalVentaBruto / factorRecargo; 
                totalTarjetaNeto += totalSinRecargo; 
                montoRecargo += (totalVentaBruto - totalSinRecargo);
            }

            // --- RECOLECCIÓN DE DETALLES PARA LA TABLA DEL PDF ---
            if (Array.isArray(venta.productos)) {
                venta.productos.forEach(producto => {
                    const nombreProducto = producto.nombre || 'Producto Desconocido'; 
                    
                    if (Array.isArray(producto.lotes)) { 
                        producto.lotes.forEach(lote => {
                            const cantidad = parseFloat(lote.cantidad || 0) || 0;
                            const precioUnitarioBase = parseFloat(lote.precio || 0) || 0; // Precio base del producto
                            
                            // El total del item sí debe reflejar el recargo si aplica
                            const totalItemConRecargo = (cantidad * precioUnitarioBase) * factorRecargo; 

                            const loteData = inventarioMap.get(lote.loteId || producto.id); 
                            const esLoteAntibiotico = loteData ? loteData.antibiotico : false;
                            
                            const conceptoFinal = esLoteAntibiotico ? nombreProducto + ' (ANTIBIÓTICO)' : nombreProducto;

                            detallesVentaTabla.push({
                                numero: idVenta, 
                                cantidad: cantidad,
                                concepto: conceptoFinal, 
                                // CAMBIO AQUÍ: Usar precioUnitarioBase para P. Unitario
                                punitario: precioUnitarioBase.toFixed(2), 
                                total: totalItemConRecargo.toFixed(2) // El total sí incluye el recargo
                            });
                        });
                    }
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

        doc.autoTable({
            startY: y,
            head: [['No. Venta', 'Cant.', 'Concepto', 'P. Unitario', 'TOTAL']],
            body: bodyTabla,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: { 
                0: { cellWidth: 20 },   // AUMENTO: Más espacio para No. Venta
                1: { cellWidth: 15 },   // AUMENTO: Más espacio para Cant.
                2: { cellWidth: 90 },   // AUMENTO SIGNIFICATIVO: Mucho más espacio para Concepto
                3: { cellWidth: 25, halign: 'right' }, // AUMENTO: Más espacio para P. Unitario
                4: { cellWidth: 25, halign: 'right' }  // AUMENTO: Más espacio para TOTAL
            },
        });

        doc.save(`Reporte_Ventas_Diario_${formatDate(new Date())}.pdf`);
        alert("✅ Reporte Diario PDF generado exitosamente.");

    } catch (e) {
        console.error("🛑 Error al generar el PDF diario:", e);
        alert(`❌ Error CRÍTICO al generar el PDF. Mensaje: ${e.message}. Revise la consola.`);
    }
}


// --- EXPORTACIONES SECUNDARIAS (Se mantienen sin cambios) ---

async function exportarExcelTotal() {
    if (!datosCargadosCompletos) {
        await cargarVentasYCálculos();
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
        const totalVenta = venta.totalNeto; 
        const numeroVenta = venta.numeroVenta || idVenta; 

        const metodo = (venta.metodoPago || '').toLowerCase(); 
        const esPagoConTarjeta = metodo.includes('tarjeta');
        const factorRecargo = esPagoConTarjeta ? (1 + RecargoPorcentaje) : 1; 

        if (Array.isArray(venta.productos)) {
            venta.productos.forEach(producto => {
                const nombreProducto = producto.nombre || 'Producto Desconocido';
                const precioReferencia = parseFloat(producto.precioReferencia || 0);

                if (Array.isArray(producto.lotes)) {
                    producto.lotes.forEach(lote => {
                        const cantidad = parseFloat(lote.cantidad || 0);
                        const precioUnitarioBase = parseFloat(lote.precio || 0);
                        
                        const precioUnitarioFinal = precioUnitarioBase * factorRecargo;
                        const totalItem = (cantidad * precioUnitarioFinal);
                        
                        const loteData = inventarioMap.get(lote.loteId || producto.id);
                        const esAntibiotico = loteData && loteData.antibiotico ? 'Sí' : 'No';
                        
                        datosDetallados.push({
                            ID_Venta: idVenta,
                            No_Transaccion: numeroVenta,
                            Fecha: fechaVenta,
                            Metodo_Pago: metodoPago,
                            Total_Venta_General: totalVenta.toFixed(2), 
                            Producto: nombreProducto,
                            Cantidad_Vendida: cantidad,
                            Precio_Unitario_Venta: precioUnitarioFinal.toFixed(2), 
                            Subtotal_Lote: totalItem.toFixed(2),
                            ID_Lote: lote.loteId || 'N/A',
                            Es_Antibiotico: esAntibiotico,
                            Precio_Referencia_Producto: precioReferencia.toFixed(2) 
                        });
                    });
                }
            });
        } else {
            datosDetallados.push({
                ID_Venta: idVenta,
                No_Transaccion: numeroVenta,
                Fecha: fechaVenta,
                Metodo_Pago: metodoPago,
                Total_Venta_General: totalVenta.toFixed(2),
                Producto: 'SIN DETALLE DE PRODUCTOS',
                Cantidad_Vendida: 0,
                Precio_Unitario_Venta: 0,
                Subtotal_Lote: 0,
                ID_Lote: 'N/A',
                Es_Antibiotico: 'N/A',
                Precio_Referencia_Producto: 0
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

async function exportarPdfTotal() {
    if (!datosCargadosCompletos) {
        await cargarVentasYCálculos();
    }
    
    if (todasLasVentas.length === 0) {
        alert("No hay ventas en el histórico para exportar.");
        return;
    }

    const doc = new jsPDF({ orientation: 'portrait' }); 
    const datosTabla = todasLasVentas.map(venta => [
        venta.id,
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


// --- EVENT LISTENERS ---
btnExportarPdfDiario.addEventListener("click", exportarPdfDiario);
btnExportarExcelTotal.addEventListener("click", exportarExcelTotal);
btnExportarPdfTotal.addEventListener("click", exportarPdfTotal);

// --- INICIALIZACIÓN ---
cargarVentasYCálculos();
