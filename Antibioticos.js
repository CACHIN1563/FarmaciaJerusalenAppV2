import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales
const { jsPDF } = window.jspdf;
const { XLSX } = window; 

// --- CONSTANTES Y REFERENCIAS DEL DOM (Mantenidas) ---
const DIAS_OFFSET = 25569; 
const CORRECCION_BISI = 1; 
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

const productosGrid = document.getElementById("productosGrid");
const filtroReporteSelect = document.getElementById("filtroReporte"); 
const btnExportar = document.getElementById("btnExportar");
const btnExportarPdf = document.getElementById("btnExportarPdf");
const loadingMessage = document.getElementById("loadingMessage");

// --- ESTADO ---
let antibioticosInventario = []; 
let ventasAntibioticos = [];      
let lotesFiltradosActualmente = []; 

// --- FUNCIONES DE UTILIDAD (Mantenidas) ---
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
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}


// --- CARGA DE DATOS CENTRAL (MODIFICADA PARA DETALLES DE AUDITORÍA) ---

async function cargarDatosCentral() {
    loadingMessage.style.display = 'block'; 
    antibioticosInventario = [];
    ventasAntibioticos = [];

    try {
        // 1. Cargar la colección 'inventario' y crear un mapa de info y stock actual
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
                            // Detalle de la cantidad vendida por tipo de empaque (para auditoría)
                            const cantCaja = parseInt(loteVendido.cajasVendidas) || 0;
                            const cantBlister = parseInt(loteVendido.blisteresVendidos) || 0;
                            const cantTableta = parseInt(loteVendido.unidadesVendidas) || 0; // Se asume que 'unidadesVendidas' es la cantidad de tabletas/unidades sueltas
                            const totalUnidadesVendidas = parseInt(loteVendido.cantidad) || 0;
                            
                            ventasAntibioticos.push({
                                id: loteId,
                                nombre: infoBase.nombre,
                                detalle: infoBase.detalle,
                                marca: infoBase.marca,
                                ubicacion: infoBase.ubicacion, // Mantenemos internamente, solo se quita en exportación
                                vencimiento: infoBase.vencimiento,
                                
                                // Datos de la venta para auditoría
                                cantidadVendida: totalUnidadesVendidas,
                                stockRestante: infoBase.stock, 
                                fechaVenta: fechaVentaObjeto, 
                                
                                // Campos de auditoría específicos solicitados
                                ventaId: docVenta.id, 
                                numeroVenta: numeroVenta,
                                metodoPago: metodoPago,
                                totalVenta: totalVenta,
                                cantCaja: cantCaja,
                                cantBlister: cantBlister,
                                cantTableta: cantTableta
                            });
                        }
                    });
                }
            });
        });

        manejarFiltroReporte();

    } catch (error) {
        console.error("Error al cargar datos. Revise la estructura de 'ventas' y 'inventario':", error);
        productosGrid.innerHTML = `<div class="no-products-message" style="color: red;">
                                    <i class="fas fa-exclamation-circle"></i> Error en la conexión o estructura de datos.
                                   </div>`;
    } finally {
        loadingMessage.style.display = 'none';
    }
}

// --- FILTRADO Y RENDERIZADO DEL GRID (Mantenidas) ---
// ... (manejarFiltroReporte y renderizarGrid sin cambios significativos) ...

function manejarFiltroReporte() {
    const filtroValor = filtroReporteSelect.value;
    lotesFiltradosActualmente = [];
    productosGrid.innerHTML = ""; 

    if (filtroValor === 'inventario') { 
        lotesFiltradosActualmente = antibioticosInventario
            .sort((a, b) => a.diasRestantes - b.diasRestantes); 
            
    } else if (filtroValor === 'vendidosMes') {
        const ventasAgrupadas = new Map();
        ventasAntibioticos.forEach(venta => {
            if (ventasAgrupadas.has(venta.id)) {
                ventasAgrupadas.get(venta.id).cantidadVendida += venta.cantidadVendida;
                // No necesitamos agrupar los campos de auditoría detallados en el grid, solo el total
            } else {
                ventasAgrupadas.set(venta.id, { ...venta });
            }
        });

        lotesFiltradosActualmente = Array.from(ventasAgrupadas.values())
            .sort((a, b) => b.fechaVenta - a.fechaVenta); 
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

    const esReporteVentas = filtroReporteSelect.value === 'vendidosMes';

    lotesFiltradosActualmente.forEach(lote => {
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
                                    ${dias > 0 && dias <= 90 ? '(3 meses)' : ''}
                                    ${dias > 90 && dias <= 180 ? '(6 meses)' : ''}
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
            claseCard = 'stock-normal'; 
            cardContent = `
                <div class="card-title">${lote.nombre}</div>
                <div class="card-subtitle">${lote.detalle}</div> 
                <p><strong>Marca:</strong> ${lote.marca}</p>
                <p><strong>Ubicación:</strong> ${lote.ubicacion}</p>
                <div class="lote-details">
                    <p><strong>Vendidas:</strong> ${lote.cantidadVendida} unidades</p>
                    <p><strong>Restante:</strong> ${lote.stockRestante} unidades</p>
                    <p><strong>Fecha Venta:</strong> ${lote.fechaVenta ? formatearFecha(lote.fechaVenta) : '-'}</p>
                    <p class="lote-id-display"><strong>ID Lote:</strong> ${lote.id}</p>
                </div>
                <button class="btn-ver-lotes" data-id="${lote.id}">
                    <i class="fas fa-chart-bar"></i> Ver Detalles
                </button>
            `;
        }

        const card = `<div class="product-card ${claseCard}">${cardContent}</div>`;
        productosGrid.innerHTML += card;
    });
    
    productosGrid.querySelectorAll('.btn-ver-lotes').forEach(button => {
        button.addEventListener('click', (e) => {
            const loteId = e.currentTarget.getAttribute('data-id');
            mostrarDetalles(loteId);
        });
    });
}


// --- FUNCIÓN DE VER DETALLES (Mantenida) ---
window.mostrarDetalles = function(loteId) {
    const lote = lotesFiltradosActualmente.find(l => l.id === loteId);
    if (!lote) {
        alert("Detalles del lote no encontrados.");
        return;
    }
    
    let encabezado = `*** DETALLES DEL LOTE ${lote.id} ***\n\n`;
    let infoGeneral = `Producto: ${lote.nombre} (${lote.detalle})\nMarca: ${lote.marca}\nUbicación: ${lote.ubicacion}\n`;
    let detallesEspecificos = '';
    
    const esVenta = filtroReporteSelect.value === 'vendidosMes';

    if (esVenta) {
        const registrosDeVenta = ventasAntibioticos.filter(v => v.id === loteId);
        
        let listaVentas = registrosDeVenta.map(r => 
            // Usamos formato de fecha y hora para la venta individual
            `| ${r.numeroVenta.padEnd(8)} | ${formatearFechaHora(r.fechaVenta).padEnd(16)} | ${String(r.cantidadVendida).padEnd(8)} | ${r.cantCaja.padEnd(6)} | ${r.cantBlister.padEnd(6)} | ${r.metodoPago}`
        ).join('\n');
        
        detallesEspecificos = `
Cantidad Total Vendida: ${lote.cantidadVendida} unidades
Stock Actual del Lote: ${lote.stockRestante} unidades

*** HISTORIAL DE VENTAS INDIVIDUALES (Auditoría) ***
| No. Venta | Fecha/Hora     | Vendidas | Cajas | Blister | Pago
| --------- | ---------------- | -------- | ----- | ------- | ----
${listaVentas}
`;
    } else {
        detallesEspecificos = `
Stock Total: ${lote.stock} unidades
Fecha de Vencimiento: ${formatearFecha(lote.vencimiento)}
Días Restantes: ${lote.diasRestantes}
`;
    }

    alert(encabezado + infoGeneral + detallesEspecificos);
};

// --- FUNCIONES DE EXPORTACIÓN (MODIFICADAS PARA AUDITORÍA) ---

function exportarAExcel() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos para exportar. Cargue el reporte primero.");
        return;
    }
    
    const filtroActualTexto = filtroReporteSelect.options[filtroReporteSelect.selectedIndex].text;
    const esReporteVentas = filtroReporteSelect.value === 'vendidosMes';

    const datosParaExportar = lotesFiltradosActualmente.map(lote => {
        
        if (esReporteVentas) {
            // EXPORTACIÓN DE VENTAS (Campos de Auditoría y empaque)
            return {
                No_Venta: lote.numeroVenta,
                Fecha_Venta: formatearFechaHora(lote.fechaVenta), // Hora para auditoría
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
                ID_Lote: lote.id
            };
        } else {
            // EXPORTACIÓN DE INVENTARIO (Sin cambios)
            return {
                Producto: lote.nombre,
                Formato: lote.detalle,
                Marca: lote.marca,
                Ubicacion: lote.ubicacion,
                Stock_Actual: lote.stock,
                Fecha_Vencimiento: formatearFecha(lote.vencimiento),
                Dias_Restantes: lote.diasRestantes,
                ID_Lote: lote.id
            };
        }
    });

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
        const doc = new jsPDF({ orientation: 'landscape', format: 'a4' }); // Cambiado a landscape para más columnas
        const filtroActualTexto = filtroReporteSelect.options[filtroReporteSelect.selectedIndex].text;
        const esReporteVentas = filtroReporteSelect.value === 'vendidosMes';

        let head;
        let datosTabla;
        
        if (esReporteVentas) {
            // PDF DE VENTAS (Campos de Auditoría y empaque)
            head = [['No. Venta', 'Fecha/Hora', 'Producto', 'Total (Und)', 'Cajas', 'Blister', 'Tabletas', 'Método Pago', 'Total Venta', 'ID Lote']];
            
            datosTabla = lotesFiltradosActualmente.map(lote => [
                lote.numeroVenta,
                formatearFechaHora(lote.fechaVenta),
                lote.nombre,
                lote.cantidadVendida, 
                lote.cantCaja,
                lote.cantBlister,
                lote.cantTableta,
                lote.metodoPago,
                `Q ${lote.totalVenta.toFixed(2)}`,
                lote.id
            ]);
        } else {
            // PDF DE INVENTARIO (Sin cambios)
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