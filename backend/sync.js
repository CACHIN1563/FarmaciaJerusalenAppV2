require('dotenv').config();
const admin = require('firebase-admin');
const sql = require('mssql');
const serviceAccount = require('./serviceAccountKey.json');

// 1. Inicializar Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const dbFirebase = admin.firestore();

// 2. Configuración de SQL Server
const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost', 
    database: process.env.DB_DATABASE || 'FarmaciaJerusalen',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function syncData() {
    let pool;
    try {
        console.log("🔄 Iniciando Sincronización BIDIRECCIONAL...");
        pool = await sql.connect(dbConfig);

        // --- A. DE FIREBASE A SQL (Bajar cambios) ---
        await syncFromFirebase(pool, 'usuarios', 'Usuarios', mapUsuarioToSQL);
        await syncFromFirebase(pool, 'facturas', 'Facturas', mapFacturaToSQL);
        await syncFromFirebase(pool, 'ventas', 'Ventas', mapVentaToSQL);
        await syncFromFirebase(pool, 'inventario', 'Inventario', mapInventarioToSQL);
        await syncFromFirebase(pool, 'cierres_caja', 'CierresCaja', mapCierreToSQL);
        
        // --- B. DE SQL A FIREBASE (Subir nuevos) ---
        await uploadNewToFirebase(pool, 'Usuarios', 'usuarios', mapUsuarioToFirebase);

        console.log("✅ ¡Sincronización completa en ambas direcciones!");
    } catch (err) {
        console.error("❌ Error General:", err.message);
    } finally {
        if (pool) await pool.close();
        process.exit();
    }
}

// --- LÓGICA DE BAJADA (FIREBASE -> SQL) ---
async function syncFromFirebase(pool, firebaseColl, sqlTable, mapper) {
    console.log(`📂 Descargando ${sqlTable}...`);
    try {
        const snap = await dbFirebase.collection(firebaseColl).get();
        for (const doc of snap.docs) {
            const data = doc.data();
            const fId = doc.id;
            const check = await pool.request().input('fId', sql.NVarChar, fId).query(`SELECT Id FROM ${sqlTable} WHERE FirebaseId = @fId`);
            if (check.recordset.length === 0) await mapper(pool, fId, data);
        }
    } catch (e) { console.error(`  ⚠️ Error en ${sqlTable}:`, e.message); }
}

// --- LÓGICA DE SUBIDA (SQL -> FIREBASE) ---
async function uploadNewToFirebase(pool, sqlTable, firebaseColl, mapper) {
    console.log(`🚀 Subiendo nuevos de ${sqlTable} a Firebase...`);
    try {
        const result = await pool.request().query(`SELECT * FROM ${sqlTable} WHERE FirebaseId IS NULL`);
        for (const row of result.recordset) {
            const newFId = await mapper(row);
            await pool.request()
                .input('id', sql.Int, row.Id)
                .input('fId', sql.NVarChar, newFId)
                .query(`UPDATE ${sqlTable} SET FirebaseId = @fId WHERE Id = @id`);
            console.log(`  ✅ ${sqlTable} ID:${row.Id} subido con éxito.`);
        }
    } catch (e) { console.error(`  ⚠️ Error subiendo ${sqlTable}:`, e.message); }
}

// --- MAPEOS ESPECÍFICOS ---

async function mapUsuarioToSQL(pool, fId, data) {
    const user = data.username || data.usuario || fId;
    const check = await pool.request().input('u', sql.NVarChar, user).query('SELECT Id FROM Usuarios WHERE Usuario = @u AND FirebaseId IS NULL');
    if (check.recordset.length > 0) {
        await pool.request().input('u', sql.NVarChar, user).input('fId', sql.NVarChar, fId).query('UPDATE Usuarios SET FirebaseId = @fId WHERE Usuario = @u');
    } else {
        await pool.request().input('fId', sql.NVarChar, fId).input('nom', sql.NVarChar, data.nombre).input('u', sql.NVarChar, user).input('p', sql.NVarChar, data.password).query('INSERT INTO Usuarios (FirebaseId, Nombre, Usuario, Password) VALUES (@fId, @nom, @u, @p)');
    }
}

async function mapUsuarioToFirebase(row) {
    const docRef = await dbFirebase.collection('usuarios').add({
        nombre: row.Nombre,
        username: row.Usuario,
        password: row.Password,
        role: 'user',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return docRef.id;
}

// (Otros mapeos simplificados para no llenar el script)
async function mapFacturaToSQL(pool, fId, data) {
    await pool.request().input('fId', sql.NVarChar, fId).input('num', sql.NVarChar, data.numFactura).input('prov', sql.NVarChar, data.proveedor).input('m', sql.Decimal(18,2), data.monto).input('p', sql.Decimal(18,2), data.montoPagado || 0).input('e', sql.NVarChar, data.estado).query('INSERT INTO Facturas (FirebaseId, NumFactura, Proveedor, MontoTotal, MontoPagado, Estado) VALUES (@fId, @num, @prov, @m, @p, @e)');
}
async function mapVentaToSQL(pool, fId, data) {
    await pool.request().input('fId', sql.NVarChar, fId).input('t', sql.Decimal(18,2), data.totalNeto || data.total).input('m', sql.NVarChar, data.metodoPago).input('u', sql.NVarChar, data.registradoPor).query('INSERT INTO Ventas (FirebaseId, TotalNeto, MetodoPago, RegistradoPor) VALUES (@fId, @t, @m, @u)');
}
async function mapInventarioToSQL(pool, fId, data) {
    await pool.request().input('fId', sql.NVarChar, fId).input('n', sql.NVarChar, data.nombre).input('p', sql.Decimal(18,2), data.precioVenta || data.precio).input('s', sql.Int, data.stock).input('c', sql.NVarChar, data.categoria).query('INSERT INTO Inventario (FirebaseId, Nombre, [Precio Venta], Stock, Categoria) VALUES (@fId, @n, @p, @s, @c)');
}
async function mapCierreToSQL(pool, fId, data) {
    await pool.request().input('fId', sql.NVarChar, fId).input('f', sql.Date, data.fecha).input('h', sql.NVarChar, data.hora).input('b', sql.Decimal(18,2), data.baseCaja).input('e', sql.Decimal(18,2), data.efectivoFinal).input('r', sql.Decimal(18,2), data.montoRetirado).input('u', sql.NVarChar, data.registradoPor).query('INSERT INTO CierresCaja (FirebaseId, Fecha, Hora, BaseCaja, TotalEfectivo, MontoRetirado, RegistradoPor) VALUES (@fId, @f, @h, @b, @e, @r, @u)');
}

syncData();
