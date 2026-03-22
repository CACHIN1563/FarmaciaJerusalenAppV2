import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    addDoc,
    doc,
    updateDoc,
    deleteDoc,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (asumidas en tu HTML: jspdf, autotable, y xlsx)
// Acceso a las librerías globales (asumidas en tu HTML: jspdf, autotable, y xlsx)
const jsPDF = window.jspdf ? window.jspdf.jsPDF : (window.jsPDF ? window.jsPDF : null);
const XLSX = window.XLSX || null;

// --- CONSTANTE POR DEFECTO ---
const BASE_CAJA_DEFAULT = 500.00;

// --- ESTADO Y DATOS (GLOBALES) ---
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
let cierreMananaTimestamp = null;
let infoFacturas = [];
let infoSalario = null;
let infoComentarios = [];

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

// --- HELPERS DE FECHAS (RESTAURADOS) ---
function normalizeDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput instanceof Date) return dateInput;
    if (typeof dateInput === 'string') return new Date(dateInput);
    if (dateInput.toDate) return dateInput.toDate(); // Firebase Timestamp
    return new Date(dateInput);
}

function formatDate(date) {
    if (!date) return 'N/A';
    const d = normalizeDate(date);
    if (!d || isNaN(d.getTime())) return 'N/A';
    // Formato DD/MM/YYYY
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

// ** FUNCIÓN PARA SEGMENTACIÓN AM/PM **
// ** FUNCIÓN PARA SEGMENTACIÓN AM/PM **
const getSegmentoDia = (timestamp) => {
    const date = normalizeDate(timestamp);
    if (!date) return 'N/A';

    // Si NO se ha realizado el cierre de mañana, TODO se considera AM (pendiente de primer corte)
    if (!cierreMananaRealizado || !cierreMananaTimestamp) {
        return 'AM';
    }

    // Si YA se hizo el cierre, comparamos timestamps
    if (date.getTime() <= cierreMananaTimestamp.getTime()) {
        return 'AM';
    } else {
        return 'PM';
    }
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

// --- NUEVAS REFERENCIAS PARA CIERRE FINAL ---
const cierreTardeInputDiv = document.getElementById("cierreTardeInput");
const btnConfirmarCierreFinal = document.getElementById("btnConfirmarCierreFinal");

const facturaDescInput = document.getElementById("facturaDesc");
const facturaMontoInput = document.getElementById("facturaMonto");
const btnAgregarFactura = document.getElementById("btnAgregarFactura");
const listaFacturasUl = document.getElementById("listaFacturas");

const salarioDescInput = document.getElementById("salarioDesc");
const salarioMontoInput = document.getElementById("salarioMonto");

const comentarioTextoInput = document.getElementById("comentarioTexto");
const btnAgregarComentario = document.getElementById("btnAgregarComentario");
const listaComentariosUl = document.getElementById("listaComentarios");

const btnVerVentasDia = document.getElementById("btnVerVentasDia");
const modalVentasDia = document.getElementById("modalVentasDia");
const closeModalVentas = document.getElementById("closeModalVentas");
const bodyTablaVentasDia = document.getElementById("bodyTablaVentasDia");
const btnCompartirWhatsapp = document.getElementById("btnCompartirWhatsapp");






// --- ESTADOS DE CÁLCULO ---
let baseCajaInicial = BASE_CAJA_DEFAULT;
let efectivoRestanteMañana = 0;
let totalInyecciones = 0;


// --- UTILIDADES DE FECHA ---
// --- (REMOVIDOS DUPLICADOS: normalizeDate y formatDate) ---

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
                nombre: data.nombre,
                antibiotico: !!data.antibiotico,
                precioCaja: parseFloat(data.precioCaja || 0),
                precioBlister: parseFloat(data.precioBlister || 0),
                precioTableta: parseFloat(data.precioTableta || 0),
                precioUnidad: parseFloat(data.precioUnidad || 0) // Para productos 'otros'
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

        // Reiniciar datos detallados de cierre final
        infoFacturas = [];
        infoSalario = null;
        infoComentarios = [];

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

                    // GUARDAR TIMESTAMP DEL CIERRE
                    cierreMananaTimestamp = timestampDate;
                }
                if (data.tipo === 'tarde') {
                    cierreTardeRealizado = true;
                    // Cargar datos extendidos para el reporte si ya se hizo el cierre
                    infoFacturas = data.facturas || [];
                    infoSalario = data.salario || null;
                    infoComentarios = data.comentarios || [];
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

        // Actualizar datos sensibles (Masking)
        ventaMensualSpan.dataset.raw = formatoMoneda(totalMensual);
        if (!ventaMensualSpan.textContent.includes('*')) ventaMensualSpan.textContent = formatoMoneda(totalMensual);

        ventaTotalHistoricaSpan.dataset.raw = formatoMoneda(totalHistorico);
        if (!ventaTotalHistoricaSpan.textContent.includes('*')) ventaTotalHistoricaSpan.textContent = formatoMoneda(totalHistorico);

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

                        // --- INFERENCIA DE TIPO DE VENTA ---
                        let tipoVentaStr = 'Uni'; // Por defecto
                        if (loteData) {
                            // Tolerancia pequeña por errores de flotante
                            if (loteData.precioCaja > 0 && Math.abs(precioUnitarioFinal - loteData.precioCaja) < 0.05) {
                                tipoVentaStr = 'CAJA';
                            } else if (loteData.precioBlister > 0 && Math.abs(precioUnitarioFinal - loteData.precioBlister) < 0.05) {
                                tipoVentaStr = 'BLISTER';
                            }
                        }

                        detallesVentaTabla.push({
                            numero: idVenta,
                            cantidad: cantidad,
                            tipo: tipoVentaStr, // NUEVO CAMPO
                            concepto: conceptoConSegmento,
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
        const totalVentaTienda = parseFloat(document.getElementById("montoVentaTienda")?.value) || 0;
        const totalFacturasDia = infoFacturas.reduce((acc, f) => acc + parseFloat(f.monto || 0), 0);
        const totalInyeccionesReal = parseFloat(document.getElementById("montoInyecciones")?.value) || totalInyecciones;

        // Efectivo en caja = Efectivo Neto (productos) + Inyecciones + baseCajaInicial - Total Retirado Dra - Facturas
        const efectivoEnCaja = totalEfectivoDia + totalInyeccionesReal + baseCajaInicial - totalRetiradoDra - totalFacturasDia;

        // Venta Neta Final = Solo Venta Neto de Productos (según solicitud)
        const ventaNetaFinal = totalNetoDia;

        // Re-asignar para uso en la tabla
        totalInyecciones = totalInyeccionesReal;

        // *** APLICAR ORDENAMIENTO FINAL ***
        detallesVentaTabla.sort((a, b) => {
            if (a.ordenVenta !== b.ordenVenta) {
                return a.ordenVenta - b.ordenVenta;
            }
            return a.ordenProducto - b.ordenProducto;
        });

        // Mapeo final para la tabla de detalles
        // Mapeo final para la tabla de detalles
        const bodyTablaDetalles = detallesVentaTabla
            .filter(d => d.cantidad > 0)
            .map(d => [d.numero, d.cantidad.toFixed(0), d.tipo, d.concepto, `Q ${d.punitario}`, `Q ${d.total}`]);

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
        doc.text("PAGOS, SALARIOS Y COMENTARIOS", 14, y);
        doc.line(14, y + 2, 90, y + 2);
        y += 8;

        const extrasBody = [];

        // Agregar Facturas
        if (infoFacturas && infoFacturas.length > 0) {
            infoFacturas.forEach(f => {
                extrasBody.push(['Pago Factura', f.descripcion, formatoMoneda(f.monto)]);
            });
        }

        // Agregar Salario
        if (infoSalario) {
            extrasBody.push(['Pago Salario', infoSalario.desc || infoSalario.descripcion, formatoMoneda(infoSalario.monto)]);
        }

        // Agregar Comentarios
        if (infoComentarios && infoComentarios.length > 0) {
            infoComentarios.forEach(c => {
                extrasBody.push(['Nota / Comentario', c, '-']);
            });
        }

        if (extrasBody.length > 0) {
            doc.autoTable({
                startY: y,
                head: [['Tipo', 'Descripción / Detalle', 'Monto (Q)']],
                body: extrasBody,
                theme: 'grid',
                headStyles: { fillColor: [108, 117, 125], textColor: 255 }, // Color Gris
                styles: { fontSize: 9, cellPadding: 2 },
                columnStyles: {
                    0: { cellWidth: 40, fontStyle: 'bold' },
                    1: { cellWidth: 100 },
                    2: { halign: 'right', cellWidth: 30 }
                }
            });
            y = doc.autoTable.previous.finalY + 10;
        } else {
            doc.setFontSize(10);
            doc.setFont(undefined, 'italic');
            doc.text("No se registraron pagos adicionales ni comentarios.", 14, y);
            y += 10;
        }

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("MOVIMIENTOS Y CIERRES", 14, y);
        doc.line(14, y + 2, 70, y + 2);
        y += 8;

        // -----------------------------------------------------------
        // MOVIMIENTOS DE CAJA Y TOTALES FINALES (COLORES AJUSTADOS)
        // -----------------------------------------------------------
        const movimientosCaja = [
            // TOTAL VENTA NETA FINAL (Solo PRODUCTOS)
            [{ content: 'TOTAL VENTA NETA (Solo Ventas de Productos)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [215, 235, 255] } },
            formatoMoneda(ventaNetaFinal),
            { content: 'VENTA NETA', styles: { fontStyle: 'bold', fillColor: [153, 204, 153], textColor: 0 } }],

            // Inyecciones (Fondo claro)
            ['(+) Servicio de Inyecciones', formatoMoneda(totalInyecciones),
                { content: 'INYECCIONES', styles: { fillColor: [255, 255, 153], textColor: 0 } }],

            // Venta Tienda (NUEVO - Informativo)
            ['Venta Total del Día TIENDA (Dato aparte)', formatoMoneda(totalVentaTienda),
                { content: 'TIENDA', styles: { fillColor: [220, 220, 220], textColor: 0 } }],

            // Facturas (Restado de Caja)
            ['(-) Pago de Facturas del Día (Sub-total)', formatoMoneda(totalFacturasDia),
                { content: 'FACTURAS', styles: { fillColor: [255, 204, 204], textColor: 0 } }],

            // Recargo (Fondo claro)
            ['Monto de Recargo por Tarjeta (5%)', formatoMoneda(montoRecargoTotal),
                { content: 'RECARGO', styles: { fillColor: [204, 255, 204], textColor: 0 } }],

            // Base de Caja (Fondo claro)
            ['BASE DE CAJA INICIAL (Saldo del día anterior)', formatoMoneda(baseCajaInicial),
                { content: 'BASE', styles: { fillColor: [255, 255, 153], textColor: 0 } }],

            // Retiro de Dra. (Fondo claro)
            ['MONTO RETIRADO POR DRA.', formatoMoneda(totalRetiradoDra),
                { content: 'RETIRO', styles: { fillColor: [255, 204, 204], textColor: 0 } }],

            // Efectivo Restante (FINAL)
            [{ content: 'EFECTIVO RESTANTE EN CAJA (Ventas + Iny. + Base - Retiro - Facturas)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [255, 204, 204] } },
            formatoMoneda(efectivoEnCaja),
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
            head: [['No.', 'Cant.', 'Tipo', 'Concepto (AM/PM)', 'P. Unit.', 'TOTAL']],
            body: bodyTablaDetalles,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 15 },
                1: { cellWidth: 10, halign: 'center' },
                2: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
                3: { cellWidth: 85 },
                4: { cellWidth: 25, halign: 'right' },
                5: { cellWidth: 25, halign: 'right' }
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

// 3. Manejo del Cierre de Tarde (AHORA SOLO MUESTRA LA UI)
btnCierreTarde.addEventListener("click", () => {
    if (cierreTardeRealizado) return;

    // Toggle de visibilidad
    if (cierreTardeInputDiv.style.display === 'none') {
        cierreTardeInputDiv.style.display = 'block';
    } else {
        cierreTardeInputDiv.style.display = 'none';
    }
});

// ---------------------------------------------------------------------------------------------------
// NUEVA LÓGICA DE CIERRE FINAL (Facturas, Salarios, Comentarios)
// ---------------------------------------------------------------------------------------------------

// Arrays temporales para la sesión actual de cierre
let cierreFacturasTemp = [];
let cierreComentariosTemp = [];
let cierreSalarioTemp = null;

function renderListaFacturas() {
    // Intenta buscar el cuerpo de la tabla (nuevo diseño)
    const tableBody = document.getElementById('bodyTablaFacturas');
    const listUl = document.getElementById('listaFacturas');

    if (tableBody) {
        tableBody.innerHTML = '';
        const msg = document.getElementById('msgSinFacturas');
        if (cierreFacturasTemp.length === 0) {
            if (msg) msg.style.display = 'block';
        } else {
            if (msg) msg.style.display = 'none';
        }

        cierreFacturasTemp.forEach((f, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${f.descripcion}</td>
                <td style="text-align: right;">${formatoMoneda(f.monto)}</td>
                <td style="text-align: center;">
                    <button onclick="eliminarFacturaTemp(${i})" style="color:var(--danger-color); border:none; background:none; cursor:pointer;"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } else if (listUl) {
        // Fallback al diseño original (lista)
        listUl.innerHTML = '';
        cierreFacturasTemp.forEach((f, i) => {
            const li = document.createElement('li');
            li.style.padding = '5px';
            li.style.borderBottom = '1px solid #eee';
            li.innerHTML = `
                <strong>${f.descripcion}</strong>: ${formatoMoneda(f.monto)} 
                <button onclick="eliminarFacturaTemp(${i})" style="margin-left:10px; color:red; border:none; background:none; cursor:pointer;"><i class="fas fa-trash"></i></button>
            `;
            listUl.appendChild(li);
        });
    }
}

window.eliminarFacturaTemp = (index) => {
    cierreFacturasTemp.splice(index, 1);
    renderListaFacturas();
};

btnAgregarFactura.addEventListener('click', () => {
    const desc = facturaDescInput.value.trim();
    const monto = parseFloat(facturaMontoInput.value);

    if (!desc || isNaN(monto) || monto <= 0) {
        alert("Ingrese descripción y monto válido para la factura.");
        return;
    }
    cierreFacturasTemp.push({ descripcion: desc, monto: monto });
    facturaDescInput.value = '';
    facturaMontoInput.value = '';
    renderListaFacturas();
});

function renderListaComentarios() {
    listaComentariosUl.innerHTML = '';
    cierreComentariosTemp.forEach((c, i) => {
        const li = document.createElement('li');
        li.style.padding = '5px';
        li.style.borderBottom = '1px solid #eee';
        li.innerHTML = `
            ${c} 
            <button onclick="eliminarComentarioTemp(${i})" style="margin-left:10px; color:red; border:none; background:none; cursor:pointer;"><i class="fas fa-trash"></i></button>
        `;
        listaComentariosUl.appendChild(li);
    });
}

window.eliminarComentarioTemp = (index) => {
    cierreComentariosTemp.splice(index, 1);
    renderListaComentarios();
};

btnAgregarComentario.addEventListener('click', () => {
    const texto = comentarioTextoInput.value.trim();
    if (!texto) return;
    cierreComentariosTemp.push(texto);
    comentarioTextoInput.value = '';
    renderListaComentarios();
});


// PROCESAR CIERRE FINAL
btnConfirmarCierreFinal.addEventListener("click", async () => {
    if (cierreTardeRealizado) return;

    if (!confirm("¿ESTÁ SEGURO DE REALIZAR EL CIERRE FINAL?\nEsta acción es irreversible y registrará el saldo final para mañana.")) {
        return;
    }

    // 1. Capturar Salario (si hay input)
    const salDesc = salarioDescInput.value.trim();
    const salMonto = parseFloat(salarioMontoInput.value);

    if (salDesc && !isNaN(salMonto) && salMonto > 0) {
        cierreSalarioTemp = { descripcion: salDesc, monto: salMonto };
    } else if (salMonto > 0 && !salDesc) {
        alert("Debe poner el nombre/detalle para el pago de salario.");
        return;
    }

    // 2. Calcular Totales del Día
    const hoyStr = formatDate(new Date());
    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr);
    const { efectivoDia: totalEfectivoVentas } = calcularTotalesVentaDia(ventasDelDia);

    // 3. Calcular Saldo Final de Caja (Base Mañana)
    // Formula: Base Inicial + Ventas Efectivo + Inyecciones - Retiro Dra - Facturas - Salario

    let totalPagosFacturas = cierreFacturasTemp.reduce((sum, item) => sum + item.monto, 0);
    let totalPagoSalario = cierreSalarioTemp ? cierreSalarioTemp.monto : 0;

    // Efectivo Final Físico (lo que queda en el cajón incluyendo inyecciones si no se retiraron aparte)
    // Asumimos que Inyecciones se queda en caja hasta el cierre final.
    let efectivoFinalFisico = (baseCajaInicial + totalEfectivoVentas + totalInyecciones)
        - totalRetiradoDra
        - totalPagosFacturas
        - totalPagoSalario;

    if (efectivoFinalFisico < 0) {
        alert(`❌ Error: Los pagos superan el efectivo disponible en caja. (Saldo calculado: ${formatoMoneda(efectivoFinalFisico)})`);
        return;
    }

    // Base para mañana = Efectivo Final - Inyecciones (porque inyecciones es "extra" del día)
    // OJO: Según lógica anterior, el usuario quería separar inyecciones. 
    // Pero si el dinero está junto, la base física es lo que importa.
    // Mantenemos la lógica de restar inyecciones para el reporte de "Base" limpia, 
    // PERO el dinero físico real que amanece mañana es efectivoFinalFisico.
    // Ajustaremos: Guardamos 'efectivoRestante' como el DINERO FÍSICO REAL para amanecer.

    const efectivoParaManana = efectivoFinalFisico;

    try {
        const now = new Date();
        const cierreData = {
            tipo: 'tarde',
            timestamp: now,
            fechaStr: formatDate(now),
            montoRetiro: 0,
            efectivoRestante: efectivoParaManana,
            registradoPor: 'Usuario',
            facturas: cierreFacturasTemp,
            salario: cierreSalarioTemp,
            comentarios: cierreComentariosTemp,
            resumenFinanciero: {
                baseInicial: baseCajaInicial,
                ventasEfectivo: totalEfectivoVentas,
                inyecciones: totalInyecciones,
                retiroDra: totalRetiradoDra,
                totalFacturas: totalPagosFacturas,
                totalSalario: totalPagoSalario
            }
        };

        await addDoc(collection(db, "cierres_caja"), cierreData);

        alert(`✅ CIERRE FINAL COMPLETADO.\n\nEfectivo Final en Caja (Para mañana): ${formatoMoneda(efectivoParaManana)}\n\n(Se han descontado facturas y salarios si los hubo).`);

        cierreTardeInputDiv.style.display = 'none';
        await cargarVentasYCálculos();

    } catch (e) {
        console.error("Error cierre final:", e);
        alert("Error al guardar cierre: " + e.message);
    }
});


// ---------------------------------------------------------------------------------------------------
// GESTIÓN DE VENTAS (MODAL Y ELIMINACIÓN)
// ---------------------------------------------------------------------------------------------------

btnVerVentasDia.addEventListener('click', () => {
    modalVentasDia.style.display = "block";
    renderTablaVentasDia();
});

closeModalVentas.addEventListener('click', () => {
    modalVentasDia.style.display = "none";
});

window.onclick = function (event) {
    if (event.target == modalVentasDia) {
        modalVentasDia.style.display = "none";
    }
};

function renderTablaVentasDia() {
    bodyTablaVentasDia.innerHTML = '';

    // Filtrar ventas de HOY
    const hoyStr = formatDate(new Date());
    const ventasHoy = todasLasVentas.filter(v => v.fechaVentaStr === hoyStr).sort((a, b) => b.fechaVenta.getTime() - a.fechaVenta.getTime());

    if (ventasHoy.length === 0) {
        bodyTablaVentasDia.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px;">No hay ventas registradas hoy.</td></tr>';
        return;
    }

    ventasHoy.forEach(venta => {
        const idVenta = venta.id; // ID del documento
        const hora = formatTimeWithAmPm(venta.fechaVenta);
        const numero = venta.numeroVenta || idVenta.substring(0, 8);
        const total = formatoMoneda(venta.totalGeneral || venta.total);

        // Resumen productos
        let resumenProd = "";
        if (venta.productos && venta.productos.length > 0) {
            resumenProd = venta.productos.map(p => `${p.cantidad}x ${p.nombre}`).join(", ");
        } else {
            resumenProd = "Sin detalle";
        }

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #ddd';
        tr.innerHTML = `
            <td style="padding:10px;">${hora}</td>
            <td style="padding:10px;">${numero}</td>
            <td style="padding:10px; font-size:0.9em;">${resumenProd}</td>
            <td style="padding:10px; text-align:right;">${total}</td>
            <td style="padding:10px; text-align:center;">
                <button onclick="confirmarEliminarVenta('${idVenta}')" style="background-color:#d32f2f; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Eliminar y Revertir Stock">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        bodyTablaVentasDia.appendChild(tr);
    });
}

// LÓGICA DE ELIMINACIÓN Y REVERSIÓN DE STOCK
window.confirmarEliminarVenta = async (idVenta) => {
    if (!confirm("⚠️ ¿ESTÁ SEGURO DE ELIMINAR ESTA VENTA?\n\nEsta acción:\n1. Eliminará el registro de venta.\n2. REVERTIRÁ EL STOCK a los lotes correspondientes.\n3. Recalculará el efectivo en caja.\n\n¿Continuar?")) {
        return;
    }

    // Buscar la venta en memoria
    const venta = todasLasVentas.find(v => v.id === idVenta);
    if (!venta) {
        alert("Error: Venta no encontrada en memoria.");
        return;
    }

    try {
        // PASO 1: Revertir Stock
        await revertirStockVenta(venta);

        // PASO 2: Eliminar Documento de Venta
        await deleteDoc(doc(db, "ventas", idVenta));

        alert("✅ Venta eliminada y stock revertido correctamente.");

        modalVentasDia.style.display = "none";
        await cargarVentasYCálculos(); // Recargar todo

    } catch (error) {
        console.error("Error al eliminar venta:", error);
        alert("❌ Error al eliminar la venta: " + error.message);
    }
};

async function revertirStockVenta(venta) {
    if (!venta.productos || !Array.isArray(venta.productos)) return;

    // Recorrer productos
    for (const producto of venta.productos) {
        // En ventas recientes, guardamos 'lotes' (array de {loteId, unidadesVendidas})
        if (producto.lotes && Array.isArray(producto.lotes)) {
            for (const detalleLote of producto.lotes) {
                const { loteId, unidadesVendidas } = detalleLote;
                if (!loteId || !unidadesVendidas) continue;

                const loteRef = doc(db, "inventario", loteId);
                const loteSnap = await getDoc(loteRef);

                if (loteSnap.exists()) {
                    const dataLote = loteSnap.data();
                    const stockActual = parseInt(dataLote.stock) || 0;
                    const nuevoStock = stockActual + parseInt(unidadesVendidas);

                    // Recalcular desglose
                    const upb = parseInt(dataLote.tabletasPorBlister) || 1;
                    const bpc = parseInt(dataLote.blistersPorCaja) || 1;
                    const unidadesPorCaja = upb * bpc;

                    let stockCaja = 0, stockBlister = 0, restante = nuevoStock;

                    // Lógica simple de reconversión (similar a inventario.js pero simplificada aquí)
                    if (unidadesPorCaja > 0) {
                        stockCaja = Math.floor(restante / unidadesPorCaja);
                        restante %= unidadesPorCaja;
                    }
                    if (upb > 0) {
                        stockBlister = Math.floor(restante / upb);
                        restante %= upb;
                    }
                    const stockTableta = restante;

                    await updateDoc(loteRef, {
                        stock: nuevoStock,
                        stockCaja: stockCaja,
                        stockBlister: stockBlister,
                        stockTableta: stockTableta
                    });
                }
            }
        } else {
            console.warn("Venta antigua o sin detalle de lotes. No se puede revertir stock exacto.", venta);
            // Si es venta antigua sin lotes, no podemos saber a qué lote devolverlo de forma segura.
            // Se omite reversión automática en este caso para evitar inconsistencias.
        }
    }
}


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

// ---------------------------------------------------------------------------------------------------
// FUNCIÓN WHATSAPP
// ---------------------------------------------------------------------------------------------------
btnCompartirWhatsapp?.addEventListener("click", async () => {
    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }

    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === formatDate(new Date()));
    const totales = calcularTotalesVentaDia(ventasDelDia);

    // Sumar gastos del día
    const gastosFacturas = infoFacturas.reduce((acc, f) => acc + (parseFloat(f.monto) || 0), 0);
    const gastoSalario = infoSalario ? (parseFloat(infoSalario.monto) || 0) : 0;
    const totalGastos = gastosFacturas + gastoSalario + totalRetiradoDra;

    // Efectivo Final en Caja
    const efectivoFinal = totales.efectivoDia + totalInyecciones + baseCajaInicial - totalRetiradoDra;

    const fechaHoy = formatDate(new Date());

    let mensaje = `📊 *REPORTE FARMACIA JERUSALÉN* 📊\n`;
    mensaje += `📅 Fecha: ${fechaHoy}\n`;
    mensaje += `--------------------------------\n`;
    mensaje += `💰 *Venta Global:* ${formatoMoneda(totales.totalDia)}\n`;
    mensaje += `💵 *Efectivo (Ventas):* ${formatoMoneda(totales.efectivoDia)}\n`;
    mensaje += `💳 *Tarjeta (Neto):* ${formatoMoneda(totales.tarjetaDia)}\n`;
    mensaje += `💉 *Inyecciones:* ${formatoMoneda(totalInyecciones)}\n`;
    mensaje += `--------------------------------\n`;
    mensaje += `📉 *SALIDAS / RETIROS:*\n`;
    mensaje += `• Retiro Dra: ${formatoMoneda(totalRetiradoDra)}\n`;
    if (gastosFacturas > 0) mensaje += `• Facturas: ${formatoMoneda(gastosFacturas)}\n`;
    if (gastoSalario > 0) mensaje += `• Salario: ${formatoMoneda(gastoSalario)}\n`;
    mensaje += `--------------------------------\n`;
    mensaje += `✅ *EFECTIVO EN CAJA:* ${formatoMoneda(efectivoFinal)}\n`; // Usamos la variable calculada

    // LOGIC MOVED TO API HANDLER (See below)
    return;
    const url = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
});

// Inicialización de la aplicación
cargarVentasYCálculos();

// ---------------------------------------------------------------------------------------------------
// GENERADOR DE BLO PDF COMPARTIDO (Retorna el objeto doc)
// ---------------------------------------------------------------------------------------------------
function generarBlobPdfDiario(ventasDelDia) {
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

                    // --- INFERENCIA DE TIPO DE VENTA ---
                    let tipoVentaStr = 'Unidad';
                    if (loteData) {
                        // Tolerancia pequeña por errores de flotante
                        if (loteData.precioCaja > 0 && Math.abs(precioUnitarioFinal - loteData.precioCaja) < 0.05) {
                            tipoVentaStr = 'Caja';
                        } else if (loteData.precioBlister > 0 && Math.abs(precioUnitarioFinal - loteData.precioBlister) < 0.05) {
                            tipoVentaStr = 'Blister';
                        }
                    }

                    detallesVentaTabla.push({
                        numero: idVenta,
                        cantidad: cantidad,
                        tipo: tipoVentaStr, // NUEVO CAMPO
                        concepto: conceptoConSegmento,
                        punitario: precioUnitarioFinal.toFixed(2),
                        total: totalItemConRecargo.toFixed(2),
                        ordenVenta: venta.fechaVenta.getTime(),
                        ordenProducto: indexProducto
                    });
                });
            });
        }
    });

    const efectivoEnCaja = totalEfectivoDia + totalInyecciones + baseCajaInicial - totalRetiradoDra;
    const ventaNetaFinal = totalNetoDia + totalInyecciones;

    detallesVentaTabla.sort((a, b) => {
        if (a.ordenVenta !== b.ordenVenta) {
            return a.ordenVenta - b.ordenVenta;
        }
        return a.ordenProducto - b.ordenProducto;
    });

    const bodyTablaDetalles = detallesVentaTabla
        .filter(d => d.cantidad > 0)
        .map(d => [d.numero, d.cantidad.toFixed(0), d.tipo, d.concepto, `Q ${d.punitario}`, `Q ${d.total}`]);

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

    const resumenVentas = [
        ['Ventas Mañana (AM)', formatoMoneda(efectivoAM), formatoMoneda(tarjetaAM)],
        ['Ventas Tarde (PM)', formatoMoneda(efectivoPM), formatoMoneda(tarjetaPM)],
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
            0: { cellWidth: 60 },
            1: { halign: 'right', cellWidth: 45 },
            2: { halign: 'right', cellWidth: 45 }
        }
    });

    y = doc.autoTable.previous.finalY + 8; // Más espacio

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("PAGOS, SALARIOS Y COMENTARIOS", 14, y);
    doc.line(14, y + 2, 90, y + 2);
    y += 8;

    const extrasBody = [];
    if (infoFacturas && infoFacturas.length > 0) {
        infoFacturas.forEach(f => {
            extrasBody.push(['Pago Factura', f.descripcion, formatoMoneda(f.monto)]);
        });
    }
    if (infoSalario) {
        extrasBody.push(['Pago Salario', infoSalario.desc || infoSalario.descripcion, formatoMoneda(infoSalario.monto)]);
    }
    if (infoComentarios && infoComentarios.length > 0) {
        infoComentarios.forEach(c => {
            extrasBody.push(['Nota / Comentario', c, '-']);
        });
    }

    if (extrasBody.length > 0) {
        doc.autoTable({
            startY: y,
            head: [['Tipo', 'Descripción / Detalle', 'Monto (Q)']],
            body: extrasBody,
            theme: 'grid',
            headStyles: { fillColor: [108, 117, 125], textColor: 255 },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 35, fontStyle: 'bold' },
                1: { cellWidth: 85 },
                2: { halign: 'right', cellWidth: 30 }
            }
        });
        y = doc.autoTable.previous.finalY + 10;
    } else {
        doc.setFontSize(10);
        doc.setFont(undefined, 'italic');
        doc.text("No se registraron pagos adicionales ni comentarios.", 14, y);
        y += 10;
    }

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("MOVIMIENTOS Y CIERRES", 14, y);
    doc.line(14, y + 2, 70, y + 2);
    y += 8;

    const movimientosCaja = [
        [{ content: 'TOTAL VENTA NETA FINAL (VENTAS + INYECCIONES)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [215, 235, 255] } },
        formatoMoneda(ventaNetaFinal),
        { content: 'VENTA NETA', styles: { fontStyle: 'bold', fillColor: [153, 204, 153], textColor: 0 } }],

        ['Total en Inyecciones', formatoMoneda(totalInyecciones),
            { content: 'INYECCIONES', styles: { fillColor: [255, 255, 153], textColor: 0 } }],

        ['Monto de Recargo por Tarjeta (5%)', formatoMoneda(montoRecargoTotal),
            { content: 'RECARGO', styles: { fillColor: [204, 255, 204], textColor: 0 } }],

        ['BASE DE CAJA INICIAL (Saldo del día anterior)', formatoMoneda(baseCajaInicial),
            { content: 'BASE', styles: { fillColor: [255, 255, 153], textColor: 0 } }],

        ['MONTO RETIRADO POR DRA.', formatoMoneda(totalRetiradoDra),
            { content: 'RETIRO', styles: { fillColor: [255, 204, 204], textColor: 0 } }],

        [{ content: 'EFECTIVO RESTANTE EN CAJA (Efectivo Neto + Base - Retiro)', colSpan: 1, styles: { fontStyle: 'bold', fillColor: [255, 204, 204] } },
        formatoMoneda(efectivoEnCaja),
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
            0: { cellWidth: 90 },
            1: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
            2: { cellWidth: 30, halign: 'center', fontStyle: 'bold' }
        }
    });

    y = doc.autoTable.previous.finalY + 15;

    doc.setFontSize(14);
    doc.text("DETALLE DE TRANSACCIONES", 14, y);
    doc.line(14, y + 2, 85, y + 2);
    y += 8;

    doc.autoTable({
        startY: y,
        head: [['No.', 'Cant.', 'Tipo', 'Concepto (AM/PM)', 'P. Unit.', 'TOTAL']],
        body: bodyTablaDetalles,
        theme: 'striped',
        headStyles: { fillColor: [0, 123, 255], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 15 },
            1: { cellWidth: 10, halign: 'center' },
            2: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            3: { cellWidth: 70 },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 25, halign: 'right' }
        },
    });

    return doc;
}

// ---------------------------------------------------------------------------------------------------
// FUNCIÓN WHATSAPP API (CON UPLOAD DE PDF)
// ---------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------
// FUNCIÓN WHATSAPP API (CON UPLOAD DE PDF)
// ---------------------------------------------------------------------------------------------------
btnCompartirWhatsapp?.addEventListener("click", async () => {
    console.log("🟢 Iniciando WhatsApp API...");

    if (!datosCargadosCompletos) {
        const exito = await cargarVentasYCálculos();
        if (!exito) return;
    }

    const ventasDelDia = todasLasVentas.filter(v => v.fechaVentaStr === formatDate(new Date()));
    const totales = calcularTotalesVentaDia(ventasDelDia);
    const fechaHoy = formatDate(new Date());

    // --- PREPARAR MENSAJE DE TEXTO (FALLBACK) ---
    const gastosFacturasSum = infoFacturas.reduce((acc, f) => acc + (parseFloat(f.monto) || 0), 0);
    const efectivoFinalCaja = totales.efectivoDia + totalInyecciones + baseCajaInicial - totalRetiradoDra;

    let mensajeTexto = `📊 *REPORTE FARMACIA JERUSALÉN* 📊\n`;
    mensajeTexto += `📅 Fecha: ${fechaHoy}\n`;
    mensajeTexto += `--------------------------------\n`;
    mensajeTexto += `💰 *Venta Global:* ${formatoMoneda(totales.totalDia)}\n`;
    mensajeTexto += `💵 *Efectivo (Ventas):* ${formatoMoneda(totales.efectivoDia)}\n`;
    mensajeTexto += `💳 *Tarjeta (Neto):* ${formatoMoneda(totales.tarjetaDia)}\n`;
    mensajeTexto += `💉 *Inyecciones:* ${formatoMoneda(totalInyecciones)}\n`;
    mensajeTexto += `--------------------------------\n`;
    mensajeTexto += `📉 *SALIDAS / RETIROS:*\n`;
    mensajeTexto += `• Retiro Dra: ${formatoMoneda(totalRetiradoDra)}\n`;
    if (gastosFacturasSum > 0) mensajeTexto += `• Facturas: ${formatoMoneda(gastosFacturasSum)}\n`;
    if (infoSalario) mensajeTexto += `• Salario: ${formatoMoneda(infoSalario.monto)}\n`;
    mensajeTexto += `--------------------------------\n`;
    mensajeTexto += `✅ *EFECTIVO EN CAJA:* ${formatoMoneda(efectivoFinalCaja)}\n`;

    const abrirWhatsAppWeb = () => {
        const num = confirm("¿Enviar a Carlos (+502 3635...) o al nuevo número (+502 3194...)?\n\nAceptar: Carlos\nCancelar: Nuevo Número")
            ? "50236359013"
            : "50231943130";
        const url = `https://wa.me/${num}?text=${encodeURIComponent(mensajeTexto)}`;
        window.open(url, '_blank');
    };

    // --- DIÁLOGO DE SELECCIÓN ---
    const sendPdf = confirm("¿Deseas enviar el PDF por la API de Meta?\n\n(Si te sale error de CORS en consola, es por bloqueo de navegador. Cancela para enviar el REPORTE DE TEXTO directamente).");

    if (!sendPdf) {
        abrirWhatsAppWeb();
        return;
    }

    // --- PROCESO API ---
    // UI Feedback
    const originalBtn = btnCompartirWhatsapp.innerHTML;
    btnCompartirWhatsapp.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Enviando...";
    btnCompartirWhatsapp.disabled = true;

    try {
        // 1. Generar PDF
        let doc = generarBlobPdfDiario(ventasDelDia);
        const pdfBlob = doc.output('blob');

        // 2. Parámetros API
        const TOKEN = "EAAR1qjceh8wBQhOlOJcQmwmffyb2XE9u5EIT16irEzEkBs3o97ZCdKrZCKrk7rayzjK2zlDGG0LJoC0BZBZCkpDZCkmEY4NAu50zLJawR3sA5sVpf7ZCSc5xdUkdnuGO4tpcTzcJJdyZArRqZBALFQTV4ZARDL2uJFYesCRKLOrG5rC3SnOJ8KN26pczZC0ZAd6OE4sIgZDZD";
        const PHONE_ID = "1000182449838839";
        const DESTINATARIOS = ["50236359013", "50231943130"];

        const formData = new FormData();
        formData.append("messaging_product", "whatsapp");
        formData.append("file", pdfBlob, `Reporte_${fechaHoy.replace(/\//g, '-')}.pdf`);
        formData.append("type", "application/pdf");

        // 3. Media Upload (Una sola vez)
        const upload = await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TOKEN}` },
            body: formData
        });

        if (!upload.ok) {
            const err = await upload.json();
            throw new Error(`Error Upload: ${JSON.stringify(err)}`);
        }

        const { id: mediaId } = await upload.json();

        // 4. Enviar Mensaje a cada destinatario
        for (const numero of DESTINATARIOS) {
            console.log(`Enviando a ${numero}...`);
            await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: numero,
                    type: "document",
                    document: {
                        id: mediaId,
                        caption: "Reporte Farmacia Jerusalén",
                        filename: `Reporte_${fechaHoy.replace(/\//g, '-')}.pdf`
                    }
                })
            });
        }

        alert("✅ PDF enviado con éxito a todos los números.");

    } catch (e) {
        console.error(e);
        if (confirm("❌ Error en la API (Token o CORS).\n\n¿Deseas enviar el reporte en formato TEXTO por WhatsApp Web?")) {
            abrirWhatsAppWeb();
        }
    } finally {
        btnCompartirWhatsapp.innerHTML = originalBtn;
        btnCompartirWhatsapp.disabled = false;
    }
});

// ---------------------------------------------------------------------------------------------------
// FUNCIÓN TOGGLE SENSITIVE (Ocultar/Mostrar KPIs)
// ---------------------------------------------------------------------------------------------------
window.toggleSensitive = function (id, icon) {
    const el = document.getElementById(id);
    if (!el) return;

    // Si contiene asteriscos, mostrar valor real
    if (el.textContent.includes('*')) {
        el.textContent = el.dataset.raw || 'Q 0.00';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
        el.dataset.visible = "true";
    } else {
        // Ocultar
        el.textContent = '******';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        el.dataset.visible = "false";
    }
};