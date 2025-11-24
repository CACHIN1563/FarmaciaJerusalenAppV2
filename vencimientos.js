import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (cargadas en el HTML)
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
    if (totalDias < 30) {
        return `${totalDias} días`;
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
    
    return resultado.trim();
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
 * **ACTUALIZADA** para usar 'convertirDiasAMesesYDias' y eliminar texto estático.
 * @param {number} dias - Días restantes.
 * @returns {{clase: string, texto: string}} Objeto con la clase CSS y el texto a mostrar.
 */
function obtenerInfoAlerta(dias) {
    const textoFormateado = convertirDiasAMesesYDias(dias);

    if (dias <= 0) {
        const diasVencido = Math.abs(dias);
        const textoVencido = diasVencido === 0 ? '¡HOY!' : `(${diasVencido} días)`;
        return { clase: "card-danger", texto: `¡VENCIDO! ${textoVencido}` };
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

    // Constantes para la conversión del número de serie de fecha de Excel/Sheets:
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

            // 1. Caso Timestamp de Firebase (Ideal)
            if (fechaVencimiento && fechaVencimiento.toDate) {
                fechaVencimiento = fechaVencimiento.toDate();
            } else if (typeof fechaVencimiento === 'string' || typeof fechaVencimiento === 'number') {
                
                let serialNumber;
                
                if (!isNaN(parseFloat(fechaVencimiento)) && isFinite(fechaVencimiento)) {
                    serialNumber = parseFloat(fechaVencimiento);
                } else {
                    return; 
                }

                // LÓGICA DE CONVERSIÓN DE NÚMERO DE SERIE DE EXCEL
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
            
            // Verificación final de validez
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

// --- FILTRADO Y RENDERIZADO DEL GRID (Mantenida) ---
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
        
        // +90: Solo Próximos (3 meses) - Excluye vencidos (dias > 0)
        if (filtroValor === '+90') { 
            const limiteDias = 90;
            return dias > 0 && dias <= limiteDias;
        }
        
        // +180: Solo Próximos (6 meses) - Excluye vencidos (dias > 0)
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
        // La variable 'texto' ya contendrá el formato "X meses y Y días" o "X días"
        const { clase, texto } = obtenerInfoAlerta(lote.diasRestantes);
        
        const card = `
            <div class="product-card ${clase}">
                <div class="card-header">
                    <span class="product-name">${lote.nombre}</span>
                </div>
                <p class="product-detail">${lote.detalle}</p> 

                <div class="product-details">
                    <p><strong>Stock:</strong> ${lote.stock} unidades</p>
                    <p><strong>P. Unidad:</strong> Q ${lote.precio.toFixed(2)}</p> 
                    <p><strong>Vencimiento:</strong> ${lote.vencimiento.toISOString().split('T')[0]}</p>
                    <p><strong>Quedan:</strong> <span class="badge">${texto}</span></p>
                    <p><strong>ID Lote:</strong> ${lote.id}</p>
                </div>
            </div>
        `;
        productosGrid.innerHTML += card;
    });
}

// --- FUNCIONES DE EXPORTACIÓN (Actualizada para usar el nuevo formato en Estado_Vencimiento) ---
function exportarAExcel() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos filtrados para exportar.");
        return;
    }
    
    const datosParaExportar = lotesFiltradosActualmente.map(lote => ({
        Producto: lote.nombre,
        Formato: lote.detalle,
        Stock_Lote: lote.stock,
        Precio_Unitario: lote.precio,
        Fecha_Vencimiento: lote.vencimiento.toISOString().split('T')[0],
        Dias_Restantes: lote.diasRestantes,
        // Usamos la nueva función para que el reporte sea consistente
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

// --- EVENT LISTENERS (Mantenidos) ---
filtroMesesSelect.addEventListener("change", filtrarYLlenarGrid);
btnExportar.addEventListener("click", exportarAExcel);
// btnExportarPdf.addEventListener("click", exportarAPDF); // Esta función no fue incluida en tu último código, así que la dejo comentada

// --- INICIALIZACIÓN (Mantenida) ---
cargarLotes();