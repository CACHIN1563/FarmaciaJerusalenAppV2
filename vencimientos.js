import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (cargadas en el HTML)
// Asegúrate de que los scripts de jspdf y autotable estén cargados antes
const { jsPDF } = window.jspdf;
const { XLSX } = window; 

// --- REFERENCIAS DEL DOM ---
const productosGrid = document.getElementById("productosGrid");
const filtroMesesSelect = document.getElementById("filtroMeses");
const btnExportar = document.getElementById("btnExportar");
const btnExportarPdf = document.getElementById("btnExportarPdf");
const loadingMessage = document.getElementById("loadingMessage");

// --- ESTADO ---
let lotesInventario = []; 
let lotesFiltradosActualmente = []; 

// --- FUNCIONES DE UTILIDAD ---

/**
 * Convierte un número total de días en un string "X meses y Y días".
 * @param {number} totalDias - El número total de días restantes.
 * @returns {string} El texto formateado.
 */
function convertirDiasAMesesYDias(totalDias) {
    // Si ya está vencido, devolvemos un mensaje especial
    if (totalDias <= 0) {
        const diasVencido = Math.abs(totalDias);
        return diasVencido === 0 ? 'VENCE HOY' : `VENCIDO (${diasVencido} DÍAS)`;
    }

    if (totalDias < 30) {
        return `${totalDias} DÍAS`;
    }
    
    const meses = Math.floor(totalDias / 30);
    const dias = totalDias % 30;
    
    let resultado = '';
    
    if (meses > 0) {
        resultado += `${meses} mes${meses !== 1 ? 'es' : ''}`;
    }
    
    if (meses > 0 && dias > 0) {
        resultado += ' y ';
    }
    
    if (dias > 0) {
        resultado += `${dias} día${dias !== 1 ? 's' : ''}`;
    }
    
    return resultado.trim().toUpperCase();
}


/**
 * Calcula los días entre la fecha de vencimiento y hoy.
 * @param {Date} fechaVencimiento - Objeto Date de la fecha de vencimiento.
 * @returns {number} Días restantes.
 */
function calcularDiasRestantes(fechaVencimiento) {
    const fechaVencimientoClonada = new Date(fechaVencimiento.getTime()); 
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); 
    
    fechaVencimientoClonada.setHours(0, 0, 0, 0); 
    
    const diffTime = fechaVencimientoClonada.getTime() - hoy.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

/**
 * Asigna una clase CSS y texto descriptivo basado en los días restantes.
 * @param {number} dias - Días restantes.
 * @returns {{clase: string, texto: string}} Objeto con la clase CSS y el texto a mostrar.
 */
function obtenerInfoAlerta(dias) {
    const textoFormateado = convertirDiasAMesesYDias(dias);

    if (dias <= 0) {
        return { clase: "card-danger", texto: textoFormateado }; // VENCIDO
    } else if (dias <= 90) { // Menos de 3 meses
        return { clase: "card-danger", texto: textoFormateado }; 
    } else if (dias <= 180) { // Menos de 6 meses
        return { clase: "card-warning", texto: textoFormateado }; 
    } else { // Más de 6 meses
        return { clase: "card-info", texto: textoFormateado }; 
    }
}

// --- CARGAR DATOS DE FIRESTORE (Mantenida) ---
async function cargarLotes() {
    loadingMessage.style.display = 'block'; 
    productosGrid.innerHTML = ''; 

    // ... (Lógica de carga y parseo de fechas mantenida) ...
    // Se asume que esta lógica funciona correctamente.
    
    const DIAS_OFFSET = 25569; 
    const CORRECCION_BISI = 1; 
    const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

    try {
        const querySnapshot = await getDocs(collection(db, "inventario"));
        lotesInventario = [];
        querySnapshot.forEach(docu => {
            const data = docu.data();
            
            let fechaVencimiento = data.vencimiento;
            let precioUnitario = parseFloat(data.precioUnidad) || parseFloat(data.precioPublico) || 0;
            let detalleUnidad = data.detalle || data.presentacion || 'Unidad/Lote'; 

            if (fechaVencimiento && fechaVencimiento.toDate) {
                fechaVencimiento = fechaVencimiento.toDate();
            } else if (typeof fechaVencimiento === 'string' || typeof fechaVencimiento === 'number') {
                
                let serialNumber;
                
                if (!isNaN(parseFloat(fechaVencimiento)) && isFinite(fechaVencimiento)) {
                    serialNumber = parseFloat(fechaVencimiento);
                } else {
                    return; 
                }

                if (serialNumber > 1) { 
                    const diasDesdeEpoch = serialNumber - DIAS_OFFSET - CORRECCION_BISI; 
                    const millisDesdeEpoch = diasDesdeEpoch * MILLIS_PER_DAY;
                    fechaVencimiento = new Date(millisDesdeEpoch);
                    fechaVencimiento.setUTCHours(12, 0, 0, 0); 
                    
                } else {
                    return; 
                }
            } else {
                return; 
            }
            
            if (isNaN(fechaVencimiento.getTime())) {
                console.warn(`Lote ignorado: Fecha inválida (NaN). Producto: ${data.nombre} (${docu.id})`);
                return;
            }
            
            const diasRestantes = calcularDiasRestantes(fechaVencimiento);

            lotesInventario.push({ 
                id: docu.id, 
                nombre: data.nombre,
                stock: parseInt(data.stock) || 0,
                precio: precioUnitario,
                detalle: detalleUnidad,
                vencimiento: fechaVencimiento,
                diasRestantes: diasRestantes,
                marca: data.marca || 'N/A', 
                imagen: data.imagen || 'https://via.placeholder.com/50' 
            });
        });
        
        // Ordenar por días restantes (Vencidos primero)
        lotesInventario.sort((a, b) => a.diasRestantes - b.diasRestantes);
        
        filtrarYLlenarGrid();
    } catch (error) {
        console.error("Error al cargar lotes:", error);
        productosGrid.innerHTML = `<div class="no-products-message" style="color: red;">
                                         <i class="fas fa-exclamation-circle"></i> Error al cargar el inventario.
                                         </div>`;
    } finally {
        loadingMessage.style.display = 'none';
    }
}


// --- FILTRADO Y RENDERIZADO DEL GRID (CORREGIDA LA ESTRUCTURA HTML DE LA TARJETA) ---
function filtrarYLlenarGrid() {
    const filtroValor = filtroMesesSelect.value;
    
    lotesFiltradosActualmente = lotesInventario.filter(lote => {
        const dias = lote.diasRestantes;
        
        // -1: Mostrar todos los lotes
        if (filtroValor === '-1') { 
            return true;
        }
        
        // 0: Solo Lotes vencidos (dias <= 0)
        if (filtroValor === '0') { 
            return dias <= 0;
        }
        
        // +90: Próximos 90 Días (excluye vencidos)
        if (filtroValor === '+90') { 
            const limiteDias = 90;
            return dias > 0 && dias <= limiteDias;
        }
        
        // +180: Próximos 180 Días (excluye vencidos)
        if (filtroValor === '+180') { 
            const limiteDias = 180;
            return dias > 0 && dias <= limiteDias;
        }

        return false;
    });

    productosGrid.innerHTML = ""; 

    if (lotesFiltradosActualmente.length === 0) {
        productosGrid.innerHTML = `<div class="no-products-message">
                                         <i class="fas fa-box-open"></i> No se encontraron lotes con las condiciones de vencimiento seleccionadas.
                                         </div>`;
        return;
    }

    // Renderizado de las tarjetas
    lotesFiltradosActualmente.forEach(lote => {
        const { clase, texto } = obtenerInfoAlerta(lote.diasRestantes);
        const fechaVencimientoStr = lote.vencimiento.toISOString().split('T')[0];
        
        // **IMPORTANTE**: La estructura de la tarjeta se ajusta a los nuevos estilos CSS
        const card = `
            <div class="product-card ${clase}">
                <div class="card-header">
                    <span class="product-name">${lote.nombre}</span>
                    <p class="product-detail">${lote.detalle}</p> 
                </div>

                <div class="alert-container">
                    <div class="info-box">
                        <p>Marca: <strong>${lote.marca}</strong></p>
                        <p>Precio Unitario: <strong>Q ${lote.precio.toFixed(2)}</strong></p>
                        <p>Stock Total: <strong>${lote.stock} unidades</strong></p>
                    </div>

                    <div class="vencimiento-detail">
                        <span>**Fecha Vencimiento:** ${fechaVencimientoStr}</span> 
                        <span class="badge">${texto}</span>
                    </div>
                </div>
                <div class="lote-id-footer">
                    ID Lote: ${lote.id}
                </div>
            </div>
        `;
        productosGrid.innerHTML += card;
    });
}

// --- FUNCIONES DE EXPORTACIÓN ---

function exportarAExcel() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos filtrados para exportar.");
        return;
    }
    
    const datosParaExportar = lotesFiltradosActualmente.map(lote => ({
        Producto: lote.nombre,
        Formato: lote.detalle,
        Marca: lote.marca, 
        Stock_Lote: lote.stock,
        Precio_Unitario: lote.precio,
        Fecha_Vencimiento: lote.vencimiento.toISOString().split('T')[0],
        Dias_Restantes: lote.diasRestantes,
        Estado_Vencimiento: convertirDiasAMesesYDias(lote.diasRestantes), 
        ID_Lote: lote.id
    }));

    try {
        const ws = XLSX.utils.json_to_sheet(datosParaExportar);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Vencimientos");
        XLSX.writeFile(wb, "Reporte_Vencimientos.xlsx");
        alert("✅ Datos exportados a Excel exitosamente.");
    } catch (e) {
        console.error("Error al exportar a Excel:", e);
        alert("❌ Error al exportar a Excel. Revise la consola.");
    }
}

/**
 * Genera el reporte en formato PDF usando jsPDF y autoTable.
 * @returns {void}
 */
function exportarAPDF() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos filtrados para exportar a PDF.");
        return;
    }

    // Inicializar jsPDF
    const doc = new jsPDF({
        orientation: "landscape", // Horizontal
        unit: "mm",
        format: "a4"
    });
    
    // Preparar los datos de la tabla
    const headers = [
        ['Producto', 'Marca', 'Stock', 'P. Unitario', 'Fecha Venc.', 'Días Restantes', 'Estado', 'ID Lote']
    ];

    const body = lotesFiltradosActualmente.map(lote => [
        `${lote.nombre} (${lote.detalle})`,
        lote.marca,
        lote.stock,
        `Q ${lote.precio.toFixed(2)}`,
        lote.vencimiento.toISOString().split('T')[0],
        lote.diasRestantes,
        convertirDiasAMesesYDias(lote.diasRestantes),
        lote.id
    ]);

    // Información de filtrado para el título
    const filtroTexto = filtroMesesSelect.options[filtroMesesSelect.selectedIndex].text;
    const date = new Date().toLocaleDateString('es-GT', { timeZone: 'America/Guatemala' });
    
    // Título
    doc.setFontSize(18);
    doc.setTextColor(52, 58, 64); // Dark Gray
    doc.text("Reporte de Alerta de Lotes Próximos a Vencer", 14, 20);
    
    // Subtítulo y fecha
    doc.setFontSize(10);
    doc.setTextColor(108, 117, 125); // Medium Gray
    doc.text(`Filtro Aplicado: ${filtroTexto}`, 14, 26);
    doc.text(`Generado el: ${date}`, 14, 32);

    // Generar la tabla con autoTable
    doc.autoTable({
        startY: 38,
        head: headers,
        body: body,
        theme: 'striped',
        styles: { 
            fontSize: 8, 
            cellPadding: 2
        },
        headStyles: {
            fillColor: [0, 123, 255], // primary-blue
            textColor: 255,
            fontStyle: 'bold'
        },
        columnStyles: {
            0: { cellWidth: 55 }, // Producto
            4: { cellWidth: 20 }, // Fecha Vencimiento
            5: { cellWidth: 20, halign: 'center' }, // Días Restantes
            6: { cellWidth: 30, fontStyle: 'bold' }, // Estado
            7: { cellWidth: 55 } // ID Lote
        }
    });

    // Guardar el PDF
    doc.save("Reporte_Vencimientos.pdf");
    alert("✅ Reporte PDF generado exitosamente.");
}

// --- EVENT LISTENERS (CORREGIDO Y COMPLETO) ---
filtroMesesSelect.addEventListener("change", filtrarYLlenarGrid);
btnExportar.addEventListener("click", exportarAExcel);
btnExportarPdf.addEventListener("click", exportarAPDF); // <-- PDF listener añadido

// --- INICIALIZACIÓN ---
cargarLotes();