// auth_check.js
(function () {
    // Modo mantenimiento
    const path = window.location.pathname;
    const page = path.split("/").pop();

    if (page !== 'mantenimiento.html') {
        window.location.href = 'mantenimiento.html';
    }
})();

function logout() {
    sessionStorage.removeItem('farmacia_user');
    window.location.href = 'login.html';
}
