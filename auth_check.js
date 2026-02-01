// auth_check.js
(function () {
    // Verificar sesión
    const sessionUser = sessionStorage.getItem('farmacia_user');

    // Lista de páginas públicas (solo login)
    const publicPages = ['login.html'];

    // Obtener nombre del archivo actual
    const path = window.location.pathname;
    const page = path.split("/").pop();

    if (!sessionUser) {
        // Si no hay usuario y no estamos en login, redirigir
        if (!publicPages.includes(page) && page !== 'login.html') {
            console.warn("Acceso denegado. Redirigiendo al login...");
            window.location.href = 'login.html';
        }
    } else {
        // Si hay usuario y estamos en login, redirigir al index
        if (page === 'login.html') {
            window.location.href = 'index.html';
        }
    }
})();

function logout() {
    sessionStorage.removeItem('farmacia_user');
    window.location.href = 'login.html';
}
