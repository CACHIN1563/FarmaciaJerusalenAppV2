import { db } from "./firebase-config.js";
import {
    collection,
    addDoc,
    deleteDoc,
    updateDoc,
    doc,
    onSnapshot,
    query,
    where,
    getDocs,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const refFacturas = collection(db, "facturas");

// ELEMENTOS HTML
const numFactura = document.getElementById("numFactura");
const monto = document.getElementById("monto"); 
const proveedor = document.getElementById("proveedor");
const fechaEmision = document.getElementById("fechaEmision");
const fechaPago = document.getElementById("fechaPago");
const estado = document.getElementById("estado");
const descripcion = document.getElementById("descripcion"); // 🔑 NUEVA REFERENCIA: DESCRIPCIÓN

const btnGuardar = document.getElementById("guardarFactura");
const filtroEstado = document.getElementById("filtroEstado");
const buscador = document.getElementById("buscador");

const listaFacturas = document.getElementById("listaFacturas");
const paginacionDiv = document.getElementById("paginacion");

// MENU EXPORTAR
const btnMostrarExportar = document.getElementById("btnMostrarExportar");
const menuExportar = document.getElementById("menuExportar");

const btnJSON = document.getElementById("exportarJSON");
const btnExcel = document.getElementById("exportarEXCEL");
const btnPDF = document.getElementById("exportarPDF");

let facturas = [];
let paginaActual = 1;
const FACTURAS_POR_PAGINA = 10;

// ----------------------------
// FUNCIONES DE UTILIDAD
// ----------------------------
const formatoMoneda = (monto) => { 
    if (monto === null || typeof monto === 'undefined') return 'Q 0.00'; 
    return `Q ${parseFloat(monto).toFixed(2)}`;
};

async function existeFactura(num) {
    const q = query(refFacturas, where("numFactura", "==", num));
    const snap = await getDocs(q);
    return snap.size > 0;
}

// ----------------------------
// GUARDAR (CON DESCRIPCIÓN)
// ----------------------------
btnGuardar.onclick = async () => {
    // VALIDACIONES
    if (!numFactura.value || !monto.value || !proveedor.value || !fechaEmision.value || !fechaPago.value) {
        alert("⚠️ Debes llenar todos los campos obligatorios.");
        return;
    }

    if (await existeFactura(numFactura.value)) {
        alert("❌ Ya existe una factura con ese número.");
        return;
    }
    
    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando...";

    try {
        await addDoc(refFacturas, {
            numFactura: numFactura.value,
            monto: parseFloat(monto.value), 
            proveedor: proveedor.value,
            fechaEmision: fechaEmision.value,
            fechaPago: fechaPago.value,
            estado: estado.value,
            descripcion: descripcion.value || "", // 🔑 GUARDAR DESCRIPCIÓN (o cadena vacía si no hay)
        });

        alert("✅ Factura guardada exitosamente!");

        // LIMPIAR FORMULARIO
        numFactura.value = "";
        monto.value = ""; 
        proveedor.value = "";
        fechaEmision.value = "";
        fechaPago.value = "";
        estado.value = "pendiente";
        descripcion.value = ""; // 🔑 LIMPIAR CAMPO DESCRIPCIÓN
        
    } catch (error) {
        console.error("Error al guardar la factura:", error);
        alert("❌ Error al guardar la factura.");
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.textContent = "Guardar Factura";
    }
};

// ----------------------------
// SUSCRIPCIÓN TIEMPO REAL
// ----------------------------
onSnapshot(query(refFacturas, orderBy("fechaEmision", "desc")), snap => {
    facturas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    paginaActual = 1;
    renderFacturas();
});

// ----------------------------
// APLICAR FILTRO + BUSCADOR
// ----------------------------
function obtenerFiltradas() {
    let filtradas = facturas;
    const textoBusqueda = buscador.value.toLowerCase().trim();

    if (filtroEstado.value !== "todas") {
        filtradas = filtradas.filter(f => f.estado === filtroEstado.value);
    }

    if (textoBusqueda !== "") {
        filtradas = filtradas.filter(f => {
            const coincideProveedor = f.proveedor.toLowerCase().includes(textoBusqueda);
            const coincideFactura = f.numFactura.toLowerCase().includes(textoBusqueda);
            const coincideMonto = (f.monto ? f.monto.toFixed(2) : '').includes(textoBusqueda) ||
                                  (f.monto ? f.monto.toString() : '').includes(textoBusqueda);
            // 🔑 Opcional: Podrías añadir la búsqueda en la descripción también
            // const coincideDescripcion = (f.descripcion || '').toLowerCase().includes(textoBusqueda);

            return coincideProveedor || coincideFactura || coincideMonto; // || coincideDescripcion;
        });
    }

    return filtradas;
}

// ----------------------------
// PAGINACIÓN
// ----------------------------
function paginar(lista) {
    const inicio = (paginaActual - 1) * FACTURAS_POR_PAGINA;
    return lista.slice(inicio, inicio + FACTURAS_POR_PAGINA);
}

function renderPaginacion(total) {
    paginacionDiv.innerHTML = "";

    const paginas = Math.ceil(total / FACTURAS_POR_PAGINA);

    for (let i = 1; i <= paginas; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.onclick = () => {
            paginaActual = i;
            renderFacturas();
        };
        if (i === paginaActual) {
            btn.classList.add("active");
        }
        paginacionDiv.appendChild(btn);
    }
}

// ----------------------------
// RENDER (MOSTRANDO DESCRIPCIÓN)
// ----------------------------
function renderFacturas() {
    listaFacturas.innerHTML = "";

    const filtradas = obtenerFiltradas();
    const paginadas = paginar(filtradas);

    if (paginadas.length === 0) {
        listaFacturas.innerHTML = "<p>No hay facturas para mostrar que coincidan con los filtros.</p>";
        renderPaginacion(0); 
        return;
    }
    
    paginadas.forEach(f => {
        const estadoClase = f.estado === 'pagada' ? 'estado-pagada' : 'estado-pendiente';
        const iconoEstado = f.estado === 'pagada' ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-clock"></i>';
        const btnPagarDisabled = f.estado === 'pagada' ? 'disabled' : '';
        const btnPagarTexto = f.estado === 'pagada' ? 'Pagada' : 'Marcar pagada';
        
        // 🔑 Mostrar descripción si existe
        const descripcionHTML = f.descripcion ? `<p class="factura-descripcion">Notas: ${f.descripcion}</p>` : '';

        listaFacturas.innerHTML += `
        <div class="factura-box">
            <p><b>Factura:</b> ${f.numFactura}</p>
            <p><b>Monto Total:</b> <strong>${formatoMoneda(f.monto)}</strong></p> 
            <p><b>Proveedor:</b> ${f.proveedor}</p>
            <p><b>Emisión:</b> ${f.fechaEmision}</p>
            <p><b>Límite Pago:</b> ${f.fechaPago}</p>
            
            ${descripcionHTML} 

            <p style="margin-top: 10px;">
                <b>Estado:</b> 
                <span class="${estadoClase}">${iconoEstado} ${f.estado.toUpperCase()}</span>
            </p>

            <div class="factura-actions">
                <button class="btn btn-pagar" ${btnPagarDisabled} onclick="marcarPagada('${f.id}')">${btnPagarTexto}</button>
                <button class="btn btn-eliminar" onclick="eliminarFactura('${f.id}')"><i class="fas fa-trash-alt"></i> Eliminar</button>
            </div>
        </div>
        `;
    });

    renderPaginacion(filtradas.length);
}

// ----------------------------
// MARCAR COMO PAGADA (GLOBAL)
// ----------------------------
window.marcarPagada = async (id) => {
    await updateDoc(doc(db, "facturas", id), { estado: "pagada" });
};

// ----------------------------
// ELIMINAR (GLOBAL)
// ----------------------------
window.eliminarFactura = async (id) => {
    if (!confirm("¿Seguro que deseas eliminar la factura? Esta acción no se puede deshacer.")) return;
    await deleteDoc(doc(db, "facturas", id));
};

// ----------------------------
// EXPORTAR RESPETANDO FILTRO + BÚSQUEDA
// ----------------------------
function datosExportacion() {
    return paginar(obtenerFiltradas()); 
}

btnJSON.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos en esta página para exportar.");

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "facturas_pagina.json";
    a.click();
};

btnExcel.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos en esta página para exportar.");
    
    const filasParaExportar = data.map(f => ({
        NumeroFactura: f.numFactura,
        MontoTotal: f.monto,
        Proveedor: f.proveedor,
        FechaEmision: f.fechaEmision,
        FechaPago: f.fechaPago,
        Estado: f.estado,
        Descripcion: f.descripcion || "", // 🔑 EXPORTAR DESCRIPCIÓN
    }));

    const ws = XLSX.utils.json_to_sheet(filasParaExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
    XLSX.writeFile(wb, "facturas_pagina.xlsx");
};

btnPDF.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos en esta página para exportar.");

    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();

    docPDF.text(`Listado de Facturas (Página ${paginaActual})`, 14, 15);

    const tabla = data.map(f => [
        f.numFactura,
        formatoMoneda(f.monto), 
        f.proveedor,
        f.fechaEmision,
        f.fechaPago,
        f.estado.charAt(0).toUpperCase() + f.estado.slice(1),
        f.descripcion || "" // 🔑 EXPORTAR DESCRIPCIÓN A PDF
    ]);

    docPDF.autoTable({
        head: [["Número", "Monto", "Proveedor", "Emisión", "Límite Pago", "Estado", "Notas"]], // 🔑 ENCABEZADO "NOTAS"
        body: tabla,
        startY: 20,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 123, 255] }
    });

    docPDF.save("facturas_pagina.pdf");
};

// ----------------------------
// MENU EXPORTAR
// ----------------------------
btnMostrarExportar.onclick = () => {
    menuExportar.style.display =
        menuExportar.style.display === "block" ? "none" : "block";
};

document.addEventListener('click', (event) => {
    if (!btnMostrarExportar.contains(event.target) && !menuExportar.contains(event.target)) {
        menuExportar.style.display = 'none';
    }
});

// ----------------------------
// ACTUALIZAR LISTA CUANDO SE FILTRA O BUSCA
// ----------------------------
buscador.oninput = () => {
    paginaActual = 1;
    renderFacturas();
};

filtroEstado.onchange = () => {
    paginaActual = 1;
    renderFacturas();
};






