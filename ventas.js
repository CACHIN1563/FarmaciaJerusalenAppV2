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
let lotesInventario = []; // Lista completa de LOTES (documentos de Firestore)
let productosConsolidados = []; // Lista de PRODUCTOS únicos (para la búsqueda)
let productoSeleccionado = null; // Producto actualmente seleccionado (del listado CONSOLIDADO)
let carrito = []; // Productos en la venta actual

// --- FUNCIONES DE UTILIDAD ---
const formatoMoneda = (monto) => {
    return `Q ${monto.toFixed(2)}`;
};

/**
 * Agrupa los lotes por nombre/ID, consolida el stock total y encuentra el mejor precio de venta.
 * @param {Array} lotes - Lista de todos los lotes de Firestore.
 * @returns {Array} Lista de productos consolidados para la UI.
 */
const agruparLotes = (lotes) => {
    const productosAgrupados = new Map();

    lotes.forEach(lote => {
        // Usar el nombre como clave si no hay un ID de producto central
        const clave = lote.nombre; 
        
        if (!productosAgrupados.has(clave)) {
            productosAgrupados.set(clave, {
                nombre: lote.nombre,
                codigo: lote.codigo || '',
                stockTotal: 0,
                precioVenta: 0, // Lo inicializamos a 0, se actualizará
                antibiotico: lote.antibiotico === 'Sí',
                // Mantenemos una referencia a los lotes (ordenados por fecha de vencimiento)
                lotes: [] 
            });
        }

        const producto = productosAgrupados.get(clave);

        // Acumular stock total
        producto.stockTotal += lote.stock;

        // Establecer el precio de venta (usamos el del primer lote o el más alto)
        // Nota: Para simplificar, asumimos que el precio de venta es el mismo o usamos el último cargado.
        // Si necesitas el precio MÁS BAJO o MÁS ALTO, se necesita más lógica aquí.
        producto.precioVenta = parseFloat(lote.precio) || 0; 

        // Almacenar el lote completo. Añadimos el ID del documento de Firestore y la fecha para FIFO
        producto.lotes.push({
            id: lote.id, // ID del documento de Firestore (LOTE)
            stock: lote.stock,
            vencimiento: lote.vencimiento ? new Date(lote.vencimiento) : new Date(0), // Convertir a Date
            precio: parseFloat(lote.precio) || 0,
            antibiotico: lote.antibiotico === 'Sí'
        });
    });

    // Opcional: Ordenar los lotes internos por fecha de vencimiento (FIFO)
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
                id: docu.id, // ID del lote
                stock: parseInt(data.stock) || 0,
                precio: parseFloat(data.precio) || 0,
            });
        });
        
        // AGREGAR: Consolidar los lotes en productos únicos
        productosConsolidados = agruparLotes(lotesInventario);

        console.log(`Inventario cargado. ${lotesInventario.length} lotes encontrados. ${productosConsolidados.length} productos únicos.`);
    } catch (error) {
        console.error("Error al cargar productos:", error);
        alert("Hubo un error al cargar el inventario.");
    }
}
cargarProductos();

// --- BUSCAR PRODUCTOS (Autocomplete) ---
buscarInput.addEventListener("input", () => {
    const texto = buscarInput.value.toLowerCase().trim();
    listaProductos.innerHTML = "";
    
    // Si la búsqueda es vacía, limpiar el estado
    if (texto.length < 2) { 
        productoInfoBox.innerHTML = 'Selecciona un producto de la lista.';
        productoSeleccionado = null; 
        return;
    }
    
    // Buscar en la lista CONSOLIDADA
    const filtrados = productosConsolidados.filter(p =>
        p.nombre.toLowerCase().includes(texto) || (p.codigo && p.codigo.toLowerCase().includes(texto))
    );
    
    // **Mostrar solo 5 resultados para no saturar la UI**
    const resultadosParaMostrar = filtrados.slice(0, 5); 

    if (resultadosParaMostrar.length > 0) {
        resultadosParaMostrar.forEach(p => {
            const li = document.createElement("li");
            // Usamos el stock TOTAL para las sugerencias
            li.textContent = `${p.nombre} (Stock Total: ${p.stockTotal}) - ${formatoMoneda(p.precioVenta)}`;

            li.onclick = () => {
                // 1. Asignar el producto seleccionado (CONSOLIDADO)
                productoSeleccionado = p;
                
                // 2. Renderizar información en el box
                const warning = p.antibiotico 
                    ? `<span class="antibiotico-warning"><i class="fas fa-exclamation-triangle"></i> Producto con receta</span>`
                    : "Producto regular";

                // Encontrar el lote que vence más pronto (FIFO) para mostrar la info
                const proxVencimiento = p.lotes.length > 0 ? 
                    p.lotes[0].vencimiento.toISOString().split('T')[0] : 'N/A';
                
                productoInfoBox.innerHTML = `
                    <strong>${p.nombre}</strong><br>
                    Precio: ${formatoMoneda(p.precioVenta)} | Stock Total: <strong>${p.stockTotal}</strong><br>
                    Próx. Vencimiento: ${proxVencimiento}<br>
                    ${warning}
                `;
                
                // 3. Limpiar y enfocar para la siguiente acción
                listaProductos.innerHTML = ""; // Limpia las sugerencias
                buscarInput.value = p.nombre; // Deja el nombre del producto en el input
                cantidadInput.focus(); 
            };
            listaProductos.appendChild(li);
        });
    } else {
        listaProductos.innerHTML = '<li style="cursor: default; background: #fff; padding: 10px 15px;">No se encontraron coincidencias.</li>';
    }
});


// --- AGREGAR PRODUCTO AL CARRITO (Aplica Lógica FIFO) ---
btnAgregar.addEventListener("click", () => {
    if (!productoSeleccionado) {
        alert("⚠️ Por favor, seleccione un producto de la lista.");
        return;
    }
    let cantidadRequerida = parseInt(cantidadInput.value);

    if (isNaN(cantidadRequerida) || cantidadRequerida <= 0) {
        alert("⚠️ Cantidad inválida. Debe ser un número positivo.");
        return;
    }
    
    if (cantidadRequerida > productoSeleccionado.stockTotal) {
        alert(`⚠️ No hay suficiente stock. Disponible: ${productoSeleccionado.stockTotal}.`);
        return;
    }

    // Lógica para asignar la cantidad a los lotes (FIFO: el que vence antes, se vende primero)
    let cantidadPendiente = cantidadRequerida;
    const lotesAfectados = [];
    
    // Los lotes ya están ordenados por fecha de vencimiento (FIFO)
    for (const lote of productoSeleccionado.lotes) {
        if (cantidadPendiente <= 0) break;

        // Stock real del lote actual
        const stockLote = lote.stock; 
        
        // Cantidad a tomar de este lote
        const cantidadTomar = Math.min(cantidadPendiente, stockLote);

        if (cantidadTomar > 0) {
            lotesAfectados.push({
                loteId: lote.id,
                cantidad: cantidadTomar,
                precio: lote.precio,
                subtotal: cantidadTomar * lote.precio
            });
            cantidadPendiente -= cantidadTomar;
        }
    }

    // Unir o crear el ítem en el carrito
    const index = carrito.findIndex(p => p.nombre === productoSeleccionado.nombre);
    
    if (index > -1) {
        // Producto ya existe: NO SE PERMITE MODIFICAR DIRECTAMENTE, se debe crear uno nuevo 
        // o manejar la actualización de lotes (la gestión de lotes es compleja y se simplificará)
        alert("⚠️ Por el manejo de lotes, primero elimine el producto del carrito y vuelva a agregarlo con la cantidad total deseada.");
        return;
    } else {
        // Producto nuevo: agregar ítem detallado
        const subtotalTotal = lotesAfectados.reduce((sum, l) => sum + l.subtotal, 0);
        carrito.push({
            nombre: productoSeleccionado.nombre,
            codigo: productoSeleccionado.codigo,
            cantidad: cantidadRequerida,
            precioUnitario: productoSeleccionado.precioVenta, // Precio de referencia
            subtotal: subtotalTotal,
            antibiotico: productoSeleccionado.antibiotico,
            stockInventario: productoSeleccionado.stockTotal,
            lotesVendidos: lotesAfectados // AQUI ESTÁ LA CLAVE: qué lotes se usan
        });
    }

    renderTablaVenta();
    actualizarTotales();
    
    // --- LIMPIEZA DE ESTADO DESPUÉS DE AGREGAR ---
    productoSeleccionado = null; 
    buscarInput.value = ""; 
    cantidadInput.value = "1"; 
    productoInfoBox.innerHTML = 'Selecciona un producto de la lista.';
    listaProductos.innerHTML = ""; 
});

// --- RENDER TABLA DE VENTA ---
function renderTablaVenta() {
    tablaVentaBody.innerHTML = "";

    if (carrito.length === 0) {
        tablaVentaBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">No hay productos en la venta.</td></tr>`;
        btnVender.disabled = true;
        return;
    }

    btnVender.disabled = false; // Habilitar el botón si hay productos
    
    carrito.forEach((p, i) => {
        // El precio unitario real es el subtotal/cantidad, ya que puede venir de varios lotes
        const precioRealUnitario = p.subtotal / p.cantidad; 
        const fila = `
        <tr>
            <td>${p.nombre}</td>
            <td>
                <div class="quantity-controls">
                    <button onclick="cambiarCantidad(${i}, -1)" disabled><i class="fas fa-minus"></i></button>
                    <span>${p.cantidad}</span>
                    <button onclick="cambiarCantidad(${i}, 1)" disabled><i class="fas fa-plus"></i></button>
                </div>
            </td>
            <td>${formatoMoneda(precioRealUnitario)}</td>
            <td>${formatoMoneda(p.subtotal)}</td>
            <td><button class="btn-remove" onclick="eliminarProducto(${i})" title="Eliminar"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`;
        tablaVentaBody.innerHTML += fila;
    });
    
    // NOTA: Se desactivan los botones +/- en el carrito. Para cambiar la cantidad
    // de un producto con lotes, es más seguro eliminar y volver a añadir.
    // Si realmente necesitas el +/- en el carrito, se requiere una lógica FIFO muy compleja para cada cambio.
}

// --- CONTROLES DE TABLA (Globales) ---
window.cambiarCantidad = (index, delta) => {
    alert("Para productos que manejan lotes, por seguridad, por favor elimine el artículo y vuelva a añadir la cantidad correcta.");
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
            cambioDisplayDiv.className = "change-display"; // Clase por defecto (positivo)
        } else {
            cambioLbl.textContent = `Faltan ${formatoMoneda(Math.abs(cambio))}`;
            cambioDisplayDiv.className = "change-display negative"; // Rojo
        }
    } else {
        cajaEfectivoSection.style.display = "none";
        dineroRecibidoInput.value = "";
    }
    
    renderTablaVenta();
}


// --- REGISTRAR VENTA ---
btnVender.addEventListener("click", async () => {
    if (carrito.length === 0) return alert("⚠️ No hay productos en la venta.");

    // Validación de efectivo
    if (metodoEfectivoRadio.checked) {
        let totalFinal = parseFloat(totalGeneralLbl.textContent.replace('Q ', '').replace(',', '')) || 0;
        let recibido = parseFloat(dineroRecibidoInput.value || 0);
        
        if (recibido < totalFinal) {
            return alert("⚠️ El dinero recibido es menor al Total General. Ingrese el monto correcto.");
        }
    }
    
    // Deshabilitar botón
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
            
            // Mapeamos los productos en el carrito, pero detallando los lotes vendidos
            productos: carrito.map(p => ({
                nombre: p.nombre,
                codigo: p.codigo,
                cantidad: p.cantidad,
                precioReferencia: p.precioUnitario,
                subtotal: p.subtotal,
                lotes: p.lotesVendidos // Lotes afectados
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
                
                // Buscar el lote original en el inventario cargado para el stock actual
                const loteOriginal = lotesInventario.find(l => l.id === loteVendido.loteId);
                
                if (loteOriginal) {
                    const nuevoStock = loteOriginal.stock - loteVendido.cantidad; 
                    
                    await updateDoc(ref, {
                        stock: nuevoStock,
                        // Opcional: podrías querer actualizar el nombre/precio si cambiaste alguno 
                    });
                }
            }
        }

        alert("✅ Venta registrada exitosamente.");
        
        // --- RESTAURAR ESTADO DE LA UI ---
        carrito = []; 
        await cargarProductos(); // Volver a cargar el inventario actualizado (lotes y consolidados)
        renderTablaVenta();
        actualizarTotales();
        
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