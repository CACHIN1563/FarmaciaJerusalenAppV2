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
const btnVender = document.getElementById("btnVender");
const cantidadInput = document.getElementById("cantidad");
const formatoVentaSelect = document.getElementById("formatoVenta"); 
const productoInfoBox = document.getElementById("productoInfo");
const tablaVentaBody = document.querySelector("#tablaVenta tbody");

// Elementos del método de pago
const metodoEfectivoRadio = document.getElementById("metodoEfectivo");
const metodoTarjetaRadio = document.getElementById("metodoTarjeta");
const cajaEfectivoSection = document.getElementById("cajaEfectivo");
const dineroRecibidoInput = document.getElementById("dineroRecibido");

// Elementos de totales y cambio
const totalLbl = document.getElementById("total");
const recargoLbl = document.getElementById("recargo");
const totalGeneralLbl = document.getElementById("totalGeneral");
const cambioLbl = document.getElementById("cambio");
const cambioDisplayDiv = document.getElementById("cambioDisplay");

// --- ESTADO DE LA APLICACIÓN ---
let lotesInventario = []; 
let productosConsolidados = []; 
let productoSeleccionado = null; 
let carrito = []; 

// --- FUNCIONES DE UTILIDAD ---
const formatoMoneda = (monto) => {
    return `Q ${monto.toFixed(2)}`;
};

/**
 * Agrupa los lotes por nombre/ID, consolida el stock por formato y los precios de venta.
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
                // LÓGICA CORREGIDA AQUÍ: Si cualquier lote es antibiótico, el producto lo es.
                antibiotico: lote.antibiotico === true || lote.antibiotico === 'Sí', 
                // PRECIOS Y STOCK POR FORMATO
                precios: {
                    publico: 0,
                    unidad: 0,
                    capsula: 0,
                    tableta: 0,
                    blister: 0,
                    caja: 0,
                },
                stocks: {
                    unidad: 0, 
                    tableta: 0,
                    blister: 0,
                    caja: 0,
                },
                lotes: [] 
            });
        }

        const producto = productosAgrupados.get(clave);

        producto.stockTotal += lote.stock;
        
        producto.stocks.unidad += lote.stock;
        producto.stocks.tableta += lote.stockTableta;
        producto.stocks.blister += lote.stockBlister;
        producto.stocks.caja += lote.stockCaja;

        // Si encontramos un lote antibiótico en la iteración, marcamos el producto consolidado como tal
        if (lote.antibiotico === true || lote.antibiotico === 'Sí') {
             producto.antibiotico = true;
        }

        if (lote.precioPublico) producto.precios.publico = lote.precioPublico;
        if (lote.precioUnidad) producto.precios.unidad = lote.precioUnidad;
        if (lote.precioCapsula) producto.precios.capsula = lote.precioCapsula;
        if (lote.precioTableta) producto.precios.tableta = lote.precioTableta;
        if (lote.precioBlister) producto.precios.blister = lote.precioBlister;
        if (lote.precioCaja) producto.precios.caja = lote.precioCaja;

        producto.lotes.push({
            id: lote.id, 
            stock: lote.stock, 
            stockTableta: lote.stockTableta,
            stockBlister: lote.stockBlister,
            stockCaja: lote.stockCaja,
            vencimiento: lote.vencimiento ? new Date(lote.vencimiento) : new Date(0),
            preciosLote: {
                unidad: lote.precioUnidad,
                capsula: lote.precioCapsula,
                tableta: lote.precioTableta,
                blister: lote.precioBlister,
                caja: lote.precioCaja,
            },
        });
    });

    productosAgrupados.forEach(producto => {
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
                stock: parseInt(data.stock) || 0,
                stockTableta: parseInt(data.stockTableta) || 0,
                stockBlister: parseInt(data.stockBlister) || 0,
                stockCaja: parseInt(data.stockCaja) || 0,
                precioPublico: parseFloat(data.precioPublico) || 0,
                precioUnidad: parseFloat(data.precioUnidad) || 0,
                precioCapsula: parseFloat(data.precioCapsula) || 0,
                precioTableta: parseFloat(data.precioTableta) || 0,
                precioBlister: parseFloat(data.precioBlister) || 0,
                precioCaja: parseFloat(data.precioCaja) || 0,
                marca: data.marca || '',
                // LÓGICA CORREGIDA AQUÍ: Asegurar que se interpreta como booleano si viene de Firebase.
                antibiotico: data.antibiotico === true || data.antibiotico === 'Sí', 
            });
        });
        
        productosConsolidados = agruparLotes(lotesInventario);

        console.log(`Inventario cargado. ${lotesInventario.length} lotes encontrados. ${productosConsolidados.length} productos únicos.`);
    } catch (error) {
        console.error("Error al cargar productos:", error);
        alert("Hubo un error al cargar el inventario.");
    }
}
cargarProductos();

// --- FUNCIONES DE RENDER Y LÓGICA DE UI ---

/**
 * Rellena el select de formatos de venta SOLO con Tableta, Blister y Caja.
 * @param {Object} producto - Producto consolidado.
 */
function llenarSelectFormato(producto) {
    const formatosPermitidos = {
        'tableta': 'Tableta (Tira)',
        'blister': 'Blister',
        'caja': 'Caja/Frasco', 
    };

    formatoVentaSelect.innerHTML = '';
    
    for (const [key, label] of Object.entries(formatosPermitidos)) {
        const precio = producto.precios[key] || 0;
        const stock = producto.stocks[key] || 0;
        
        if (precio > 0 || stock > 0) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${label} (${formatoMoneda(precio)})`;
            formatoVentaSelect.appendChild(option);
        }
    }
    
    // Seleccionar el formato de mayor prioridad si existe
    if (producto.precios.caja > 0 && producto.stocks.caja > 0) formatoVentaSelect.value = 'caja';
    else if (producto.precios.blister > 0 && producto.stocks.blister > 0) formatoVentaSelect.value = 'blister';
    else if (producto.precios.tableta > 0 && producto.stocks.tableta > 0) formatoVentaSelect.value = 'tableta';
    else if (formatoVentaSelect.options.length > 0) formatoVentaSelect.value = formatoVentaSelect.options[0].value;
}

/**
 * Renderiza la información del producto en el infoBox utilizando una TABLA estilizada.
 * Muestra un resumen del producto, incluyendo Precios y Stocks de los 3 formatos clave.
 * @param {Object} producto - Producto consolidado.
 * @param {string} formato - Clave del formato ('tableta', 'blister', 'caja').
 */
function renderInfoProducto(producto, formato) {
    const precio = producto.precios[formato] || 0;
    
    let stockBase = 0; 
    let campoDescuento = 'stock'; 

    // Determinar stock base y campo de descuento (lógica necesaria para btnAgregar)
    if (formato === 'tableta') {
        stockBase = producto.stocks.tableta;
        campoDescuento = 'stockTableta';
    } else if (formato === 'blister') {
        stockBase = producto.stocks.blister;
        campoDescuento = 'stockBlister';
    } else if (formato === 'caja') {
        stockBase = producto.stocks.caja;
        campoDescuento = 'stockCaja';
    } else {
        stockBase = 0; 
        campoDescuento = 'stock';
    }
    
    productoSeleccionado.stockBaseFormato = stockBase; 
    productoSeleccionado.campoDescuento = campoDescuento;
    
    // Ahora, si producto.antibiotico es true, mostrará la advertencia.
    const antibioticoWarning = producto.antibiotico 
        ? `<span class="antibiotico-warning" style="font-weight: bold; color: #b00020;"><i class="fas fa-exclamation-triangle"></i>Antibiótico - Producto Controlado</span>`
        : `<span class="regular-product" style="font-weight: bold; color: #1e88e5;"><i class="fas fa-info-circle"></i> Producto regular</span>`;

    const proxVencimiento = producto.lotes.length > 0 ? 
        producto.lotes[0].vencimiento.toISOString().split('T')[0] : 'N/A';
    
    // === FORMATO DE VISUALIZACIÓN EN TABLA ESTILIZADA ===
    productoInfoBox.innerHTML = `
        <strong style="display: block; margin-bottom: 5px;">${producto.nombre}</strong>
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
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(producto.precios.tableta)}</td>
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${producto.stocks.tableta}</td>
                </tr>
                <tr>
                    <td style="padding: 6px; border: 1px solid #aaa;">Blister</td>
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(producto.precios.blister)}</td>
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${producto.stocks.blister}</td>
                </tr>
                <tr>
                    <td style="padding: 6px; border: 1px solid #aaa;">Caja/Frasco</td>
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center;">${formatoMoneda(producto.precios.caja)}</td>
                    <td style="padding: 6px; border: 1px solid #aaa; text-align: center; font-weight: bold;">${producto.stocks.caja}</td>
                </tr>
            </tbody>
        </table>

        ${antibioticoWarning}
    `;
    
    // Habilitar/deshabilitar botón
    btnAgregar.disabled = stockBase <= 0 || precio <= 0;
}

// --- BUSCAR PRODUCTOS (Autocomplete) ---
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
            
            // MODIFICACIÓN SOLICITADA: SOLO NOMBRE Y EMPRESA/MARCA
            const marcaNombre = p.marca || 'Proveedor Desconocido';
            li.textContent = `${p.nombre} - ${marcaNombre}`; 

            li.onclick = () => {
                productoSeleccionado = p;
                
                llenarSelectFormato(p);
                formatoVentaSelect.disabled = false;
                
                renderInfoProducto(p, formatoVentaSelect.value);

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

// Listener para actualizar la información cuando cambia el formato de venta
formatoVentaSelect.addEventListener('change', () => {
    if (productoSeleccionado) {
        renderInfoProducto(productoSeleccionado, formatoVentaSelect.value);
    }
});

// --- AGREGAR PRODUCTO AL CARRITO (Aplica Lógica FIFO POR FORMATO) ---
btnAgregar.addEventListener("click", () => {
    if (!productoSeleccionado) {
        alert("⚠️ Por favor, seleccione un producto de la lista.");
        return;
    }
    const formato = formatoVentaSelect.value;
    let cantidadRequerida = parseInt(cantidadInput.value);

    const precioUnitario = productoSeleccionado.precios[formato] || 0;
    const stockBase = productoSeleccionado.stockBaseFormato || 0;
    const campoDescuento = productoSeleccionado.campoDescuento;

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

    // 1. Lógica para asignar la cantidad a los lotes (FIFO)
    let cantidadPendiente = cantidadRequerida;
    const lotesAfectados = [];
    
    for (const lote of productoSeleccionado.lotes) {
        if (cantidadPendiente <= 0) break;

        const stockLoteDisponible = lote[campoDescuento]; 
        const cantidadTomar = Math.min(cantidadPendiente, stockLoteDisponible);

        if (cantidadTomar > 0) {
            lotesAfectados.push({
                loteId: lote.id,
                cantidad: cantidadTomar,
                campoDescontar: campoDescuento, 
            });
            cantidadPendiente -= cantidadTomar;
        }
    }
    
    if (cantidadPendiente > 0) {
        alert("⚠️ Error crítico en la asignación de lotes. La venta no es posible.");
        return;
    }

    // 2. Crear el ítem en el carrito
    const subtotalTotal = cantidadRequerida * precioUnitario;
    
    const index = carrito.findIndex(p => p.nombre === productoSeleccionado.nombre && p.formatoVenta === formato);
    
    if (index > -1) {
        alert(`⚠️ Ya existe un producto con el formato ${formato.toUpperCase()} en el carrito.`);
        return;
    } else {
        carrito.push({
            nombre: productoSeleccionado.nombre,
            codigo: productoSeleccionado.codigo,
            cantidad: cantidadRequerida,
            precioUnitario: precioUnitario,
            subtotal: subtotalTotal,
            antibiotico: productoSeleccionado.antibiotico,
            formatoVenta: formato, 
            lotesVendidos: lotesAfectados 
        });
    }

    renderTablaVenta();
    actualizarTotales();
    
    // 3. Limpieza de UI y actualización temporal de stock
    productoSeleccionado.stocks[formato] -= cantidadRequerida; 
    
    renderInfoProducto(productoSeleccionado, formato); 
    
    buscarInput.value = ""; 
    cantidadInput.value = "1"; 
    listaProductos.innerHTML = "";
    btnAgregar.disabled = true;
    formatoVentaSelect.disabled = true;
    productoInfoBox.innerHTML = 'Selecciona un producto de la lista.';
});

// --- RENDER TABLA DE VENTA ---
function renderTablaVenta() {
    tablaVentaBody.innerHTML = "";

    if (carrito.length === 0) {
        tablaVentaBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">No hay productos en la venta.</td></tr>`;
        btnVender.disabled = true;
        return;
    }

    btnVender.disabled = false;
    
    carrito.forEach((p, i) => {
        const fila = `
        <tr>
            <td>${p.nombre}</td>
            <td>${p.formatoVenta.toUpperCase().replace('CAJA', 'CAJA/FRASCO')}</td> 
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

// --- CONTROLES DE TABLA (Globales) ---
window.cambiarCantidad = (index, delta) => {
    alert("Para productos que manejan lotes y diferentes formatos, por seguridad, por favor elimine el artículo y vuelva a añadir la cantidad correcta.");
};

window.eliminarProducto = (index) => {
    carrito.splice(index, 1);
    renderTablaVenta();
    actualizarTotales();
};

// --- MANEJO DE TOTALES Y PAGOS ---
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


// --- REGISTRAR VENTA ---
btnVender.addEventListener("click", async () => {
    if (carrito.length === 0) return alert("⚠️ No hay productos en la venta.");

    if (metodoEfectivoRadio.checked) {
        let totalFinal = parseFloat(totalGeneralLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        let recibido = parseFloat(dineroRecibidoInput.value || 0);
        
        if (recibido < totalFinal) {
            return alert("⚠️ El dinero recibido es menor al Total General. Ingrese el monto correcto.");
        }
    }
    
    btnVender.disabled = true;
    btnVender.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Procesando...';

    try {
        const total = parseFloat(totalLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        const recargo = parseFloat(recargoLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        const totalGeneral = parseFloat(totalGeneralLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        
        const venta = {
            fecha: new Date(),
            numeroVenta: Date.now(),
            metodoPago: metodoEfectivoRadio.checked ? "efectivo" : "tarjeta",
            
            productos: carrito.map(p => ({
                nombre: p.nombre,
                codigo: p.codigo,
                cantidad: p.cantidad,
                precioUnitario: p.precioUnitario,
                formatoVenta: p.formatoVenta, 
                subtotal: p.subtotal,
                antibiotico: p.antibiotico,
                lotes: p.lotesVendidos 
            })),
            
            total: total,
            recargo: recargo,
            totalGeneral: totalGeneral,
        };

        // 1. Guardar la Venta
        await addDoc(collection(db, "ventas"), venta);

        // 2. ACTUALIZAR STOCK EN LOTES
        for (const itemCarrito of carrito) {
            for (const loteVendido of itemCarrito.lotesVendidos) {
                const ref = doc(db, "inventario", loteVendido.loteId);
                
                const loteOriginal = lotesInventario.find(l => l.id === loteVendido.loteId);
                
                if (loteOriginal) {
                    const campoAActualizar = loteVendido.campoDescontar;
                    const stockActual = loteOriginal[campoAActualizar] || 0;
                    const nuevoStock = stockActual - loteVendido.cantidad; 
                    
                    const actualizacion = {
                        [campoAActualizar]: nuevoStock
                    };
                    
                    await updateDoc(ref, actualizacion);
                }
            }
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

// Inicialización de totales
actualizarTotales();