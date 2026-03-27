# Backend Farmacia Jerusalén

Servidor intermedio para conectar la aplicación web con **SQL Server (SSMS)**.

## Requisitos
1. **Node.js**: Instalado (v24+).
2. **SQL Server**: Instalado y con la base de datos `FarmaciaJerusalen` creada.

## Configuración
Edita el archivo `.env` con tus credenciales de SQL Server:
- `DB_USER`: Tu usuario (ej: `sa`).
- `DB_PASSWORD`: Tu contraseña.
- `DB_SERVER`: `localhost` (si está en tu PC).
- `DB_DATABASE`: `FarmaciaJerusalen`.

## Cómo Ejecutar
1. Abre una terminal en esta carpeta.
2. Ejecuta:
   ```bash
   npm install
   node server.js
   ```
3. Verás el mensaje: `✅ Conectado exitosamente a SQL Server`.

## Endpoints Disponibles
- `GET /api/facturas`: Obtiene todas las facturas de SQL.
- `POST /api/ventas`: Registra una nueva venta.
