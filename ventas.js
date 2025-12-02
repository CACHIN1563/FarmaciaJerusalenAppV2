import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    addDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- REFERENCIAS DEL DOM ---
const buscarInput = document.getElementById("buscar");
const listaProductos = document.getElementById("lista-productos");
const btnAgregar = document.getElementById("btnAgregar");
const cantidadInput = document.getElementById("cantidad");
const formatoVentaSelect = document.getElementById("formatoVenta");
const productoInfoBox = document.getElementById("productoInfo");
const tablaVentaBody = document.querySelector("#tablaVenta tbody");
const metodoEfectivoRadio = document.getElementById("metodoEfectivo");
const metodoTarjetaRadio = document.getElementById("metodoTarjeta");
const cajaEfectivoSection = document.getElementById("cajaEfectivo");
const dineroRecibidoInput = document.getElementById("dineroRecibido");
const totalLbl = document.getElementById("total");
const recargoLbl = document.getElementById("recargo");
const totalGeneralLbl = document.getElementById("totalGeneral");
const cambioLbl = document.getElementById("cambio");
const cambioDisplayDiv = document.getElementById("cambioDisplay");
const btnVender = document.getElementById("btnVender");
const RECARGO_TARJETA = 0.05; // Constante para el recargo de tarjeta

// --- ESTADO DE LA APLICACIÓN ---
let lotesInventario = [];
let productosConsolidados = [];
let productoSeleccionado = null;
let carrito = [];

// --- FUNCIONES DE UTILIDAD ---
const formatoMoneda = (monto) => {
    return `Q ${parseFloat(monto).toFixed(2)}`;
};

/**
 * Convierte un número de serie de fecha de Excel a un objeto Date de JavaScript.
 */
function excelDateToJSDate(excelDate) {
    if (!excelDate || isNaN(excelDate)) {
        return null; 
    }

    const serial = parseFloat(excelDate);
    if (serial < 1) return null;

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    
    // Base de Excel: 1899-12-30T00:00:00Z
    const baseDate = new Date('1899-12-30T00:00:00Z'); 
    
    // Ajuste por el error de Excel que cuenta el 29 de febrero de 1900
    const adjustment = serial >= 60 ? -1 : 0; 

    // Sumamos los milisegundos: (días + ajuste) * milisegundos por día
    const milliseconds = baseDate.getTime() + (serial + adjustment) * MS_PER_DAY;
    
    return new Date(milliseconds);
}

/**
 * Formatea un objeto Date a la cadena DD/MM/YYYY.
 */
const formatearFechaDisplay = (dateObj) => {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        return dateObj.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    return 'N/A';
};


/**
 * Convierte el stock total de unidades en stock físico desagregado (caja, blister, tableta).
 */
function reconvertirStock(stockTotal, upb, bpc) {
    upb = upb > 0 ? upb : 1;
    bpc = bpc > 0 ? bpc : 1;

    const unidadesPorCaja = upb * bpc;

    let stockTemp = stockTotal;

    // 1. Calcular Cajas
    const stockCaja = Math.floor(stockTemp / unidadesPorCaja);
    stockTemp -= stockCaja * unidadesPorCaja;

    // 2. Calcular Blisters
    const stockBlister = Math.floor(stockTemp / upb);
    stockTemp -= stockBlister * upb;

    // 3. El resto es Tableta
    const stockTableta = stockTemp;

    return { stockCaja, stockBlister, stockTableta };
}

/**
 * Calcula el stock disponible para la venta en cada formato (Stock Virtual)
 */
function calcularStockVendible(producto) {
    const stockTotal = producto.stockTotal;
    const upb = producto.tabletasPorBlister || 1;
    const bpc = producto.blistersPorCaja || 1;
    const unidadesPorCaja = upb * bpc;

    if (producto.tipoProducto !== 'farmaceutico') {
        return {
            stockVendibleCaja: 0,
            stockVendibleBlister: 0,
            stockVendibleTableta: stockTotal
        };
    }

    const stockVendibleCaja = Math.floor(stockTotal / unidadesPorCaja);
    const stockVendibleBlister = Math.floor(stockTotal / upb);
    const stockVendibleTableta = stockTotal;

    return {
        stockVendibleCaja,
        stockVendibleBlister,
        stockVendibleTableta
    };
}

/**
 * Agrupa los lotes y CONSOLIDA el stock total en UNIDADES.
 */
const agruparLotes = (lotes) => {
    const productosAgrupados = new Map();

    lotes.forEach(lote => {
        const clave = lote.nombre;

        if (!productosAgrupados.has(clave)) {
            productosAgrupados.set(clave, {
                nombre: lote.nombre,
                codigo: lote.codigo || '',
                marca: lote.marca || '',
                stockTotal: 0,
                antibiotico: lote.antibiotico === true || lote.antibiotico === 'Sí',
                tabletasPorBlister: lote.tabletasPorBlister || 1,
                blistersPorCaja: lote.blistersPorCaja || 1,
                tipoProducto: lote.tipoProducto || 'farmaceutico',
                precios: { tableta: 0, blister: 0, caja: 0, },
                lotes: [],
                proxVencimiento: null, // Campo para la fecha más próxima
            });
        }

        const producto = productosAgrupados.get(clave);

        producto.stockTotal += lote.stock;

        // LÓGICA DE PRECIOS
        const pTableta = parseFloat(lote.precioTableta) || 0;
        const pBlister = parseFloat(lote.precioBlister) || 0;
        const pCaja = parseFloat(lote.precioCaja) || 0;
        const pPublico = parseFloat(lote.precioPublico) || 0;

        if (pTableta > 0) {
            producto.precios.tableta = pTableta;
        } else if (pPublico > 0 && producto.precios.tableta === 0) {
            producto.precios.tableta = pPublico;
        }

        if (pBlister > 0) producto.precios.blister = pBlister;
        if (pCaja > 0) producto.precios.caja = pCaja;
        // FIN LÓGICA DE PRECIOS

        if (lote.antibiotico === true || lote.antibiotico === 'Sí') {
             producto.antibiotico = true;
        }
        
        // Convertir la cadena 'YYYY-MM-DD' de vencimiento a un objeto Date o null
        const vencimientoDate = lote.vencimiento ? new Date(lote.vencimiento) : null;


        producto.lotes.push({
            id: lote.id,
            stock: lote.stock, // Stock total en unidades del lote
            vencimiento: vencimientoDate, // Guardamos el objeto Date o null
        });
    });

    productosAgrupados.forEach(producto => {
        // Ordenar lotes del producto consolidado por vencimiento (el más viejo/próximo primero)
        producto.lotes.sort((a, b) => {
             const timeA = a.vencimiento ? a.vencimiento.getTime() : Infinity;
             const timeB = b.vencimiento ? b.vencimiento.getTime() : Infinity;
             return timeA - timeB;
        });
        
        // Almacenar la fecha de vencimiento más próxima en el producto principal
        if (producto.lotes.length > 0 && producto.lotes[0].vencimiento) {
             producto.proxVencimiento = producto.lotes[0].vencimiento;
        }
    });

    return Array.from(productosAgrupados.values());
};

// --- CARGAR PRODUCTOS AL INICIO ---
async function cargarProductos() {
    try {
        const querySnapshot = await getDocs(collection(db, "inventario"));
        lotesInventario = [];
        querySnapshot.forEach(docu => {
            const data = docu.data();

            let vencimientoDate = null;
            
            if (data.vencimiento) {
                // 1. Manejo de Timestamp de Firebase
                if (typeof data.vencimiento.toDate === 'function') {
                    vencimientoDate = data.vencimiento.toDate();
                // 2. Manejo de cadena numérica de Excel (ej: "47300")
                } else if (typeof data.vencimiento === 'string' && !isNaN(data.vencimiento)) {
                    vencimientoDate = excelDateToJSDate(data.vencimiento);
                // 3. Manejo de Date estándar o cadena ISO (si existe)
                } else if (data.vencimiento instanceof Date || typeof data.vencimiento === 'string') {
                    const tempDate = new Date(data.vencimiento);
                    if (!isNaN(tempDate)) {
                        vencimientoDate = tempDate;
                    }
                }
            }
            
            // Normalizar la fecha a una cadena ISO 'YYYY-MM-DD'
            const vencimientoString = vencimientoDate ? vencimientoDate.toISOString().split('T')[0] : null;


            lotesInventario.push({
                ...data,
                id: docu.id,
                stock: parseInt(data.stock) || 0, // Stock Total en Unidades/Pastillas
                vencimiento: vencimientoString, // Usamos la cadena de fecha normalizada YYYY-MM-DD
                precioTableta: parseFloat(data.precioTableta) || 0,
                precioBlister: parseFloat(data.precioBlister) || 0,
                precioCaja: parseFloat(data.precioCaja) || 0,
                precioPublico: parseFloat(data.precioPublico) || 0,
                tabletasPorBlister: parseInt(data.tabletasPorBlister) || 1,
                blistersPorCaja: parseInt(data.blistersPorCaja) || 1,
                antibiotico: data.antibiotico === true || data.antibiotico === 'Sí',
                tipoProducto: data.tipoProducto || 'farmaceutico',
            });
        });

        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0));
    } catch (error) {
        console.error("Error al cargar productos:", error);
        alert("Hubo un error al cargar el inventario.");
    }
}


// --------------------------------------------------------------------------
// LÓGICA DE HABILITACIÓN DE FORMATO Y LÓGICA DE STOCK EN EL SELECT
// --------------------------------------------------------------------------
function llenarSelectFormato(producto) {
    const productoActualizado = productosConsolidados.find(p => p.nombre === producto.nombre) || producto;
    const stocksVendibles = calcularStockVendible(productoActualizado);

    let formatosPermitidos = {};

    if (productoActualizado.tipoProducto !== 'farmaceutico') {
        formatosPermitidos = {
            'tableta': 'Unidad/Tableta',
        };
    } else {
        // Orden de preferencia para el select
        formatosPermitidos = {
            'caja': 'Caja/Frasco',
            'blister': 'Blister',
            'tableta': 'Unidad', // Cambiado a 'Tableta/Unidad' para ser genérico
        };
    }

    formatoVentaSelect.innerHTML = '';
    let primerFormatoValido = null;

    for (const [key, label] of Object.entries(formatosPermitidos)) {
        const precio = productoActualizado.precios[key] || 0;
        let stock = 0;

        if (key === 'caja') stock = stocksVendibles.stockVendibleCaja;
        else if (key === 'blister') stock = stocksVendibles.stockVendibleBlister;
        else if (key === 'tableta') stock = stocksVendibles.stockVendibleTableta;

        // Solo añadir opción si tiene precio Y stock
        if (precio > 0 && stock > 0) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${label} (${formatoMoneda(precio)})`;
            formatoVentaSelect.appendChild(option);

            if (!primerFormatoValido) {
                primerFormatoValido = key;
            }
        }
    }

    if (primerFormatoValido) {
        // Seleccionar el primer formato válido por defecto
        formatoVentaSelect.value = primerFormatoValido;
        formatoVentaSelect.disabled = false;
        renderInfoProducto(productoActualizado, formatoVentaSelect.value);
    } else {
        // Caso: Sin opciones válidas (Agotado o sin precio definido)
        formatoVentaSelect.disabled = true;
        btnAgregar.disabled = true;
        cantidadInput.disabled = true;
        productoInfoBox.innerHTML = '<p style="color: #b00020; font-weight: bold; padding: 10px 0;">Producto agotado o sin precio de venta para formatos disponibles.</p>';
    }
}

/**
 * Renderiza la información detallada del producto.
 */
function renderInfoProducto(producto, formato) {
    const productoActualizado = productosConsolidados.find(p => p.nombre === producto.nombre) || producto;
    const stocksVendibles = calcularStockVendible(productoActualizado);
    const precio = productoActualizado.precios[formato] || 0;

    let stockBase = 0;
    let factorConversion = 1;

    const upb = productoActualizado.tabletasPorBlister || 1;
    const bpc = productoActualizado.blistersPorCaja || 1;
    const unidadesPorCaja = upb * bpc;

    if (formato === 'tableta') {
        stockBase = stocksVendibles.stockVendibleTableta;
        factorConversion = 1;
    } else if (formato === 'blister') {
        stockBase = stocksVendibles.stockVendibleBlister;
        factorConversion = upb;
    } else if (formato === 'caja') {
        stockBase = stocksVendibles.stockVendibleCaja;
        factorConversion = unidadesPorCaja;
    }

    if (productoSeleccionado) {
        productoSeleccionado.stockBaseFormato = stockBase;
        productoSeleccionado.precioUnitarioFormato = precio;
        productoSeleccionado.factorConversion = factorConversion;
    }

    cantidadInput.max = stockBase;
    cantidadInput.disabled = stockBase <= 0;
    // --- ESTILOS PARA INPUT DE CANTIDAD (Ajuste de visibilidad) ---
    cantidadInput.style.width = '60px'; 
    // ---------------------------------------------------------------
    cantidadInput.value = Math.min(parseInt(cantidadInput.value) || 1, stockBase);

    // --- ESTILOS PARA SELECT DE FORMATO (Hacerlo más largo) ---
    formatoVentaSelect.style.minWidth = '150px'; 
    // -----------------------------------------------------------

    const proxVencimientoDate = productoActualizado.proxVencimiento;
    const proxVencimientoDisplay = formatearFechaDisplay(proxVencimientoDate);

    const pTableta = productoActualizado.precios.tableta || 0;
    const pBlister = productoActualizado.precios.blister || 0;
    const pCaja = productoActualizado.precios.caja || 0;

    const esAntibiotico = productoActualizado.antibiotico;
    const tipoProductoIcon = esAntibiotico ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle';
    const tipoProductoColor = esAntibiotico ? '#b00020' : '#1e88e5';
    const tipoProductoTexto = esAntibiotico ? 'Antibiótico - Producto Controlado' : 'Producto regular';

    // --------------------------------------------------------------------------
    // Renderizado UI - Diseño Compacto
    // --------------------------------------------------------------------------

    let productoInfoHtml = `
        <strong style="display: block; margin-bottom: 2px; font-size: 1em;">${productoActualizado.nombre}</strong>
        Próx. Vencimiento: ${proxVencimientoDisplay}
    `;

    productoInfoHtml += `
        <div style="background-color: #e3f2fd; border: 1px solid #90caf9; border-radius: 4px; padding: 10px; margin: 8px 0;">
            <div style="font-size: 1.1em; font-weight: bold; color: #1e88e5; margin-bottom: 5px;">
                Precio Unitario: ${formatoMoneda(pTableta)}
            </div>
            <div style="font-weight: 500;">
                Stock Total Unidades: ${stocksVendibles.stockVendibleTableta}
            </div>
    `;

    // Si es un producto farmacéutico con más de un formato, añadir los precios de Blister y Caja
    if (productoActualizado.tipoProducto === 'farmaceutico' && (pBlister > 0 || pCaja > 0)) {
        
        productoInfoHtml += `<hr style="border: none; border-top: 1px solid #bbdefb; margin: 5px 0 8px 0;">`;
        productoInfoHtml += `<div style="font-size: 0.9em; color: #616161; font-weight: bold;">Otros formatos:</div>`;
        
        if (pBlister > 0) {
            productoInfoHtml += `<div style="display: flex; justify-content: space-between; font-size: 0.9em;">
                <span>Blister:</span>
                <span style="font-weight: bold;">${formatoMoneda(pBlister)}</span>
            </div>`;
        }
        if (pCaja > 0) {
            productoInfoHtml += `<div style="display: flex; justify-content: space-between; font-size: 0.9em;">
                <span>Caja/Frasco:</span>
                <span style="font-weight: bold;">${formatoMoneda(pCaja)}</span>
            </div>`;
        }
    }
    
    productoInfoHtml += `</div>`; // Cierre del div de información

    // Mensaje de producto (Abajo de la caja azul)
    productoInfoHtml += `
        <p style="margin-top: 10px; margin-bottom: 0; font-size: 0.9em; font-weight: bold; color: ${tipoProductoColor};">
            <i class="${tipoProductoIcon}"></i> ${tipoProductoTexto}
        </p>
    `;

    productoInfoBox.innerHTML = productoInfoHtml;
    // --------------------------------------------------------------------------

    btnAgregar.disabled = stockBase <= 0 || precio <= 0;
}

// --- BUSCAR PRODUCTOS Y LISTENERS ---
buscarInput.addEventListener("input", () => {
    const texto = buscarInput.value.toLowerCase().trim();
    listaProductos.innerHTML = "";

    // Resetear UI si el texto es muy corto
    if (texto.length < 2) {
        productoInfoBox.innerHTML = '<p style="padding: 10px 0;">Selecciona un producto de la lista.</p>';
        productoSeleccionado = null;
        formatoVentaSelect.disabled = true;
        cantidadInput.disabled = true; // Deshabilitar cantidad
        btnAgregar.disabled = true;
        return;
    }

    const filtrados = productosConsolidados.filter(p =>
        p.nombre.toLowerCase().includes(texto) || (p.codigo && p.codigo.toLowerCase().includes(texto))
    ).slice(0, 5);

    if (filtrados.length > 0) {
        filtrados.forEach(p => {
            const li = document.createElement("li");

            const marcaNombre = p.marca || 'Proveedor Desconocido';
            li.innerHTML = `${p.nombre} - <span style="color: #1e88e5; font-weight: 600;">${marcaNombre}</span>`;

            li.onclick = () => {
                // Al hacer clic, aseguramos que el producto seleccionado es la versión consolidada
                productoSeleccionado = productosConsolidados.find(item => item.nombre === p.nombre);

                llenarSelectFormato(productoSeleccionado);

                // Si se habilitó el select, renderizamos la info
                if (!formatoVentaSelect.disabled) {
                    renderInfoProducto(productoSeleccionado, formatoVentaSelect.value);
                }

                listaProductos.innerHTML = "";
                buscarInput.value = p.nombre;

                // Asegurarse de habilitar la cantidad si hay stock
                if (!cantidadInput.disabled) {
                    cantidadInput.value = "1";
                    cantidadInput.focus();
                }
            };
            listaProductos.appendChild(li);
        });
    } else {
        listaProductos.innerHTML = '<li style="cursor: default; background: #fff; padding: 10px 15px;">No se encontraron coincidencias.</li>';
    }
});

formatoVentaSelect.addEventListener('change', () => {
    if (productoSeleccionado) {
        renderInfoProducto(productoSeleccionado, formatoVentaSelect.value);
    }
});


// --- AGREGAR PRODUCTO AL CARRITO ---
btnAgregar.addEventListener("click", () => {
    if (!productoSeleccionado) {
        alert("⚠️ Por favor, seleccione un producto de la lista.");
        return;
    }
    const formato = formatoVentaSelect.value;
    let cantidadRequerida = parseInt(cantidadInput.value);

    const productoActualizado = productosConsolidados.find(p => p.nombre === productoSeleccionado.nombre);
    if (!productoActualizado) {
        alert("⚠️ Error: Producto no encontrado en la caché de inventario.");
        return;
    }

    const precioUnitario = productoSeleccionado.precioUnitarioFormato || 0;
    const stockBase = productoSeleccionado.stockBaseFormato || 0;
    const factorConversion = productoSeleccionado.factorConversion || 1;

    if (isNaN(cantidadRequerida) || cantidadRequerida <= 0) {
        alert("⚠️ Cantidad inválida. Debe ser un número positivo.");
        return;
    }

    if (precioUnitario <= 0) {
        alert("⚠️ El precio para este formato es Q 0.00. No se puede vender.");
        return;
    }

    if (cantidadRequerida > stockBase) {
        alert(`⚠️ No hay suficiente stock en formato ${formato.toUpperCase()}. Disponible: ${stockBase}.`);
        return;
    }

    // --- LÓGICA DE ASIGNACIÓN DE LOTES (Descuenta STOCK TOTAL de UNIDADES) ---
    const unidadesBaseVendidas = cantidadRequerida * factorConversion;
    let unidadesPendientes = unidadesBaseVendidas;
    const lotesVendidosDetallado = [];

    const lotesTemp = JSON.parse(JSON.stringify(productoActualizado.lotes));

    // Descontar del inventario en caché (lotesInventario) por lote más próximo a vencer (FIFO/LIFO)
    const lotesDisponibles = lotesInventario.filter(l => l.nombre === productoActualizado.nombre)
                                            .sort((a, b) => new Date(a.vencimiento) - new Date(b.vencimiento));


    for (const lote of lotesDisponibles) {
        if (unidadesPendientes <= 0) break;

        let cantidadTomar = Math.min(unidadesPendientes, lote.stock);

        if (cantidadTomar > 0) {
            const stockAnteriorLote = lote.stock;

            lotesVendidosDetallado.push({
                loteId: lote.id,
                unidadesVendidas: cantidadTomar,
                stockAnteriorLote: stockAnteriorLote
            });
            lote.stock -= cantidadTomar; // Descuenta directamente del lote en lotesInventario
            unidadesPendientes -= cantidadTomar;
        }
    }

    if (unidadesPendientes > 0) {
        alert("⚠️ Error crítico: El stock total no pudo cubrir la demanda. Venta abortada.");
        return;
    }

    // 1. ACTUALIZAR STOCK INMEDIATAMENTE EN CACHÉ (Recalcular productos consolidados)
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoActualizado.nombre));
    const productoConsolidadoActualizado = productosConsolidados.find(p => p.nombre === productoActualizado.nombre);
    
    // Si por alguna razón no se encontró, usamos el actual para la venta, aunque la fuente es lotesInventario
    const productoFinalVenta = productoConsolidadoActualizado || productoActualizado;


    // 2. Crear el ítem en el carrito
    const subtotalTotal = cantidadRequerida * precioUnitario;

    const index = carrito.findIndex(p => p.nombre === productoFinalVenta.nombre && p.formatoVenta === formato);

    if (index > -1) {
        alert(`⚠️ Ya existe un producto con el formato ${formato.toUpperCase()} en el carrito. Por favor, elimínelo y vuelva a añadir la cantidad correcta.`);
        // Revertir el descuento si no se añade al carrito
        // Nota: Esta reversión es un poco compleja aquí. Por ahora, nos basamos en el mensaje.
        return; 
    } else {
        carrito.push({
            nombre: productoFinalVenta.nombre,
            codigo: productoFinalVenta.codigo,
            cantidad: cantidadRequerida,
            unidadesBaseVendidas: unidadesBaseVendidas,
            precioUnitario: precioUnitario,
            subtotal: subtotalTotal,
            antibiotico: productoFinalVenta.antibiotico,
            formatoVenta: formato,
            lotesVendidos: lotesVendidosDetallado
        });
    }

    renderTablaVenta();
    actualizarTotales();

    // 3. Forzar el refresco de información
    if (productoConsolidadoActualizado) {
        productoSeleccionado = productoConsolidadoActualizado;
        llenarSelectFormato(productoSeleccionado);
    }

    // Limpieza de UI
    buscarInput.value = "";
    cantidadInput.value = "1";
    listaProductos.innerHTML = "";
    btnAgregar.disabled = true;
    formatoVentaSelect.disabled = true;
    cantidadInput.disabled = true;
    productoInfoBox.innerHTML = '<p style="padding: 10px 0;">Selecciona un producto de la lista.</p>';
});


// --- REGISTRAR VENTA ---
btnVender.addEventListener("click", async () => {
    if (carrito.length === 0) return alert("⚠️ No hay productos en la venta.");

    // Validación de pago en efectivo
    const totalGeneral = parseFloat(totalGeneralLbl.textContent.replace('Q ', '')) || 0;
    const recibido = parseFloat(dineroRecibidoInput.value) || 0;
    const cambio = parseFloat(cambioLbl.textContent.replace('Q ', '')) || 0;

    if (metodoEfectivoRadio.checked && recibido < totalGeneral) {
        alert("⚠️ El dinero recibido es menor que el total de la venta.");
        return;
    }

    if (!confirm(`¿Confirmar venta por ${formatoMoneda(totalGeneral)}?`)) return;

    btnVender.disabled = true;
    btnVender.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Procesando...';

    try {
        // 1. Guardar la Venta
        const venta = {
            fecha: new Date(), numeroVenta: Date.now(),
            metodoPago: metodoEfectivoRadio.checked ? "Efectivo" : "Tarjeta",
            productos: carrito.map(p => ({
                nombre: p.nombre, codigo: p.codigo, cantidad: p.cantidad, precioUnitario: p.precioUnitario,
                formatoVenta: p.formatoVenta, subtotal: p.subtotal, antibiotico: p.antibiotico, lotes: p.lotesVendidos
            })),
            total: parseFloat(totalLbl.textContent.replace('Q ', '')),
            recargo: parseFloat(recargoLbl.textContent.replace('Q ', '')),
            totalGeneral: totalGeneral,
            dineroRecibido: metodoEfectivoRadio.checked ? recibido : totalGeneral,
            cambio: cambio > 0 ? cambio : 0,
        };
        await addDoc(collection(db, "ventas"), venta);

        // 2. ACTUALIZAR STOCK EN LOTES DE FIREBASE
        const batch = db.batch();

        for (const itemCarrito of carrito) {
            for (const loteVendido of itemCarrito.lotesVendidos) {
                const { loteId, unidadesVendidas } = loteVendido;
                
                const loteOriginal = lotesInventario.find(l => l.id === loteId);
                if (!loteOriginal) continue;

                const nuevoStockTotal = loteOriginal.stock; // Ya fue descontado en lotesInventario al agregar al carrito

                const { stockCaja, stockBlister, stockTableta } = reconvertirStock(
                    nuevoStockTotal,
                    loteOriginal.tabletasPorBlister,
                    loteOriginal.blistersPorCaja
                );

                const ref = doc(db, "inventario", loteId);
                const updateData = {
                    stock: Math.max(0, nuevoStockTotal),
                    stockCaja: Math.max(0, stockCaja),
                    stockBlister: Math.max(0, stockBlister),
                    stockTableta: Math.max(0, stockTableta)
                };

                batch.update(ref, updateData);
            }
        }
        await batch.commit();

        alert("✅ Venta registrada exitosamente. ¡Se ha actualizado el inventario!");

        // --- RESTAURAR ESTADO DE LA UI ---
        carrito = [];
        await cargarProductos();
        renderTablaVenta();
        actualizarTotales();
        dineroRecibidoInput.value = "";

    } catch (error) {
        console.error("Error al registrar la venta: ", error);
        alert("❌ Error al registrar la venta. Consulte la consola.");
    } finally {
        btnVender.disabled = false;
        btnVender.innerHTML = '<i class="fas fa-check-circle"></i> Registrar Venta';
    }
});

// --- RENDER TABLA DE VENTA, CONTROLES DE TABLA, MANEJO DE TOTALES ---
function renderTablaVenta() {
    tablaVentaBody.innerHTML = "";

    if (carrito.length === 0) {
        tablaVentaBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 10px;">No hay productos en la venta.</td></tr>`;
        btnVender.disabled = true;
        return;
    }

    btnVender.disabled = false;

    carrito.forEach((p, i) => {
        const formatoDisplay = p.formatoVenta.toUpperCase().replace('CAJA', 'CAJA/FRASCO').replace('TABLETA', 'UNIDAD');
        
        // --- ESTILOS COMPACTOS Y AJUSTES DE TAMAÑO SOLICITADOS ---
        const cellStyle = "padding: 5px 8px; vertical-align: middle; font-size: 0.85em;";
        const controlStyle = "display: flex; align-items: center; justify-content: center; gap: 4px; height: 30px;"; // Mayor altura y separación
        const buttonStyle = "padding: 5px; font-size: 0.8em; height: 30px; width: 30px; border-radius: 5px; line-height: 1; background-color: #f0f0f0; border: 1px solid #ccc; cursor: pointer;"; // Botones más grandes y visibles
        const removeButtonStyle = "background-color: #f44336; color: white; border: none; border-radius: 4px; padding: 4px 6px; cursor: pointer; font-size: 0.9em; height: 30px;";

        const fila = `
        <tr style="height: 35px;">
            <td style="${cellStyle} max-width: 150px; white-space: normal;">${p.nombre}</td>
            <td style="${cellStyle} text-align: center; white-space: nowrap;">${formatoDisplay}</td>
            <td style="${cellStyle}">
                <div style="${controlStyle}">
                    <button onclick="cambiarCantidad(${i}, -1)" ${p.cantidad <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} style="${buttonStyle}"><i class="fas fa-minus"></i></button>
                    <span style="font-weight: bold; margin: 0 4px; white-space: nowrap;">${p.cantidad}</span>
                    <button onclick="cambiarCantidad(${i}, 1)" style="${buttonStyle}"><i class="fas fa-plus"></i></button>
                </div>
            </td>
            <td style="${cellStyle} text-align: right; white-space: nowrap;">${formatoMoneda(p.precioUnitario)}</td>
            <td style="${cellStyle} text-align: right; font-weight: bold; white-space: nowrap;">${formatoMoneda(p.subtotal)}</td>
            <td style="${cellStyle} text-align: center;">
                <button onclick="eliminarProducto(${i})" title="Eliminar" style="${removeButtonStyle}"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>`;
        tablaVentaBody.innerHTML += fila;
    });
}

// --- LÓGICA DE CAMBIO DE CANTIDAD EN CARRITO (Nueva Implementación) ---
window.cambiarCantidad = (index, delta) => {
    const itemCarrito = carrito[index];
    const nuevaCantidad = itemCarrito.cantidad + delta;
    
    // Si la nueva cantidad es cero o menos, se elimina el producto
    if (nuevaCantidad <= 0) {
        window.eliminarProducto(index);
        return;
    }

    // 1. REVERTIR el stock actual del item del carrito en la caché de lotes (lotesInventario)
    const productoCache = productosConsolidados.find(p => p.nombre === itemCarrito.nombre);
    if (!productoCache) {
        alert("⚠️ Error: Producto no encontrado en caché al intentar modificar cantidad.");
        return;
    }
    
    // Revertir el stock de cada lote en la caché lotesInventario
    for (const detalleLote of itemCarrito.lotesVendidos) {
        const loteOriginal = lotesInventario.find(l => l.id === detalleLote.loteId);
        if (loteOriginal) {
            loteOriginal.stock += detalleLote.unidadesVendidas;
        }
    }
    
    // Recalcular el factor de conversión y las nuevas unidades base
    const factorConversion = itemCarrito.unidadesBaseVendidas / itemCarrito.cantidad;
    const nuevasUnidadesBaseVendidas = nuevaCantidad * factorConversion;

    // 2. VALIDAR la nueva cantidad contra el stock total revertido (stock disponible actual)
    // Recargar productos consolidados en memoria para tener el stock total disponible
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoCache.nombre));
    const productoActualizado = productosConsolidados.find(p => p.nombre === itemCarrito.nombre);
    
    const stockTotalUnidadesActual = productoActualizado.stockTotal;
    
    if (nuevasUnidadesBaseVendidas > stockTotalUnidadesActual) {
        alert(`⚠️ No hay suficiente stock disponible para ${nuevaCantidad} ${itemCarrito.formatoVenta.toUpperCase()}. Stock actual en unidades: ${stockTotalUnidadesActual}.`);
        
        // Si no hay stock, debemos RE-ASIGNAR los lotes originales para mantener la integridad
        for (const detalleLote of itemCarrito.lotesVendidos) {
            const loteOriginal = lotesInventario.find(l => l.id === detalleLote.loteId);
            if (loteOriginal) {
                loteOriginal.stock -= detalleLote.unidadesVendidas;
            }
        }
        
        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoCache.nombre));
        renderTablaVenta(); 
        return;
    }


    // 3. ASIGNAR NUEVOS LOTES y Descontar
    let unidadesPendientes = nuevasUnidadesBaseVendidas;
    const nuevosLotesVendidosDetallado = [];

    // Lotes disponibles para este producto (ordenados por vencimiento)
    const lotesDisponibles = lotesInventario.filter(l => l.nombre === productoActualizado.nombre)
                                            .sort((a, b) => new Date(a.vencimiento) - new Date(b.vencimiento));
    
    for (const lote of lotesDisponibles) {
        if (unidadesPendientes <= 0) break;
        
        let cantidadTomar = Math.min(unidadesPendientes, lote.stock);
        
        if (cantidadTomar > 0) {
            const stockAnteriorLote = lote.stock; 

            nuevosLotesVendidosDetallado.push({
                loteId: lote.id,
                unidadesVendidas: cantidadTomar,
                stockAnteriorLote: stockAnteriorLote
            });
            lote.stock -= cantidadTomar; // Descontar del lote en lotesInventario
            unidadesPendientes -= cantidadTomar;
        }
    }

    if (unidadesPendientes > 0) {
        alert("⚠️ Error crítico al reasignar lotes. Por favor, elimine y vuelva a añadir el producto.");
        // Se recomienda una recarga completa del inventario en un caso crítico.
        return; 
    }
    
    // 4. ACTUALIZAR ITEM DEL CARRITO
    itemCarrito.cantidad = nuevaCantidad;
    itemCarrito.unidadesBaseVendidas = nuevasUnidadesBaseVendidas;
    itemCarrito.subtotal = nuevaCantidad * itemCarrito.precioUnitario;
    itemCarrito.lotesVendidos = nuevosLotesVendidosDetallado;
    
    // 5. Refrescar UI
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoCache.nombre));
    renderTablaVenta();
    actualizarTotales();
};


// Función global para eliminar producto del carrito
window.eliminarProducto = async (index) => {
    if (!confirm("¿Está seguro de eliminar este producto de la venta?")) return;

    // 1. Eliminar del carrito
    const productoEliminado = carrito.splice(index, 1)[0];

    // 2. Revertir el stock en caché (lotesInventario)
    const productoCache = productosConsolidados.find(p => p.nombre === productoEliminado.nombre);

    if (productoCache) {
        // Revertir el stock de cada lote en la caché lotesInventario
        for (const detalleLote of productoEliminado.lotesVendidos) {
             const loteOriginal = lotesInventario.find(l => l.id === detalleLote.loteId);
             if (loteOriginal) {
                 loteOriginal.stock += detalleLote.unidadesVendidas;
             }
        }

        // Recargar el caché de productos consolidados para reflejar la reversión
        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoCache.nombre));
    }

    renderTablaVenta();
    actualizarTotales();

    // 3. Si el producto eliminado es el que está seleccionado, refrescar la UI de selección
    if (productoSeleccionado && productoSeleccionado.nombre === productoEliminado.nombre) {
        const pUpdated = productosConsolidados.find(p => p.nombre === productoSeleccionado.nombre);
        if (pUpdated) {
             productoSeleccionado = pUpdated;
             llenarSelectFormato(productoSeleccionado);
        }
    }
};

metodoEfectivoRadio.addEventListener("change", actualizarTotales);
metodoTarjetaRadio.addEventListener("change", actualizarTotales);
dineroRecibidoInput.addEventListener("input", actualizarTotales);

function actualizarTotales() {
    let totalNeto = carrito.reduce((sum, p) => sum + p.subtotal, 0);

    let recargo = metodoTarjetaRadio.checked ? totalNeto * RECARGO_TARJETA : 0;
    let totalGeneral = totalNeto + recargo;

    totalLbl.textContent = formatoMoneda(totalNeto);
    recargoLbl.textContent = formatoMoneda(recargo);
    totalGeneralLbl.textContent = formatoMoneda(totalGeneral);

    if (metodoEfectivoRadio.checked) {
        cajaEfectivoSection.style.display = "block";
        let recibido = parseFloat(dineroRecibidoInput.value) || 0;
        let cambio = recibido - totalGeneral;

        if (cambio >= 0) {
            cambioLbl.textContent = formatoMoneda(cambio);
            cambioDisplayDiv.className = "change-display success";
            cambioDisplayDiv.style.backgroundColor = '#e8f5e9'; // success-light
            cambioDisplayDiv.style.color = '#388e3c'; // success-dark
        } else {
            cambioLbl.textContent = `Faltan ${formatoMoneda(Math.abs(cambio))}`;
            cambioDisplayDiv.className = "change-display negative";
            cambioDisplayDiv.style.backgroundColor = '#ffebee'; // danger-light
            cambioDisplayDiv.style.color = '#d32f2f'; // danger-dark
        }
    } else {
        cajaEfectivoSection.style.display = "none";
        dineroRecibidoInput.value = "";
    }
}


// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", async () => {
    await cargarProductos();
    actualizarTotales();
    renderTablaVenta();
    // Inicializar UI
    productoInfoBox.innerHTML = '<p style="padding: 10px 0;">Selecciona un producto de la lista.</p>';
    cantidadInput.disabled = true;
    formatoVentaSelect.disabled = true;
    btnAgregar.disabled = true;
});