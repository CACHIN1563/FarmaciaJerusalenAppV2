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
 * ✅ LÓGICA DE HERENCIA: Usa precioPublico si no hay precioTableta definido.
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
                lotes: []
            });
        }

        const producto = productosAgrupados.get(clave);

        producto.stockTotal += lote.stock;

        // ----------------------------------------------------------------------
        // ✅ LÓGICA DE PRECIOS CON HERENCIA
        // ----------------------------------------------------------------------
        const pTableta = parseFloat(lote.precioTableta) || 0;
        const pBlister = parseFloat(lote.precioBlister) || 0;
        const pCaja = parseFloat(lote.precioCaja) || 0;
        const pPublico = parseFloat(lote.precioPublico) || 0; // Nuevo campo

        // Si el lote tiene precio de tableta definido, lo usa
        if (pTableta > 0) {
            producto.precios.tableta = pTableta;
        } else if (pPublico > 0 && producto.precios.tableta === 0) {
            // Si no hay precio de tableta y SÍ hay precio público, usar precio público
            producto.precios.tableta = pPublico;
        }

        // Blister y Caja usan sus precios específicos si están definidos
        if (pBlister > 0) producto.precios.blister = pBlister;
        if (pCaja > 0) producto.precios.caja = pCaja;
        // ----------------------------------------------------------------------

        if (lote.antibiotico === true || lote.antibiotico === 'Sí') {
             producto.antibiotico = true;
        }

        producto.lotes.push({
            id: lote.id,
            stock: lote.stock, // Stock total en unidades del lote
            vencimiento: lote.vencimiento ? new Date(lote.vencimiento) : new Date(0),
        });
    });

    productosAgrupados.forEach(producto => {
        // Ordenar lotes del producto consolidado por vencimiento (el más viejo primero)
        producto.lotes.sort((a, b) => a.vencimiento.getTime() - b.vencimiento.getTime());
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

            let vencimientoString = data.vencimiento;
            if (data.vencimiento && typeof data.vencimiento.toDate === 'function') {
                vencimientoString = data.vencimiento.toDate().toISOString().split('T')[0];
            } else if (data.vencimiento instanceof Date) {
                vencimientoString = data.vencimiento.toISOString().split('T')[0];
            }

            lotesInventario.push({
                ...data,
                id: docu.id,
                stock: parseInt(data.stock) || 0, // Stock Total en Unidades/Pastillas
                vencimiento: vencimientoString, // Usamos la cadena de fecha normalizada
                precioTableta: parseFloat(data.precioTableta) || 0,
                precioBlister: parseFloat(data.precioBlister) || 0,
                precioCaja: parseFloat(data.precioCaja) || 0,
                // ✅ Añadido precioPublico (Aseguramos que sea un número)
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
            // Nota: Se omite el stock en el display del select para mantener la UI limpia,
            // pero la validación de stock y precio se mantiene
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
 * Renderiza la información detallada del producto, aplicando el estilo simplificado
 * si solo el precio unitario está disponible.
 */
function renderInfoProducto(producto, formato) {
    const productoActualizado = productosConsolidados.find(p => p.nombre === producto.nombre) || producto;
    const stocksVendibles = calcularStockVendible(productoActualizado);
    const precio = productoActualizado.precios[formato] || 0;

    let stockBase = 0;
    let factorConversion = 1;

    // Determinar stock base y factor de conversión
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

    // Actualizar datos de productoSeleccionado y el input de cantidad
    if (productoSeleccionado) {
        productoSeleccionado.stockBaseFormato = stockBase;
        productoSeleccionado.precioUnitarioFormato = precio;
        productoSeleccionado.factorConversion = factorConversion;
    }

    cantidadInput.max = stockBase;
    cantidadInput.disabled = stockBase <= 0; // Habilitar/Deshabilitar el input
    cantidadInput.value = Math.min(parseInt(cantidadInput.value) || 1, stockBase); // Ajustar el valor actual

    const antibioticoWarning = productoActualizado.antibiotico
        ? `<span class="antibiotico-warning" style="font-weight: bold; color: #b00020;"><i class="fas fa-exclamation-triangle"></i> Antibiótico - Producto Controlado</span>`
        : `<span class="regular-product" style="font-weight: bold; color: #1e88e5;"><i class="fas fa-info-circle"></i> Producto regular</span>`;

    const proxVencimientoDate = productoActualizado.lotes.length > 0 ?
        productoActualizado.lotes[0].vencimiento : null;

    const proxVencimientoDisplay = proxVencimientoDate instanceof Date && !isNaN(proxVencimientoDate)
        ? proxVencimientoDate.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : 'N/A';

    // --------------------------------------------------------------------------
    // Renderizado UI - Estilo Simplificado o Completo
    // --------------------------------------------------------------------------
    const pTableta = productoActualizado.precios.tableta || 0;
    const pBlister = productoActualizado.precios.blister || 0;
    const pCaja = productoActualizado.precios.caja || 0;

    // Condición para usar el estilo simplificado: Solo si tableta tiene precio Y (Blister y Caja no tienen precio O no es farmacéutico)
    const estiloSimplificado = pTableta > 0 && ((pBlister === 0 && pCaja === 0) || productoActualizado.tipoProducto !== 'farmaceutico');

    let productoInfoHtml = '';

    if (estiloSimplificado) {
        // Estilo simplificado (como se solicitó)
        productoInfoHtml = `
            <strong style="display: block; margin-bottom: 5px; font-size: 1.1em;">${productoActualizado.nombre}</strong>
            Próx. Vencimiento: ${proxVencimientoDisplay}<br>
            <div style="background-color: #e3f2fd; border: 1px solid #90caf9; border-radius: 4px; padding: 10px; margin: 8px 0;">
                <h4 style="margin: 0 0 5px 0; color: #1e88e5; font-size: 1.2em;">Precio Unitario: ${formatoMoneda(pTableta)}</h4>
                <p style="margin: 0; font-weight: bold;">Stock Total Unidades: ${stocksVendibles.stockVendibleTableta}</p>
            </div>
        `;
    } else {
        // Estilo completo (con la tabla de formatos)
        productoInfoHtml = `
            <strong style="display: block; margin-bottom: 5px; font-size: 1.1em;">${productoActualizado.nombre}</strong>
            Próx. Vencimiento: ${proxVencimientoDisplay}<br>

            <table class="info-table" style="width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 0.9em;">
                <thead style="background-color: #d8d8d8;">
                    <tr>
                        <th style="padding: 6px; border: 1px solid #aaa;">Formato</th>
                        <th style="padding: 6px; border: 1px solid #aaa; text-align: center;">Precio</th>
                        <th style="padding: 6px; border: 1px solid #aaa; text-align: center;">Stock</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #aaa;">Unidad</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(pTableta)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleTableta}</td>
                    </tr>
                    ${productoActualizado.tipoProducto === 'farmaceutico' && pBlister > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #aaa;">Blister</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(pBlister)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleBlister}</td>
                    </tr>
                    ` : ''}
                    ${productoActualizado.tipoProducto === 'farmaceutico' && pCaja > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #aaa;">Caja/Frasco</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(pCaja)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleCaja}</td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>
        `;
    }

    productoInfoBox.innerHTML = productoInfoHtml + `<p style="margin-top: 10px;">${antibioticoWarning}</p>`;
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

    for (const lote of lotesTemp) {
        if (unidadesPendientes <= 0) break;

        let cantidadTomar = Math.min(unidadesPendientes, lote.stock);

        if (cantidadTomar > 0) {
            const loteOriginal = lotesInventario.find(l => l.id === lote.id);
            const stockAnteriorLote = loteOriginal ? loteOriginal.stock : lote.stock;

            lotesVendidosDetallado.push({
                loteId: lote.id,
                unidadesVendidas: cantidadTomar,
                stockAnteriorLote: stockAnteriorLote
            });
            lote.stock -= cantidadTomar;
            unidadesPendientes -= cantidadTomar;
        }
    }

    if (unidadesPendientes > 0) {
        alert("⚠️ Error crítico: El stock total no pudo cubrir la demanda. Venta abortada.");
        return;
    }

    // 1. ACTUALIZAR STOCK INMEDIATAMENTE EN CACHÉ
    productoActualizado.stockTotal -= unidadesBaseVendidas;
    productoActualizado.lotes = lotesTemp.filter(l => l.stock > 0);

    // 2. Crear el ítem en el carrito
    const subtotalTotal = cantidadRequerida * precioUnitario;

    const index = carrito.findIndex(p => p.nombre === productoActualizado.nombre && p.formatoVenta === formato);

    if (index > -1) {
        alert(`⚠️ Ya existe un producto con el formato ${formato.toUpperCase()} en el carrito. Por favor, elimínelo y vuelva a añadir la cantidad correcta.`);
        return;
    } else {
        carrito.push({
            nombre: productoActualizado.nombre,
            codigo: productoActualizado.codigo,
            cantidad: cantidadRequerida,
            unidadesBaseVendidas: unidadesBaseVendidas,
            precioUnitario: precioUnitario,
            subtotal: subtotalTotal,
            antibiotico: productoActualizado.antibiotico,
            formatoVenta: formato,
            lotesVendidos: lotesVendidosDetallado
        });
    }

    renderTablaVenta();
    actualizarTotales();

    // 3. Forzar el refresco de información
    const pUpdated = productosConsolidados.find(p => p.nombre === productoSeleccionado.nombre);
    if (pUpdated) {
        productoSeleccionado = pUpdated;
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

        // 2. ACTUALIZAR STOCK EN LOTES
        const lotesAActualizar = new Map();

        for (const itemCarrito of carrito) {
            for (const loteVendido of itemCarrito.lotesVendidos) {
                const { loteId, unidadesVendidas } = loteVendido;

                if (!lotesAActualizar.has(loteId)) {
                    lotesAActualizar.set(loteId, {
                        unidadesVendidasTotales: 0,
                    });
                }
                lotesAActualizar.get(loteId).unidadesVendidasTotales += unidadesVendidas;
            }
        }

        for (const [loteId, dataUpdate] of lotesAActualizar.entries()) {
            const loteOriginal = lotesInventario.find(l => l.id === loteId);
            if (!loteOriginal) continue;

            const nuevoStockTotal = loteOriginal.stock - dataUpdate.unidadesVendidasTotales;

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

            await updateDoc(ref, updateData);
        }

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
        tablaVentaBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">No hay productos en la venta.</td></tr>`;
        btnVender.disabled = true;
        return;
    }

    btnVender.disabled = false;

    carrito.forEach((p, i) => {
        const formatoDisplay = p.formatoVenta.toUpperCase().replace('CAJA', 'CAJA/FRASCO').replace('TABLETA', 'UNIDAD');
        const fila = `
        <tr>
            <td>${p.nombre}</td>
            <td>${formatoDisplay}</td>
            <td>
                <div class="quantity-controls">
                    <button onclick="cambiarCantidad(${i}, -1)" disabled><i class="fas fa-minus"></i></button>
                    <span>${p.cantidad}</span>
                    <button onclick="cambiarCantidad(${i}, 1)" disabled><i class="fas fa-plus"></i></button>
                </div>
            </td>
            <td>${formatoMoneda(p.precioUnitario)}</td>
            <td>${formatoMoneda(p.subtotal)}</td>
            <td><button class="btn-remove" onclick="eliminarProducto(${i})" title="Eliminar"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`;
        tablaVentaBody.innerHTML += fila;
    });
}

// Se mantiene deshabilitada la edición de cantidad directamente en la tabla
window.cambiarCantidad = (index, delta) => {
    alert("Para productos que manejan lotes y diferentes formatos, por favor elimine el artículo y vuelva a añadir la cantidad correcta.");
};

// Función global para eliminar producto del carrito
window.eliminarProducto = async (index) => {
    if (!confirm("¿Está seguro de eliminar este producto de la venta?")) return;

    // 1. Eliminar del carrito
    const productoEliminado = carrito.splice(index, 1)[0];

    // 2. Revertir el stock en caché
    const productoCache = productosConsolidados.find(p => p.nombre === productoEliminado.nombre);

    if (productoCache) {
        // Revertir el stock total de unidades base
        productoCache.stockTotal += productoEliminado.unidadesBaseVendidas;

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