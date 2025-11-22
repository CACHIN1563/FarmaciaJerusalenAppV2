import { db } from "./firebase-config.js";
import { collection, getDocs, deleteDoc, doc, getDoc, updateDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- REFERENCIAS DEL DOM ---
const buscar = document.getElementById("buscar");
const lista = document.getElementById("lista-inventario");
const indicadorCarga = document.getElementById("loading-indicator");
const btnNuevoProducto = document.getElementById("btn-nuevo-producto");
const btnDescargarInventario = document.getElementById("btn-descargar-inventario");

// --- MODAL EDICIÓN/INGRESO ---
const modal = document.getElementById("modal-producto");
const modalTitle = document.getElementById("modal-title");
const formProducto = document.getElementById("form-producto");
const productoIdInput = document.getElementById("producto-id");
const nombreInput = document.getElementById("nombre");
const nombreSugerencias = document.getElementById("nombre-sugerencias");
const marcaInput = document.getElementById("marca");
const ubicacionInput = document.getElementById("ubicacion");
const precioPublicoInput = document.getElementById("precioPublico");
const precioUnidadInput = document.getElementById("precioUnidad");
const precioCapsulaInput = document.getElementById("precioCapsula");
const precioTabletaInput = document.getElementById("precioTableta");
const precioBlisterInput = document.getElementById("precioBlister");
const precioCajaInput = document.getElementById("precioCaja");
const stockInput = document.getElementById("stock");
// NUEVOS CAMPOS DE STOCK POR FORMATO
const stockTabletaInput = document.getElementById("stockTableta");
const stockBlisterInput = document.getElementById("stockBlister");
const stockCajaInput = document.getElementById("stockCaja");

const vencimientoInput = document.getElementById("vencimiento");
const antibioticoInput = document.getElementById("antibiotico");
const btnCancelarModal = document.getElementById("btn-cancelar-modal");
const closeModalSpan = modal ? modal.querySelector(".close") : null;

// --- MODAL CARGA MASIVA ---
const modalMasiva = document.getElementById("modal-carga-masiva");
const btnCargaMasiva = document.getElementById("btn-carga-masiva");
const closeMasiva = document.getElementById("close-masiva");
const btnCancelarMasiva = document.getElementById("btn-cancelar-masiva");
const btnProcesarMasiva = document.getElementById("btn-procesar-masiva");
const datosMasivosInput = document.getElementById("datos-masivos");
const btnDescargarPlantilla = document.getElementById("btn-descargar-plantilla");

// --- MODAL LOTES ---
const modalLotes = document.getElementById("modal-lotes");
const closeLotes = document.getElementById("close-lotes");
const lotesTitle = document.getElementById("lotes-title");
const lotesLista = document.getElementById("lotes-lista");
const btnAgregarLote = document.getElementById("btn-agregar-lote");
const btnCerrarLotes = document.getElementById("btn-cerrar-lotes");

// --- ALMACÉN DE DATOS EN MEMORIA ---
let inventarioAgrupadoGlobal = {};
let inventarioBrutoGlobal = [];
let nombresProductosExistentes = new Set(); 

// ------------------ Helpers ------------------

function safeNumber(val) {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
}

function safeString(val) {
    return (val === undefined || val === null || val === '') ? '-' : String(val);
}

function cerrarModal() {
    if (formProducto) formProducto.reset();
    if (productoIdInput) productoIdInput.value = "";
    if (modal) modal.style.display = "none";
    if (nombreSugerencias) nombreSugerencias.innerHTML = "";
}

function cerrarModalMasiva() {
    if (datosMasivosInput) datosMasivosInput.value = "";
    if (modalMasiva) modalMasiva.style.display = "none";
}

function cerrarModalLotes() {
    if (modalLotes) modalLotes.style.display = "none";
    if (lotesLista) lotesLista.innerHTML = "";
    if (lotesTitle) lotesTitle.dataset.nombreProducto = "";
}

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
});

btnCargaMasiva?.addEventListener("click", () => {
    cerrarModal();
    cerrarModalLotes();
    if (modalMasiva) modalMasiva.style.display = "block";
});

// Botón de descargar inventario
btnDescargarInventario?.addEventListener("click", () => {
    if (inventarioBrutoGlobal.length === 0) {
        alert("No hay datos de inventario para descargar.");
        return;
    }

    // 1. Definir encabezados (Añadiendo los nuevos campos de stock por formato)
    const headers = [
        "ID", "Nombre", "Marca", "Ubicacion", "PrecioPublico", "PrecioUnidad", 
        "PrecioCapsula", "PrecioTableta", "PrecioBlister", "PrecioCaja", 
        "Stock", "StockTableta", "StockBlister", "StockCaja",
        "Vencimiento", "Antibiotico", "FechaCreacion"
    ].join(',') + '\n';

    // 2. Generar filas de datos
    const csvRows = inventarioBrutoGlobal.map(item => {
        const row = [
            item.id || '',
            item.nombre || '',
            item.marca || '',
            item.ubicacion || '',
            item.precioPublico !== null && item.precioPublico !== undefined ? item.precioPublico.toFixed(2) : '',
            item.precioUnidad !== null && item.precioUnidad !== undefined ? item.precioUnidad.toFixed(2) : '',
            item.precioCapsula !== null && item.precioCapsula !== undefined ? item.precioCapsula.toFixed(2) : '',
            item.precioTableta !== null && item.precioTableta !== undefined ? item.precioTableta.toFixed(2) : '',
            item.precioBlister !== null && item.precioBlister !== undefined ? item.precioBlister.toFixed(2) : '',
            item.precioCaja !== null && item.precioCaja !== undefined ? item.precioCaja.toFixed(2) : '',
            item.stock || 0,
            item.stockTableta || 0, // Nuevo
            item.stockBlister || 0, // Nuevo
            item.stockCaja || 0,     // Nuevo
            item.vencimiento || '',
            item.antibiotico ? 'true' : 'false',
            item.fechaCreacion || ''
        ];
        // Envolver campos con comas en comillas dobles (para CSV)
        return row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    }).join('\n');

    const csvContent = headers + csvRows;
    const filename = `inventario_completo_${new Date().toISOString().split('T')[0]}.csv`;

    // 3. Crear y descargar el Blob
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
    } else {
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

// Delegación de eventos en el contenedor de la lista (para botón Lotes)
lista?.addEventListener("click", (e) => {
    const botonLotes = e.target.closest(".btn-lotes");
    
    if (botonLotes) {
        const nombreProducto = botonLotes.dataset.nombre;
        abrirModalLotes(nombreProducto);
    } 
});

// Delegación eventos en modalLotes (Editar/Eliminar)
modalLotes?.addEventListener("click", async (e) => {
    const loteId = e.target.dataset.id;
    const nombreProducto = e.target.dataset.nombre;
    if (!loteId) return;
    if (e.target.classList.contains("btn-editar-lote")) {
        await obtenerDatosProductoParaEdicion(loteId);
    }
    if (e.target.classList.contains("btn-eliminar-lote")) {
        await eliminarLote(loteId, nombreProducto);
    }
});

// ------------------ SUGERENCIAS DE PRODUCTO ------------------

nombreInput?.addEventListener('input', () => {
    const inputTexto = nombreInput.value.trim().toUpperCase();
    nombreSugerencias.innerHTML = ''; 

    if (inputTexto.length < 2) return;

    let encontrado = false;
    let sugerencias = [];

    // Buscar coincidencias parciales
    nombresProductosExistentes.forEach(nombre => {
        if (nombre.includes(inputTexto)) {
            sugerencias.push(nombre);
            if (nombre === inputTexto) encontrado = true;
        }
    });

    // Mostrar sugerencias
    sugerencias.sort().forEach(nombre => {
        const li = document.createElement('li');
        li.textContent = nombre;
        li.classList.add('producto-existente');
        li.onclick = () => {
            nombreInput.value = nombre;
            nombreSugerencias.innerHTML = '';
        };
        nombreSugerencias.appendChild(li);
    });

    // Mostrar "Producto Nuevo" si no se encontró coincidencia exacta y hay texto
    if (!encontrado && inputTexto.length > 0) {
        const li = document.createElement('li');
        li.textContent = `Crear producto: ${nombreInput.value.trim()}`;
        li.classList.add('producto-nuevo');
        li.onclick = () => {
             nombreInput.value = nombreInput.value.trim();
             nombreSugerencias.innerHTML = '';
        };
        nombreSugerencias.appendChild(li);
    }
});

nombreInput?.addEventListener('blur', () => {
    // Retrasar el cierre para permitir el click en la sugerencia
    setTimeout(() => {
        if (nombreSugerencias) nombreSugerencias.innerHTML = '';
    }, 200);
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
            // Cargar stocks por formato (Nuevo)
            stockTabletaInput.value = datos.stockTableta ?? '';
            stockBlisterInput.value = datos.stockBlister ?? '';
            stockCajaInput.value = datos.stockCaja ?? '';

            vencimientoInput.value = datos.vencimiento || '';
            antibioticoInput.checked = datos.antibiotico || false;
            cerrarModalLotes();
            if (modal) modal.style.display = "block";
        } else {
            alert("❌ Error: No se encontró el lote con el ID: " + productoId);
        }
    } catch (error) {
        console.error("Error al obtener el documento para edición:", error);
        alert("❌ Ocurrió un error al cargar los datos de edición.");
    }
}

formProducto?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = productoIdInput.value;
    const datosProducto = {
        nombre: nombreInput.value.trim(),
        marca: marcaInput.value.trim() || null,
        ubicacion: ubicacionInput.value.trim() || null,
        // Precios
        precioPublico: precioPublicoInput.value !== '' ? parseFloat(precioPublicoInput.value) : null,
        precioUnidad: precioUnidadInput.value !== '' ? parseFloat(precioUnidadInput.value) : null,
        precioCapsula: precioCapsulaInput.value !== '' ? parseFloat(precioCapsulaInput.value) : null,
        precioTableta: precioTabletaInput.value !== '' ? parseFloat(precioTabletaInput.value) : null,
        precioBlister: precioBlisterInput.value !== '' ? parseFloat(precioBlisterInput.value) : null,
        precioCaja: precioCajaInput.value !== '' ? parseFloat(precioCajaInput.value) : null,
        // Stocks
        stock: safeNumber(stockInput.value),
        stockTableta: safeNumber(stockTabletaInput.value), // Nuevo
        stockBlister: safeNumber(stockBlisterInput.value), // Nuevo
        stockCaja: safeNumber(stockCajaInput.value),       // Nuevo

        vencimiento: vencimientoInput.value.trim() || null,
        antibiotico: !!antibioticoInput.checked,
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

// ------------------ CARGA MASIVA ------------------

btnDescargarPlantilla?.addEventListener("click", () => {
    // Definición de las cabeceras (Añadiendo stocks por formato)
    const headers = "Nombre,Marca,Ubicacion,PrecioPublico,PrecioUnidad,PrecioCapsula,PrecioTableta,PrecioBlister,PrecioCaja,Stock,StockTableta,StockBlister,StockCaja,Vencimiento,Antibiotico(true/false)\n";
    
    // Ejemplo de datos
    const exampleData = 
        "SANTEMICINA SOBRE GRANULADO,SANTE,15,15.00,1.50,,,2.00,25,1000,0,0,0,2026-08-01,false\n" +
        "PARACETAMOL 500MG,GENERICO,2B DER,2.00,0.50,,,,,500,0,10,5,2026-06-15,false\n";

    const csvContent = headers + exampleData;
    const filename = "plantilla_carga_inventario.csv";

    // SOLUCIÓN ROBUSTA PARA DESCARGA
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
    } else {
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
    if (!datos) {
        alert("⚠️ Por favor, pega los datos CSV en el campo de texto.");
        return;
    }

    const lineas = datos.split('\n').filter(line => line.trim() !== '');
    // Ignorar la primera línea si parece un encabezado
    const datosAProcesar = lineas.filter(line => !line.toLowerCase().includes('nombre,marca,ubicacion'));

    let guardados = 0, errores = 0;
    
    // Deshabilitar botón para evitar envíos dobles
    btnProcesarMasiva.disabled = true;

    for (const linea of datosAProcesar) {
        const campos = linea.split(',').map(c => c.trim());
        
        // Se espera el orden: [0]Nombre, ..., [9]Stock, [10]StockTableta, [11]StockBlister, [12]StockCaja, [13]Vencimiento, [14]Antibiotico
        if (!campos[0] || isNaN(parseInt(campos[9] || '0'))) { 
            console.warn("Fila ignorada por datos inválidos:", linea);
            errores++; 
            continue; 
        }

        try {
            const producto = {
                nombre: campos[0],
                marca: campos[1] || null,
                ubicacion: campos[2] || null,
                precioPublico: campos[3] ? parseFloat(campos[3]) : null,
                precioUnidad: campos[4] ? parseFloat(campos[4]) : null,
                precioCapsula: campos[5] ? parseFloat(campos[5]) : null,
                precioTableta: campos[6] ? parseFloat(campos[6]) : null,
                precioBlister: campos[7] ? parseFloat(campos[7]) : null,
                precioCaja: campos[8] ? parseFloat(campos[8]) : null,
                stock: safeNumber(campos[9] || 0),
                stockTableta: safeNumber(campos[10] || 0), // Nuevo
                stockBlister: safeNumber(campos[11] || 0), // Nuevo
                stockCaja: safeNumber(campos[12] || 0),    // Nuevo
                vencimiento: campos[13] || null,
                antibiotico: (campos[14] || 'false').toLowerCase() === 'true',
                fechaCreacion: new Date().toISOString().split('T')[0]
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
    if (lotesDeProducto.length === 0) {
        alert(`No se encontraron lotes para ${nombreProducto}.`);
        return;
    }

    if (lotesTitle) lotesTitle.textContent = `Lotes de: ${nombreProducto}`;
    if (lotesTitle) lotesTitle.dataset.nombreProducto = nombreProducto;
    if (lotesLista) lotesLista.innerHTML = "";

    lotesDeProducto.forEach(lote => {
        const div = document.createElement("div");
        div.classList.add("lote-item");

        const fechaVenc = lote.vencimiento || 'Indefinido';
        const vencimientoHtml = lote.vencimiento && new Date(lote.vencimiento) < new Date()
            ? `<strong style="color: red;">VENCIDO: ${fechaVenc}</strong>`
            : `Vencimiento: <strong>${fechaVenc}</strong>`;

        const antibioticoLabel = lote.antibiotico ? `<span style="color:#b85">⚠ Antibiótico</span>` : '';
        
        // Stocks por formato en el lote (Nuevo)
        const stockFormatos = `
            ${lote.stockTableta > 0 ? `| Tiras: <strong>${lote.stockTableta}</strong>` : ''}
            ${lote.stockBlister > 0 ? `| Blisters: <strong>${lote.stockBlister}</strong>` : ''}
            ${lote.stockCaja > 0 ? `| Cajas: <strong>${lote.stockCaja}</strong>` : ''}
        `;

        div.innerHTML = `
            <div>
                Unidades Totales: <strong>${lote.stock}</strong> | ${vencimientoHtml} ${antibioticoLabel}
                <div style="margin-top: 5px; font-size: 0.9em;">Stock por formato: ${stockFormatos || 'N/A'}</div>
                <div>Precio público: ${lote.precioPublico !== null && lote.precioPublico !== undefined ? `Q ${Number(lote.precioPublico).toFixed(2)}` : '-' }</div>
                <div>Marca: ${safeString(lote.marca)} | Ubicación: ${safeString(lote.ubicacion)}</div>
            </div>
            <div class="lote-actions">
                <button class="action-button btn-editar-lote" data-id="${lote.id}">✏️ Editar</button>
                <button class="action-button btn-eliminar-lote" data-id="${lote.id}" data-nombre="${nombreProducto}">🗑️ Eliminar</button>
            </div>
        `;
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
        // Copiar precios de referencia
        precioPublicoInput.value = datosAgrupados.precioPublico ?? '';
        precioUnidadInput.value = datosAgrupados.precioUnidad ?? '';
        precioCapsulaInput.value = datosAgrupados.precioCapsula ?? '';
        precioTabletaInput.value = datosAgrupados.precioTableta ?? '';
        precioBlisterInput.value = datosAgrupados.precioBlister ?? '';
        precioCajaInput.value = datosAgrupados.precioCaja ?? '';
        antibioticoInput.checked = datosAgrupados.antibiotico || false;
    }

    // Resetear stocks para el nuevo lote
    stockInput.value = '';
    stockTabletaInput.value = '';
    stockBlisterInput.value = '';
    stockCajaInput.value = '';


    cerrarModalLotes();
    if (modal) modal.style.display = "block";
});


// ------------------ RENDER / AGRUPAR (MODIFICADO) ------------------

function crearTarjetaProducto(producto) {
    const li = document.createElement("li");
    li.classList.add("product-card");

    const stockTotal = producto.totalStock || 0;
    
    // --- NUEVAS VARIABLES DE STOCKS Y PRECIOS POR FORMATO AGRUPADO ---
    // Usaremos el stock total como la suma de unidades/pastillas
    const totalStockPastilla = producto.totalStock || 0; 
    const totalStockTableta = producto.totalStockTableta || 0; 
    const totalStockBlister = producto.totalStockBlister || 0;
    const totalStockCaja = producto.totalStockCaja || 0;
    
    const precioUnidad = producto.precioUnidad ?? null;
    const precioCapsula = producto.precioCapsula ?? null;
    const precioTableta = producto.precioTableta ?? null;
    const precioBlister = producto.precioBlister ?? null;
    const precioCaja = producto.precioCaja ?? null;
    // ------------------------------------------------------------------

    const precioVenta = producto.precioPublico !== undefined && producto.precioPublico !== null
        ? `Q ${Number(producto.precioPublico).toFixed(2)}`
        : 'Q -';
    const requiereReceta = producto.antibiotico ? `<span class="alerta-receta-badge">Antibiótico</span>` : '';
    const stockClase = stockTotal < 50 ? 'stock-bajo' : ''; 
    const stockStr = stockTotal > 0 ? `Stock Total: ${stockTotal} unidades` : 'AGOTADO';

    const loteMasProximo = producto.lotes.sort((a, b) => {
        if (a.vencimiento === null) return 1;
        if (b.vencimiento === null) return -1;
        return new Date(a.vencimiento) - new Date(b.vencimiento);
    })[0];
    const vencimientoStr = loteMasProximo && loteMasProximo.vencimiento ? loteMasProximo.vencimiento : '-';
    
    // Función helper para formatear precios
    const formatPrice = (price) => price !== null && price !== undefined ? `Q ${Number(price).toFixed(2)}` : 'N/A';

    // Función helper para generar badges de stock
    const createStockBadge = (label, value, color) => {
        if (value > 0) {
            // Usar un estilo CSS en línea simple para el badge (debería estar en styles.css)
            return `<span class="stock-badge" style="background-color: ${color}; padding: 3px 6px; border-radius: 4px; font-size: 0.8em; margin-right: 5px; color: #333;">**${label}:** ${value}</span>`;
        }
        return '';
    }

    li.innerHTML = `
        <div class="product-header">
            <span class="product-name">${safeString(producto.nombre)}</span>
            ${requiereReceta}
        </div>
        <div class="product-details">
            <div class="detail-item"><strong>Marca:</strong> ${safeString(producto.marca)}</div>
            <div class="detail-item"><strong>Ubicación:</strong> ${safeString(producto.ubicacion)}</div>
            <div class="detail-item"><strong class="vence-fecha">Vence:</strong> ${vencimientoStr}</div>
            
            <div class="price-section">
                <div class="detail-item">P. Público (Ref.): **${precioVenta}**</div>
                <div class="price-format-grid">
                    <span>P. Unidad: ${formatPrice(precioUnidad)}</span>
                    <span>P. Cápsula: ${formatPrice(precioCapsula)}</span>
                    <span>P. Tableta: ${formatPrice(precioTableta)}</span>
                    <span>P. Blister: ${formatPrice(precioBlister)}</span>
                    <span>P. Caja: ${formatPrice(precioCaja)}</span>
                </div>
            </div>
        </div>

        <div class="stock-individual-badges">
            ${createStockBadge("Unidades", totalStockPastilla, '#e0f7fa')} 
            ${createStockBadge("Tableta", totalStockTableta, '#fff3cd')}
            ${createStockBadge("Blister", totalStockBlister, '#d1ecf1')}
            ${createStockBadge("Cajas", totalStockCaja, '#e6ffed')}
        </div>

        <div class="stock-info ${stockClase}">
            <i class="fas fa-boxes"></i> **${stockStr}**
        </div>
        <div class="product-actions-footer">
            <button class="button-action btn-lotes" data-nombre="${producto.nombre.toUpperCase().trim()}" style="background-color: #3b82f6; color: white;"><i class="fas fa-clipboard-list"></i> Ver Lotes (${producto.lotes.length})</button>
        </div>
    `;
    return li;
}


async function cargarInventario() {
    const inventarioRef = collection(db, "inventario");
    
    if (indicadorCarga) indicadorCarga.style.display = 'block';
    if (lista) lista.style.display = 'none';
    if (lista) lista.innerHTML = ""; 

    try {
        const querySnapshot = await getDocs(inventarioRef);
        inventarioAgrupadoGlobal = {};
        inventarioBrutoGlobal = [];
        nombresProductosExistentes = new Set(); 

        if (querySnapshot.empty) {
            if (lista) lista.innerHTML = "<p>No hay productos registrados en el inventario.</p>";
            if (indicadorCarga) indicadorCarga.style.display = 'none';
            if (lista) lista.style.display = 'grid'; 
            return;
        }

        querySnapshot.forEach((docItem) => {
            const data = docItem.data();
            data.id = docItem.id;
            inventarioBrutoGlobal.push(data);

            const nombreClave = (data.nombre || '').toUpperCase().trim();
            if (nombreClave) {
                nombresProductosExistentes.add(nombreClave); 
            }

            // Datos específicos del lote (stock por formato y precios por formato)
            const loteData = {
                id: docItem.id,
                vencimiento: data.vencimiento || null,
                stock: Number(data.stock) || 0,
                // Stock por formato (añadido)
                stockTableta: Number(data.stockTableta) || 0,
                stockBlister: Number(data.stockBlister) || 0,
                stockCaja: Number(data.stockCaja) || 0,
                // Precios por formato (añadido)
                precioPublico: data.precioPublico ?? null,
                precioUnidad: data.precioUnidad ?? null,
                precioCapsula: data.precioCapsula ?? null,
                precioTableta: data.precioTableta ?? null,
                precioBlister: data.precioBlister ?? null,
                precioCaja: data.precioCaja ?? null,
                sku: data.sku || null, 
                antibiotico: !!data.antibiotico,
                marca: data.marca ?? null,
                ubicacion: data.ubicacion ?? null,
            };

            if (!inventarioAgrupadoGlobal[nombreClave]) {
                inventarioAgrupadoGlobal[nombreClave] = {
                    nombre: data.nombre,
                    marca: data.marca ?? null,
                    ubicacion: data.ubicacion ?? null,
                    antibiotico: !!data.antibiotico,
                    totalStock: Number(data.stock) || 0,
                    lotes: [loteData],
                    // Inicializar stocks totales por formato
                    totalStockTableta: loteData.stockTableta,
                    totalStockBlister: loteData.stockBlister,
                    totalStockCaja: loteData.stockCaja,
                    // Usar los precios del primer lote como referencia para la tarjeta principal
                    precioPublico: loteData.precioPublico,
                    precioUnidad: loteData.precioUnidad,
                    precioCapsula: loteData.precioCapsula,
                    precioTableta: loteData.precioTableta,
                    precioBlister: loteData.precioBlister,
                    precioCaja: loteData.precioCaja,
                };
            } else {
                // Sumar Stock Total General
                inventarioAgrupadoGlobal[nombreClave].totalStock += loteData.stock;
                // Sumar Stocks por formato
                inventarioAgrupadoGlobal[nombreClave].totalStockTableta += loteData.stockTableta;
                inventarioAgrupadoGlobal[nombreClave].totalStockBlister += loteData.stockBlister;
                inventarioAgrupadoGlobal[nombreClave].totalStockCaja += loteData.stockCaja;

                inventarioAgrupadoGlobal[nombreClave].lotes.push(loteData);
                // Si algún lote es antibiótico, marcar todo el producto como antibiótico
                inventarioAgrupadoGlobal[nombreClave].antibiotico = inventarioAgrupadoGlobal[nombreClave].antibiotico || loteData.antibiotico;
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
        if (producto.nombre && producto.nombre.toLowerCase().includes(texto) || (producto.marca && producto.marca.toLowerCase().includes(texto)) || (producto.ubicacion && producto.ubicacion.toLowerCase().includes(texto))) {
            const li = crearTarjetaProducto(producto); 
            if (lista) lista.appendChild(li);
            resultadosEncontrados = true;
        }
    }

    if (!resultadosEncontrados && lista) {
        lista.innerHTML = "<p>No hay productos que coincidan con la búsqueda.</p>";
    }
});

// Inicializar la carga de inventario
cargarInventario();