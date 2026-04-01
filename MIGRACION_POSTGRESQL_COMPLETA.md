# ✅ Migración SQLite → PostgreSQL COMPLETA

## Resumen de la Migración

La migración de SQLite a PostgreSQL ha sido completada exitosamente. Todo el código del Backend ahora usa PostgreSQL con `pg` (node-postgres).

## 🎯 Cambios Principales

### 1. **Archivos Migrados**

#### Routes (Backend/src/routes/)
- ✅ `auth.js` - Migrado a PostgreSQL (código duplicado SQLite eliminado)
- ✅ `matches.js` - Migrado a PostgreSQL (código duplicado SQLite eliminado)
- ✅ `tournaments.js` - Ya estaba migrado
- ✅ `players.js` - Ya estaba migrado
- ✅ `users.js` - Ya estaba migrado
- ✅ `superadmin.js` - Ya estaba migrado
- ✅ `paymentMethods.js` - Ya estaba migrado
- ✅ `globalCourts.js` - Ya estaba migrado
- ✅ `globalClubs.js` - Ya estaba migrado

#### Services (Backend/src/services/)
- ✅ `tournamentSetup.js` - Migrado a PostgreSQL (código duplicado SQLite eliminado)
- ✅ `audit.js` - Ya estaba migrado
- ✅ `auth.js` - Ya estaba migrado

#### Logic (Backend/src/logic/)
- ✅ `courts.js` - Ya estaba migrado
- ✅ `standings.js` - Ya estaba migrado
- ✅ Otros archivos no usan DB directamente

#### Database (Backend/src/db/)
- ✅ `connection.js` - Configurado para PostgreSQL
- ✅ `migrate.js` - Configurado para PostgreSQL
- ✅ `migrations/001_init_postgres.sql` - Schema completo de PostgreSQL

### 2. **Patrones de Migración Aplicados**

#### Anteriormente (SQLite)
```javascript
// Consultas síncronas
const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);

// Inserciones
const result = db.prepare("INSERT INTO users (name) VALUES (?)").run(name);
const id = result.lastInsertRowid;

// Listas
const users = db.prepare("SELECT * FROM users").all();

// Transacciones
const tx = db.transaction(() => {
  db.prepare("INSERT ...").run(...);
});
tx();

// Códigos de error
if (error?.code === "SQLITE_CONSTRAINT_UNIQUE")
```

#### Actualmente (PostgreSQL)
```javascript
// Consultas asíncronas
const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
const user = rows[0];

// Inserciones con RETURNING
const { rows } = await db.query(
  "INSERT INTO users (name) VALUES ($1) RETURNING id", 
  [name]
);
const id = rows[0].id;

// Listas
const { rows: users } = await db.query("SELECT * FROM users");

// Transacciones
const client = await db.getClient();
try {
  await client.query("BEGIN");
  await client.query("INSERT ...", [...]);
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}

// Códigos de error
if (error?.code === '23505') // PostgreSQL unique violation
```

### 3. **Diferencias Clave SQLite vs PostgreSQL**

| Característica | SQLite | PostgreSQL |
|---------------|---------|------------|
| Placeholders | `?` | `$1, $2, $3` |
| API | Síncrona | Asíncrona (async/await) |
| Método consulta | `.get()`, `.all()`, `.run()` | `await db.query()` → `.rows` |
| ID insertado | `result.lastInsertRowid` | `RETURNING id` → `rows[0].id` |
| Transacciones | `db.transaction()` | `BEGIN/COMMIT/ROLLBACK` |
| Booleanos | 0/1 | `TRUE/FALSE` |
| Timestamps | `CURRENT_TIMESTAMP` | `NOW()` |
| LIKE | `LIKE` | `ILIKE` (case-insensitive) |

## 📦 Dependencias

### Backend/package.json
```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.6",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.3",      // ✅ PostgreSQL driver
    "zod": "^3.24.2"
  }
}
```

**NOTA:** `better-sqlite3` ha sido eliminado de las dependencias.

## 🔧 Configuración para Vercel

### Variables de Entorno Necesarias

Crea estas variables en el dashboard de Vercel:

```bash
# Database
DATABASE_URL=postgresql://usuario:password@host:5432/database
# O usa componentes separados:
PGHOST=tu-host.postgres.database.azure.com
PGDATABASE=nombre_bd
PGUSER=usuario
PGPASSWORD=password
PGPORT=5432

# App
JWT_SECRET=tu_secreto_jwt_muy_seguro
NODE_ENV=production

# Opcional
PORT=3000
```

### Archivos de Configuración Vercel

#### Backend/vercel.json
```json
{
  "version": 2,
  "builds": [
    {
      "src": "src/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "src/index.js"
    }
  ]
}
```

## 🚀 Pasos para Desplegar en Vercel

### 1. **Configura la Base de Datos PostgreSQL**

Opciones recomendadas (todas tienen planes gratuitos):
- **Vercel Postgres** (integración nativa)
- **Supabase** (generous free tier)
- **Neon** (serverless PostgreSQL)
- **Railway** (muy fácil de configurar)

### 2. **Ejecuta las Migraciones**

Primero, crea la base de datos vacía en tu proveedor PostgreSQL, luego:

```bash
cd Backend
node src/db/migrate.js
```

Esto ejecutará `001_init_postgres.sql` que crea todas las tablas.

### 3. **Crea Usuario Superadmin Inicial** (opcional)

```bash
node create-superadmin.js
```

### 4. **Despliega en Vercel**

```bash
# Instala Vercel CLI si no lo tienes
npm i -g vercel

# Desde la carpeta Backend
cd Backend
vercel

# Sigue las instrucciones:
# - Link to existing project? No
# - Project name: tournament-tracker-api
# - Override settings? No

# Configura las variables de entorno:
vercel env add DATABASE_URL
vercel env add JWT_SECRET

# Despliega a producción
vercel --prod
```

### 5. **Verifica el Despliegue**

Prueba estos endpoints:
```bash
# Health check
curl https://tu-app.vercel.app/api/health

# Login (si creaste superadmin)
curl -X POST https://tu-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"tu_password"}'
```

## ✅ Verificaciones Pre-Deploy

- [x] Todo el código usa sintaxis PostgreSQL (sin `.prepare()`, `.get()`, `.all()`, `.run()`)
- [x] Placeholders usan formato `$1, $2` en lugar de `?`
- [x] Todas las queries son async/await
- [x] Transacciones usan `BEGIN/COMMIT/ROLLBACK` con client pool
- [x] Schema PostgreSQL creado en `001_init_postgres.sql`
- [x] `better-sqlite3` eliminado de package.json
- [x] `pg` incluido en package.json
- [x] Sin errores de sintaxis
- [x] Variables de entorno documentadas

## 🐛 Troubleshooting

### Si ves errores de conexión:
1. Verifica que `DATABASE_URL` esté configurada correctamente
2. Chequea que el firewall de tu proveedor PostgreSQL permita conexiones desde Vercel
3. Prueba la conexión localmente primero

### Si las migraciones fallan:
1. Asegúrate de que la base de datos esté vacía
2. Verifica que el usuario tenga permisos CREATE TABLE
3. Revisa los logs: `node src/db/migrate.js`

### Si hay errores en runtime:
1. Revisa los logs de Vercel: `vercel logs`
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que el pool de conexiones se esté creando correctamente

## 📝 Notas Importantes

1. **Connection Pooling**: El código usa `pg.Pool` que es ideal para serverless
2. **Auto-incremento**: PostgreSQL usa `SERIAL` en lugar de `AUTOINCREMENT`
3. **Booleans**: PostgreSQL usa `BOOLEAN` nativo en lugar de 0/1
4. **Case Sensitivity**: Usa `ILIKE` para búsquedas case-insensitive
5. **NOW()**: PostgreSQL usa `NOW()` en lugar de `CURRENT_TIMESTAMP`

## 🎉 Conclusión

La migración está **100% completa**. El código está listo para ser desplegado en Vercel con PostgreSQL.

**Próximos pasos:**
1. Configura PostgreSQL en tu proveedor favorito
2. Ejecuta las migraciones
3. Despliega a Vercel
4. ¡Prueba tu aplicación!

---

*Migración completada el: 2025*
*Stack final: Node.js + Express + PostgreSQL + Vercel*
