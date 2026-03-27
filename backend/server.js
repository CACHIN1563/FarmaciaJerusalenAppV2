require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configuración de Conexión "Inmortal"
const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'TuPassword',
    server: process.env.DB_SERVER || 'localhost', 
    database: process.env.DB_DATABASE || 'FarmaciaJerusalen',
    options: {
        encrypt: false,
        trustServerCertificate: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Conexión con re-intento automático
let pool;
async function connectDB() {
    try {
        pool = await sql.connect(dbConfig);
        console.log("✅ Conectado exitosamente a SQL Server");
    } catch (err) {
        console.error("❌ Error de conexión a SQL, reintentando en 5s...", err.message);
        setTimeout(connectDB, 5000);
    }
}
connectDB();

// --- RUTAS DE LA API ---

// 1. Obtener Facturas
app.get('/api/facturas', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM Facturas ORDER BY FechaEmision DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Registrar Venta
app.post('/api/ventas', async (req, res) => {
    const { total, metodoPago, usuario } = req.body;
    try {
        await pool.request()
            .input('total', sql.Decimal(18, 2), total)
            .input('metodo', sql.NVarChar, metodoPago)
            .input('user', sql.NVarChar, usuario)
            .query('INSERT INTO Ventas (TotalNeto, MetodoPago, RegistradoPor) VALUES (@total, @metodo, @user)');
        res.status(201).json({ message: "Venta registrada con éxito" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Registrar Pago Factura
app.post('/api/facturas/pago', async (req, res) => {
    const { facturaId, monto } = req.body;
    try {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        // Registrar el pago en el historial
        await transaction.request()
            .input('fId', sql.Int, facturaId)
            .input('monto', sql.Decimal(18, 2), monto)
            .query('INSERT INTO PagosFacturas (FacturaId, Monto) VALUES (@fId, @monto)');
            
        // Actualizar el monto pagado en la factura
        await transaction.request()
            .input('fId', sql.Int, facturaId)
            .input('monto', sql.Decimal(18, 2), monto)
            .query('UPDATE Facturas SET MontoPagado = MontoPagado + @monto WHERE Id = @fId');
            
        await transaction.commit();
        res.json({ message: "Pago registrado y factura actualizada" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Farmacia corriendo en http://localhost:${PORT}`);
    console.log(`📌 Recuerda configurar tu .env con las credenciales de SQL Server`);
});
