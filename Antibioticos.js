import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales
const { jsPDF } = window.jspdf;
const { XLSX } = window; 

// --- CONSTANTES Y REFERENCIAS DEL DOM ---
const DIAS_OFFSET = 25569; 
const CORRECCION_BISI = 1; 
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

const productosGrid = document.getElementById("productosGrid");
const filtroReporteSelect = document.getElementById("filtroReporte"); 
const btnExportar = document.getElementById("btnExportar");
const btnExportarPdf = document.getElementById("btnExportarPdf");
const loadingMessage = document.getElementById("loadingMessage");
// Referencias para el MODAL de auditoría
const auditModal = document.getElementById("auditModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");


// --- ESTADO ---
let antibioticosInventario = []; 
let ventasAntibioticos = [];      
let lotesFiltradosActualmente = []; 

// --- FUNCIONES DE UTILIDAD ---
function convertirAFecha(fechaVencimiento) {
    if (!fechaVencimiento) return null;
    if (fechaVencimiento.toDate) return fechaVencimiento.toDate(); 
    
    let serialNumber;
    if (!isNaN(parseFloat(fechaVencimiento)) && isFinite(fechaVencimiento)) {
        serialNumber = parseFloat(fechaVencimiento);
    } else {
        const dateFromStr = new Date(fechaVencimiento);
        if (!isNaN(dateFromStr.getTime())) {
            dateFromStr.setUTCHours(12, 0, 0, 0); 
            return dateFromStr;
        }
        return null; 
    }

    if (serialNumber > 10000) { 
        const diasDesdeEpoch = serialNumber - DIAS_OFFSET - CORRECCION_BISI; 
        const millisDesdeEpoch = diasDesdeEpoch * MILLIS_PER_DAY;
        const fecha = new Date(millisDesdeEpoch);
        fecha.setUTCHours(12, 0, 0, 0); 
        return fecha;
    }
    return null;
}

function formatearFecha(dateObj) {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${day}/${month}/${year}`; 
    }
    return '-';
}

function formatearFechaHora(dateObj) {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        const datePart = formatearFecha(dateObj);
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        return `${datePart} ${hours}:${minutes}`; 
    }
    return '-';
}

function calcularDiasRestantes(fechaVencimiento) {
    if (!fechaVencimiento) return Infinity;
    const fechaVencimientoClonada = new Date(fechaVencimiento.getTime()); 
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); 
    fechaVencimientoClonada.setHours(0, 0, 0, 0); 
    const diffTime = fechaVencimientoClonada.getTime() - hoy.getTime();
    return Math.ceil(diffTime / MILLIS_PER_DAY);
}

/**
 * Calcula la fecha de inicio (medianoche) para el filtro de tiempo.
 * @param {string} filtroValor - El valor del filtro (ej: 'vendidosDia', 'vendidosMes').
 * @returns {Date | null} La fecha de inicio del período.
 */
function getFechaInicio(filtroValor) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); 

    switch (filtroValor) {
        case 'vendidosDia':
            // Se usa el inicio de hoy
            return hoy; 
        case 'vendidosSemana':
            return new Date(hoy.getTime() - (7 * MILLIS_PER_DAY));
        case 'vendidosMes':
            return new Date(hoy.getTime() - (30 * MILLIS_PER_DAY));
        case 'vendidosAnio':
            return new Date(hoy.getTime() - (365 * MILLIS_PER_DAY));
        default:
            return null;
    }
}


// --- CARGA DE DATOS CENTRAL ---

async function cargarDatosCentral() {
    loadingMessage.style.display = 'block'; 
    antibioticosInventario = [];
    ventasAntibioticos = [];

    try {
        // 1. Cargar la colección 'inventario'
        const inventarioSnapshot = await getDocs(query(collection(db, "inventario")));
        const inventarioMap = new Map();

        inventarioSnapshot.forEach(docu => {
            const data = docu.data();
            const esAntibiotico = data.antibiotico === true || data.antibiotico === "true";
            const noEsOtroProducto = data.esOtroProducto !== true && data.esOtroProducto !== "true";

            if (esAntibiotico && noEsOtroProducto) {
                const lote = { 
                    id: docu.id, 
                    nombre: data.nombre,
                    detalle: data.detalle || data.presentacion || 'Unidad/Lote',
                    stock: parseInt(data.stock) || 0, 
                    vencimiento: convertirAFecha(data.vencimiento),
                    marca: data.marca || 'N/A',
                    ubicacion: data.ubicacion || 'N/A'
                };
                lote.diasRestantes = calcularDiasRestantes(lote.vencimiento);
                
                if (lote.stock > 0) {
                    antibioticosInventario.push(lote);
                }
                
                inventarioMap.set(docu.id, lote);
            }
        });
        
        // 2. Cargar la colección 'ventas' e identificar los antibióticos vendidos
        const ventasSnapshot = await getDocs(query(collection(db, "ventas")));
        
        ventasSnapshot.forEach(docVenta => {
            const ventaData = docVenta.data();
            const productosVendidos = ventaData.productos || []; 
            const fechaVentaObjeto = convertirAFecha(ventaData.fecha || ventaData.timestamp);
            const numeroVenta = ventaData.numeroVenta || docVenta.id;
            const metodoPago = ventaData.metodoPago || 'N/A';
            const totalVenta = parseFloat(ventaData.totalGeneral) || 0;


            productosVendidos.forEach(producto => {
                const esAntibioticoVendido = producto.antibiotico === true || producto.antibiotico === "true";

                if (esAntibioticoVendido) {
                    const lotesUsados = producto.lotes || []; 

                    lotesUsados.forEach(loteVendido => {
                        const loteId = loteVendido.loteId; 
                        const infoBase = inventarioMap.get(loteId); 

                        if (infoBase) {
                            const cantCaja = parseInt(loteVendido.cajasVendidas) || 0;
                            const cantBlister = parseInt(loteVendido.blisteresVendidas) || 0;
                            // Usaremos 'unidadesVendidas' como el valor más detallado (ej. tabletas)
                            const cantUnidad = parseInt(loteVendido.unidadesVendidas) || 0;
                            
                            // Campo 'cantidad' del lote vendido: se espera que sea la cantidad total vendida.
                            let totalUnidadesVendidas = parseInt(loteVendido.cantidad) || 0;
                            
                            // *** CORRECCIÓN CLAVE ***
                            // Si 'cantidad' es 0, usamos 'cantUnidad' (el detalle de las tabletas/unidades vendidas) como fallback.
                            if (totalUnidadesVendidas === 0 && cantUnidad > 0) {
                                totalUnidadesVendidas = cantUnidad;
                            }
                            // *************************
                            
                            ventasAntibioticos.push({
                                id: loteId,
                                nombre: infoBase.nombre,
                                detalle: infoBase.detalle,
                                marca: infoBase.marca,
                                ubicacion: infoBase.ubicacion, 
                                vencimiento: infoBase.vencimiento,
                                
                                cantidadVendida: totalUnidadesVendidas, // Ahora con el valor ajustado
                                stockRestante: infoBase.stock, 
                                fechaVenta: fechaVentaObjeto, 
                                
                                ventaId: docVenta.id, 
                                numeroVenta: numeroVenta,
                                metodoPago: metodoPago,
                                totalVenta: totalVenta,
                                cantCaja: cantCaja,
                                cantBlister: cantBlister,
                                cantTableta: cantUnidad // Usamos 'cantUnidad' para la tabla de auditoría.
                            });
                        }
                    });
                }
            });
        });

        manejarFiltroReporte();

    } catch (error) {
        console.error("Error al cargar datos. Revise la conexión y estructura de 'ventas' y 'inventario':", error);
        productosGrid.innerHTML = `<div class="no-products-message" style="color: red;">
                                         <i class="fas fa-exclamation-circle"></i> Error en la conexión o estructura de datos.
                                        </div>`;
    } finally {
        loadingMessage.style.display = 'none';
    }
}

// --- FILTRADO Y RENDERIZADO DEL GRID ---

function manejarFiltroReporte() {
    const filtroValor = filtroReporteSelect.value;
    lotesFiltradosActualmente = [];
    productosGrid.innerHTML = ""; 

    if (filtroValor === 'inventario') { 
        // Lógica de Inventario
        lotesFiltradosActualmente = antibioticosInventario
            .sort((a, b) => a.diasRestantes - b.diasRestantes); 
        
    } else if (filtroValor.startsWith('vendidos')) { 
        
        const fechaInicio = getFechaInicio(filtroValor);
        let ventasFiltradas = ventasAntibioticos;

        // 1. Aplicar filtro de fecha
        if (fechaInicio) {
            const fechaInicioTime = fechaInicio.getTime();
            
            ventasFiltradas = ventasAntibioticos.filter(venta => {
                if (!venta.fechaVenta) return false;
                
                const fechaVentaTime = venta.fechaVenta.getTime();
                
                return fechaVentaTime >= fechaInicioTime;
            });
        }
        
        // 2. Determinar si se Agrupa o se Muestra Detallado
        if (filtroValor === 'vendidosDia') {
            // Reporte Diario (Detallado)
            lotesFiltradosActualmente = ventasFiltradas
                .sort((a, b) => b.fechaVenta.getTime() - a.fechaVenta.getTime()); 
            
        } else {
            // Reportes Agrupados (Semana, Mes, Año)
            const ventasAgrupadas = new Map();
            
            ventasFiltradas.forEach(venta => {
                // La clave de agrupación es el ID del lote
                if (ventasAgrupadas.has(venta.id)) {
                    // Si ya existe, sumar la cantidad vendida
                    ventasAgrupadas.get(venta.id).cantidadVendida += venta.cantidadVendida;
                } else {
                    // Si no existe, crear una nueva entrada (copiando el objeto venta)
                    ventasAgrupadas.set(venta.id, { ...venta });
                }
            });

            lotesFiltradosActualmente = Array.from(ventasAgrupadas.values())
                .sort((a, b) => b.fechaVenta.getTime() - a.fechaVenta.getTime()); 
        }
    }
    
    renderizarGrid();
}

function renderizarGrid() {
    if (lotesFiltradosActualmente.length === 0) {
        productosGrid.innerHTML = `<div class="no-products-message">
                                           <i class="fas fa-box-open"></i> No se encontraron lotes para el reporte seleccionado.
                                         </div>`;
        return;
    }

    const esReporteVentas = filtroReporteSelect.value.startsWith('vendidos');
    const esReporteDetallado = filtroReporteSelect.value === 'vendidosDia';

    productosGrid.innerHTML = lotesFiltradosActualmente.map(lote => {
        let claseCard = 'stock-normal'; 
        let cardContent = '';
        
        if (!esReporteVentas) {
            // --- INVENTARIO ---
            const dias = lote.diasRestantes;
            const alertaTexto = dias <= 0 ? `VENCIDO` : `${dias} días`;
            
            if (dias <= 0) { claseCard = 'vencido'; } 
            else if (dias <= 90) { claseCard = 'proximo-3m'; } 
            else if (dias <= 180) { claseCard = 'proximo-6m'; } 
            
            const etiquetaDias = `<span class="dias-restantes-tag ${claseCard}">
                                     ${alertaTexto} 
                                   </span>`;
            
            cardContent = `
                <div class="card-title">${lote.nombre}</div>
                <div class="card-subtitle">${lote.detalle}</div> 
                <p><strong>Marca:</strong> ${lote.marca}</p>
                <p><strong>Ubicación:</strong> ${lote.ubicacion}</p>
                <div class="lote-details">
                    <p><strong>Unidades:</strong> ${lote.stock}</p>
                    <p><strong>Vence:</strong> ${lote.vencimiento ? formatearFecha(lote.vencimiento) : '-'}</p>
                    <p><strong>Quedan:</strong> ${etiquetaDias}</p>
                    <p class="lote-id-display"><strong>ID Lote:</strong> ${lote.id}</p>
                </div>
            `;
            
        } else {
            // --- VENTAS ---
            claseCard = 'venta-card'; 
            
            const cantidadDisplay = esReporteDetallado 
                ? `${lote.cantidadVendida} unidades (Venta ${lote.numeroVenta})`
                : `${lote.cantidadVendida} unidades`;
            
            const fechaDisplay = esReporteDetallado 
                ? formatearFechaHora(lote.fechaVenta) 
                : filtroReporteSelect.options[filtroReporteSelect.selectedIndex].text; 
                
            const botonDetalle = esReporteDetallado 
                ? '' 
                : `<button class="btn-ver-detalles" data-id="${lote.id}">
                    <i class="fas fa-chart-bar"></i> Ver Auditoría del Lote
                   </button>`;

            cardContent = `
                <div class="card-title">${lote.nombre}</div>
                <div class="card-subtitle">${lote.detalle}</div> 
                <p><strong>Marca:</strong> ${lote.marca}</p>
                <p><strong>Stock Restante Lote:</strong> ${lote.stockRestante} unidades</p>
                <div class="lote-details">
                    <p><strong>Fecha/Período:</strong> ${fechaDisplay}</p>
                    <p><strong>Total Vendido:</strong> ${cantidadDisplay}</p>
                    <p class="lote-id-display"><strong>ID Lote:</strong> ${lote.id}</p>
                </div>
                ${botonDetalle}
            `;
        }
        return `<div class="product-card ${claseCard}">${cardContent}</div>`;
    }).join('');
    
    // Adjuntar eventos para el modal (solo para reportes agrupados)
    productosGrid.querySelectorAll('.btn-ver-detalles').forEach(button => {
        button.addEventListener('click', (e) => {
            const loteId = e.currentTarget.getAttribute('data-id');
            mostrarDetalles(loteId); 
        });
    });
}


// --- FUNCIÓN DE VER DETALLES (MODAL) ---

window.mostrarDetalles = function(loteId) {
    const registrosDeVenta = ventasAntibioticos.filter(v => v.id === loteId);
    
    if (registrosDeVenta.length === 0) {
        alert("Detalles del lote no encontrados o no vendidos.");
        return;
    }
    
    const infoBase = registrosDeVenta[0]; 

    modalTitle.textContent = `Auditoría de Ventas para Lote: ${loteId}`;
    
    let infoGeneralHTML = `
        <p><strong>Producto:</strong> ${infoBase.nombre} (${infoBase.detalle})</p>
        <p><strong>Marca:</strong> ${infoBase.marca}</p>
        <p><strong>Ubicación (Lote):</strong> ${infoBase.ubicacion}</p>
        <p><strong>Stock Actual del Lote:</strong> ${infoBase.stockRestante} unidades</p>
        <hr>
        <h4>Historial de Ventas Detallado:</h4>
    `;

    let tablaHTML = `
        <table class="audit-table">
            <thead>
                <tr>
                    <th>No. Venta</th>
                    <th>Fecha/Hora</th>
                    <th>Vendidas (Und)</th>
                    <th>Cajas</th>
                    <th>Blísteres</th>
                    <th>Tabletas</th>
                    <th>Método Pago</th>
                    <th>Total Venta</th>
                </tr>
            </thead>
            <tbody>
    `;

    registrosDeVenta
        .sort((a, b) => b.fechaVenta.getTime() - a.fechaVenta.getTime()) 
        .forEach(r => {
            tablaHTML += `
                <tr>
                    <td>${r.numeroVenta}</td>
                    <td>${formatearFechaHora(r.fechaVenta)}</td>
                    <td>${r.cantidadVendida}</td>
                    <td>${r.cantCaja}</td>
                    <td>${r.cantBlister}</td>
                    <td>${r.cantTableta}</td>
                    <td>${r.metodoPago}</td>
                    <td>Q ${r.totalVenta.toFixed(2)}</td>
                </tr>
            `;
        });
        
    tablaHTML += `</tbody></table>`;
    
    modalBody.innerHTML = infoGeneralHTML + tablaHTML;
    openModal();
};

window.openModal = function() {
    auditModal.classList.add('open');
}

window.closeModal = function() {
    auditModal.classList.remove('open');
}


// --- FUNCIONES DE EXPORTACIÓN ---

function exportarAExcel() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos para exportar. Cargue el reporte primero.");
        return;
    }
    
    const filtroActualTexto = filtroReporteSelect.options[filtroReporteSelect.selectedIndex].text;
    const esReporteVentas = filtroReporteSelect.value.startsWith('vendidos');

    let datosParaExportar;
    if (esReporteVentas) {
        // Para Excel, siempre exportamos los datos detallados de ventas del período
        const fechaInicio = getFechaInicio(filtroReporteSelect.value);
        
        datosParaExportar = ventasAntibioticos
            .filter(v => v.fechaVenta.getTime() >= fechaInicio.getTime()) 
            .map(lote => ({
                No_Venta: lote.numeroVenta,
                Fecha_Hora_Venta: formatearFechaHora(lote.fechaVenta), 
                Producto: lote.nombre,
                Formato: lote.detalle,
                Marca: lote.marca,
                Cantidad_Total_Vendida: lote.cantidadVendida,
                Cajas_Vendidas: lote.cantCaja,
                Blisteres_Vendidos: lote.cantBlister,
                Tabletas_Vendidas: lote.cantTableta,
                Stock_Restante_Lote: lote.stockRestante,
                Metodo_Pago: lote.metodoPago,
                Total_Venta: lote.totalVenta,
                ID_Lote: lote.id,
                ID_Venta_Interno: lote.ventaId
            }));

    } else {
        // EXPORTACIÓN DE INVENTARIO
        datosParaExportar = lotesFiltradosActualmente.map(lote => ({
            Producto: lote.nombre,
            Formato: lote.detalle,
            Marca: lote.marca,
            Ubicacion: lote.ubicacion,
            Stock_Actual: lote.stock,
            Fecha_Vencimiento: formatearFecha(lote.vencimiento),
            Dias_Restantes: lote.diasRestantes,
            ID_Lote: lote.id
        }));
    }

    try {
        const ws = XLSX.utils.json_to_sheet(datosParaExportar);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, filtroActualTexto.replace(/\s/g, '_')); 
        XLSX.writeFile(wb, `Reporte_Antibioticos_${filtroActualTexto.replace(/\s/g, '_')}.xlsx`);
        alert("✅ Datos exportados a Excel exitosamente.");
    } catch (e) {
        console.error("Error al exportar a Excel:", e);
        alert("❌ Error al exportar a Excel. Revise la consola.");
    }
}


function exportarAPDF() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos para exportar a PDF. Cargue el reporte primero.");
        return;
    }

    try {
        // Inicializar el documento PDF en orientación horizontal
        const doc = new jsPDF({ orientation: 'landscape', format: 'a4' }); 
        const filtroActualTexto = filtroReporteSelect.options[filtroReporteSelect.selectedIndex].text;
        const esReporteVentas = filtroReporteSelect.value.startsWith('vendidos');
        const esReporteDetallado = filtroReporteSelect.value === 'vendidosDia'; // Filtro 'Ventas: Hoy'

        let head;
        let datosTabla;
        
        if (esReporteVentas) {
            if (esReporteDetallado) {
                // PDF DE VENTA DETALLADA (Filtro: Ventas Hoy)
                head = [['No. Venta', 'Producto', 'Formato', 'Vendidas (Und)', 'Stock Restante', 'Fecha/Hora Venta', 'ID Lote']];
                
                datosTabla = lotesFiltradosActualmente.map(lote => [
                    lote.numeroVenta,
                    lote.nombre,
                    lote.detalle,
                    lote.cantidadVendida, // ¡Corregido para mostrar el valor correcto!
                    lote.stockRestante,
                    formatearFechaHora(lote.fechaVenta),
                    lote.id
                ]);

            } else {
                // PDF DE VENTA AGRUPADA (Filtros: Semana, Mes, Año)
                head = [['Producto', 'Formato', 'Vendidas (Und)', 'Stock Restante', 'Vencimiento', 'Período', 'ID Lote']];
                
                datosTabla = lotesFiltradosActualmente.map(lote => [
                    lote.nombre,
                    lote.detalle,
                    lote.cantidadVendida, // ¡Corregido para mostrar el valor correcto!
                    lote.stockRestante,
                    formatearFecha(lote.vencimiento), 
                    filtroActualTexto, 
                    lote.id
                ]);
            }
        } else {
            // PDF DE INVENTARIO 
            head = [['Producto', 'Formato', 'Stock Actual', 'Ubicación', 'Fecha Vencimiento', 'Días Restantes', 'ID Lote']];
            datosTabla = lotesFiltradosActualmente.map(lote => [
                lote.nombre,
                lote.detalle,
                lote.stock,
                lote.ubicacion,
                formatearFecha(lote.vencimiento),
                lote.diasRestantes,
                lote.id
            ]);
        }


        doc.autoTable({
            head: head,
            body: datosTabla,
            startY: 30,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255] }, 
            didDrawPage: function (data) {
                doc.setFontSize(16);
                doc.setTextColor(40);
                doc.text("Reporte de Antibióticos", data.settings.margin.left, 15);
                doc.setFontSize(11);
                doc.text(`Filtro: ${filtroActualTexto}`, data.settings.margin.left, 25);
                
                doc.setFontSize(9);
                doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - data.settings.margin.right, doc.internal.pageSize.height - 10, {align: 'right'});
            }
        });

        doc.save(`Reporte_Antibioticos_${filtroActualTexto.replace(/\s/g, '_')}.pdf`);
        alert("✅ Reporte exportado a PDF exitosamente.");
    } catch (e) {
        console.error("Error al exportar a PDF:", e);
        alert("❌ Error al exportar a PDF. Revise la consola.");
    }
}


// --- EVENT LISTENERS ---
filtroReporteSelect.addEventListener("change", manejarFiltroReporte);
btnExportar.addEventListener("click", exportarAExcel);
btnExportarPdf.addEventListener("click", exportarAPDF);

// --- INICIALIZACIÓN ---
cargarDatosCentral();