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
const productoInfoBox = document.getElementById("productoInfo"); // Contenedor del recuadro azul de info
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
const btnVender = document.getElementById("btnVender"); // Asegúrate de que este ID existe en tu HTML


// --- ESTADO DE LA APLICACIÓN ---
let lotesInventario = []; 
let productosConsolidados = []; 
let productoSeleccionado = null; 
let carrito = []; 

// --- FUNCIONES DE UTILIDAD ---
const formatoMoneda = (monto) => {
    // Usar toFixed(2) para garantizar dos decimales
    return `Q ${parseFloat(monto).toFixed(2)}`; 
};

/**
 * Función CLAVE: Convierte el stock total de unidades en stock físico desagregado (caja, blister, tableta).
 * @param {number} stockTotal - El stock total en unidades base (tabletas/pastillas).
 * @param {number} upb - Unidades por Blister.
 * @param {number} bpc - Blisters por Caja.
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
 * basado en el Stock Total de UNIDADES CONSOLIDADAS (`producto.stockTotal`).
 */
function calcularStockVendible(producto) {
    const stockTotal = producto.stockTotal;
    const upb = producto.tabletasPorBlister || 1; 
    const bpc = producto.blistersPorCaja || 1;     
    const unidadesPorCaja = upb * bpc; 

    // Si el producto no es farmacéutico, solo podemos vender por unidad (tableta)
    if (producto.tipoProducto !== 'farmaceutico') {
        return {
            stockVendibleCaja: 0,
            stockVendibleBlister: 0,
            stockVendibleTableta: stockTotal 
        };
    }
    
    // Stock vendible en cada formato (solo farmacéuticos)
    const stockVendibleCaja = Math.floor(stockTotal / unidadesPorCaja);
    const stockVendibleBlister = Math.floor(stockTotal / upb);
    const stockVendibleTableta = stockTotal; // Stock total en la unidad base

    return {
        stockVendibleCaja,
        stockVendibleBlister,
        stockVendibleTableta
    };
}

/**
 * Agrupa los lotes y CONSOLIDA el stock total en UNIDADES. 
 * Se añade la herencia del campo tipoProducto.
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
                stockTotal: 0, // El stock de unidades base consolidado
                antibiotico: lote.antibiotico === true || lote.antibiotico === 'Sí', 
                tabletasPorBlister: lote.tabletasPorBlister || 1, 
                blistersPorCaja: lote.blistersPorCaja || 1, 
                tipoProducto: lote.tipoProducto || 'farmaceutico', // <-- AÑADIDO: Tipo de Producto (CRÍTICO)
                precios: { tableta: 0, blister: 0, caja: 0, },
                stocks: { unidad: 0, tableta: 0, blister: 0, caja: 0, }, // Se recalculará después
                lotes: [] 
            });
        }

        const producto = productosAgrupados.get(clave);

        // Sumar todos los stocks TOTALES de unidades de todos los lotes
        producto.stockTotal += lote.stock; 

        // Actualizar precios (solo toma el último, por simplicidad)
        if (lote.precioTableta) producto.precios.tableta = parseFloat(lote.precioTableta) || 0;
        if (lote.precioBlister) producto.precios.blister = parseFloat(lote.precioBlister) || 0;
        if (lote.precioCaja) producto.precios.caja = parseFloat(lote.precioCaja) || 0;
        
        if (lote.antibiotico === true || lote.antibiotico === 'Sí') {
             producto.antibiotico = true;
        }

        producto.lotes.push({
            id: lote.id, 
            stock: lote.stock, // Stock total en unidades del lote (esta es la fuente de verdad)
            tabletasPorBlister: lote.tabletasPorBlister || 1, 
            blistersPorCaja: lote.blistersPorCaja || 1, 
            vencimiento: lote.vencimiento ? new Date(lote.vencimiento) : new Date(0),
        });
    });

    productosAgrupados.forEach(producto => {
        // Recalcular el stock físico consolidado a partir del stock total de unidades
        const { stockCaja, stockBlister, stockTableta } = reconvertirStock(
            producto.stockTotal, 
            producto.tabletasPorBlister, 
            producto.blistersPorCaja
        );
        producto.stocks.caja = stockCaja;
        producto.stocks.blister = stockBlister;
        producto.stocks.tableta = stockTableta;

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
            lotesInventario.push({ 
                ...data,
                id: docu.id, 
                stock: parseInt(data.stock) || 0, // Stock Total en Unidades/Pastillas
                stockTableta: parseInt(data.stockTableta) || 0, // Físicos
                stockBlister: parseInt(data.stockBlister) || 0, // Físicos
                stockCaja: parseInt(data.stockCaja) || 0, // Físicos
                precioTableta: parseFloat(data.precioTableta) || 0,
                precioBlister: parseFloat(data.precioBlister) || 0,
                precioCaja: parseFloat(data.precioCaja) || 0,
                tabletasPorBlister: parseInt(data.tabletasPorBlister) || 1,
                blistersPorCaja: parseInt(data.blistersPorCaja) || 1,
                antibiotico: data.antibiotico === true || data.antibiotico === 'Sí', 
                tipoProducto: data.tipoProducto || 'farmaceutico', // <-- AÑADIDO: Tipo de Producto (CRÍTICO)
            });
        });
        
        productosConsolidados = agruparLotes(lotesInventario);
    } catch (error) {
        console.error("Error al cargar productos:", error);
        alert("Hubo un error al cargar el inventario.");
    }
}
cargarProductos();

// --- FUNCIONES DE RENDER Y LÓGICA DE UI ---
function llenarSelectFormato(producto) {
    const productoActualizado = productosConsolidados.find(p => p.nombre === producto.nombre) || producto;
    const stocksVendibles = calcularStockVendible(productoActualizado); 

    let formatosPermitidos = {};
    
    // Si NO es farmacéutico, solo permitimos 'tableta' (Unidad)
    if (productoActualizado.tipoProducto !== 'farmaceutico') {
        formatosPermitidos = {
            'tableta': 'Unidad/Tableta',
        };
    } else {
        // Si es farmacéutico, permitimos todos los formatos
        formatosPermitidos = {
            'tableta': 'Tableta (Tira)',
            'blister': 'Blister',
            'caja': 'Caja/Frasco', 
        };
    }

    formatoVentaSelect.innerHTML = '';
    
    for (const [key, label] of Object.entries(formatosPermitidos)) {
        const precio = productoActualizado.precios[key] || 0;
        let stock = 0;
        
        if (key === 'caja') stock = stocksVendibles.stockVendibleCaja;
        else if (key === 'blister') stock = stocksVendibles.stockVendibleBlister;
        else if (key === 'tableta') stock = stocksVendibles.stockVendibleTableta;

        // Mostrar solo si hay precio o stock disponible
        if (precio > 0 || stock > 0) {
            const option = document.createElement('option');
            option.value = key;
            
            // CORRECCIÓN: Mostrar solo el nombre del formato (quitando precio y stock del texto)
            option.textContent = label; 
            
            formatoVentaSelect.appendChild(option);
        }
    }
    
    // Seleccionar el formato de mayor prioridad si existe 
    if (productoActualizado.tipoProducto === 'farmaceutico' && productoActualizado.precios.caja > 0 && stocksVendibles.stockVendibleCaja > 0) formatoVentaSelect.value = 'caja';
    else if (productoActualizado.tipoProducto === 'farmaceutico' && productoActualizado.precios.blister > 0 && stocksVendibles.stockVendibleBlister > 0) formatoVentaSelect.value = 'blister';
    else if (productoActualizado.precios.tableta > 0 && stocksVendibles.stockVendibleTableta > 0) formatoVentaSelect.value = 'tableta';
    else if (formatoVentaSelect.options.length > 0) formatoVentaSelect.value = formatoVentaSelect.options[0].value;
}

function renderInfoProducto(producto, formato) {
    // Asegurarse de usar la versión más actualizada del producto consolidado
    const productoActualizado = productosConsolidados.find(p => p.nombre === producto.nombre) || producto;
    const stocksVendibles = calcularStockVendible(productoActualizado); 
    const precio = productoActualizado.precios[formato] || 0;
    
    let stockBase = 0; 
    
    // Determinar stock base A PARTIR DEL STOCK VIRTUAL (calculado de forma consistente)
    if (formato === 'tableta') {
        stockBase = stocksVendibles.stockVendibleTableta; 
    } else if (formato === 'blister') {
        stockBase = stocksVendibles.stockVendibleBlister; 
    } else if (formato === 'caja') {
        stockBase = stocksVendibles.stockVendibleCaja;     
    }
    
    // Asignar datos al objeto seleccionado para que btnAgregar lo use
    productoSeleccionado.stockBaseFormato = stockBase; 
    productoSeleccionado.precioUnitarioFormato = precio;
    
    // Asignar el factor de conversión para btnAgregar
    const upb = productoActualizado.tabletasPorBlister || 1; 
    const bpc = productoActualizado.blistersPorCaja || 1; 
    const unidadesPorCaja = upb * bpc;
    
    if (formato === 'tableta') productoSeleccionado.factorConversion = 1; 
    else if (formato === 'blister') productoSeleccionado.factorConversion = upb;
    else if (formato === 'caja') productoSeleccionado.factorConversion = unidadesPorCaja;

    
    const antibioticoWarning = productoActualizado.antibiotico 
        ? `<span class="antibiotico-warning" style="font-weight: bold; color: #b00020;"><i class="fas fa-exclamation-triangle"></i>Antibiótico - Producto Controlado</span>`
        : `<span class="regular-product" style="font-weight: bold; color: #1e88e5;"><i class="fas fa-info-circle"></i> Producto regular</span>`;

    const proxVencimiento = productoActualizado.lotes.length > 0 ? 
        productoActualizado.lotes[0].vencimiento.toISOString().split('T')[0] : 'N/A';
    
    // --------------------------------------------------------------------------
    //  ✅ CAMBIO CLAVE: LÓGICA CONDICIONAL DE RENDERIZADO
    // --------------------------------------------------------------------------
    if (productoActualizado.tipoProducto !== 'farmaceutico') {
        // Renderizado MINIMALISTA para productos "Otros" (Misceláneos)
        productoInfoBox.innerHTML = `
            <strong style="display: block; margin-bottom: 5px; font-size: 1.1em;">${productoActualizado.nombre}</strong>
            <p style="margin-top: 5px;">Tipo: <strong style="color: #f59e0b;"><i class="fas fa-tag"></i> Producto Misceláneo/Otro</strong></p>
            <p style="margin-top: 5px;">Stock Total Unidades: <strong style="font-size: 1.1em;">${productoActualizado.stockTotal}</strong></p>
            <p style="margin-top: 10px; font-style: italic; font-size: 0.9em; padding-left: 10px; border-left: 3px solid #ccc;">
               Solo se vende por Unidad (Tableta/Unidad). Precio Unitario: ${formatoMoneda(productoActualizado.precios.tableta)}.
            </p>
        `;
        // Para productos misceláneos, asumimos que el stock base es el total y el factor es 1
        productoSeleccionado.stockBaseFormato = productoActualizado.stockTotal; 
        productoSeleccionado.precioUnitarioFormato = productoActualizado.precios.tableta || 0; 
        productoSeleccionado.factorConversion = 1;
        
    } else {
        // Renderizado COMPLETO para productos FARMACÉUTICOS (Tabla de stock/precio)
        productoInfoBox.innerHTML = `
            <strong style="display: block; margin-bottom: 5px; font-size: 1.1em;">${productoActualizado.nombre}</strong>
            Próx. Vencimiento: ${proxVencimiento}<br>
            
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
                        <td style="padding: 6px; border: 1px solid #aaa;">Tableta</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(productoActualizado.precios.tableta)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleTableta}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #aaa;">Blister</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(productoActualizado.precios.blister)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleBlister}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #aaa;">Caja/Frasco</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(productoActualizado.precios.caja)}</td>
                        <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${stocksVendibles.stockVendibleCaja}</td>
                    </tr>
                </tbody>
            </table>

            ${antibioticoWarning}
        `;
    }
    
    btnAgregar.disabled = stockBase <= 0 || precio <= 0;
}

// --- BUSCAR PRODUCTOS Y LISTENERS ---
buscarInput.addEventListener("input", () => {
    const texto = buscarInput.value.toLowerCase().trim();
    listaProductos.innerHTML = "";
    
    if (texto.length < 2) { 
        productoInfoBox.innerHTML = 'Selecciona un producto de la lista.';
        productoSeleccionado = null; 
        formatoVentaSelect.disabled = true;
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
            li.textContent = `${p.nombre} - ${marcaNombre}`; 

            li.onclick = () => {
                // Al hacer clic, aseguramos que el producto seleccionado es la versión consolidada
                productoSeleccionado = productosConsolidados.find(item => item.nombre === p.nombre);
                
                llenarSelectFormato(productoSeleccionado);
                formatoVentaSelect.disabled = false;
                
                // Renderizar la información del producto
                renderInfoProducto(productoSeleccionado, formatoVentaSelect.value);

                listaProductos.innerHTML = ""; 
                buscarInput.value = p.nombre; 
                cantidadInput.focus();
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


// --- AGREGAR PRODUCTO AL CARRITO (LÓGICA CORREGIDA PARA MANEJO DE CACHÉ) ---
btnAgregar.addEventListener("click", () => {
    if (!productoSeleccionado) {
        alert("⚠️ Por favor, seleccione un producto de la lista.");
        return;
    }
    const formato = formatoVentaSelect.value;
    let cantidadRequerida = parseInt(cantidadInput.value);

    // VUELVE A CARGAR el producto más reciente antes de empezar
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
    
    // CREAMOS UNA COPIA PROFUNDA de los lotes del producto ACTUALIZADO
    const lotesTemp = JSON.parse(JSON.stringify(productoActualizado.lotes));

    // Recorrer lotes por vencimiento (FIFO) y descontar del stock total de UNIDADES
    for (const lote of lotesTemp) { 
        if (unidadesPendientes <= 0) break;

        let cantidadTomar = Math.min(unidadesPendientes, lote.stock);
        
        if (cantidadTomar > 0) {
            lotesVendidosDetallado.push({ 
                loteId: lote.id, 
                unidadesVendidas: cantidadTomar, // Unidades/Tabletas base vendidas
                stockAnteriorLote: lote.stock // Stock total antes del descuento
            });
            lote.stock -= cantidadTomar;
            unidadesPendientes -= cantidadTomar;
        }
    }
    // --- FIN DE LÓGICA DE ASIGNACIÓN DE LOTES ---

    if (unidadesPendientes > 0) {
        alert("⚠️ Error crítico: El stock total no pudo cubrir la demanda. Venta abortada.");
        return;
    }

    // ----------------------------------------------------------------
    //  ✅ CORRECCIÓN CRÍTICA: ACTUALIZAR STOCK INMEDIATAMENTE EN CACHÉ
    // ----------------------------------------------------------------
    productoActualizado.stockTotal -= unidadesBaseVendidas;

    // ----------------------------------------------------------------
    //  ✅ CORRECCIÓN ADICIONAL: ACTUALIZAR LOTES EN CACHÉ
    // ----------------------------------------------------------------
    productoActualizado.lotes = lotesTemp.filter(l => l.stock > 0); 

    // 2. Crear el ítem en el carrito
    const subtotalTotal = cantidadRequerida * precioUnitario;
    
    const index = carrito.findIndex(p => p.nombre === productoActualizado.nombre && p.formatoVenta === formato);
    
    if (index > -1) {
        alert(`⚠️ Ya existe un producto con el formato ${formato.toUpperCase()} en el carrito.`);
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
    
    // 3. Forzar el refresco de información (Síncrono para reflejar el stock restado)
    const pUpdated = productosConsolidados.find(p => p.nombre === productoSeleccionado.nombre);
    if (pUpdated) {
        productoSeleccionado = pUpdated; // Actualizar la referencia
        renderInfoProducto(productoSeleccionado, formato); 
        llenarSelectFormato(productoSeleccionado); // Para actualizar el select con el nuevo stock
    }
    
    // Limpieza de UI
    buscarInput.value = ""; 
    cantidadInput.value = "1"; 
    listaProductos.innerHTML = "";
    btnAgregar.disabled = true;
    formatoVentaSelect.disabled = true;
    productoInfoBox.innerHTML = 'Selecciona un producto de la lista.';
});


// --- REGISTRAR VENTA (APLICACIÓN ATÓMICA FINAL Y CORREGIDA) ---
btnVender.addEventListener("click", async () => {
    if (carrito.length === 0) return alert("⚠️ No hay productos en la venta.");

    // Validación de pago en efectivo
    if (metodoEfectivoRadio.checked) {
        const totalGeneral = parseFloat(totalGeneralLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        const recibido = parseFloat(dineroRecibidoInput.value) || 0;
        if (recibido < totalGeneral) {
            alert("⚠️ El dinero recibido es menor que el total de la venta.");
            return;
        }
    }


    btnVender.disabled = true;
    btnVender.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Procesando...';

    try {
        // 1. Guardar la Venta
        const total = parseFloat(totalLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        const recargo = parseFloat(recargoLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        const totalGeneral = parseFloat(totalGeneralLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        
        const venta = {
            fecha: new Date(), numeroVenta: Date.now(),
            metodoPago: metodoEfectivoRadio.checked ? "efectivo" : "tarjeta",
            productos: carrito.map(p => ({
                nombre: p.nombre, codigo: p.codigo, cantidad: p.cantidad, precioUnitario: p.precioUnitario,
                formatoVenta: p.formatoVenta, subtotal: p.subtotal, antibiotico: p.antibiotico, lotes: p.lotesVendidos
            })),
            total: total, recargo: recargo, totalGeneral: totalGeneral,
        };
        await addDoc(collection(db, "ventas"), venta);

        // 2. ACTUALIZAR STOCK EN LOTES
        const lotesAActualizar = new Map();

        // 2a. Consolidar el descuento total en unidades por lote (agrupando si un lote se usó en múltiples ítems del carrito)
        for (const itemCarrito of carrito) {
            for (const loteVendido of itemCarrito.lotesVendidos) {
                const { loteId, unidadesVendidas, stockAnteriorLote } = loteVendido;

                if (!lotesAActualizar.has(loteId)) {
                    lotesAActualizar.set(loteId, {
                        unidadesVendidasTotales: 0,
                        stockAnteriorLote: stockAnteriorLote, 
                        loteOriginal: lotesInventario.find(l => l.id === loteId)
                    });
                }
                lotesAActualizar.get(loteId).unidadesVendidasTotales += unidadesVendidas;
            }
        }

        // 2b. Ejecutar la actualización en Firebase (usando reconvertirStock)
        for (const [loteId, dataUpdate] of lotesAActualizar.entries()) {
            const loteOriginal = dataUpdate.loteOriginal;
            if (!loteOriginal) continue;
            
            // Calcular el NUEVO STOCK TOTAL de UNIDADES
            const nuevoStockTotal = loteOriginal.stock - dataUpdate.unidadesVendidasTotales;

            // RECONVERTIR: Calcular los nuevos stocks físicos (caja, blister, tableta)
            const { stockCaja, stockBlister, stockTableta } = reconvertirStock(
                nuevoStockTotal, 
                loteOriginal.tabletasPorBlister, 
                loteOriginal.blistersPorCaja
            );

            // Ejecutar la actualización ATÓMICA en Firebase
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
        await cargarProductos(); // Recarga toda la caché
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

window.cambiarCantidad = (index, delta) => {
    alert("Para productos que manejan lotes y diferentes formatos, por seguridad, por favor elimine el artículo y vuelva a añadir la cantidad correcta.");
};

window.eliminarProducto = (index) => {
    // 1. Eliminar del carrito
    const productoEliminado = carrito.splice(index, 1)[0];
    
    // 2. Intentar revertir el stock en caché (si el producto está visible en la búsqueda)
    const productoCache = productosConsolidados.find(p => p.nombre === productoEliminado.nombre);
    
    if (productoCache) {
        // Revertir el stock total de unidades base
        productoCache.stockTotal += productoEliminado.unidadesBaseVendidas; 

        // Forzar la recarga de productos para actualizar los lotes correctamente
        cargarProductos().then(() => {
            if (productoSeleccionado && productoSeleccionado.nombre === productoEliminado.nombre) {
                // Si era el producto seleccionado, refrescar la vista
                const pUpdated = productosConsolidados.find(p => p.nombre === productoSeleccionado.nombre);
                if (pUpdated) {
                    productoSeleccionado = pUpdated;
                    renderInfoProducto(productoSeleccionado, formatoVentaSelect.value);
                    llenarSelectFormato(productoSeleccionado);
                }
            }
        });
    }

    renderTablaVenta();
    actualizarTotales();
};

metodoEfectivoRadio.addEventListener("change", actualizarTotales);
metodoTarjetaRadio.addEventListener("change", actualizarTotales);
dineroRecibidoInput.addEventListener("input", actualizarTotales);

function actualizarTotales() {
    let totalNeto = carrito.reduce((sum, p) => sum + p.subtotal, 0);
    
    let recargo = metodoTarjetaRadio.checked ? totalNeto * 0.05 : 0;
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
            cambioDisplayDiv.className = "change-display"; 
        } else {
            cambioLbl.textContent = `Faltan ${formatoMoneda(Math.abs(cambio))}`;
            cambioDisplayDiv.className = "change-display negative";
        }
    } else {
        cajaEfectivoSection.style.display = "none";
        dineroRecibidoInput.value = "";
    }
}

actualizarTotales();