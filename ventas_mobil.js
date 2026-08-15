// ventas_mobil.js - Lógica del Punto de Venta Móvil de Farmacia Jerusalén
import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    addDoc,
    doc,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- ELEMENTOS DEL DOM ---
const buscarInput = document.getElementById("buscarMobil");
const btnClearSearch = document.getElementById("btnClearSearch");
const listaResultados = document.getElementById("listaResultadosMobil");

const cardProducto = document.getElementById("cardProductoSeleccionado");
const emptyStateBox = document.getElementById("emptyStateBox");
const prodNombreEl = document.getElementById("prodNombreMobil");
const prodMarcaEl = document.getElementById("prodMarcaMobil");
const badgeStockTotal = document.getElementById("badgeStockTotal");
const badgeVencimiento = document.getElementById("badgeVencimiento");
const badgeAntibiotico = document.getElementById("badgeAntibiotico");

// Formatos
const optTableta = document.getElementById("optFormatoTableta");
const optBlister = document.getElementById("optFormatoBlister");
const optCaja = document.getElementById("optFormatoCaja");
const precioTabletaEl = document.getElementById("precioFormatoTableta");
const precioBlisterEl = document.getElementById("precioFormatoBlister");
const precioCajaEl = document.getElementById("precioFormatoCaja");
const stockTabletaEl = document.getElementById("stockFormatoTableta");
const stockBlisterEl = document.getElementById("stockFormatoBlister");
const stockCajaEl = document.getElementById("stockFormatoCaja");

// Controles de cantidad y botón agregar
const btnQtyMinus = document.getElementById("btnQtyMinus");
const btnQtyPlus = document.getElementById("btnQtyPlus");
const inputQty = document.getElementById("inputQtyMobil");
const btnAgregar = document.getElementById("btnAgregarMobil");

// Sección carrito rápido
const quickCartSection = document.getElementById("quickCartSection");
const quickCartCountEl = document.getElementById("quickCartCount");
const cartCardsList = document.getElementById("cartCardsList");
const btnVaciarCarrito = document.getElementById("btnVaciarCarrito");

// Barra inferior
const barTotalGeneral = document.getElementById("barTotalGeneral");
const btnAbrirCheckout = document.getElementById("btnAbrirCheckout");
const headerCartCountEl = document.getElementById("headerCartCount");
const btnHeaderCart = document.getElementById("btnHeaderCart");

// Modal / Drawer de Checkout
const drawerOverlay = document.getElementById("checkoutDrawerOverlay");
const btnCerrarDrawer = document.getElementById("btnCerrarDrawer");
const drawerSubtotalNeto = document.getElementById("drawerSubtotalNeto");
const drawerRecargoRow = document.getElementById("drawerRecargoRow");
const drawerRecargoTarjeta = document.getElementById("drawerRecargoTarjeta");
const drawerTotalFinal = document.getElementById("drawerTotalFinal");

const btnPagoEfectivo = document.getElementById("btnPagoEfectivo");
const btnPagoTarjeta = document.getElementById("btnPagoTarjeta");
const seccionEfectivo = document.getElementById("seccionEfectivoMobil");
const inputDineroRecibido = document.getElementById("inputDineroRecibidoMobil");
const badgeCambio = document.getElementById("badgeCambioMobil");
const labelCambio = document.getElementById("labelCambioMobil");
const btnCashExacto = document.getElementById("btnCashExacto");
const quickCashBtns = document.querySelectorAll(".btn-quick-cash[data-cash]");
const btnConfirmarVenta = document.getElementById("btnConfirmarVentaMobil");

// Toast
const toastNotification = document.getElementById("toastNotification");
const toastIcon = document.getElementById("toastIcon");
const toastMsg = document.getElementById("toastMsg");

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
let lotesInventario = [];
let productosConsolidados = [];
let productoSeleccionado = null;
let formatoSeleccionado = 'tableta';
let carrito = [];
let metodoPago = 'efectivo'; // 'efectivo' o 'tarjeta'
const RECARGO_TARJETA = 0.05; // 5% de recargo

// --- FUNCIONES DE UTILIDAD ---
const formatoMoneda = (monto) => {
    return `Q ${parseFloat(monto || 0).toFixed(2)}`;
};

const triggerHaptic = () => {
    if ("vibrate" in navigator) {
        try { navigator.vibrate(15); } catch (e) {}
    }
};

let toastTimeout = null;
const showToast = (mensaje, tipo = "info") => {
    if (toastTimeout) clearTimeout(toastTimeout);
    
    toastMsg.textContent = mensaje;
    toastNotification.className = `toast-notification ${tipo} active`;

    if (tipo === "success") {
        toastIcon.className = "fas fa-check-circle";
    } else if (tipo === "error") {
        toastIcon.className = "fas fa-exclamation-circle";
    } else {
        toastIcon.className = "fas fa-info-circle";
    }

    toastTimeout = setTimeout(() => {
        toastNotification.classList.remove("active");
    }, 2800);
};

function excelDateToJSDate(excelDate) {
    if (!excelDate || isNaN(excelDate)) return null;
    const serial = parseFloat(excelDate);
    if (serial < 1) return null;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const baseDate = new Date('1899-12-30T00:00:00Z');
    const adjustment = serial >= 60 ? -1 : 0;
    const milliseconds = baseDate.getTime() + (serial + adjustment) * MS_PER_DAY;
    return new Date(milliseconds);
}

const formatearFechaDisplay = (dateObj) => {
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
        return dateObj.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    return 'N/A';
};

function reconvertirStock(stockTotal, upb, bpc) {
    upb = upb > 0 ? upb : 1;
    bpc = bpc > 0 ? bpc : 1;
    const unidadesPorCaja = upb * bpc;

    let stockTemp = stockTotal;
    const stockCaja = Math.floor(stockTemp / unidadesPorCaja);
    stockTemp -= stockCaja * unidadesPorCaja;

    const stockBlister = Math.floor(stockTemp / upb);
    stockTemp -= stockBlister * upb;

    const stockTableta = stockTemp;
    return { stockCaja, stockBlister, stockTableta };
}

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
                antibiotico: lote.antibiotico === true || lote.antibiotico === 'Sí' || lote.antibiotico === 'SI',
                tabletasPorBlister: lote.tabletasPorBlister || 1,
                blistersPorCaja: lote.blistersPorCaja || 1,
                tipoProducto: lote.tipoProducto || 'farmaceutico',
                precios: { tableta: 0, blister: 0, caja: 0 },
                lotes: [],
                proxVencimiento: null,
            });
        }

        const producto = productosAgrupados.get(clave);
        producto.stockTotal += lote.stock;

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

        if (lote.antibiotico === true || lote.antibiotico === 'Sí' || lote.antibiotico === 'SI') {
            producto.antibiotico = true;
        }

        const vencimientoDate = lote.vencimiento ? new Date(lote.vencimiento) : null;

        producto.lotes.push({
            id: lote.id,
            stock: lote.stock,
            vencimiento: vencimientoDate,
        });
    });

    productosAgrupados.forEach(producto => {
        producto.lotes.sort((a, b) => {
            const timeA = a.vencimiento ? a.vencimiento.getTime() : Infinity;
            const timeB = b.vencimiento ? b.vencimiento.getTime() : Infinity;
            return timeA - timeB;
        });

        if (producto.lotes.length > 0 && producto.lotes[0].vencimiento) {
            producto.proxVencimiento = producto.lotes[0].vencimiento;
        }
    });

    return Array.from(productosAgrupados.values());
};

// --- CARGA DE PRODUCTOS DESDE FIREBASE ---
async function cargarProductos() {
    try {
        const querySnapshot = await getDocs(collection(db, "inventario"));
        lotesInventario = [];
        querySnapshot.forEach(docu => {
            const data = docu.data();

            let vencimientoDate = null;
            if (data.vencimiento) {
                if (typeof data.vencimiento.toDate === 'function') {
                    vencimientoDate = data.vencimiento.toDate();
                } else if (typeof data.vencimiento === 'string' && !isNaN(data.vencimiento)) {
                    vencimientoDate = excelDateToJSDate(data.vencimiento);
                } else if (data.vencimiento instanceof Date || typeof data.vencimiento === 'string') {
                    const tempDate = new Date(data.vencimiento);
                    if (!isNaN(tempDate)) vencimientoDate = tempDate;
                }
            }

            const vencimientoString = vencimientoDate ? vencimientoDate.toISOString().split('T')[0] : null;

            lotesInventario.push({
                ...data,
                id: docu.id,
                stock: parseInt(data.stock) || 0,
                vencimiento: vencimientoString,
                precioTableta: parseFloat(data.precioTableta) || 0,
                precioBlister: parseFloat(data.precioBlister) || 0,
                precioCaja: parseFloat(data.precioCaja) || 0,
                precioPublico: parseFloat(data.precioPublico) || 0,
                tabletasPorBlister: parseInt(data.tabletasPorBlister) || 1,
                blistersPorCaja: parseInt(data.blistersPorCaja) || 1,
            });
        });

        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0));
        console.log(`Cargados ${productosConsolidados.length} productos consolidados.`);
    } catch (error) {
        console.error("Error al cargar productos:", error);
        showToast("Error al conectar con el inventario", "error");
    }
}

// --- BÚSQUEDA Y SELECCIÓN DE PRODUCTOS ---
buscarInput.addEventListener("input", () => {
    const query = buscarInput.value.toLowerCase().trim();
    listaResultados.innerHTML = "";

    if (query.length > 0) {
        btnClearSearch.style.display = "flex";
    } else {
        btnClearSearch.style.display = "none";
    }

    if (query.length < 2) {
        listaResultados.classList.remove("active");
        return;
    }

    const coincidencias = productosConsolidados.filter(p =>
        p.nombre.toLowerCase().includes(query) ||
        (p.codigo && p.codigo.toLowerCase().includes(query)) ||
        (p.marca && p.marca.toLowerCase().includes(query))
    ).slice(0, 8);

    if (coincidencias.length > 0) {
        coincidencias.forEach(prod => {
            const li = document.createElement("li");
            li.className = "search-item";

            const marcaNombre = prod.marca || 'Genérico';
            const precioBase = prod.precios.tableta || prod.precios.caja || prod.precios.blister || 0;

            li.innerHTML = `
                <div class="search-item-info">
                    <div class="search-item-title">${prod.nombre}</div>
                    <div class="search-item-sub">
                        <span class="search-item-badge">${marcaNombre}</span>
                        <span>Stock: ${prod.stockTotal} unid.</span>
                    </div>
                </div>
                <div class="search-item-price">
                    ${formatoMoneda(precioBase)}
                </div>
            `;

            li.addEventListener("click", () => {
                triggerHaptic();
                seleccionarProducto(prod);
                listaResultados.classList.remove("active");
                buscarInput.value = prod.nombre;
            });

            listaResultados.appendChild(li);
        });
        listaResultados.classList.add("active");
    } else {
        listaResultados.innerHTML = `
            <li class="search-item" style="cursor: default; color: var(--gray); justify-content: center; padding: 14px;">
                <i class="fas fa-search-minus" style="margin-right: 6px;"></i> No se encontraron coincidencias
            </li>
        `;
        listaResultados.classList.add("active");
    }
});

btnClearSearch.addEventListener("click", () => {
    triggerHaptic();
    buscarInput.value = "";
    btnClearSearch.style.display = "none";
    listaResultados.classList.remove("active");
    cardProducto.style.display = "none";
    emptyStateBox.style.display = "block";
    productoSeleccionado = null;
});

// Cerrar lista al tocar fuera
document.addEventListener("click", (e) => {
    if (!buscarInput.contains(e.target) && !listaResultados.contains(e.target)) {
        listaResultados.classList.remove("active");
    }
});

// --- SELECCIONAR PRODUCTO Y RENDERIZAR FORMATOS ---
function seleccionarProducto(prod) {
    const productoActual = productosConsolidados.find(p => p.nombre === prod.nombre) || prod;
    productoSeleccionado = productoActual;

    const stocks = calcularStockVendible(productoActual);
    const pTableta = productoActual.precios.tableta || 0;
    const pBlister = productoActual.precios.blister || 0;
    const pCaja = productoActual.precios.caja || 0;

    // Nombre y proveedor
    prodNombreEl.textContent = productoActual.nombre;
    prodMarcaEl.textContent = productoActual.marca ? `Proveedor / Lab: ${productoActual.marca}` : 'Producto regular';

    // Badges
    badgeStockTotal.innerHTML = `<i class="fas fa-boxes"></i> Stock: ${productoActual.stockTotal} unid.`;
    
    const vencDisplay = formatearFechaDisplay(productoActual.proxVencimiento);
    badgeVencimiento.innerHTML = `<i class="fas fa-calendar-alt"></i> Vence: ${vencDisplay}`;

    if (productoActual.antibiotico) {
        badgeAntibiotico.style.display = "inline-flex";
    } else {
        badgeAntibiotico.style.display = "none";
    }

    // Configurar Formatos
    configurarOpcionFormato(optTableta, precioTabletaEl, stockTabletaEl, pTableta, stocks.stockVendibleTableta);
    configurarOpcionFormato(optBlister, precioBlisterEl, stockBlisterEl, pBlister, stocks.stockVendibleBlister);
    configurarOpcionFormato(optCaja, precioCajaEl, stockCajaEl, pCaja, stocks.stockVendibleCaja);

    // Seleccionar el primer formato disponible
    if (stocks.stockVendibleTableta > 0 && pTableta > 0) {
        setFormatoActivo('tableta');
    } else if (stocks.stockVendibleBlister > 0 && pBlister > 0) {
        setFormatoActivo('blister');
    } else if (stocks.stockVendibleCaja > 0 && pCaja > 0) {
        setFormatoActivo('caja');
    } else {
        setFormatoActivo('tableta');
    }

    inputQty.value = 1;
    actualizarMaxCantidad();

    emptyStateBox.style.display = "none";
    cardProducto.style.display = "block";
}

function configurarOpcionFormato(optEl, precioEl, stockEl, precio, stockDisp) {
    precioEl.textContent = formatoMoneda(precio);
    stockEl.textContent = `Disp: ${stockDisp}`;

    if (precio > 0 && stockDisp > 0) {
        optEl.classList.remove("disabled");
    } else {
        optEl.classList.add("disabled");
    }
}

function setFormatoActivo(formato) {
    formatoSeleccionado = formato;
    [optTableta, optBlister, optCaja].forEach(opt => opt.classList.remove("selected"));

    if (formato === 'tableta') optTableta.classList.add("selected");
    if (formato === 'blister') optBlister.classList.add("selected");
    if (formato === 'caja') optCaja.classList.add("selected");

    actualizarMaxCantidad();
}

// Eventos de selección de formato
optTableta.addEventListener("click", () => {
    if (!optTableta.classList.contains("disabled")) {
        triggerHaptic();
        setFormatoActivo('tableta');
    }
});

optBlister.addEventListener("click", () => {
    if (!optBlister.classList.contains("disabled")) {
        triggerHaptic();
        setFormatoActivo('blister');
    }
});

optCaja.addEventListener("click", () => {
    if (!optCaja.classList.contains("disabled")) {
        triggerHaptic();
        setFormatoActivo('caja');
    }
});

function obtenerStockYPrecioFormatoActual() {
    if (!productoSeleccionado) return { stockMax: 0, precio: 0, factor: 1 };

    const stocks = calcularStockVendible(productoSeleccionado);
    const upb = productoSeleccionado.tabletasPorBlister || 1;
    const bpc = productoSeleccionado.blistersPorCaja || 1;
    const unidadesPorCaja = upb * bpc;

    if (formatoSeleccionado === 'tableta') {
        return {
            stockMax: stocks.stockVendibleTableta,
            precio: productoSeleccionado.precios.tableta || 0,
            factor: 1
        };
    } else if (formatoSeleccionado === 'blister') {
        return {
            stockMax: stocks.stockVendibleBlister,
            precio: productoSeleccionado.precios.blister || 0,
            factor: upb
        };
    } else {
        return {
            stockMax: stocks.stockVendibleCaja,
            precio: productoSeleccionado.precios.caja || 0,
            factor: unidadesPorCaja
        };
    }
}

function actualizarMaxCantidad() {
    const { stockMax, precio } = obtenerStockYPrecioFormatoActual();
    inputQty.max = stockMax;
    
    let currentVal = parseInt(inputQty.value) || 1;
    if (currentVal > stockMax && stockMax > 0) {
        inputQty.value = stockMax;
    } else if (stockMax === 0) {
        inputQty.value = 1;
    }

    btnAgregar.disabled = stockMax <= 0 || precio <= 0;
}

// Stepper de Cantidad
btnQtyMinus.addEventListener("click", () => {
    triggerHaptic();
    let val = parseInt(inputQty.value) || 1;
    if (val > 1) {
        inputQty.value = val - 1;
    }
});

btnQtyPlus.addEventListener("click", () => {
    triggerHaptic();
    const { stockMax } = obtenerStockYPrecioFormatoActual();
    let val = parseInt(inputQty.value) || 1;
    if (val < stockMax) {
        inputQty.value = val + 1;
    } else {
        showToast(`Stock máximo disponible: ${stockMax}`, "info");
    }
});

inputQty.addEventListener("change", () => {
    const { stockMax } = obtenerStockYPrecioFormatoActual();
    let val = parseInt(inputQty.value) || 1;
    if (val < 1) val = 1;
    if (val > stockMax) val = stockMax;
    inputQty.value = val;
});

// --- AGREGAR AL CARRITO CON ASIGNACIÓN FIFO DE LOTES ---
btnAgregar.addEventListener("click", () => {
    if (!productoSeleccionado) {
        showToast("Selecciona un producto primero", "error");
        return;
    }

    const { stockMax, precio, factor } = obtenerStockYPrecioFormatoActual();
    const cantidad = parseInt(inputQty.value) || 1;

    if (cantidad <= 0 || cantidad > stockMax) {
        showToast(`Cantidad no disponible (Máx: ${stockMax})`, "error");
        return;
    }

    const unidadesBaseRequeridas = cantidad * factor;

    // Asignar lotes FIFO ordenados por vencimiento
    const lotesDisponibles = lotesInventario
        .filter(l => l.nombre === productoSeleccionado.nombre && l.stock > 0)
        .sort((a, b) => {
            const timeA = a.vencimiento ? new Date(a.vencimiento).getTime() : Infinity;
            const timeB = b.vencimiento ? new Date(b.vencimiento).getTime() : Infinity;
            return timeA - timeB;
        });

    let unidadesPendientes = unidadesBaseRequeridas;
    const lotesVendidosDetallado = [];

    for (const lote of lotesDisponibles) {
        if (unidadesPendientes <= 0) break;

        const tomar = Math.min(unidadesPendientes, lote.stock);
        if (tomar > 0) {
            lotesVendidosDetallado.push({
                loteId: lote.id,
                unidadesVendidas: tomar,
                stockAnteriorLote: lote.stock
            });
            lote.stock -= tomar; // Descontar temporalmente en memoria
            unidadesPendientes -= tomar;
        }
    }

    if (unidadesPendientes > 0) {
        showToast("Error crítico de inventario al asignar lotes", "error");
        // Revertir
        for (const detalle of lotesVendidosDetallado) {
            const loteOrig = lotesInventario.find(l => l.id === detalle.loteId);
            if (loteOrig) loteOrig.stock += detalle.unidadesVendidas;
        }
        return;
    }

    // Agregar al carrito
    carrito.push({
        nombre: productoSeleccionado.nombre,
        codigo: productoSeleccionado.codigo || '',
        cantidad: cantidad,
        unidadesBaseVendidas: unidadesBaseRequeridas,
        precioUnitario: precio,
        subtotal: cantidad * precio,
        antibiotico: productoSeleccionado.antibiotico,
        formatoVenta: formatoSeleccionado,
        lotesVendidos: lotesVendidosDetallado
    });

    // Actualizar productos consolidados en memoria
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === productoSeleccionado.nombre));

    triggerHaptic();
    showToast(`✓ ${productoSeleccionado.nombre} agregado`, "success");

    // Limpiar UI de selección
    buscarInput.value = "";
    btnClearSearch.style.display = "none";
    cardProducto.style.display = "none";
    emptyStateBox.style.display = "block";
    productoSeleccionado = null;

    renderCarrito();
    actualizarTotales();
});

// --- RENDERIZADO Y GESTIÓN DEL CARRITO ---
function renderCarrito() {
    cartCardsList.innerHTML = "";

    const totalItems = carrito.reduce((acc, p) => acc + p.cantidad, 0);
    headerCartCountEl.textContent = totalItems;
    quickCartCountEl.textContent = totalItems;

    if (carrito.length === 0) {
        quickCartSection.style.display = "none";
        btnAbrirCheckout.disabled = true;
        return;
    }

    quickCartSection.style.display = "block";
    btnAbrirCheckout.disabled = false;

    carrito.forEach((item, index) => {
        const formatoNombre = item.formatoVenta.toUpperCase()
            .replace('TABLETA', 'UNIDAD')
            .replace('CAJA', 'CAJA/FCO');

        const card = document.createElement("div");
        card.className = "cart-card-item";

        card.innerHTML = `
            <div class="cart-card-info">
                <div class="cart-card-name">${item.nombre}</div>
                <div class="cart-card-meta">
                    <span class="search-item-badge">${formatoNombre}</span>
                    <span>${formatoMoneda(item.precioUnitario)} c/u</span>
                </div>
            </div>
            <div>
                <div class="cart-card-subtotal">${formatoMoneda(item.subtotal)}</div>
                <div class="cart-card-controls">
                    <button class="btn-mini-qty" onclick="window.cambiarCantidadItem(${index}, -1)" ${item.cantidad <= 1 ? 'disabled style="opacity: 0.4;"' : ''}>
                        <i class="fas fa-minus"></i>
                    </button>
                    <span class="mini-qty-val">${item.cantidad}</span>
                    <button class="btn-mini-qty" onclick="window.cambiarCantidadItem(${index}, 1)">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="btn-mini-del" onclick="window.eliminarItemCarrito(${index})" title="Eliminar">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `;

        cartCardsList.appendChild(card);
    });
}

// Modificar cantidad en carrito
window.cambiarCantidadItem = (index, delta) => {
    triggerHaptic();
    const itemCarrito = carrito[index];
    const nuevaCantidad = itemCarrito.cantidad + delta;

    if (nuevaCantidad <= 0) {
        window.eliminarItemCarrito(index);
        return;
    }

    // 1. Revertir temporalmente el stock en memoria
    for (const detalle of itemCarrito.lotesVendidos) {
        const loteOriginal = lotesInventario.find(l => l.id === detalle.loteId);
        if (loteOriginal) {
            loteOriginal.stock += detalle.unidadesVendidas;
        }
    }

    const factorConversion = itemCarrito.unidadesBaseVendidas / itemCarrito.cantidad;
    const nuevasUnidadesRequeridas = nuevaCantidad * factorConversion;

    // 2. Validar stock disponible
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === itemCarrito.nombre));
    const prodActual = productosConsolidados.find(p => p.nombre === itemCarrito.nombre);
    const stockTotalUnidades = prodActual ? prodActual.stockTotal : 0;
    const stockDisponibleFormato = stockTotalUnidades / factorConversion;

    if (nuevaCantidad > stockDisponibleFormato) {
        showToast(`Stock insuficiente. Disponible: ${Math.floor(stockDisponibleFormato)}`, "error");
        // Volver a descontar lo revertido
        for (const detalle of itemCarrito.lotesVendidos) {
            const loteOriginal = lotesInventario.find(l => l.id === detalle.loteId);
            if (loteOriginal) loteOriginal.stock -= detalle.unidadesVendidas;
        }
        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === itemCarrito.nombre));
        return;
    }

    // 3. Asignar nuevos lotes FIFO
    let unidadesPendientes = nuevasUnidadesRequeridas;
    const nuevosLotesDetalle = [];
    const lotesDisponibles = lotesInventario
        .filter(l => l.nombre === itemCarrito.nombre && l.stock > 0)
        .sort((a, b) => {
            const timeA = a.vencimiento ? new Date(a.vencimiento).getTime() : Infinity;
            const timeB = b.vencimiento ? new Date(b.vencimiento).getTime() : Infinity;
            return timeA - timeB;
        });

    for (const lote of lotesDisponibles) {
        if (unidadesPendientes <= 0) break;
        const tomar = Math.min(unidadesPendientes, lote.stock);
        if (tomar > 0) {
            nuevosLotesDetalle.push({
                loteId: lote.id,
                unidadesVendidas: tomar,
                stockAnteriorLote: lote.stock
            });
            lote.stock -= tomar;
            unidadesPendientes -= tomar;
        }
    }

    // 4. Actualizar item
    itemCarrito.cantidad = nuevaCantidad;
    itemCarrito.unidadesBaseVendidas = nuevasUnidadesRequeridas;
    itemCarrito.subtotal = nuevaCantidad * itemCarrito.precioUnitario;
    itemCarrito.lotesVendidos = nuevosLotesDetalle;

    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === itemCarrito.nombre));
    renderCarrito();
    actualizarTotales();
};

// Eliminar producto del carrito
window.eliminarItemCarrito = (index) => {
    triggerHaptic();
    const itemEliminado = carrito.splice(index, 1)[0];

    if (itemEliminado) {
        for (const detalle of itemEliminado.lotesVendidos) {
            const loteOriginal = lotesInventario.find(l => l.id === detalle.loteId);
            if (loteOriginal) loteOriginal.stock += detalle.unidadesVendidas;
        }
        productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0 || l.nombre === itemEliminado.nombre));
    }

    renderCarrito();
    actualizarTotales();
    showToast("Producto eliminado del carrito", "info");
};

// Vaciar carrito completo
btnVaciarCarrito.addEventListener("click", () => {
    if (carrito.length === 0) return;
    if (!confirm("¿Deseas vaciar todos los productos de la venta actual?")) return;

    triggerHaptic();
    for (const item of carrito) {
        for (const detalle of item.lotesVendidos) {
            const loteOriginal = lotesInventario.find(l => l.id === detalle.loteId);
            if (loteOriginal) loteOriginal.stock += detalle.unidadesVendidas;
        }
    }

    carrito = [];
    productosConsolidados = agruparLotes(lotesInventario.filter(l => l.stock > 0));
    renderCarrito();
    actualizarTotales();
    showToast("Carrito vaciado", "info");
});

// --- TOTALES Y CHECKOUT ---
function actualizarTotales() {
    const totalNeto = carrito.reduce((sum, p) => sum + p.subtotal, 0);
    const recargo = metodoPago === 'tarjeta' ? totalNeto * RECARGO_TARJETA : 0;
    const totalGeneral = totalNeto + recargo;

    barTotalGeneral.textContent = formatoMoneda(totalGeneral);
    drawerSubtotalNeto.textContent = formatoMoneda(totalNeto);
    drawerRecargoTarjeta.textContent = formatoMoneda(recargo);
    drawerTotalFinal.textContent = formatoMoneda(totalGeneral);

    if (metodoPago === 'tarjeta') {
        drawerRecargoRow.style.display = "flex";
        seccionEfectivo.style.display = "none";
        inputDineroRecibido.value = "";
    } else {
        drawerRecargoRow.style.display = "none";
        seccionEfectivo.style.display = "block";

        const recibido = parseFloat(inputDineroRecibido.value) || 0;
        const cambio = recibido - totalGeneral;

        if (recibido === 0) {
            badgeCambio.className = "change-result-badge";
            labelCambio.textContent = formatoMoneda(0);
        } else if (cambio >= 0) {
            badgeCambio.className = "change-result-badge";
            labelCambio.textContent = formatoMoneda(cambio);
        } else {
            badgeCambio.className = "change-result-badge warning";
            labelCambio.textContent = `Faltan ${formatoMoneda(Math.abs(cambio))}`;
        }
    }
}

// Métodos de pago en Checkout Drawer
btnPagoEfectivo.addEventListener("click", () => {
    triggerHaptic();
    metodoPago = 'efectivo';
    btnPagoEfectivo.classList.add("selected");
    btnPagoTarjeta.classList.remove("selected");
    actualizarTotales();
});

btnPagoTarjeta.addEventListener("click", () => {
    triggerHaptic();
    metodoPago = 'tarjeta';
    btnPagoTarjeta.classList.add("selected");
    btnPagoEfectivo.classList.remove("selected");
    actualizarTotales();
});

inputDineroRecibido.addEventListener("input", actualizarTotales);

// Atajos de billetes rápidos
btnCashExacto.addEventListener("click", () => {
    triggerHaptic();
    const totalNeto = carrito.reduce((sum, p) => sum + p.subtotal, 0);
    const recargo = metodoPago === 'tarjeta' ? totalNeto * RECARGO_TARJETA : 0;
    inputDineroRecibido.value = (totalNeto + recargo).toFixed(2);
    actualizarTotales();
});

quickCashBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        triggerHaptic();
        const monto = parseFloat(btn.getAttribute("data-cash")) || 0;
        inputDineroRecibido.value = monto.toFixed(2);
        actualizarTotales();
    });
});

// Abrir / Cerrar Drawer de Checkout
function abrirCheckoutDrawer() {
    if (carrito.length === 0) {
        showToast("Agrega al menos un producto a la venta", "info");
        return;
    }
    triggerHaptic();
    actualizarTotales();
    drawerOverlay.classList.add("active");
}

function cerrarCheckoutDrawer() {
    drawerOverlay.classList.remove("active");
}

btnAbrirCheckout.addEventListener("click", abrirCheckoutDrawer);
btnHeaderCart.addEventListener("click", abrirCheckoutDrawer);
btnCerrarDrawer.addEventListener("click", cerrarCheckoutDrawer);

drawerOverlay.addEventListener("click", (e) => {
    if (e.target === drawerOverlay) {
        cerrarCheckoutDrawer();
    }
});

// --- CONFIRMAR Y REGISTRAR VENTA EN FIREBASE ---
btnConfirmarVenta.addEventListener("click", async () => {
    if (carrito.length === 0) {
        showToast("No hay productos en la venta", "error");
        return;
    }

    const totalNeto = carrito.reduce((sum, p) => sum + p.subtotal, 0);
    const recargo = metodoPago === 'tarjeta' ? totalNeto * RECARGO_TARJETA : 0;
    const totalGeneral = totalNeto + recargo;
    const recibido = parseFloat(inputDineroRecibido.value) || 0;
    const cambio = recibido - totalGeneral;

    if (metodoPago === 'efectivo' && recibido < totalGeneral) {
        triggerHaptic();
        showToast(`El dinero recibido (Q ${recibido.toFixed(2)}) es menor al total`, "error");
        inputDineroRecibido.focus();
        return;
    }

    if (!confirm(`¿Confirmar venta por ${formatoMoneda(totalGeneral)} en ${metodoPago.toUpperCase()}?`)) {
        return;
    }

    btnConfirmarVenta.disabled = true;
    btnConfirmarVenta.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';

    try {
        // 1. Guardar documento de venta
        const venta = {
            fecha: serverTimestamp(),
            numeroVenta: Date.now(),
            metodoPago: metodoPago === 'efectivo' ? "Efectivo" : "Tarjeta",
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
            total: totalNeto,
            recargo: recargo,
            totalGeneral: totalGeneral,
            dineroRecibido: metodoPago === 'efectivo' ? recibido : totalGeneral,
            cambio: cambio > 0 ? cambio : 0,
            origen: "Ventas Móvil"
        };

        await addDoc(collection(db, "ventas"), venta);

        // 2. Batch para actualizar stock en Firebase
        const batch = writeBatch(db);

        for (const itemCarrito of carrito) {
            for (const loteVendido of itemCarrito.lotesVendidos) {
                const { loteId, unidadesVendidas } = loteVendido;
                const loteOriginal = lotesInventario.find(l => l.id === loteId);
                if (!loteOriginal) continue;

                const nuevoStockTotal = loteOriginal.stock;
                const { stockCaja, stockBlister, stockTableta } = reconvertirStock(
                    nuevoStockTotal,
                    loteOriginal.tabletasPorBlister,
                    loteOriginal.blistersPorCaja
                );

                const ref = doc(db, "inventario", loteId);
                batch.update(ref, {
                    stock: Math.max(0, nuevoStockTotal),
                    stockCaja: Math.max(0, stockCaja),
                    stockBlister: Math.max(0, stockBlister),
                    stockTableta: Math.max(0, stockTableta)
                });

                // Registro en kardex si es antibiótico
                if (itemCarrito.antibiotico) {
                    try {
                        const kardexRef = collection(db, "kardex_antibioticos");
                        await addDoc(kardexRef, {
                            productoId: loteId,
                            nombre: itemCarrito.nombre,
                            principioActivo: loteOriginal.principioActivo || "",
                            concentracion: loteOriginal.concentracion || "",
                            presentacion_med: loteOriginal.presentacion_med || "",
                            fecha: new Date(),
                            tipo: 'SALIDA',
                            documento: "-",
                            cantidad: unidadesVendidas,
                            saldo: Math.max(0, nuevoStockTotal),
                            observacion: "Venta Móvil #" + venta.numeroVenta
                        });
                    } catch (kErr) {
                        console.error("Error al registrar en Kardex antibiótico:", kErr);
                    }
                }
            }
        }

        await batch.commit();

        triggerHaptic();
        alert(`✅ VENTA EXITOSA\n\nTotal: ${formatoMoneda(totalGeneral)}\n${metodoPago === 'efectivo' ? `Vuelto: ${formatoMoneda(cambio > 0 ? cambio : 0)}` : 'Pago con Tarjeta'}\n\n¡El inventario se ha actualizado correctamente!`);

        // Restaurar estado
        carrito = [];
        cerrarCheckoutDrawer();
        await cargarProductos();
        renderCarrito();
        actualizarTotales();
        inputDineroRecibido.value = "";

    } catch (error) {
        console.error("Error al registrar venta móvil:", error);
        alert("❌ Ocurrió un error al procesar la venta. Revisa la consola o conexión a internet.");
    } finally {
        btnConfirmarVenta.disabled = false;
        btnConfirmarVenta.innerHTML = '<i class="fas fa-check-circle"></i> CONFIRMAR VENTA';
    }
});

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", async () => {
    await cargarProductos();
    renderCarrito();
    actualizarTotales();
});
