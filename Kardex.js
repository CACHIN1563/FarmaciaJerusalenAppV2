import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    query,
    where,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { jsPDF } = window.jspdf;

// --- ELEMENTOS DEL DOM ---
const selectAntibiotico = document.getElementById("antibioticoSelect");
const selectAnio = document.getElementById("anioSelect");
const btnExportarPdf = document.getElementById("btnExportarPdf");
const kardexContent = document.getElementById("kardexContent");
const noDataMsg = document.getElementById("noDataMsg");
const infoCargando = document.getElementById("infoCargando");
const kardexBody = document.getElementById("kardexBody");

// Labels de info
const lblNombre = document.getElementById("lblNombre");
const lblPrincipio = document.getElementById("lblPrincipio");
const lblConcentracion = document.getElementById("lblConcentracion");
const lblPresentacion = document.getElementById("lblPresentacion");

// --- ESTADO ---
let antibioticosUnicos = [];
let movimientosActuales = [];
let productoSeleccionado = null;

/**
 * Carga la lista de antibióticos disponibles en el inventario para el selector.
 */
async function cargarListaAntibioticos() {
    try {
        const q = query(collection(db, "inventario"), where("antibiotico", "==", true));
        const snapshot = await getDocs(q);
        
        const mapaAgrupado = new Map();
        
        snapshot.forEach(docu => {
            const data = docu.data();
            const nombre = (data.nombre || "").toUpperCase().trim();
            if (!mapaAgrupado.has(nombre)) {
                mapaAgrupado.set(nombre, {
                    nombre: data.nombre,
                    principioActivo: data.principioActivo || "-",
                    concentracion: data.concentracion || "-",
                    presentacion_med: data.presentacion_med || "-",
                    ids: [docu.id]
                });
            } else {
                mapaAgrupado.get(nombre).ids.push(docu.id);
            }
        });

        antibioticosUnicos = Array.from(mapaAgrupado.values()).sort((a,b) => a.nombre.localeCompare(b.nombre));

        selectAntibiotico.innerHTML = '<option value="">-- Seleccione un antibiótico --</option>';
        antibioticosUnicos.forEach((prod, index) => {
            const opt = document.createElement("option");
            opt.value = index;
            opt.textContent = prod.nombre;
            selectAntibiotico.appendChild(opt);
        });

    } catch (error) {
        console.error("Error al cargar antibióticos:", error);
    }
}

/**
 * Carga los movimientos de Kardex para el producto seleccionado.
 */
async function cargarMovimientosKardex() {
    const idx = selectAntibiotico.value;
    if (idx === "") {
        kardexContent.style.display = "none";
        noDataMsg.style.display = "block";
        return;
    }

    productoSeleccionado = antibioticosUnicos[idx];
    const anio = selectAnio.value;
    
    noDataMsg.style.display = "none";
    infoCargando.style.display = "block";
    kardexContent.style.display = "none";

    try {
        // Consultar movimientos donde el nombre coincida (agrupamos por nombre comercial)
        const q = query(
            collection(db, "kardex_antibioticos"), 
            where("nombre", "==", productoSeleccionado.nombre)
        );
        
        const snapshot = await getDocs(q);
        movimientosActuales = [];
        
        snapshot.forEach(docu => {
            const data = docu.data();
            const fechaVal = data.fecha?.toDate ? data.fecha.toDate() : new Date(data.fecha);
            
            // Filtrar solo movimientos del año seleccionado
            if (fechaVal.getFullYear().toString() === anio) {
                movimientosActuales.push({
                    ...data,
                    id: docu.id,
                    fechaObjeto: fechaVal
                });
            }
        });

        // Ordenar en memoria por fecha para evitar errores de índice compuesto en Firebase
        movimientosActuales.sort((a, b) => a.fechaObjeto - b.fechaObjeto);

        renderizarTabla();
        
        // Actualizar Info Header
        lblNombre.textContent = productoSeleccionado.nombre;
        lblPrincipio.textContent = productoSeleccionado.principioActivo;
        lblConcentracion.textContent = productoSeleccionado.concentracion;
        lblPresentacion.textContent = productoSeleccionado.presentacion_med;

    } catch (error) {
        console.error("Error al cargar movimientos:", error);
        alert("Error al cargar el historial del Kardex.");
    } finally {
        infoCargando.style.display = "none";
        kardexContent.style.display = "block";
    }
}

function renderizarTabla() {
    kardexBody.innerHTML = "";
    
    if (movimientosActuales.length === 0) {
        kardexBody.innerHTML = '<tr><td colspan="6" class="no-data">No hay movimientos registrados para este año.</td></tr>';
        return;
    }

    movimientosActuales.forEach(mov => {
        const tr = document.createElement("tr");
        
        const fechaStr = mov.fechaObjeto.toLocaleDateString('es-GT', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        tr.innerHTML = `
            <td>${fechaStr}</td>
            <td>${mov.documento || '-'}</td>
            <td class="tipo-entrada">${mov.tipo === 'ENTRADA' ? mov.cantidad : '-'}</td>
            <td class="tipo-salida">${mov.tipo === 'SALIDA' ? mov.cantidad : '-'}</td>
            <td style="font-weight:bold;">${mov.saldo}</td>
            <td style="font-size:0.85em;">${mov.observacion || '-'}</td>
        `;
        kardexBody.appendChild(tr);
    });
}

/**
 * Genera el PDF con el estilo oficial de la foto.
 */
function generarPdfKardex() {
    if (!productoSeleccionado || movimientosActuales.length === 0) {
        alert("Primero seleccione un producto con movimientos.");
        return;
    }

    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    
    // Título y Logos (Simulado)
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("FARMACIA JERUSALÉN - KARDEX DE ANTIBIÓTICOS", 105, 15, { align: "center" });
    
    doc.setFontSize(10);
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    
    // Cuadro de Información del Producto
    const startY = 25;
    doc.rect(14, startY, 182, 30); // x, y, width, height
    
    doc.setFont("helvetica", "bold");
    doc.text("Nombre del Medicamento:", 16, startY + 7);
    doc.text("Principio Activo:", 16, startY + 14);
    doc.text("Concentración:", 16, startY + 21);
    doc.text("Presentación:", 16, startY + 28);
    
    doc.setFont("helvetica", "normal");
    doc.text(productoSeleccionado.nombre, 65, startY + 7);
    doc.text(productoSeleccionado.principioActivo, 65, startY + 14);
    doc.text(productoSeleccionado.concentracion, 65, startY + 21);
    doc.text(productoSeleccionado.presentacion_med, 65, startY + 28);
    
    // Tabla de Movimientos
    const tableData = movimientosActuales.map(mov => [
        mov.fechaObjeto.toLocaleDateString('es-GT'),
        mov.documento || '-',
        mov.tipo === 'ENTRADA' ? mov.cantidad : '',
        mov.tipo === 'SALIDA' ? mov.cantidad : '',
        mov.saldo,
        mov.observacion || ''
    ]);

    doc.autoTable({
        head: [['Fecha', 'Documento', 'Entrada', 'Salida', 'Saldo', 'Observación']],
        body: tableData,
        startY: startY + 35,
        theme: 'plain',
        tableLineColor: [0, 0, 0],
        tableLineWidth: 0.2,
        styles: {
            cellPadding: 2,
            fontSize: 9,
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
            halign: 'center'
        },
        headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            fontStyle: 'bold'
        }
    });

    const fileName = `Kardex_${productoSeleccionado.nombre.replace(/\s+/g, '_')}_${selectAnio.value}.pdf`;
    doc.save(fileName);
}

// Eventos
selectAntibiotico.addEventListener("change", cargarMovimientosKardex);
selectAnio.addEventListener("change", cargarMovimientosKardex);
btnExportarPdf.addEventListener("click", generarPdfKardex);

// Inicio
cargarListaAntibioticos();
