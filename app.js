// app.js — Compatible Firebase v10
import { db } from "./firebase-config.js";
import {
    collection, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ===========================
   BUSCADOR DE INVENTARIO
   =========================== */

const buscar = document.getElementById("buscar");
const lista = document.getElementById("lista");

if (buscar) {
    buscar.addEventListener("keyup", async () => {
        const texto = buscar.value.toLowerCase();

        const snapshot = await getDocs(collection(db, "inventario"));

        lista.innerHTML = "";

        snapshot.forEach(docu => {
            let producto = docu.data();

            if (producto.nombre.toLowerCase().includes(texto)) {
                let item = document.createElement("div");
                item.innerHTML = `
                    <b>${producto.nombre}</b><br>
                    Precio: Q${producto.precio}<br>
                    Stock: ${producto.stock}<br><br>
                `;
                lista.appendChild(item);
            }
        });
    });
}

/* ===========================
   AUTOCOMPLETAR VENTAS
   =========================== */

const inputProducto = document.getElementById("producto");
const divSuge = document.getElementById("sugerencias");
const precioInput = document.getElementById("precio");
const cantInput = document.getElementById("cantidad");
const totalInput = document.getElementById("total");
const metodo = document.getElementById("metodo");
const recargoInput = document.getElementById("recargo");
const antiInput = document.getElementById("antibiotico");

let productoSeleccionado = null;
let carrito = [];

if (inputProducto) {
    inputProducto.addEventListener("keyup", async () => {
        const texto = inputProducto.value.toLowerCase();
        if (texto.length === 0) { divSuge.innerHTML = ""; return; }

        const snap = await getDocs(collection(db, "inventario"));
        divSuge.innerHTML = "";

        snap.forEach(docu => {
            let p = docu.data();
            if (p.nombre.toLowerCase().includes(texto)) {
                let item = document.createElement("div");
                item.style.cursor = "pointer";
                item.innerHTML = p.nombre;

                item.onclick = () => {
                    productoSeleccionado = { id: docu.id, ...p };
                    inputProducto.value = p.nombre;
                    precioInput.value = p.precio;
                    antiInput.value = p.antibiotico ? "Sí" : "No";
                    calcularTotal();
                    divSuge.innerHTML = "";
                };

                divSuge.appendChild(item);
            }
        });
    });
}

function calcularTotal() {
    if (!productoSeleccionado) return;

    let cantidad = Number(cantInput.value);
    let precio = Number(precioInput.value);
    let subtotal = cantidad * precio;

    totalInput.value = subtotal;

    if (metodo.value === "tarjeta") {
        recargoInput.value = (subtotal * 0.05).toFixed(2);
    } else {
        recargoInput.value = 0;
    }
}

cantInput?.addEventListener("input", calcularTotal);
metodo?.addEventListener("change", calcularTotal);

/* ===========================
   AGREGAR AL CARRITO
   =========================== */

document.getElementById("btnAgregar")?.addEventListener("click", () => {
    if (!productoSeleccionado) {
        alert("Selecciona un producto");
        return;
    }

    carrito.push({
        ...productoSeleccionado,
        cantidad: Number(cantInput.value),
        subtotal: Number(totalInput.value),
        recargo: Number(recargoInput.value)
    });

    mostrarCarrito();
});

function mostrarCarrito() {
    const div = document.getElementById("carrito");
    div.innerHTML = "";

    carrito.forEach((p, index) => {
        div.innerHTML += `
            ${p.nombre} — Cant: ${p.cantidad} — Total: Q${p.subtotal} — Recargo: Q${p.recargo}
            <button onclick="eliminarProducto(${index})">X</button>
            <br>
        `;
    });
}

window.eliminarProducto = function(i) {
    carrito.splice(i, 1);
    mostrarCarrito();
};

document.getElementById("btnFinalizar")?.addEventListener("click", async () => {
    if (carrito.length === 0) {
        alert("No hay productos en el carrito");
        return;
    }

    let correlativo = Date.now();

    await addDoc(collection(db, "ventas"), {
        numeroVenta: correlativo,
        fecha: new Date(),
        productos: carrito,
        metodoPago: metodo.value
    });

    alert("Venta guardada con número: " + correlativo);
    carrito = [];
    mostrarCarrito();
});

/* ===========================
   FACTURAS
   =========================== */

document.getElementById("guardarFactura")?.addEventListener("click", async () => {
    let num = document.getElementById("numFactura").value;

    const ref = doc(db, "facturas", num);
    let existe = await getDoc(ref);

    if (existe.exists()) {
        alert("La factura ya está ingresada.");
        return;
    }

    await setDoc(ref, {
        proveedor: document.getElementById("proveedor").value,
        fechaEmision: document.getElementById("fechaEmision").value,
        fechaPago: document.getElementById("fechaPago").value,
        estado: "pendiente"
    });

    alert("Factura guardada.");
});

/* ===========================
   AUTOCOMPLETAR PRODUCTOS ENTRADA
   =========================== */

const prodEntrada = document.getElementById("prodEntrada");
const sugeEntrada = document.getElementById("sugeEntrada");

if (prodEntrada) {
    prodEntrada.addEventListener("keyup", async () => {
        const texto = prodEntrada.value.toLowerCase();
        sugeEntrada.innerHTML = "";

        const snap = await getDocs(collection(db, "inventario"));
        snap.forEach(docu => {
            let p = docu.data();
            if (p.nombre.toLowerCase().includes(texto)) {
                let item = document.createElement("div");
                item.style.cursor = "pointer";
                item.innerHTML = p.nombre;

                item.onclick = () => {
                    prodEntrada.value = p.nombre;
                    sugeEntrada.innerHTML = "";
                };

                sugeEntrada.appendChild(item);
            }
        });
    });
}

/* ===========================
   GUARDAR PRODUCTO EN INVENTARIO
   =========================== */

document.getElementById("guardarProductoEntrada")?.addEventListener("click", async () => {

    let nombre = prodEntrada.value;
    let precio = Number(document.getElementById("precioEntrada").value);
    let cantidad = Number(document.getElementById("cantidadEntrada").value);
    let antibiotico = document.getElementById("antibioticoEntrada").value === "true";
    let vencimiento = document.getElementById("vencimientoEntrada").value;

    const q = query(collection(db, "inventario"), where("nombre", "==", nombre));
    const snap = await getDocs(q);

    if (snap.empty) {
        await addDoc(collection(db, "inventario"), {
            nombre,
            precio,
            stock: cantidad,
            antibiotico,
            vencimiento
        });
    } else {
        let id = snap.docs[0].id;
        let actual = snap.docs[0].data().stock;

        await updateDoc(doc(db, "inventario", id), {
            precio,
            stock: actual + cantidad,
            antibiotico,
            vencimiento
        });
    }

    alert("Producto guardado en inventario.");
});

/* ===========================
   CARGAR LISTA DE INVENTARIO
   =========================== */

async function cargarInventario() {
    const inventarioRef = collection(db, "inventario");
    const querySnapshot = await getDocs(inventarioRef);

    const lista = document.getElementById("lista-inventario");
    lista.innerHTML = "";

    querySnapshot.forEach((docu) => {
        const data = docu.data();
        const item = document.createElement("li");
        item.textContent = `${data.nombre} - ${data.stock} unidades`;
        lista.appendChild(item);
    });
}

if (window.location.pathname.includes("inventario.html")) {
    cargarInventario();
}

