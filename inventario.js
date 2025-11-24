import { db } from "./firebase-config.js";
import { collection, getDocs, deleteDoc, doc, getDoc, updateDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONSTANTES GLOBALES PARA LA CONVERSIÓN DE FECHA DE EXCEL ---
const DIAS_OFFSET = 25569; 
const CORRECCION_BISI = 1; 
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// --- REFERENCIAS DEL DOM ---
const buscar = document.getElementById("buscar"), lista = document.getElementById("lista-inventario"), indicadorCarga = document.getElementById("loading-indicator"), btnNuevoProducto = document.getElementById("btn-nuevo-producto"), btnDescargarInventario = document.getElementById("btn-descargar-inventario");

// --- MODAL EDICIÓN/INGRESO ---
const modal = document.getElementById("modal-producto"), modalTitle = document.getElementById("modal-title"), formProducto = document.getElementById("form-producto"), productoIdInput = document.getElementById("producto-id"), nombreInput = document.getElementById("nombre"), nombreSugerencias = document.getElementById("nombre-sugerencias"), marcaInput = document.getElementById("marca"), ubicacionInput = document.getElementById("ubicacion"), precioPublicoInput = document.getElementById("precioPublico"), precioUnidadInput = document.getElementById("precioUnidad"), precioCapsulaInput = document.getElementById("precioCapsula"), precioTabletaInput = document.getElementById("precioTableta"), precioBlisterInput = document.getElementById("precioBlister"), precioCajaInput = document.getElementById("precioCaja"), stockInput = document.getElementById("stock"), tabletasPorBlisterInput = document.getElementById("tabletasPorBlister"), blistersPorCajaInput = document.getElementById("blistersPorCaja"), stockTabletaInput = document.getElementById("stockTableta"), stockBlisterInput = document.getElementById("stockBlister"), stockCajaInput = document.getElementById("stockCaja"), vencimientoInput = document.getElementById("vencimiento"), antibioticoInput = document.getElementById("antibiotico"), btnCancelarModal = document.getElementById("btn-cancelar-modal"), closeModalSpan = modal ? modal.querySelector(".close") : null, 
tipoProductoInput = document.getElementById("tipoProducto"); // <--- NUEVO INPUT DE TIPO DE PRODUCTO

// --- MODAL CARGA MASIVA ---
const modalMasiva = document.getElementById("modal-carga-masiva"), btnCargaMasiva = document.getElementById("btn-carga-masiva"), closeMasiva = document.getElementById("close-masiva"), btnCancelarMasiva = document.getElementById("btn-cancelar-masiva"), btnProcesarMasiva = document.getElementById("btn-procesar-masiva"), datosMasivosInput = document.getElementById("datos-masivos"), btnDescargarPlantilla = document.getElementById("btn-descargar-plantilla");

// --- MODAL LOTES ---
const modalLotes = document.getElementById("modal-lotes"), closeLotes = document.getElementById("close-lotes"), lotesTitle = document.getElementById("lotes-title"), lotesLista = document.getElementById("lotes-lista"), btnAgregarLote = document.getElementById("btn-agregar-lote"), btnCerrarLotes = document.getElementById("btn-cerrar-lotes");

// --- ALMACÉN DE DATOS EN MEMORIA ---
let inventarioAgrupadoGlobal = {}, inventarioBrutoGlobal = [], nombresProductosExistentes = new Set();

// ----------------- Helpers ------------------
function safeNumber(val) {const n = Number(val); return isNaN(n) ? 0 : n;}
function safeString(val) {return (val === undefined || val === null || val === '') ? '-' : String(val);}
function cerrarModal() {if (formProducto) formProducto.reset(); if (productoIdInput) productoIdInput.value = ""; if (modal) modal.style.display = "none"; if (nombreSugerencias) nombreSugerencias.innerHTML = ""; desactivarCamposPorTipo(false);}
function cerrarModalMasiva() {if (datosMasivosInput) datosMasivosInput.value = ""; if (modalMasiva) modalMasiva.style.display = "none";}
function cerrarModalLotes() {if (modalLotes) modalLotes.style.display = "none"; if (lotesLista) lotesLista.innerHTML = ""; if (lotesTitle) lotesTitle.dataset.nombreProducto = "";}

// 🔑 FUNCIÓN CLAVE: Lógica de Desagregación de Stock
const desagregarStock = (totalStock, tabletasPorBlister, blistersPorCaja) => {
    if (totalStock <= 0) return { stockCaja: 0, stockBlister: 0, stockTableta: 0 };
    const upb = tabletasPorBlister > 0 ? tabletasPorBlister : 1, bpc = blistersPorCaja > 0 ? blistersPorCaja : 1, unidadesPorCaja = upb * bpc;
    let stockCaja = 0, stockBlister = 0, restante = totalStock;
    if (unidadesPorCaja > 0) { stockCaja = Math.floor(restante / unidadesPorCaja); restante %= unidadesPorCaja; }
    if (upb > 0) { stockBlister = Math.floor(restante / upb); restante %= upb; }
    const stockTableta = restante;
    return { stockCaja, stockBlister, stockTableta };
};

// ------------------ LÓGICA DE CONVERSIÓN DE FECHA ------------------

/**
 * Convierte un número de serie de Excel, un string de fecha, o un Timestamp a un objeto Date o null.
 * @param {string|number|Object} fechaVencimiento - Valor del campo vencimiento de Firebase.
 * @returns {Date | null} Objeto Date si es válido, null si no.
 */
function convertirAFecha(fechaVencimiento) {
    if (!fechaVencimiento) return null;
    
    // 1. Caso Timestamp de Firebase (Ideal)
    if (fechaVencimiento.toDate) {
        return fechaVencimiento.toDate();
    } 
    
    let serialNumber;

    // 2. Intentar parsear como número de serie de Excel
    if (!isNaN(parseFloat(fechaVencimiento)) && isFinite(fechaVencimiento)) {
        serialNumber = parseFloat(fechaVencimiento);
    } else {
        // 3. Intentar parsear como string de fecha (ej: YYYY-MM-DD)
        const dateFromStr = new Date(fechaVencimiento);
        if (!isNaN(dateFromStr.getTime())) {
            return dateFromStr;
        }
        return null; // Fallo total
    }

    // LÓGICA DE CONVERSIÓN DE NÚMERO DE SERIE DE EXCEL
    if (serialNumber > 10000) { // Un número de serie de Excel válido será grande (ej: 46419)
        const diasDesdeEpoch = serialNumber - DIAS_OFFSET - CORRECCION_BISI; 
        const millisDesdeEpoch = diasDesdeEpoch * MILLIS_PER_DAY;
        const fecha = new Date(millisDesdeEpoch);
        // Ajustar a medio día para evitar problemas de zona horaria (UTC)
        fecha.setUTCHours(12, 0, 0, 0); 
        return fecha;
    }
    
    return null;
}

/**
 * Formatea un objeto Date a string DD/MM/AAAA o devuelve '-' si es nulo o inválido.
 * Esta es la versión para MOSTRAR al usuario.
 * @param {Date | null} dateObj - Objeto Date.
 * @returns {string} Fecha formateada (DD/MM/AAAA) o '-'.
 */
function formatearFecha(dateObj) {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        const year = dateObj.getFullYear();
        // getMonth() es base 0, por eso se suma 1
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${day}/${month}/${year}`; // DEVUELVE DD/MM/AAAA
    }
    return '-';
}

/**
 * Formatea un objeto Date a string YYYY-MM-DD o devuelve '' si es nulo o inválido.
 * Esta es la versión para USAR en <input type="date"> (el formato que espera HTML).
 * @param {Date | null} dateObj - Objeto Date.
 * @returns {string} Fecha formateada (YYYY-MM-DD) o ''.
 */
function formatearFechaParaInput(dateObj) {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        return dateObj.toISOString().split('T')[0]; // DEVUELVE YYYY-MM-DD
    }
    return '';
}

// ------------------ LISTENERS DE CONTROL DE FORMULARIO ------------------

// Campos que se desactivan al ser "Otro Producto"
const camposAFarmaceuticos = [
    tabletasPorBlisterInput, blistersPorCajaInput, 
    precioCapsulaInput, precioTabletaInput, precioBlisterInput, precioCajaInput, 
    stockTabletaInput, stockBlisterInput, stockCajaInput, 
    antibioticoInput 
];

function desactivarCamposPorTipo(esOtroProducto) {
    camposAFarmaceuticos.forEach(input => {
        if (input) {
            input.disabled = esOtroProducto;
            if (esOtroProducto) {
                // Limpiar valores si se desactiva
                if (input.type !== 'checkbox') input.value = '';
                else input.checked = false;
            }
        }
    });

    // Control del contenedor visual
    const contenedor = document.getElementById('contenedor-campos-farmaceuticos');
    if (contenedor) {
        if (esOtroProducto) contenedor.classList.add('desactivado-otro');
        else contenedor.classList.remove('desactivado-otro');
    }
}

// Listener para el cambio en el selector de Tipo de Producto
tipoProductoInput?.addEventListener('change', (e) => {
    const esOtroProducto = e.target.value === 'otro';
    desactivarCamposPorTipo(esOtroProducto);
    actualizarStocksCalculados(); // Forzar el cálculo (que ahora puede dar cero)
});

// ------------------ LISTENERS DE CÁLCULO EN TIEMPO REAL ------------------

const stockInputs = [stockInput, tabletasPorBlisterInput, blistersPorCajaInput];

function actualizarStocksCalculados() {
    const esOtroProducto = tipoProductoInput?.value === 'otro';
    const totalStock = safeNumber(stockInput.value);

    let desglose;
    if (esOtroProducto) {
        // Si es "Otro", todo el stock va a unidades sueltas
        desglose = { stockCaja: 0, stockBlister: 0, stockTableta: totalStock };
    } else {
        const tabletasPorBlister = safeNumber(tabletasPorBlisterInput.value);
        const blistersPorCaja = safeNumber(blistersPorCajaInput.value);
        desglose = desagregarStock(totalStock, tabletasPorBlister, blistersPorCaja);
    }
    
    // Actualizar los inputs de salida
    stockTabletaInput.value = desglose.stockTableta;
    stockBlisterInput.value = desglose.stockBlister;
    stockCajaInput.value = desglose.stockCaja;
}

stockInputs.forEach(input => {
    input?.addEventListener('input', actualizarStocksCalculados);
    input?.addEventListener('change', actualizarStocksCalculados);
});

// Listener para forzar el cálculo y estado al abrir el modal
modal?.addEventListener('transitionend', () => {
    if (modal.style.display === 'block') {
        // Re-evaluar estado al abrir el modal
        const esOtro = tipoProductoInput?.value === 'otro';
        desactivarCamposPorTipo(esOtro);
        actualizarStocksCalculados();
    }
});

// ------------------ ESCUCHADORES DE EVENTOS ------------------
// Cierre de modales
closeModalSpan?.addEventListener("click", cerrarModal);
btnCancelarModal?.addEventListener("click", cerrarModal);
closeMasiva?.addEventListener("click", cerrarModalMasiva);
btnCancelarMasiva?.addEventListener("click", cerrarModalMasiva);
closeLotes?.addEventListener("click", cerrarModalLotes);
btnCerrarLotes?.addEventListener("click", cerrarModalLotes);

// Abrir modales
btnNuevoProducto?.addEventListener("click", () => {
    modalTitle.textContent = "Ingresar Nuevo Producto/Lote"; 
    cerrarModal(); 
    if (modal) modal.style.display = "block"; 
    if (nombreInput) nombreInput.focus();
    if (tipoProductoInput) tipoProductoInput.value = 'farmaceutico'; // Valor por defecto
    desactivarCamposPorTipo(false); // Asegura que los campos estén activos por defecto
});
btnCargaMasiva?.addEventListener("click", () => {cerrarModal(); cerrarModalLotes(); if (modalMasiva) modalMasiva.style.display = "block";});

// Botón de descargar inventario (USA DD/MM/AAAA)
btnDescargarInventario?.addEventListener("click", () => {
    if (inventarioBrutoGlobal.length === 0) {alert("No hay datos de inventario para descargar."); return;}
    const headers = ["ID","Nombre","Marca","Ubicacion","PrecioPublico","PrecioUnidad","PrecioCapsula","PrecioTableta","PrecioBlister","PrecioCaja","Stock","TabletasPorBlister","BlistersPorCaja","StockTableta","StockBlister","StockCaja","Vencimiento","Antibiotico","EsOtroProducto","FechaCreacion"].join(',') + '\n';
    const csvRows = inventarioBrutoGlobal.map(item => {
        // Asegurar que la fecha de vencimiento se formatea correctamente en el CSV (DD/MM/AAAA)
        const fechaObjeto = convertirAFecha(item.vencimiento);
        const vencimientoCSV = formatearFecha(fechaObjeto); // <-- Usa formatearFecha (DD/MM/AAAA)

        const row = [
            item.id||'',item.nombre||'',item.marca||'',item.ubicacion||'',
            item.precioPublico!=null ? item.precioPublico.toFixed(2) : '', 
            item.precioUnidad!=null ? item.precioUnidad.toFixed(2) : '', 
            item.precioCapsula!=null ? item.precioCapsula.toFixed(2) : '', 
            item.precioTableta!=null ? item.precioTableta.toFixed(2) : '', 
            item.precioBlister!=null ? item.precioBlister.toFixed(2) : '', 
            item.precioCaja!=null ? item.precioCaja.toFixed(2) : '', 
            item.stock || 0, item.tabletasPorBlister || 0, item.blistersPorCaja || 0, 
            item.stockTableta || 0, item.stockBlister || 0, item.stockCaja || 0, 
            vencimientoCSV, // USAR FECHA FORMATEADA (DD/MM/AAAA)
            item.antibiotico ? 'true' : 'false', 
            item.esOtroProducto ? 'true' : 'false', // <--- NUEVA COLUMNA
            item.fechaCreacion || ''
        ];
        return row.map(field => `"${String(field).replace(/"/g,'""')}"`).join(',');
    }).join('\n');
    const csvContent = headers + csvRows;
    const filename = `inventario_completo_${new Date().toISOString().split('T')[0]}.csv`;
    const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
    if (navigator.msSaveBlob) navigator.msSaveBlob(blob, filename);
    else {
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    }
    alert("✅ El inventario completo se ha descargado correctamente.");
});

// Delegación de eventos en lista (botón Lotes)
lista?.addEventListener("click", (e) => {
    const botonLotes = e.target.closest(".btn-lotes");
    if (botonLotes) abrirModalLotes(botonLotes.dataset.nombre);
});
// Delegación en modalLotes (Editar/Eliminar)
modalLotes?.addEventListener("click", async (e) => {
    const loteId = e.target.dataset.id, nombreProducto = e.target.dataset.nombre;
    if (!loteId) return;
    if (e.target.classList.contains("btn-editar-lote")) await obtenerDatosProductoParaEdicion(loteId);
    if (e.target.classList.contains("btn-eliminar-lote")) await eliminarLote(loteId, nombreProducto);
});

// ------------------ SUGERENCIAS DE PRODUCTO ------------------
nombreInput?.addEventListener('input', () => {
    const inputTexto = nombreInput.value.trim().toUpperCase(); nombreSugerencias.innerHTML = '';
    if (inputTexto.length < 2) return;
    let encontrado = false; let sugerencias = [];
    nombresProductosExistentes.forEach(nombre => {
        if (nombre.includes(inputTexto)) {
            sugerencias.push(nombre);
            if (nombre === inputTexto) encontrado = true;
        }
    });
    sugerencias.sort().forEach(nombre => {
        const li = document.createElement('li');
        li.textContent = nombre;
        li.classList.add('producto-existente');
        li.onclick = () => { nombreInput.value = nombre; nombreSugerencias.innerHTML = ''; };
        nombreSugerencias.appendChild(li);
    });
    if (!encontrado && inputTexto.length > 0) {
        const li = document.createElement('li');
        li.textContent = `Crear producto: ${nombreInput.value.trim()}`;
        li.classList.add('producto-nuevo');
        li.onclick = () => { nombreInput.value = nombreInput.value.trim(); nombreSugerencias.innerHTML = ''; };
        nombreSugerencias.appendChild(li);
    }
});
nombreInput?.addEventListener('blur', () => {
    setTimeout(() => { if (nombreSugerencias) nombreSugerencias.innerHTML = ''; }, 200);
});

// ------------------ CRUD / FIRESTORE ------------------
async function obtenerDatosProductoParaEdicion(productoId) {
    try {
        const productoRef = doc(db, "inventario", productoId);
        const productoSnap = await getDoc(productoRef);
        if (productoSnap.exists()) {
            const datos = productoSnap.data();
            modalTitle.textContent = `Editar Lote: ${datos.nombre}`;
            productoIdInput.value = productoId;
            nombreInput.value = datos.nombre || '';
            marcaInput.value = datos.marca || '';
            ubicacionInput.value = datos.ubicacion || '';
            precioPublicoInput.value = datos.precioPublico ?? '';
            precioUnidadInput.value = datos.precioUnidad ?? '';
            precioCapsulaInput.value = datos.precioCapsula ?? '';
            precioTabletaInput.value = datos.precioTableta ?? '';
            precioBlisterInput.value = datos.precioBlister ?? '';
            precioCajaInput.value = datos.precioCaja ?? '';
            stockInput.value = datos.stock ?? '';
            stockTabletaInput.value = datos.stockTableta ?? '';
            stockBlisterInput.value = datos.stockBlister ?? '';
            stockCajaInput.value = datos.stockCaja ?? '';
            tabletasPorBlisterInput.value = datos.tabletasPorBlister ?? '';
            blistersPorCajaInput.value = datos.blistersPorCaja ?? '';
            
            // NUEVO: Aseguramos que el input type="date" obtenga el formato AAAA-MM-DD
            const fechaObjetoParaInput = convertirAFecha(datos.vencimiento);
            vencimientoInput.value = formatearFechaParaInput(fechaObjetoParaInput);

            antibioticoInput.checked = datos.antibiotico || false;

            // CARGAR VALOR DEL NUEVO CAMPO Y DESACTIVAR SI ES NECESARIO
            const esOtroProducto = datos.esOtroProducto === true;
            tipoProductoInput.value = esOtroProducto ? 'otro' : 'farmaceutico';
            desactivarCamposPorTipo(esOtroProducto); 
            // --------------------------------------------------------

            cerrarModalLotes();
            if (modal) modal.style.display = "block";
        } else alert("❌ Error: No se encontró el lote con el ID: " + productoId);
    } catch (error) {
        console.error("Error al obtener el documento para edición:", error);
        alert("❌ Ocurrió un error al cargar los datos de edición.");
    }
}


formProducto?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = productoIdInput.value;
    
    // NUEVA LÓGICA DE TIPO DE PRODUCTO
    const esOtroProducto = tipoProductoInput?.value === 'otro'; 
    
    // Resetear valores de formato si es otro producto
    const tabletasPorBlister = esOtroProducto ? 0 : safeNumber(tabletasPorBlisterInput.value); 
    const blistersPorCaja = esOtroProducto ? 0 : safeNumber(blistersPorCajaInput.value); 
    const stockMaestro = safeNumber(stockInput.value);
    
    // Calcular desglose
    const desglose = esOtroProducto ? { stockCaja: 0, stockBlister: 0, stockTableta: stockMaestro } : desagregarStock(stockMaestro, tabletasPorBlister, blistersPorCaja);
    
    const datosProducto = {
        nombre: nombreInput.value.trim(),
        marca: marcaInput.value.trim() || null,
        ubicacion: ubicacionInput.value.trim() || null,
        
        // Precios por formato se anulan si es otro producto
        precioPublico: precioPublicoInput.value !== '' ? parseFloat(precioPublicoInput.value) : null,
        precioUnidad: precioUnidadInput.value !== '' ? parseFloat(precioUnidadInput.value) : null,
        precioCapsula: !esOtroProducto && precioCapsulaInput.value !== '' ? parseFloat(precioCapsulaInput.value) : null,
        precioTableta: !esOtroProducto && precioTabletaInput.value !== '' ? parseFloat(precioTabletaInput.value) : null,
        precioBlister: !esOtroProducto && precioBlisterInput.value !== '' ? parseFloat(precioBlisterInput.value) : null,
        precioCaja: !esOtroProducto && precioCajaInput.value !== '' ? parseFloat(precioCajaInput.value) : null,
        
        tabletasPorBlister: tabletasPorBlister, 
        blistersPorCaja: blistersPorCaja,
        stock: stockMaestro,
        stockTableta: desglose.stockTableta,
        stockBlister: desglose.stockBlister,
        stockCaja: desglose.stockCaja,
        vencimiento: vencimientoInput.value.trim() || null, // Se guarda AAAA-MM-DD
        antibiotico: !esOtroProducto && !!antibioticoInput.checked, // Se anula si es otro producto
        esOtroProducto: esOtroProducto, // <--- NUEVO CAMPO
        fechaCreacion: new Date().toISOString().split('T')[0]
    };
    if (!datosProducto.nombre || datosProducto.stock < 0) {
        alert("El nombre y el stock total deben ser válidos.");
        return;
    }
    try {
        if (id) {
            const productoRef = doc(db, "inventario", id);
            await updateDoc(productoRef, datosProducto);
            alert(`✅ Lote de ${datosProducto.nombre} actualizado correctamente.`);
        } else {
            const inventarioRef = collection(db, "inventario");
            await addDoc(inventarioRef, datosProducto);
            alert(`✅ Nuevo Lote de ${datosProducto.nombre} agregado correctamente.`);
        }
        cerrarModal();
        cargarInventario();
    } catch (error) {
        console.error("Error al guardar el lote/producto:", error);
        alert(`❌ Error al guardar: ${error.message}`);
    }
});


async function eliminarLote(loteId, nombreLote) {
    if (!confirm(`¿Confirmas eliminar el LOTE de: ${nombreLote}? Esta acción es irreversible.`)) return;
    try {
        const productoRef = doc(db, "inventario", loteId);
        await deleteDoc(productoRef);
        alert(`✅ Lote eliminado correctamente de Firebase.`);
        cargarInventario();
        cerrarModalLotes();
    } catch (error) {
        console.error("Error al eliminar el documento:", error);
        alert("❌ Ocurrió un error al intentar eliminar el lote.");
    }
}

// ------------------ CARGA MASIVA (INCLUYE NUEVA COLUMNA) ------------------
btnDescargarPlantilla?.addEventListener("click", () => {
    const headers = "Nombre,Marca,Ubicacion,PrecioPublico,PrecioUnidad,PrecioCapsula,PrecioTableta,PrecioBlister,PrecioCaja,Stock,TabletasPorBlister,BlistersPorCaja,Vencimiento,Antibiotico(true/false),EsOtroProducto(true/false)\n";
    const exampleData = "SANTEMICINA SOBRE GRANULADO,SANTE,15,15.00,1.50,,,2.00,25,1000,10,2,2026-08-01,false,false\nPARACETAMOL 500MG,GENERICO,2B DER,2.00,0.50,,,,,500,10,5,2026-06-15,false,false\nSHAMPOO ANTICAIDA,GENERICO,ESTANTERIA,50.00,,,,,,,50,1,1,2028-01-01,false,true\n"; 
    const csvContent = headers + exampleData;
    const filename = "plantilla_carga_inventario.csv";
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    if (navigator.msSaveBlob) navigator.msSaveBlob(blob, filename);
    else {
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    }
    alert("✅ Plantilla descargada. Verifica tu carpeta de descargas.");
});


btnProcesarMasiva?.addEventListener("click", async () => {
    const datos = datosMasivosInput.value.trim();
    if (!datos) { alert("⚠️ Por favor, pega los datos CSV en el campo de texto."); return; }
    const lineas = datos.split('\n').filter(line => line.trim() !== '');
    const datosAProcesar = lineas.filter(line => !line.toLowerCase().includes('nombre,marca,ubicacion'));
    let guardados = 0, errores = 0;
    btnProcesarMasiva.disabled = true;
    for (const linea of datosAProcesar) {
        const campos = linea.split(',').map(c => c.trim());
        if (!campos[0] || isNaN(parseInt(campos[9] || '0'))) { errores++; continue; }
        try {
            const esOtroProducto = (campos[14] || 'false').toLowerCase() === 'true'; // <--- NUEVA LECTURA

            const stockMaestro = safeNumber(campos[9] || 0);
            const tabletasPorBlister = esOtroProducto ? 0 : safeNumber(campos[10] || 0);
            const blistersPorCaja = esOtroProducto ? 0 : safeNumber(campos[11] || 0);
            
            const desglose = esOtroProducto ? { stockCaja: 0, stockBlister: 0, stockTableta: stockMaestro } : desagregarStock(stockMaestro, tabletasPorBlister, blistersPorCaja);

            const producto = {
                nombre: campos[0],
                marca: campos[1] || null,
                ubicacion: campos[2] || null,
                
                // Anular precios por formato si es otro
                precioPublico: campos[3] ? parseFloat(campos[3]) : null,
                precioUnidad: campos[4] ? parseFloat(campos[4]) : null,
                precioCapsula: !esOtroProducto && campos[5] ? parseFloat(campos[5]) : null,
                precioTableta: !esOtroProducto && campos[6] ? parseFloat(campos[6]) : null,
                precioBlister: !esOtroProducto && campos[7] ? parseFloat(campos[7]) : null,
                precioCaja: !esOtroProducto && campos[8] ? parseFloat(campos[8]) : null,

                tabletasPorBlister,
                blistersPorCaja,
                stock: stockMaestro,
                stockTableta: desglose.stockTableta,
                stockBlister: desglose.stockBlister,
                stockCaja: desglose.stockCaja,
                vencimiento: campos[12] || null, // Se espera AAAA-MM-DD
                antibiotico: !esOtroProducto && (campos[13] || 'false').toLowerCase() === 'true', 
                esOtroProducto: esOtroProducto, 
                fechaCreacion: new Date().toISOString().split('T')[0],
            };
            const inventarioRef = collection(db, "inventario");
            await addDoc(inventarioRef, producto);
            guardados++;
        } catch (e) {
            console.error("Error al guardar masivo:", e);
            errores++;
        }
    }
    btnProcesarMasiva.disabled = false;
    alert(`Carga masiva finalizada. Guardados: ${guardados}. Errores: ${errores}.`);
    cerrarModalMasiva();
    cargarInventario();
});

// ------------------ LOTES DINÁMICOS ------------------
function abrirModalLotes(nombreProducto) {
    const lotesDeProducto = inventarioAgrupadoGlobal[nombreProducto.toUpperCase().trim()]?.lotes || [];
    if (lotesDeProducto.length === 0) {alert(`No se encontraron lotes para ${nombreProducto}.`); return;}
    if (lotesTitle) {lotesTitle.textContent = `Lotes de: ${nombreProducto}`; lotesTitle.dataset.nombreProducto = nombreProducto;}
    if (lotesLista) lotesLista.innerHTML = "";
    lotesDeProducto.forEach(lote => {
        // --- LÓGICA DE FECHA (usa las propiedades pre-calculadas al cargar) ---
        // 'lote.vencimientoFormateada' ahora es DD/MM/AAAA
        const fechaVencStr = lote.vencimientoFormateada || 'Indefinido';
        const estaVencido = lote.vencimientoFecha && lote.vencimientoFecha < new Date();
        const vencimientoHtml = estaVencido ? `<strong style="color: red;">VENCIDO: ${fechaVencStr}</strong>` : `Vencimiento: <strong>${fechaVencStr}</strong>`;
        // --- FIN LÓGICA DE FECHA ---
        
        const div = document.createElement("div");
        div.classList.add("lote-item");
        const antibioticoLabel = lote.antibiotico ? `<span style="color:#b85">⚠ Antibiótico</span>` : '';
        const stockFormatos = lote.esOtroProducto ? `Stock total en unidades: <strong>${lote.stock}</strong>` : 
            `${lote.stockTableta > 0 ? `| Unidades: <strong>${lote.stockTableta}</strong>` : ''} ${lote.stockBlister > 0 ? `| Blisters: <strong>${lote.stockBlister}</strong>` : ''} ${lote.stockCaja > 0 ? `| Cajas: <strong>${lote.stockCaja}</strong>` : ''}`;
        const tipoProductoLabel = lote.esOtroProducto ? `<span style="color: #007bff;">🛍 Otro Producto</span>` : ''; 
        
        div.innerHTML = `<div>Unidades Totales: <strong>${lote.stock}</strong> | ${vencimientoHtml} ${antibioticoLabel} ${tipoProductoLabel}<div style="margin-top: 5px; font-size: 0.9em;">Stock por formato: ${stockFormatos || 'N/A'}</div><div>Precio público: ${lote.precioPublico != null ? `Q ${Number(lote.precioPublico).toFixed(2)}` : '-'}</div><div>Marca: ${safeString(lote.marca)} | Ubicación: ${safeString(lote.ubicacion)}</div></div><div class="lote-actions"><button class="action-button btn-editar-lote" data-id="${lote.id}">✏️ Editar</button><button class="action-button btn-eliminar-lote" data-id="${lote.id}" data-nombre="${nombreProducto}">🗑️ Eliminar</button></div>`;
        if (lotesLista) lotesLista.appendChild(div);
    });
    if (modalLotes) modalLotes.style.display = "block";
}

btnAgregarLote?.addEventListener("click", () => {
    const nombreLoteActual = lotesTitle.dataset.nombreProducto;
    if (!nombreLoteActual) return;
    modalTitle.textContent = `Agregar Nuevo Lote a: ${nombreLoteActual}`;
    productoIdInput.value = "";
    nombreInput.value = nombreLoteActual;
    const datosAgrupados = inventarioAgrupadoGlobal[nombreLoteActual.toUpperCase().trim()];
    if (datosAgrupados) {
        // Copiar precios y formatos de la agrupación
        precioPublicoInput.value = datosAgrupados.precioPublico ?? '';
        precioUnidadInput.value = datosAgrupados.precioUnidad ?? '';
        precioCapsulaInput.value = datosAgrupados.precioCapsula ?? '';
        precioTabletaInput.value = datosAgrupados.precioTableta ?? '';
        precioBlisterInput.value = datosAgrupados.precioBlister ?? '';
        precioCajaInput.value = datosAgrupados.precioCaja ?? '';
        antibioticoInput.checked = datosAgrupados.antibiotico || false;
        tipoProductoInput.value = datosAgrupados.esOtroProducto ? 'otro' : 'farmaceutico'; // <-- CARGAR TIPO
        tabletasPorBlisterInput.value = datosAgrupados.lotes[0]?.tabletasPorBlister ?? '';
        blistersPorCajaInput.value = datosAgrupados.lotes[0]?.blistersPorCaja ?? '';
    }
    stockInput.value = stockTabletaInput.value = stockBlisterInput.value = stockCajaInput.value = '';
    
    // Llamar a desactivación al configurar el valor del tipo de producto
    const esOtro = tipoProductoInput?.value === 'otro';
    desactivarCamposPorTipo(esOtro);

    cerrarModalLotes();
    if (modal) modal.style.display = "block";
});

// ------------------ RENDER / AGRUPAR (INCLUYE NUEVO BADGE) ------------------
function crearTarjetaProducto(producto) {
    const li = document.createElement("li");
    li.classList.add("product-card");
    const stockTotal = producto.totalStock || 0;
    const totalStockPastilla = producto.totalStock || 0;
    const totalStockTableta = producto.totalStockTableta || 0;
    const totalStockBlister = producto.totalStockBlister || 0;
    const totalStockCaja = producto.totalStockCaja || 0;
    const precioUnidad = producto.precioUnidad ?? null;
    const precioCapsula = producto.precioCapsula ?? null;
    const precioTableta = producto.precioTableta ?? null;
    const precioBlister = producto.precioBlister ?? null;
    const precioCaja = producto.precioCaja ?? null;
    const precioVenta = producto.precioPublico != null ? `Q ${Number(producto.precioPublico).toFixed(2)}` : 'Q -';
    
    const requiereReceta = producto.antibiotico ? `<span class="alerta-receta-badge">💊 Antibiótico</span>` : '';
    // Badge con un estilo simple en línea para el ejemplo
    const esOtroProductoBadge = producto.esOtroProducto ? `<span class="otro-producto-badge" style="background-color: #007bff; color: white; padding: 3px 6px; border-radius: 4px; margin-left: 5px; font-size: 0.8em;">🛍 Otro Producto</span>` : ''; 

    const stockClase = stockTotal < 50 ? 'stock-bajo' : '';
    const stockStr = stockTotal > 0 ? `Stock Total: ${stockTotal} unidades` : 'AGOTADO';
    
    // Ordenar lotes usando el objeto Date para encontrar el vencimiento más próximo
    const loteMasProximo = producto.lotes.sort((a,b) => { 
        if (a.vencimientoFecha === null) return 1; 
        if (b.vencimientoFecha === null) return -1; 
        return a.vencimientoFecha.getTime() - b.vencimientoFecha.getTime(); 
    })[0];
    
    // Usar la fecha formateada que ya está en el objeto lote (DD/MM/AAAA)
    const vencimientoStr = loteMasProximo && loteMasProximo.vencimientoFormateada ? loteMasProximo.vencimientoFormateada : '-';
    
    const formatPrice = price => price != null ? `Q ${Number(price).toFixed(2)}` : 'N/A';
    const createStockBadge = (label, value, color) => value > 0 ? `<span class="stock-badge" style="background-color: ${color}; padding: 3px 6px; border-radius: 4px; font-size: 0.8em; margin-right: 5px; color: #333;">**${label}:** ${value}</span>` : '';
    
    const stockIndividualBadges = producto.esOtroProducto 
        ? createStockBadge("Unidades", totalStockPastilla, '#e0f7fa') 
        : `${createStockBadge("Unidades", totalStockPastilla, '#e0f7fa')}${createStockBadge("Tableta", totalStockTableta, '#fff3cd')}${createStockBadge("Blister", totalStockBlister, '#d1ecf1')}${createStockBadge("Cajas", totalStockCaja, '#e6ffed')}`;
    
    // El grid de precios muestra solo los precios relevantes si es farmacéutico
    const precioFormatosHTML = producto.esOtroProducto ? '' : `<span>P. Cápsula: ${formatPrice(precioCapsula)}</span><span>P. Tableta: ${formatPrice(precioTableta)}</span><span>P. Blister: ${formatPrice(precioBlister)}</span><span>P. Caja: ${formatPrice(precioCaja)}</span>`;

    li.innerHTML = `<div class="product-header"><span class="product-name">${safeString(producto.nombre)}</span>${requiereReceta}${esOtroProductoBadge}</div><div class="product-details"><div class="detail-item"><strong>Marca:</strong> ${safeString(producto.marca)}</div><div class="detail-item"><strong>Ubicación:</strong> ${safeString(producto.ubicacion)}</div><div class="detail-item"><strong class="vence-fecha">Vence:</strong> ${vencimientoStr}</div><div class="price-section"><div class="detail-item">P. Público (Ref.): **${precioVenta}**</div><div class="price-format-grid"><span>P. Unidad: ${formatPrice(precioUnidad)}</span>${precioFormatosHTML}</div></div></div><div class="stock-individual-badges">${stockIndividualBadges}</div><div class="stock-info ${stockClase}"><i class="fas fa-boxes"></i> **${stockStr}**</div><div class="product-actions-footer"><button class="button-action btn-lotes" data-nombre="${producto.nombre.toUpperCase().trim()}" style="background-color: #3b82f6; color: white;"><i class="fas fa-clipboard-list"></i> Ver Lotes (${producto.lotes.length})</button></div>`;
    return li;
}

async function cargarInventario() {
    const inventarioRef = collection(db, "inventario");
    if (indicadorCarga) indicadorCarga.style.display = 'block';
    if (lista) { lista.style.display = 'none'; lista.innerHTML = ""; }
    try {
        const querySnapshot = await getDocs(inventarioRef);
        inventarioAgrupadoGlobal = {};
        inventarioBrutoGlobal = [];
        nombresProductosExistentes = new Set();
        if (querySnapshot.empty) {
            if(lista) lista.innerHTML = "<p>No hay productos registrados en el inventario.</p>";
            if(indicadorCarga) indicadorCarga.style.display = 'none';
            if(lista) lista.style.display = 'grid';
            return;
        }
        querySnapshot.forEach((docItem) => {
            const data = docItem.data();
            data.id = docItem.id;
            
            // 1. CONVERSIÓN DE FECHA
            const fechaObjeto = convertirAFecha(data.vencimiento);
            data.vencimientoFecha = fechaObjeto; // Guardar el objeto Date para ordenamiento
            data.vencimientoFormateada = formatearFecha(fechaObjeto); // Guardar la string formateada (DD/MM/AAAA)

            inventarioBrutoGlobal.push(data);
            const nombreClave = (data.nombre || '').toUpperCase().trim();
            if (nombreClave) nombresProductosExistentes.add(nombreClave);
            
            // 2. CREACIÓN DE OBJETO LOTE (incluye las nuevas propiedades de fecha)
            const loteData = {
                id: docItem.id,
                vencimiento: data.vencimiento || null, // Se mantiene el valor original para referencia
                vencimientoFecha: data.vencimientoFecha, // <-- Objeto Date
                vencimientoFormateada: data.vencimientoFormateada, // <-- String DD/MM/AAAA
                stock: Number(data.stock) || 0,
                tabletasPorBlister: Number(data.tabletasPorBlister) || 1,
                blistersPorCaja: Number(data.blistersPorCaja) || 1,
                stockTableta: Number(data.stockTableta) || 0,
                stockBlister: Number(data.stockBlister) || 0,
                stockCaja: Number(data.stockCaja) || 0,
                precioPublico: data.precioPublico ?? null,
                precioUnidad: data.precioUnidad ?? null,
                precioCapsula: data.precioCapsula ?? null,
                precioTableta: data.precioTableta ?? null,
                precioBlister: data.precioBlister ?? null,
                precioCaja: data.precioCaja ?? null,
                sku: data.sku || null,
                antibiotico: !!data.antibiotico,
                esOtroProducto: !!data.esOtroProducto, // <--- CAMPO EN LOTE
                marca: data.marca ?? null,
                ubicacion: data.ubicacion ?? null,
            };

            // 3. AGRUPACIÓN
            if (!inventarioAgrupadoGlobal[nombreClave]) {
                inventarioAgrupadoGlobal[nombreClave] = {
                    nombre: data.nombre,
                    marca: data.marca ?? null,
                    ubicacion: data.ubicacion ?? null,
                    antibiotico: !!data.antibiotico,
                    esOtroProducto: !!data.esOtroProducto, // <--- CAMPO EN AGRUPADO
                    totalStock: Number(data.stock) || 0,
                    lotes: [loteData],
                    totalStockTableta: loteData.stockTableta,
                    totalStockBlister: loteData.stockBlister,
                    totalStockCaja: loteData.stockCaja,
                    precioPublico: loteData.precioPublico,
                    precioUnidad: loteData.precioUnidad,
                    precioCapsula: loteData.precioCapsula,
                    precioTableta: loteData.precioTableta,
                    precioBlister: loteData.precioBlister,
                    precioCaja: loteData.precioCaja,
                };
            } else {
                inventarioAgrupadoGlobal[nombreClave].totalStock += loteData.stock;
                inventarioAgrupadoGlobal[nombreClave].totalStockTableta += loteData.stockTableta;
                inventarioAgrupadoGlobal[nombreClave].totalStockBlister += loteData.stockBlister;
                inventarioAgrupadoGlobal[nombreClave].totalStockCaja += loteData.stockCaja;
                inventarioAgrupadoGlobal[nombreClave].lotes.push(loteData);
                inventarioAgrupadoGlobal[nombreClave].antibiotico = inventarioAgrupadoGlobal[nombreClave].antibiotico || loteData.antibiotico;
                inventarioAgrupadoGlobal[nombreClave].esOtroProducto = inventarioAgrupadoGlobal[nombreClave].esOtroProducto || loteData.esOtroProducto; // <--- AGREGACIÓN LÓGICA
            }
        });
        for (const key in inventarioAgrupadoGlobal) {
            const producto = inventarioAgrupadoGlobal[key];
            const li = crearTarjetaProducto(producto);
            if (lista) lista.appendChild(li);
        }
    } catch (error) {
        console.error("Error al cargar el inventario:", error);
        if (lista) lista.innerHTML = "<p>Error al cargar los datos del inventario.</p>";
    } finally {
        if (indicadorCarga) indicadorCarga.style.display = 'none';
        if (lista) lista.style.display = 'grid';
    }
}

// Búsqueda en tiempo real
buscar?.addEventListener("keyup", () => {
    const texto = buscar.value.toLowerCase().trim();
    if (lista) lista.innerHTML = "";
    let resultadosEncontrados = false;
    for (const key in inventarioAgrupadoGlobal) {
        const producto = inventarioAgrupadoGlobal[key];
        if ((producto.nombre && producto.nombre.toLowerCase().includes(texto)) || (producto.marca && producto.marca.toLowerCase().includes(texto)) || (producto.ubicacion && producto.ubicacion.toLowerCase().includes(texto))) {
            const li = crearTarjetaProducto(producto);
            if (lista) lista.appendChild(li);
            resultadosEncontrados = true;
        }
    }
    if (!resultadosEncontrados && lista) lista.innerHTML = "<p>No hay productos que coincidan con la búsqueda.</p>";
});

document.addEventListener("DOMContentLoaded", cargarInventario);