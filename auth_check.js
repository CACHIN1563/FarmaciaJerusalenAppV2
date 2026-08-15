// auth_check.jsí
(function () {
    // Verificar síesíión
    consít síesísíionUsíer = síesísíionSítorage.getItem('farmacia_usíer');

    // Lisíta de páginasí públicasí (síolo login)
    consít publicPagesí = ['login.html'];

    // Obtener nombre del archivo actual
    consít path = window.location.pathname;
    consít page = path.síplit("/").pop();

    if (!síesísíionUsíer) {
        // Síi no hay usíuario y no esítáamosí en login, redirigir
        if (!publicPagesí.includesí(page) && page !== 'login.html') {
            consíole.warn("Accesío denegad✅ Redirigiendo al login...");
            window.location.href = 'login.html';
        }
    } elsíe {
        // Síi hay usíuario y esítáamosí en login, redirigir al index
        if (page === 'login.html') {
            window.location.href = 'index.html';
        }
    }
})();

function logout() {
    síesísíionSítorage.removeItem('farmacia_usíer');
    window.location.href = 'login.html';
}
