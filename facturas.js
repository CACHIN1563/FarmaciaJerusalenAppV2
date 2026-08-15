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

// ELEMENTOS HTML (Asegúrate de que estas referencias son correctas en tu HTML)
const numFactura = document.getElementById("numFactura");
const monto = document.getElementById("monto"); 
const proveedor = document.getElementById("proveedor");
const fechaEmision = document.getElementById("fechaEmision");
const fechaPago = document.getElementById("fechaPago");
const estado = document.getElementById("estado");
const descripcion = document.getElementById("descripcion"); 

const btnGuardar = document.getElementById("guardarFactura");
const filtroEstado = document.getElementById("filtroEstado");
const buscador = document.getElementById("buscador");

const listaFacturas = document.getElementById("listaFacturas");
const paginacionDiv = document.getElementById("paginacion");

// ELEMENTOS PARA CARGA MASIVA
const inputArchivo = document.getElementById("inputArchivo");
const btnCargaMasiva = document.getElementById("btnCargaMasiva");
const mensajeCarga = document.getElementById("mensajeCarga"); 

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

/**
 * Mapea los nombres de las columnas del reporte SAT (XLSX) 
 * a los nombres de campos en tu base de datos de Firebase.
 * @param {Object} satItem - Objeto con los datos de una fila del reporte SAT.
 * @returns {Object} Factura mapeada a la estructura de la aplicación.
 */
function mapFacturaData(satItem) {
    
    // Función para obtener el valor del campo, manejando null/undefined y limpiando strings
    const getValue = (key) => satItem[key] !== undefined && satItem[key] !== null ? String(satItem[key]).trim() : '';
    const getFloat = (key) => {
        const value = satItem[key];
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const cleaned = value.replace(/,/g, ''); 
            return parseFloat(cleaned) || 0;
        }
        return 0;
    };
    
    // --- 1. Calcular Fechas y Límite de Pago (Fecha de Emisión + 1 mes) ---
    const fechaEmisionStr = getValue('Fecha de emisión');
    let fechaPagoStr = fechaEmisionStr; 
    
    try {
        // Intenta parsear la fecha. Es vital que el formato de Excel sea reconocido.
        let fecha = new Date(fechaEmisionStr);
        
        if (!isNaN(fecha.getTime())) { // Comprobar que la fecha es válida
            let fechaPago = new Date(fecha);
            fechaPago.setMonth(fechaPago.getMonth() + 1);
            
            // Formatear la fecha de pago a YYYY-MM-DD
            const year = fechaPago.getFullYear();
            const month = String(fechaPago.getMonth() + 1).padStart(2, '0');
            const day = String(fechaPago.getDate()).padStart(2, '0');
            fechaPagoStr = `${year}-${month}-${day}`;
        }
    } catch (e) {
        console.warn("Error al calcular la fecha de pago. Usando la fecha de emisión.", e);
    }
    
    // --- 2. Descripción Simplificada (Según lo solicitado) ---
    const descripcionNotas = `Compra de medicamentos/bienes`;


    // --- 3. Creación del Número de Factura (Serie-Número del DTE) ---
    const numDTE = getValue('Número del DTE'); // Columna E
    
    return {
        // Mapeo a campos de Firebase
        numFactura: numDTE, 
        monto: getFloat('Gran Total (Moneda Original)'),
        proveedor: getValue('Nombre completo del emisor'),
        fechaEmision: fechaEmisionStr, 
        
        // Límite de pago calculado
        fechaPago: fechaPagoStr, 
        estado: 'pendiente', 
        descripcion: descripcionNotas,
        
        // Indicador para omitir
        anulado: getValue('Marca de anulado') === 'SI' || getValue('Estado') === 'ANULADA',
    };
}


// ----------------------------
// 🔑 LÓGICA DE CARGA MASIVA Y SALTAR DUPLICADOS
// ----------------------------
btnCargaMasiva.onclick = async () => {
    if (!inputArchivo.files.length) {
        alert("⚠️ Por favor, selecciona un archivo XLSX.");
        return;
    }

    const archivo = inputArchivo.files[0];
    const extension = archivo.name.split('.').pop().toLowerCase();

    if (extension !== 'xls' && extension !== 'xlsx') {
        alert("❌ Formato de archivo no soportado. Por favor, sube el reporte en formato Excel (.xls o .xlsx).");
        return;
    }

    btnCargaMasiva.disabled = true;
    btnCargaMasiva.textContent = "Procesando...";
    mensajeCarga.textContent = "Leyendo archivo Excel...";
    
    let subidasExitosas = 0;
    let duplicadosOmitidos = 0;
    let fallos = 0;

    const lector = new FileReader();

    lector.onload = async (e) => {
        try {
            // Lectura del archivo XLSX/XLS
            const data = new Uint8Array(e.target.result);
            // cellDates: true ayuda a la librería a reconocer fechas
            const workbook = XLSX.read(data, { type: 'array', cellDates: true }); 
            
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Convertir la hoja a un array de objetos JSON usando los encabezados (header: 1)
            const datosSAT = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (datosSAT.length < 2) {
                alert("❌ El archivo no contiene datos válidos o está vacío.");
                return;
            }
            
            // Normalizar y estructurar los datos (crucial para usar los nombres de columnas)
            const headers = datosSAT[0].map(h => String(h).trim());
            const structuredData = [];

            for (let i = 1; i < datosSAT.length; i++) {
                let row = {};
                if (datosSAT[i].length !== headers.length) continue; 

                headers.forEach((header, index) => {
                    row[header] = datosSAT[i][index];
                });
                structuredData.push(row);
            }
            
            const total = structuredData.length;
            mensajeCarga.textContent = `Archivo cargado. Iniciando validación y subida de ${total} facturas...`;
            
            // 1. Optimización: Obtener todos los números de factura existentes
            const snapExistentes = await getDocs(refFacturas);
            const numFacturasExistentes = new Set(snapExistentes.docs.map(doc => doc.data().numFactura));

            // 2. Procesar y Subir
            for (const [index, itemSAT] of structuredData.entries()) {
                
                const facturaMapeada = mapFacturaData(itemSAT);

                const { numFactura, monto, proveedor, fechaEmision, fechaPago, estado, descripcion, anulado } = facturaMapeada;

                // 3. Validaciones y Salto
                if (anulado) {
                    fallos++;
                    mensajeCarga.textContent = `Procesando ${index + 1}/${total} (Factura ${numFactura} fue ANULADA, omitida)...`;
                    continue; 
                }
                
                if (!numFactura || monto <= 0 || !proveedor || !fechaEmision) {
                    fallos++;
                    console.warn(`Factura omitida en línea ${index + 2}: Faltan datos cruciales.`, itemSAT);
                    continue; 
                }

                // 4. Verificación de Duplicados
                if (numFacturasExistentes.has(numFactura)) {
                    duplicadosOmitidos++;
                    mensajeCarga.textContent = `Procesando ${index + 1}/${total} (${duplicadosOmitidos} duplicados omitidos)...`;
                    continue; 
                }

                // 5. Guardar
                try {
                    await addDoc(refFacturas, {
                        numFactura: numFactura,
                        monto: monto,
                        proveedor: proveedor,
                        fechaEmision: fechaEmision,
                        fechaPago: fechaPago,
                        estado: estado,
                        descripcion: descripcion,
                    });
                    subidasExitosas++;
                    numFacturasExistentes.add(numFactura); 
                    mensajeCarga.textContent = `Procesando ${index + 1}/${total} (${subidasExitosas} añadidas)...`;
                } catch (error) {
                    console.error(`Fallo al subir factura ${numFactura}:`, error);
                    fallos++;
                }
            }

            // 6. Reporte final
            alert(`🎉 Carga finalizada: ${subidasExitosas} nuevas facturas añadidas, ${duplicadosOmitidos} duplicados omitidos, ${fallos} facturas anuladas/mal formadas.`);
            mensajeCarga.textContent = `✅ Carga finalizada: ${subidasExitosas} añadidas / ${duplicadosOmitidos} omitidas.`;

        } catch (error) {
            console.error("Error catastrófico al procesar el archivo:", error);
            alert("❌ Error al procesar el archivo. Asegúrate de que sea un XLSX válido.");
        } finally {
            btnCargaMasiva.disabled = false;
            btnCargaMasiva.textContent = "Procesar y Subir";
            inputArchivo.value = ''; 
        }
    };

    lector.onerror = (e) => {
        alert("Error leyendo el archivo.");
        btnCargaMasiva.disabled = false;
        btnCargaMasiva.textContent = "Procesar y Subir";
    };

    lector.readAsArrayBuffer(archivo);
};

// ----------------------------
// GUARDAR INDIVIDUAL (ORIGINAL)
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
            descripcion: descripcion.value || "", 
        });

        alert("✅ Factura guardada exitosamente!");

        // LIMPIAR FORMULARIO
        numFactura.value = "";
        monto.value = ""; 
        proveedor.value = "";
        fechaEmision.value = "";
        fechaPago.value = "";
        estado.value = "pendiente";
        descripcion.value = ""; 
        
    } catch (error) {
        console.error("Error al guardar la factura:", error);
        alert("❌ Error al guardar la factura.");
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.textContent = "Guardar Factura";
    }
};

// ----------------------------
// SUSCRIPCIÓN TIEMPO REAL (ORIGINAL)
// ----------------------------
onSnapshot(query(refFacturas, orderBy("fechaEmision", "desc")), snap => {
    facturas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    paginaActual = 1;
    renderFacturas();
});

// ----------------------------
// APLICAR FILTRO + BUSCADOR (ORIGINAL)
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

            return coincideProveedor || coincideFactura || coincideMonto;
        });
    }

    return filtradas;
}

// ----------------------------
// PAGINACIÓN (ORIGINAL)
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
// RENDER (ORIGINAL)
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
        
        // Mostrar descripción si existe
        const descripcionHTML = f.descripcion ? `<p class="factura-descripcion">Notas: ${f.descripcion.replace(/\n/g, '<br>')}</p>` : '';

        listaFacturas.innerHTML += `
        <div class="factura-box">
            <p><b>No.Factura:</b> ${f.numFactura}</p>
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
// ACCIONES GLOBALES (ORIGINAL)
// ----------------------------
window.marcarPagada = async (id) => {
    await updateDoc(doc(db, "facturas", id), { estado: "pagada" });
};

window.eliminarFactura = async (id) => {
    if (!confirm("¿Seguro que deseas eliminar la factura? Esta acción no se puede deshacer.")) return;
    await deleteDoc(doc(db, "facturas", id));
};

// ----------------------------
// EXPORTAR RESPETANDO FILTRO + BÚSQUEDA (ORIGINAL)
// ----------------------------
function datosExportacion() {
    return obtenerFiltradas(); 
}

btnJSON.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos para exportar.");

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `facturas_exportadas_${new Date().toISOString()}.json`;
    a.click();
};

btnExcel.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos para exportar.");
    
    const filasParaExportar = data.map(f => ({
        NumeroFactura: f.numFactura,
        MontoTotal: f.monto,
        Proveedor: f.proveedor,
        FechaEmision: f.fechaEmision,
        FechaPago: f.fechaPago,
        Estado: f.estado,
        Descripcion: f.descripcion || "", 
    }));

    const ws = XLSX.utils.json_to_sheet(filasParaExportar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
    XLSX.writeFile(wb, `facturas_exportadas_${new Date().toISOString()}.xlsx`);
};

btnPDF.onclick = () => {
    const data = datosExportacion();
    if (data.length === 0) return alert("No hay datos para exportar.");

    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF('landscape');

    docPDF.text(`Listado de Facturas (Filtrado)`, 14, 15);

    const tabla = data.map(f => [
        f.numFactura,
        formatoMoneda(f.monto), 
        f.proveedor,
        f.fechaEmision,
        f.fechaPago,
        f.estado.charAt(0).toUpperCase() + f.estado.slice(1),
        (f.descripcion || "").substring(0, 50) + '...', 
    ]);

    docPDF.autoTable({
        head: [["Número", "Monto", "Proveedor", "Emisión", "Límite Pago", "Estado", "Notas"]], 
        body: tabla,
        startY: 20,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 123, 255] }
    });

    docPDF.save(`facturas_exportadas_${new Date().toISOString()}.pdf`);
};

// ----------------------------
// MENU EXPORTAR (ORIGINAL)
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
// ACTUALIZAR LISTA CUANDO SE FILTRA O BUSCA (ORIGINAL)
// ----------------------------
buscador.oninput = () => {
    paginaActual = 1;
    renderFacturas();
};

filtroEstado.onchange = () => {
    paginaActual = 1;
    renderFacturas();
};