import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Acceso a las librerías globales (cargadas en el HTML)
const { jsPDF } = window.jspdf;

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
 * Calcula los días entre la fecha de vencimiento y hoy.
 * @param {Date} fechaVencimiento - Objeto Date de la fecha de vencimiento.
 * @returns {number} Días restantes.
 */
function calcularDiasRestantes(fechaVencimiento) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0); 
    fechaVencimiento.setHours(0, 0, 0, 0);
    
    const diffTime = fechaVencimiento.getTime() - hoy.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

/**
 * Asigna una clase CSS y texto descriptivo basado en los días restantes.
 * NOTA: Esta función de alerta sigue usando los rangos (3/6 meses) para la CLASIFICACIÓN visual,
 * independientemente del filtro seleccionado.
 * @param {number} dias - Días restantes.
 * @returns {{clase: string, texto: string}} Objeto con la clase CSS y el texto a mostrar.
 */
function obtenerInfoAlerta(dias) {
    if (dias <= 0) {
        // Vencido
        const diasVencido = Math.abs(dias);
        const textoVencido = diasVencido === 0 ? '¡HOY!' : `(${diasVencido} días)`;
        return { clase: "card-danger", texto: `¡VENCIDO! ${textoVencido}` };
    } else if (dias <= 90) { // Menos de 3 meses
        return { clase: "card-danger", texto: `${dias} días (3 meses)` }; 
    } else if (dias <= 180) { // Menos de 6 meses
        return { clase: "card-warning", texto: `${dias} días (6 meses)` }; 
    } else { // Más de 6 meses
        return { clase: "card-info", texto: `${dias} días` }; 
    }
}

// --- CARGAR DATOS DE FIRESTORE ---
async function cargarLotes() {
    loadingMessage.style.display = 'block'; 
    productosGrid.innerHTML = ''; 

    try {
        const querySnapshot = await getDocs(collection(db, "inventario"));
        lotesInventario = [];
        querySnapshot.forEach(docu => {
            const data = docu.data();
            
            let fechaVencimiento = data.vencimiento;
            if (typeof fechaVencimiento === 'string') {
                fechaVencimiento = new Date(fechaVencimiento);
            } else if (fechaVencimiento && fechaVencimiento.toDate) {
                fechaVencimiento = fechaVencimiento.toDate();
            } else {
                return; 
            }
            
            const diasRestantes = calcularDiasRestantes(fechaVencimiento);

            lotesInventario.push({ 
                id: docu.id, 
                nombre: data.nombre,
                stock: parseInt(data.stock) || 0,
                precio: parseFloat(data.precio) || 0,
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

// --- FILTRADO Y RENDERIZADO DEL GRID (LÓGICA SIMPLE Y FINAL) ---
function filtrarYLlenarGrid() {
    const filtroValor = filtroMesesSelect.value;
    
    lotesFiltradosActualmente = lotesInventario.filter(lote => {
        const dias = lote.diasRestantes;
        
        if (filtroValor === '-1') { 
            // Mostrar todos
            return true;
        }
        
        if (filtroValor === '+1') { 
            // Vencidos y Próximos a Vencer (Definimos un límite amplio, ej: 12 meses o 365 días)
            const limiteDias = 365; // Límite de 12 meses
            
            // Retorna: 
            // 1. Lotes vencidos (dias <= 0)
            // 2. Lotes por vencer dentro del límite (dias > 0 y dias <= limiteDias)
            return dias <= limiteDias;
        }
        
        // Si se añade cualquier otro filtro en el futuro, por defecto no se muestra.
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
        
        const card = `
            <div class="product-card ${clase}">
                <div class="card-header">

                    <span class="product-name">${lote.nombre}</span>
                </div>
                <div class="product-details">
                    <p><strong>Stock:</strong> ${lote.stock} unidades</p>
                    <p><strong>Precio:</strong> Q ${lote.precio.toFixed(2)}</p>
                    <p><strong>Vencimiento:</strong> ${lote.vencimiento.toISOString().split('T')[0]}</p>
                    <p><strong>Quedan:</strong> <span class="badge">${texto}</span></p>
                    <p><strong>ID Lote:</strong> ${lote.id}</p>
                </div>
            </div>
        `;
        productosGrid.innerHTML += card;
    });
}

// --- FUNCIÓN PARA EXPORTAR A EXCEL ---
function exportarAExcel() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos filtrados para exportar.");
        return;
    }
    
    const datosParaExportar = lotesFiltradosActualmente.map(lote => ({
        Producto: lote.nombre,
        Stock_Lote: lote.stock,
        Precio_Unitario: lote.precio,
        Fecha_Vencimiento: lote.vencimiento.toISOString().split('T')[0],
        Dias_Restantes: lote.diasRestantes,
        Estado_Vencimiento: obtenerInfoAlerta(lote.diasRestantes).texto,
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


// --- FUNCIÓN PARA EXPORTAR A PDF ---
function exportarAPDF() {
    if (lotesFiltradosActualmente.length === 0) {
        alert("No hay datos filtrados para exportar a PDF.");
        return;
    }

    try {
        const doc = new jsPDF({ orientation: 'landscape' }); 
        const filtroActual = filtroMesesSelect.options[filtroMesesSelect.selectedIndex].text;

        const datosTabla = lotesFiltradosActualmente.map(lote => [
            lote.nombre,
            lote.stock,
            `Q ${lote.precio.toFixed(2)}`,
            lote.vencimiento.toISOString().split('T')[0],
            lote.diasRestantes,
            obtenerInfoAlerta(lote.diasRestantes).texto
        ]);

        doc.autoTable({
            head: [['Producto', 'Stock Lote', 'Precio Unitario', 'Fecha Vencimiento', 'Días Restantes', 'Estado']],
            body: datosTabla,
            startY: 30,
            theme: 'striped',
            headStyles: { fillColor: [0, 123, 255] }, 
            didDrawPage: function (data) {
                doc.setFontSize(18);
                doc.setTextColor(40);
                doc.text("Reporte de Alerta de Vencimientos", data.settings.margin.left, 15);
                doc.setFontSize(12);
                doc.text(`Filtro Aplicado: ${filtroActual}`, data.settings.margin.left, 25);
                
                doc.setFontSize(10);
                doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - data.settings.margin.right, doc.internal.pageSize.height - 10, {align: 'right'});
            }
        });

        doc.save('Reporte_Vencimientos.pdf');
        alert("✅ Reporte exportado a PDF exitosamente.");
    } catch (e) {
        console.error("Error al exportar a PDF:", e);
        alert("❌ Error al exportar a PDF. Revise la consola.");
    }
}


// --- EVENT LISTENERS ---
filtroMesesSelect.addEventListener("change", filtrarYLlenarGrid);
btnExportar.addEventListener("click", exportarAExcel);
btnExportarPdf.addEventListener("click", exportarAPDF);

// --- INICIALIZACIÓN ---
cargarLotes();