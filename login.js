import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    addDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const loginForm = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');

// Referencia a la colección de usuarios
const usuariosCol = collection(db, "usuarios");

// --- INICIALIZACIÓN ---
async function initLogin() {
    try {
        // Verificar si existe algún usuario (para crear el default si es la primera vez)
        const q = query(usuariosCol);
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log("⚠️ No hay usuarios detectados. Creando usuario Admin por defecto...");
            await addDoc(usuariosCol, {
                username: "admin",
                password: "password", // Contraseña por defecto solicitada
                role: "admin",
                nombre: "Administrador Sistema"
            });
            console.log("✅ Usuario 'admin' creado exitosamente.");
        }
    } catch (e) {
        console.error("Error al inicializar login:", e);
    }
}

// Ejecutar inicialización
initLogin();

// --- MANEJO DEL LOGIN ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();
    const btn = document.querySelector('.btn-login');
    const originalBtnText = btn.innerHTML;

    // UI Loading
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    errorMsg.style.display = 'none';

    try {
        // Consultar Firestore
        const q = query(usuariosCol, where("username", "==", user));
        const querySnapshot = await getDocs(q);

        let valid = false;
        let userData = null;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Comparación directa (Como solicitado por el usuario, sin hash complejo por ahora)
            // Se recomienda usar autenticación real de Firebase en producción
            if (data.password === pass) {
                valid = true;
                userData = data;
            }
        });

        if (valid) {
            // Guardar sesión
            sessionStorage.setItem('farmacia_user', JSON.stringify({
                username: userData.username,
                role: userData.role,
                nombre: userData.nombre
            }));

            // Redirigir
            window.location.href = 'index.html';
        } else {
            throw new Error("Usuario o contraseña incorrectos.");
        }

    } catch (error) {
        console.error(error);
        errorMsg.textContent = error.message.includes("Usuario") ? error.message : "Error de conexión. Intente nuevo.";
        errorMsg.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
});
