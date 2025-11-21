import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const total = document.getElementById("total");
const bajoStock = document.getElementById("bajoStock");

async function cargarReportes() {
    let suma = 0;

    // Ventas
    const ventas = await getDocs(collection(db, "ventas"));
    ventas.forEach(v => {
        suma += v.data().cantidad;
    });
    total.textContent = suma;

    // Inventario
    const inventario = await getDocs(collection(db, "inventario"));
    inventario.forEach(p => {
        if (p.data().stock <= 5) {
            const li = document.createElement("li");
            li.textContent = `${p.data().nombre} — Stock: ${p.data().stock}`;
            bajoStock.appendChild(li);
        }
    });
}

cargarReportes();
