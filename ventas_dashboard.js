import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    addDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (asumidas en tu HTML: jspdf, autotable, y xlsx)
const { jsPDF } = window.jspdf;
const { XLSX } = window; 

// --- CONSTANTE POR DEFECTO ---
const BASE_CAJA_DEFAULT = 500.00; 

// --- UTILIDAD DE FORMATO ---
function formatoMoneda(monto) {
    return `Q ${parseFloat(monto).toFixed(2)}`;
}

// Función para formatear la hora con AM/PM para Excel y Cierres
const formatTimeWithAmPm = (timestamp) => {
    // Normaliza el input a un objeto Date
    const date = normalizeDate(timestamp);
    if (!date) return 'N/A';
    
    let hours = date.getHours(); 
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12; 
    hours = hours ? hours : 12; // La hora '0' (medianoche) debe ser '12'
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${hours}:${minutes} ${ampm}`;
};

// ** FUNCIÓN PARA SEGMENTACIÓN AM/PM **
const getSegmentoDia = (timestamp) => {
    const date = normalizeDate(timestamp);
    if (!date) return 'N/A';
    // Definimos el corte a las 12:00 PM (hora 12)
    return date.getHours() < 12 ? 'AM' : 'PM';
};


// --- REFERENCIAS DEL DOM (ASUMIDAS) ---
const ventaDiariaSpan = document.getElementById("ventaDiaria");
const ventaMensualSpan = document.getElementById("ventaMensual");
const ventaTotalHistoricaSpan = document.getElementById("ventaTotalHistorica");
const fechaActualSpan = document.getElementById("fechaActual");
const baseCajaInicialSpan = document.getElementById("baseCajaInicial"); 

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

// --- REFERENCIAS DEL DOM ADICIONALES ---
const kpiEfectivoRestante = document.getElementById("kpiEfectivoRestante"); 
const efectivoRestanteLbl = document.getElementById("efectivoRestante");      
const inyeccionesInputDiv = document.getElementById("inyeccionesInput");      
const montoInyeccionesInput = document.getElementById("montoInyecciones");    


// --- ESTADO Y DATOS ---
let todasLasVentas = [];
let inventarioMap = new Map();
const RecargoPorcentaje = 0.05; // 5%
let datosCargadosCompletos = false;

// ESTADOS DE CIERRE
let todosLosCierres = [];
let retirosDraHoy = [];
let totalRetiradoDra = 0;
let cierreMananaRealizado = false;
let cierreTardeRealizado = false;

// --- ESTADOS DE CÁLCULO ---
let baseCajaInicial = BASE_CAJA_DEFAULT; 
let efectivoRestanteMañana = 0; 
let totalInyecciones = 0;       


// --- UTILIDADES DE FECHA ---
function normalizeDate(dateInput) {
    if (dateInput instanceof Date) return dateInput;
    if (dateInput && typeof dateInput.toDate === 'function') {
        return dateInput.toDate();
    }
    if (typeof dateInput === 'string') {
        try {
            const date = new Date(dateInput.replace(/-/g, '/') + ' 00:00:00'); 
            if (!isNaN(date.getTime())) return date;
        } catch (e) {
             // Ignorar error de normalización si falla.
        }
    }
    if (dateInput && dateInput.seconds !== undefined) {
        return new Date(dateInput.seconds * 1000 + (dateInput.nanoseconds / 1000000));
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
    if (day.length < 2) month = '0' + month;

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

    // --- PASO 2: Cargar Retiros/Cierres del día y establecer la BASE DE CAJA ---
    const hoyStr = formatDate(hoy);
    baseCajaInicial = BASE_CAJA_DEFAULT; 

    try {
        const cierresSnapshot = await getDocs(collection(db, "cierres_caja"));
        retirosDraHoy = [];
        todosLosCierres = [];
        totalRetiradoDra = 0;
        cierreMananaRealizado = false;
        cierreTardeRealizado = false;
        
        // Reiniciar efectivo restante y ocultar el KPI de efectivo y el campo de inyecciones
        efectivoRestanteMañana = 0;
        kpiEfectivoRestante.style.display = 'none';
        inyeccionesInputDiv.style.display = 'none';

        // 1. Encontrar el último cierre para establecer la BASE DE CAJA
        let ultimoCierreTimestamp = 0;
        let saldoDiaAnterior = BASE_CAJA_DEFAULT;
        
        cierresSnapshot.forEach(docu => {
            const data = docu.data();
            const timestampDate = normalizeDate(data.timestamp);
            if (!timestampDate) return;
            
            const timestampCierre = timestampDate.getTime();
            const fechaCierreStr = data.fechaStr || formatDate(timestampDate);
            
            // Guarda todos los cierres para el reporte de Excel
            todosLosCierres.push({
                ...data,
                id: docu.id,
                fecha: fechaCierreStr,
                hora: formatTimeWithAmPm(timestampDate) 
            });

            if (fechaCierreStr === hoyStr) {
                // Procesar cierres de HOY
                if (data.tipo === 'manana') {
                    retirosDraHoy.push(data);
                    totalRetiradoDra += parseFloat(data.montoRetiro || 0);
                    cierreMananaRealizado = true;
                    // Al cargar, asumimos que el último retiro de mañana de hoy define el efectivo restante
                    efectivoRestanteMañana = parseFloat(data.efectivoRestante || 0); 
                }
                if (data.tipo === 'tarde') {
                    cierreTardeRealizado = true;
                }
            } else {
                // Procesar cierres ANTERIORES para encontrar la BASE
                if (timestampCierre > ultimoCierreTimestamp) {
                    ultimoCierreTimestamp = timestampCierre;
                    // El campo 'efectivoRestante' del cierre de 'tarde' es la BASE de mañana (ya excluye inyecciones)
                    saldoDiaAnterior = parseFloat(data.efectivoRestante || BASE_CAJA_DEFAULT); 
                }
            }
        });
        
        // Asignar el saldo final del día anterior como la base de caja de hoy
        baseCajaInicial = saldoDiaAnterior;
        
        // Actualizar el span en el DOM (si existe)
        if (baseCajaInicialSpan) {
            baseCajaInicialSpan.textContent = formatoMoneda(baseCajaInicial);
        }

        retiroDraDiaSpan.textContent = formatoMoneda(totalRetiradoDra);
        console.log(`1.2. ✅ Cierres cargados. Base de Caja Inicial dinámica: Q ${baseCajaInicial.toFixed(2)}.`);

    } catch (error) {
        console.error("🛑 Error al cargar los cierres de caja (Colección 'cierres_caja').", error);
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
                fechaVentaStr: fechaVentaStr,
                segmento: getSegmentoDia(fechaVenta) // Añadir segmento de día
            });

            totalHistorico += totalVentaNetoBase;
            if (fechaVenta.getMonth() === mesActual && fechaVenta.getFullYear() === añoActual) {
                totalMensual += totalVentaNetoBase;
                if (fechaVentaStr === hoyStr) {
                    totalDiario += totalVentaNetoBase;
                }
            }
        });

        ventaDiariaSpan.textContent = formatoMoneda(totalDiario);
        ventaMensualSpan.textContent = formatoMoneda(totalMensual);
        ventaTotalHistoricaSpan.textContent = formatoMoneda(totalHistorico);
        console.log("3. ✅ Carga de Ventas completada. KPIs actualizados.");

        // Recalcular Efectivo Restante (Si el cierre ya se hizo)
        if (cierreMananaRealizado) {
            const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr);
            const totalEfectivoVentas = calcularTotalesVentaDia(ventasDelDia).efectivoDia;
            
            // Efectivo Restante = Ventas Efectivo NETO + Base Dinámica - Total Retirado Dra + Inyecciones
            efectivoRestanteMañana = totalEfectivoVentas + baseCajaInicial - totalRetiradoDra + totalInyecciones;
            
            efectivoRestanteLbl.textContent = formatoMoneda(efectivoRestanteMañana);
            kpiEfectivoRestante.style.display = 'flex'; // Muestra el KPI
            inyeccionesInputDiv.style.display = 'block'; // Muestra el campo de inyecciones
        }

        actualizarBotonesCierre();
        
        datosCargadosCompletos = true;
        return true;
        
    } catch (error) {
        console.error("🛑 Error al cargar los datos de ventas (Colección 'ventas').", error);
        return false;
    }
}


// --- FUNCIÓN DE CÁLCULO DE TOTALES PARA REUTILIZACIÓN (LÓGICA CORREGIDA) ---
function calcularTotalesVentaDia(ventasDelDia) {
    let totalEfectivoDia = 0;
    let totalTarjetaNetoDia = 0;
    let totalNetoDia = 0;
    
    // Venta segmentada AM/PM
    let efectivoAM = 0;
    let tarjetaAM = 0;
    let efectivoPM = 0;
    let tarjetaPM = 0;
    
    ventasDelDia.forEach(venta => {
        const totalVentaNetoBase = parseFloat(venta.totalNeto || 0);
        totalNetoDia += totalVentaNetoBase;
        
        const metodo = (venta.metodoPago || '').toLowerCase(); 
        const segmento = venta.segmento;
        
        // ** LÓGICA CLAVE PARA EL RESUMEN DE CAJA: 
        // Si el cierre de mañana NO se ha realizado, TODO se considera AM para el resumen. **
        const segmentoEfectivo = cierreMananaRealizado ? segmento : 'AM';


        if (metodo.includes('efectivo')) { 
            totalEfectivoDia += totalVentaNetoBase;
            
            if (segmentoEfectivo === 'AM') {
                efectivoAM += totalVentaNetoBase;
            } else if (segmentoEfectivo === 'PM') {
                efectivoPM += totalVentaNetoBase;
            }
        } else if (metodo.includes('tarjeta')) { 
            totalTarjetaNetoDia += totalVentaNetoBase;
            
            if (segmentoEfectivo === 'AM') {
                tarjetaAM += totalVentaNetoBase;
            } else if (segmentoEfectivo === 'PM') {
                tarjetaPM += totalVentaNetoBase;
            }
        }
    });

    return {
        efectivoDia: totalEfectivoDia,
        tarjetaDia: totalTarjetaNetoDia,
        totalDia: totalNetoDia,
        efectivoAM, tarjetaAM,
        efectivoPM, tarjetaPM
    };
}

// ---------------------------------------------------------------------------------------------------
// FUNCIONES DE CIERRE DE CAJA (Manejo de UI y lógica de guardado)
// ---------------------------------------------------------------------------------------------------

function actualizarBotonesCierre() {
    btnCierreManana.style.display = 'block';
    btnCierreTarde.style.display = 'none';
    cierreMananaInputDiv.style.display = 'none';
    
    if (!cierreMananaRealizado) {
        kpiEfectivoRestante.style.display = 'none';
        inyeccionesInputDiv.style.display = 'none';
    }


    const colorSuccess = '#ffc107'; // Amarillo
    const colorDisabled = '#6c757d'; // Gris
    const colorPrimary = '#007bff'; // Azul

    if (cierreTardeRealizado) {
        btnCierreManana.textContent = 'Cierre de Mañana COMPLETO';
        btnCierreManana.disabled = true;
        btnCierreManana.style.backgroundColor = colorDisabled; 
        
        btnCierreTarde.textContent = 'Cierre Final COMPLETO';
        btnCierreTarde.style.display = 'block';
        btnCierreTarde.disabled = true;
        btnCierreTarde.style.backgroundColor = colorDisabled; 
        
    } else if (cierreMananaRealizado) {
        btnCierreManana.textContent = `Cierre de Mañana REALIZADO (Retiro ${formatoMoneda(totalRetiradoDra)})`;
        btnCierreManana.disabled = true;
        btnCierreManana.style.backgroundColor = colorDisabled; 
        
        btnCierreTarde.style.display = 'block';
        btnCierreTarde.disabled = false;
        btnCierreTarde.style.backgroundColor = colorPrimary; 
        
        kpiEfectivoRestante.style.display = 'flex';
        efectivoRestanteLbl.textContent = formatoMoneda(efectivoRestanteMañana);
        inyeccionesInputDiv.style.display = 'block';
        
    } else {
        btnCierreManana.textContent = 'Cierre de Mañana';
        btnCierreManana.disabled = false;
        btnCierreManana.style.backgroundColor = colorSuccess; 
    }
}


// ---------------------------------------------------------------------------------------------------
// EXPORTACIÓN PDF DIARIO (Ajustado para el formato solicitado)
// ---------------------------------------------------------------------------------------------------
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

        let montoRecargoTotal = 0;
        let totalNetoDia = 0; 
        const detallesVentaTabla = [];
        
        const { 
            efectivoDia: totalEfectivoDia, 
            tarjetaDia: totalTarjetaNetoDia, 
            totalDia: totalNetoDiaCalculado,
            efectivoAM, tarjetaAM,
            efectivoPM, tarjetaPM
        } = calcularTotalesVentaDia(ventasDelDia);
        
        totalNetoDia = totalNetoDiaCalculado;

        // Procesamiento de ventas para detalle y recargo
        ventasDelDia.forEach(venta => {
            
            const totalVentaNetoBase = parseFloat(venta.totalNeto || 0);
            
            const idVenta = venta.numeroVenta || venta.id.substring(0, 10); 
            const metodo = (venta.metodoPago || '').toLowerCase(); 
            
            // ** LÓGICA CORREGIDA PARA EL DETALLE DE TRANSACCIONES: **
            // Si el cierre de mañana NO se ha realizado, TODAS las ventas se marcan como [AM] en el reporte de detalle.
            const segmentoParaReporte = cierreMananaRealizado ? venta.segmento : 'AM';
            
            const esPagoConTarjeta = metodo.includes('tarjeta');
            const totalVentaBruto = parseFloat(venta.totalBruto) || (esPagoConTarjeta ? totalVentaNetoBase * (1 + RecargoPorcentaje) : totalVentaNetoBase); 

            if (esPagoConTarjeta) { 
                montoRecargoTotal += (totalVentaBruto - totalVentaNetoBase);
            }

            // --- RECOLECCIÓN DE DETALLES PARA LA TABLA DEL PDF ---
            if (Array.isArray(venta.productos)) {
                venta.productos.forEach((producto, indexProducto) => {
                    const nombreProducto = producto.nombre || 'Producto Desconocido'; 
                    
                    const lotesArray = (Array.isArray(producto.lotes) && producto.lotes.length > 0) ? producto.lotes : 
                                             [{ cantidad: producto.cantidad || 0, precio: producto.precioUnitario || 0, loteId: producto.id }];
                    
                    lotesArray.forEach(lote => {
                        const cantidad = parseFloat(lote.cantidad) || parseFloat(producto.cantidad) || 0; 
                        
                        const precioUnitarioFinal = parseFloat(lote.precio) || parseFloat(producto.precioUnitario) || parseFloat(producto.precioReferencia) || 0;
                        const totalItemConRecargo = cantidad * precioUnitarioFinal; 

                        const loteId = lote.loteId || producto.id;
                        const loteData = inventarioMap.get(loteId); 
                        const esLoteAntibiotico = loteData ? loteData.antibiotico : false; 
                        
                        // Añadir segmento CORREGIDO al concepto [AM] o [PM]
                        const conceptoConSegmento = `[${segmentoParaReporte}] ${nombreProducto} ${esLoteAntibiotico ? '(ANTIBIÓTICO)' : ''}`;

                        detallesVentaTabla.push({
                            numero: idVenta, 
                            cantidad: cantidad, 
                            concepto: conceptoConSegmento, // CONCEPTO CON [AM] o [PM] CORREGIDO
                            punitario: precioUnitarioFinal.toFixed(2), 
                            total: totalItemConRecargo.toFixed(2), 
                            ordenVenta: venta.fechaVenta.getTime(),
                            ordenProducto: indexProducto
                        });
                    });
                });
            }
        });
        
        // --- Cálculo de Totales y Resumen ---
        // Efectivo en caja = Efectivo Neto (productos) + Inyecciones + baseCajaInicial - Total Retirado Dra
        const efectivoEnCaja = totalEfectivoDia + totalInyecciones + baseCajaInicial - totalRetiradoDra;
        
        // Venta Neta Final = Venta Neto (Productos) + Inyecciones
        const ventaNetaFinal = totalNetoDia + totalInyecciones; 

        // *** APLICAR ORDENAMIENTO FINAL ***
        detallesVentaTabla.sort((a, b) => {
            if (a.ordenVenta !== b.ordenVenta) {
                return a.ordenVenta - b.ordenVenta; 
            }
            return a.ordenProducto - b.ordenProducto;
        });

        // Mapeo final para la tabla de detalles
        const bodyTablaDetalles = detallesVentaTabla
            .filter(d => d.cantidad > 0)
            .map(d => [d.numero, d.cantidad.toFixed(0), d.concepto, `Q ${d.punitario}`, `Q ${d.total}`]); 

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
        // RESUMEN DE VENTAS
        // -----------------------------------------------------------
        const resumenVentas = [
            // Fila de mañana
            ['Ventas Mañana (AM)', formatoMoneda(efectivoAM), formatoMoneda(tarjetaAM)],
            // Fila de tarde (Solo contará ventas PM si se hizo cierre de mañana)
            ['Ventas Tarde (PM)', formatoMoneda(efectivoPM), formatoMoneda(tarjetaPM)],
            // Fila de totales
            [{ content: 'TOTAL NETO VENDIDO (DÍA)', styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } }, 
             { content: formatoMoneda(totalEfectivoDia), styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } }, 
             { content: formatoMoneda(totalTarjetaNetoDia), styles: { fontStyle: 'bold', fillColor: [200, 220, 255] } }],
        ];

        doc.autoTable({
            startY: y,
            head: [['Detalle de Ventas', 'MONTO EFECTIVO NETO (Q)', 'MONTO TARJETA NETO (Q)']], 
            body: resumenVentas,
            theme: 'grid', 
            headStyles: { fillColor: [0, 123, 255], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 
                0: { cellWidth: 70 }, 
                1: { halign: 'right', cellWidth: 50 },
                2: { halign: 'right', cellWidth: 50 } 
            }
        });
        
        // ** AJUSTE DE ESPACIADO **
        y = doc.autoTable.previous.finalY + 8; // Más espacio
        
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("MOVIMIENTOS Y CIERRES", 14, y);
        doc.line(14, y + 2, 70, y + 2); 
        y += 8;

        // -----------------------------------------------------------
        // MOVIMIENTOS DE CAJA Y TOTALES FINALES (COLORES AJUSTADOS)
        // -----------------------------------------------------------
        const movimientosCaja = [
            // TOTAL VENTA NETA FINAL (PRODUCTOS + INYECCIONES)
            // Color de fondo celeste claro (similar a la imagen)
            [{ content: 'TOTAL VENTA NETA FINAL (VENTAS + INYECCIONES)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [215, 235, 255] } }, 
             formatoMoneda(ventaNetaFinal), 
             // Etiqueta verde
             { content: 'VENTA NETA', styles: { fontStyle: 'bold', fillColor: [153, 204, 153], textColor: 0 } }],
            
            // Inyecciones (Fondo claro)
            ['Total en Inyecciones', formatoMoneda(totalInyecciones), 
             // Etiqueta amarilla
             { content: 'INYECCIONES', styles: { fillColor: [255, 255, 153], textColor: 0 } }],

            // Recargo (Fondo claro)
            ['Monto de Recargo por Tarjeta (5%)', formatoMoneda(montoRecargoTotal), 
             // Etiqueta verde claro
             { content: 'RECARGO', styles: { fillColor: [204, 255, 204], textColor: 0 } }],

            // Base de Caja (Fondo claro)
            ['BASE DE CAJA INICIAL (Saldo del día anterior)', formatoMoneda(baseCajaInicial), 
             // Etiqueta amarilla
             { content: 'BASE', styles: { fillColor: [255, 255, 153], textColor: 0 } }],
            
            // Retiro de Dra. (Fondo claro)
            ['MONTO RETIRADO POR DRA.', formatoMoneda(totalRetiradoDra), 
             // Etiqueta salmón/rojiza
             { content: 'RETIRO', styles: { fillColor: [255, 204, 204], textColor: 0 } }],
            
            // Efectivo Restante (FINAL)
            // Color de fondo salmón/rojizo fuerte (similar a la imagen)
            [{ content: 'EFECTIVO RESTANTE EN CAJA (Efectivo Neto + Base - Retiro)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [255, 204, 204] } }, 
             formatoMoneda(efectivoEnCaja), 
             // Etiqueta roja
             { content: 'FINAL', styles: { fontStyle: 'bold', fillColor: [255, 102, 102], textColor: 255 } }],
        ];
        
        doc.autoTable({
            startY: y,
            head: [['Concepto', 'Monto (Q)', 'Etiqueta']],
            body: movimientosCaja,
            theme: 'plain', 
            headStyles: { fillColor: [52, 58, 64], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 2 },
            columnStyles: { 
                0: { cellWidth: 120 }, 
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
            head: [['No. Venta', 'Cant.', 'Concepto (AM/PM)', 'P. Unitario', 'TOTAL']], 
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


// ---------------------------------------------------------------------------------------------------
// EXPORTACIÓN EXCEL DE CIERRES
// ---------------------------------------------------------------------------------------------------
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
        Efectivo_Restante_Post_Cierre: parseFloat(cierre.efectivoRestante || 0).toFixed(2), 
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

// ---------------------------------------------------------------------------------------------------
// EXPORTACIÓN EXCEL HISTÓRICO
// ---------------------------------------------------------------------------------------------------
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
        
        const horaVenta = formatTimeWithAmPm(venta.fechaVenta); 
        

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
                        Hora: horaVenta, 
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
                 ID_Venta: idVenta, No_Transaccion: numeroVenta, Fecha: fechaVenta, Hora: horaVenta, 
                 Metodo_Pago: metodoPago, Total_Venta_General: totalVentaBruto,
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


// ---------------------------------------------------------------------------------------------------
// EXPORTACIÓN PDF HISTÓRICO
// ---------------------------------------------------------------------------------------------------
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
        formatoMoneda(venta.totalNeto), 
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


// ---------------------------------------------------------------------------------------------------
// EVENT LISTENERS E INICIALIZACIÓN
// ---------------------------------------------------------------------------------------------------

// 1. Manejo del Cierre de Mañana (Muestra el campo de texto)
btnCierreManana.addEventListener("click", () => {
    if (!cierreMananaRealizado) {
        cierreMananaInputDiv.style.display = 'block';
        montoRetiroDraInput.value = '';
    }
});

// 2. Confirmación y guardado del Retiro (Cierre de Mañana)
btnConfirmarRetiro.addEventListener("click", async () => {
    const montoRetiro = parseFloat(montoRetiroDraInput.value);
    
    if (isNaN(montoRetiro) || montoRetiro < 0) {
        alert("Por favor, ingrese un monto de retiro válido (cero o mayor).");
        return;
    }

    // Calcular el efectivo actual antes de confirmar
    const hoyStr = formatDate(new Date());
    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr);
    const totalEfectivoVentas = calcularTotalesVentaDia(ventasDelDia).efectivoDia;
    // Se incluye la base de caja DINÁMICA
    const efectivoActual = totalEfectivoVentas + baseCajaInicial; 
    
    if (montoRetiro > efectivoActual) {
        alert(`❌ El monto de retiro (Q ${montoRetiro.toFixed(2)}) excede el efectivo disponible en caja (Q ${efectivoActual.toFixed(2)}). Por favor, revise.`);
        return;
    }

    if (!confirm(`¿Confirmar retiro de ${formatoMoneda(montoRetiro)} por parte de la DRA? Este monto se restará del efectivo en caja.`)) {
        return;
    }

    // Calcular el efectivo restante (incluye las inyecciones si ya se registraron)
    // Este valor de 'efectivoRestante' es solo para mostrar el KPI a mitad del día.
    const efectivoRestante = efectivoActual - montoRetiro + totalInyecciones; 

    try {
        const now = new Date();
        // Guardamos en Firebase, incluyendo el efectivo restante
        await addDoc(collection(db, "cierres_caja"), {
            tipo: 'manana',
            timestamp: now,
            fechaStr: formatDate(now),
            montoRetiro: montoRetiro,
            efectivoRestante: efectivoRestante, // Saldo post-retiro (incluye inyecciones)
            registradoPor: 'Usuario'
        });

        alert(`✅ Cierre de Mañana y Retiro de ${formatoMoneda(montoRetiro)} registrado. Efectivo restante: ${formatoMoneda(efectivoRestante)}`);
        
        cierreMananaInputDiv.style.display = 'none'; 
        btnCierreManana.style.display = 'none'; 
        btnCierreTarde.style.display = 'block'; 
        
        efectivoRestanteMañana = efectivoRestante;
        efectivoRestanteLbl.textContent = formatoMoneda(efectivoRestanteMañana);
        kpiEfectivoRestante.style.display = 'flex'; 
        inyeccionesInputDiv.style.display = 'block'; 
        
        await cargarVentasYCálculos(); 
    } catch (e) {
        console.error("Error al registrar cierre de mañana:", e);
        alert("❌ Error al guardar el cierre en Firebase.");
    }
});

// 3. Manejo del Cierre de Tarde (Guarda el saldo final como base de mañana SIN INYECCIONES)
btnCierreTarde.addEventListener("click", async () => {
    if (cierreTardeRealizado) return;

    if (!confirm("¿Confirmar el Cierre Final del Día? Esto inhabilita el resto de cierres de hoy.")) {
        return;
    }

    // Calcular el saldo final del día para usarlo como Base de Mañana
    const hoyStr = formatDate(new Date());
    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr);
    const { efectivoDia: totalEfectivoVentas } = calcularTotalesVentaDia(ventasDelDia);

    // Saldo Final de Efectivo TOTAL (lo que queda en caja)
    const efectivoFinalDelDiaTotal = totalEfectivoVentas + baseCajaInicial + totalInyecciones - totalRetiradoDra;
    
    // Calcular el Saldo Final de Caja (Base para mañana) EXCLUYENDO el monto de Inyecciones
    const efectivoParaBaseManana = efectivoFinalDelDiaTotal - totalInyecciones; 

    try {
        const now = new Date();
        await addDoc(collection(db, "cierres_caja"), {
            tipo: 'tarde',
            timestamp: now,
            fechaStr: formatDate(now),
            montoRetiro: 0, 
            efectivoRestante: efectivoParaBaseManana, // << ESTO ES LA BASE DE CAJA DE MAÑANA (SIN INYECCIONES)
            registradoPor: 'Usuario'
        });

        alert(`✅ Cierre Final del Día registrado. Saldo Final de Caja (Base para mañana, sin inyecciones): ${formatoMoneda(efectivoParaBaseManana)}`);
        await cargarVentasYCálculos(); 
    } catch (e) {
        console.error("Error al registrar cierre de tarde:", e);
        alert("❌ Error al guardar el cierre final en Firebase.");
    }
});


// --- EVENT LISTENER PARA CAPTURAR INYECCIONES ---
montoInyeccionesInput.addEventListener('input', () => {
    totalInyecciones = parseFloat(montoInyeccionesInput.value) || 0;
    
    // Recalcular el KPI de Efectivo Restante de forma dinámica al cambiar inyecciones
    if (cierreMananaRealizado) {
         const hoyStr = formatDate(new Date());
         const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr);
         const totalEfectivoVentas = calcularTotalesVentaDia(ventasDelDia).efectivoDia;
         
         // Efectivo Restante = Ventas Efectivo NETO + Base Dinámica - Total Retirado Dra + Inyecciones
         efectivoRestanteMañana = totalEfectivoVentas + baseCajaInicial - totalRetiradoDra + totalInyecciones;
         efectivoRestanteLbl.textContent = formatoMoneda(efectivoRestanteMañana);
    }
});


// Otros Event Listeners
btnExportarPdfDiario.addEventListener("click", exportarPdfDiario);
btnExportarExcelTotal.addEventListener("click", exportarExcelTotal);
btnExportarPdfTotal.addEventListener("click", exportarPdfTotal);
btnExportarExcelCierres.addEventListener("click", exportarExcelCierres);

// Inicialización de la aplicación
cargarVentasYCálculos();