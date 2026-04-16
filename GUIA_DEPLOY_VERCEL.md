# 🚀 Guía Completa: Desplegar Tournament Tracker en Vercel

## 📋 Resumen: ¿Qué vamos a hacer?

Vamos a desplegar 3 componentes **SEPARADOS**:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1️⃣ BASE DE DATOS (PostgreSQL)                             │
│     ↓ Servicio externo: Supabase ⭐                        │
│     ↓ Te da una URL de conexión                            │
│     ↓ Ejecutar migraciones (crear tablas)                  │
│     ↓ Ver "Opción B: Supabase" con instrucciones detalladas│
│                                                             │
│  1️⃣B CREAR USUARIO SUPERADMIN                              │
│     ↓ Ejecutar script create-superadmin.js                 │
│     ↓ Crear el primer usuario en la base de datos          │
│     ↓ ⚠️  NO es una variable de entorno                    │
│     ↓ ⚠️  Se crea EN LA BASE DE DATOS                      │
│                                                             │
│  2️⃣ BACKEND (API)                                          │
│     ↓ Proyecto Vercel #1                                   │
│     ↓ URL: https://tu-api.vercel.app                       │
│     ↓ Se conecta a la base de datos                        │
│     ↓ Configurar variables de entorno (DATABASE_URL, etc)  │
│                                                             │
│  3️⃣ FRONTEND (React)                                       │
│     ↓ Proyecto Vercel #2                                   │
│     ↓ URL: https://tu-app.vercel.app                       │
│     ↓ Se conecta al Backend                                │
│     ↓ Configurar VITE_BACKEND_URL                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**📌 Nota sobre Supabase:** Esta guía incluye instrucciones **PASO A PASO MUY DETALLADAS** 
para configurar Supabase en la "Opción B" del Paso 1. Incluye capturas descritas, 
troubleshooting específico, y mejores prácticas.

**⚠️ IMPORTANTE sobre usuarios ADMIN/SUPERADMIN:**
Los usuarios **NO son variables de entorno**. Se crean **EN LA BASE DE DATOS** usando 
el script `create-superadmin.js` (ver PASO 1B). Sin este usuario inicial, no podrás 
hacer login en la aplicación.

## 🎯 PASO 1: Crear la Base de Datos PostgreSQL

Necesitas elegir un proveedor de PostgreSQL. **Recomendación: Neon** (es gratuito, rápido y fácil).

### Opción A: Neon PostgreSQL (⭐ RECOMENDADO)

1. **Crea una cuenta en Neon**
   - Ve a https://neon.tech
   - Click en "Sign Up" (puedes usar tu cuenta de GitHub)
   - Es gratis, no necesitas tarjeta de crédito

2. **Crea un nuevo proyecto**
   - Click en "Create Project"
   - Nombre: `tournament-tracker`
   - Región: elige la más cercana (US East, Europe, etc.)
   - PostgreSQL version: deja la última (16+)
   - Click "Create Project"

3. **Copia la Connection String**
   - Verás un cuadro con la connection string
   - Se ve así: `postgresql://usuario:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
   - **¡GUÁRDALA!** La necesitarás en el paso 3

4. **IMPORTANTE:** Cambia `sslmode=require` por `sslmode=no-verify`
   ```
   postgresql://usuario:password@host/neondb?sslmode=no-verify
   ```

### Opción B: Supabase (⭐ DETALLADO PASO A PASO)

#### Paso B.1: Crear Cuenta en Supabase

1. **Ve a https://supabase.com**
2. **Click en "Start your project"**
3. **Sign Up** - Elige una opción:
   - **GitHub** (recomendado - más rápido)
   - **GitLab**
   - **Email** (si prefieres)

4. Si usas GitHub:
   - Click "Continue with GitHub"
   - Autoriza Supabase a acceder a tu cuenta
   - Te redirigirá al dashboard

#### Paso B.2: Crear un Nuevo Proyecto

1. **En el Dashboard de Supabase**, verás un botón verde **"New project"**
2. **Click en "New project"**

3. **Te pedirá crear una Organización** (si es tu primera vez):
   - Organization Name: `TournamentTracker` (o el nombre que prefieras)
   - Click "Create organization"

4. **Ahora sí, crea el proyecto** con estos datos:
   
   ```
   Name: tournament-tracker
   Database Password: [GENERA UNA CONTRASEÑA SEGURA - GUÁRDALA!]
   TT-LAF
   S1mpl3L1n3L4F
   Region: elige la más cercana a ti o a tus usuarios
         - South America (São Paulo) - Si estás en Latinoamérica
         - US East (N. Virginia) - Si estás en USA/Canadá
         - Europe (Frankfurt) - Si estás en Europa
   Pricing Plan: Free (es suficiente para empezar)
   ```

5. **Click "Create new project"**

   ⏳ Supabase tardará **1-2 minutos** en crear tu base de datos. Verás un mensaje:
   ```
   "Setting up your project..."
   ```
   
   ☕ Espera a que termine. Cuando esté listo, verás el dashboard del proyecto.

#### Paso B.3: Obtener la Connection String

1. **En el dashboard del proyecto**, busca en el menú lateral izquierdo:
   - Click en **⚙️ Project Settings** (abajo a la izquierda)
   
2. **En Settings**, click en **"Database"** (en el menú lateral)

3. **Scroll down hasta la sección "Connection string"**

4. **MUY IMPORTANTE - Hay TRES tipos de connection strings:**

   ```
   ┌─────────────────────────────────────────────────────────┐
   │ 🔴 Session mode (NO USAR para Vercel)                 │
   │ 🟢 Transaction mode (✅ USA ESTE para Vercel)         │
   │ 🔵 Direct connection (NO USAR para Vercel)            │
   └─────────────────────────────────────────────────────────┘
   ```

5. **Selecciona el TAB "Transaction"** (muy importante!)

6. **Verás un dropdown que dice "URI"** - déjalo en URI

7. **Copia la string completa**. Se verá así:
   ```
   postgresql://postgres.[proyecto-id]:[TU-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
postgresql://postgres.pmuognusubpbvipxdbuj:S1mpl3L1n3L4F@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=no-verify

8. **⚠️ IMPORTANTE:** La connection string tiene `[YOUR-PASSWORD]` como placeholder
   - **Reemplaza `[YOUR-PASSWORD]`** con la contraseña que elegiste en el Paso B.2
   - Ejemplo:
     ```
     ANTES: postgresql://postgres.abc123:[YOUR-PASSWORD]@...
     DESPUÉS: postgresql://postgres.abc123:MiPassword123!@...
     ```

#### Paso B.4: Modificar la Connection String para Vercel

La connection string que copiaste necesita un pequeño ajuste para funcionar con Vercel:

**Connection String Original (de Supabase):**
```
postgresql://postgres.xyz123:MiPassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**⚠️ Agrega `?sslmode=no-verify` al final:**
```
postgresql://postgres.xyz123:MiPassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=no-verify
```

**¿Por qué?** Vercel necesita esta configuración para validar correctamente el certificado SSL de Supabase.

#### Paso B.5: Guardar tu Connection String

**🔐 SUPER IMPORTANTE - Guarda esta información en un lugar seguro:**

```
SUPABASE PROJECT INFO
=====================
Project Name: tournament-tracker
Project ID: xyz123abc...
Database Password: [la que elegiste]
Region: South America (São Paulo)

Connection String (Transaction Mode + sslmode):
postgresql://postgres.xyz123:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=no-verify

Supabase Dashboard:
https://supabase.com/dashboard/project/[tu-project-id]
```

**💡 TIP:** Guarda esto en un archivo `.txt` local o en un gestor de contraseñas como:
- 1Password
- Bitwarden  
- LastPass
- Un archivo de texto (NO lo subas a Git!)

#### Paso B.6: Ejecutar las Migraciones en Supabase

Ahora vamos a crear todas las tablas de la aplicación:

1. **En el Dashboard de Supabase**, busca en el menú lateral:
   - Click en **🔧 SQL Editor**

2. **Click en "New query"** (botón verde arriba)

3. **Abre el archivo de migración en tu PC:**
   - Ruta: `Backend/src/db/migrations/001_init_postgres.sql`
   - Abre con cualquier editor de texto (Notepad, VS Code, etc.)
   - **Selecciona TODO el contenido** (Ctrl+A)
   - **Copia** (Ctrl+C)

4. **Vuelve a Supabase SQL Editor**
   - **Pega** todo el contenido del archivo (Ctrl+V)
   - Verás un SQL muy largo con CREATE TABLE, CREATE INDEX, etc.

5. **Click en "Run"** (botón abajo a la derecha, o presiona Ctrl+Enter)

6. **Si todo salió bien**, verás en la parte inferior:
   ```
   Success. No rows returned
   ```

#### Paso B.6.1: FIX - Agregar columna `email` (Si ejecutaste migraciones antiguas)

⚠️ **IMPORTANTE:** Si ya ejecutaste las migraciones antes, es posible que la tabla `users` no tenga la columna `email`. 

**Para verificar y corregir:**

1. **En Supabase SQL Editor**, ejecuta esto:
   ```sql
   -- Agregar columna email si no existe
   ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
   CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
   ```

2. **Click "Run"**

3. **Resultado esperado:**
   ```
   Success. No rows returned
   ```

💡 **¿Por qué?** La columna `email` es necesaria para el script `create-superadmin.js` y para el registro de usuarios Player.

#### Paso B.7: Verificar que las Tablas se Crearon

1. **En el menú lateral de Supabase**, click en **🗃️ Table Editor**

2. **Deberías ver TODAS estas tablas:**
   ```
   ✅ users
   ✅ tournaments
   ✅ players
   ✅ tournament_players
   ✅ matches
   ✅ courts
   ✅ payment_methods
   ✅ payments
   ✅ global_clubs
   ✅ global_courts
   ✅ audit_logs
   ```

3. **Verificar que `users` tiene la columna `email`:**
   - Click en la tabla **`users`**
   - Verifica que veas estas columnas:
     - `id`, `username`, `password_hash`, `role`, `nombre`, **`email`**, `activo`, `session_version`, `created_at`

4. **Si las ves todas** = ¡Perfecto! ✅
5. **Si NO las ves o falta `email`** = Repite el Paso B.6.1

#### Paso B.8: Configuración de Seguridad (Opcional pero Recomendado)

Por defecto, Supabase tiene Row Level Security (RLS) deshabilitado en tablas nuevas.

**Para mayor seguridad:**

1. En **Table Editor**, elige una tabla (ej: `users`)
2. Click en los **tres puntos (...)** → **Edit table**
3. Scroll down hasta **"Enable Row Level Security (RLS)"**
4. **Actívalo** solo si sabes crear políticas RLS
5. Si no, déjalo desactivado por ahora (tu backend ya tiene autenticación JWT)

#### Paso B.9: Monitoreo y Logs (Opcional)

Supabase te da herramientas para monitorear tu base de datos:

1. **📊 Dashboard** → Muestra:
   - Requests por segundo
   - Database size
   - Bandwidth usado

2. **📈 Reports** → Estadísticas detalladas

3. **🔍 Logs** → Logs de la base de datos en tiempo real

#### ✅ Resumen - ¿Qué acabas de hacer?

- ✅ Creaste una cuenta en Supabase
- ✅ Creaste un proyecto PostgreSQL en la nube (gratis!)
- ✅ Obtuviste la connection string correcta (Transaction Mode)
- ✅ Agregaste `?sslmode=no-verify` para Vercel
- ✅ Ejecutaste las migraciones (creaste todas las tablas)
- ✅ Verificaste que las tablas existan

**🎯 Siguiente paso:** Ve al **PASO 1B** para crear tu usuario SuperAdmin.

---

## 🎯 PASO 1B: Crear Usuario SuperAdmin (IMPORTANTE)

### ❓ ¿Los usuarios van en las variables de Vercel?

**❌ NO!** Los usuarios ADMIN/SUPERADMIN:
- **NO son variables de entorno**
- **SE CREAN EN LA BASE DE DATOS** (como cualquier otro usuario)
- Se crean usando el script `create-superadmin.js`

### ¿Por qué necesito un SuperAdmin?

Es el **primer usuario** de tu aplicación. Sin él, no puedes hacer login ni crear otros usuarios.

### Paso B1.1: Crear archivo .env local (temporal)

Este archivo es **SOLO para ejecutar el script**, NO lo subas a Git.

1. **Abre PowerShell** en la carpeta raíz del proyecto:
   ```powershell
   cd "c:\Users\shadad\OneDrive - BINIT TECH\Documents\Santiago\Proyectos Copilot\Tournament Tracker"
   ```

2. **Crea el archivo .env en la carpeta Backend:**
   ```powershell
   # Navega a Backend
   cd Backend
   
   # Crea el archivo .env
   New-Item -Path ".env" -ItemType File -Force
   ```

3. **Edita el archivo** (abre con Notepad o VS Code):
   ```powershell
   notepad .env
   ```

4. **Agrega tu connection string de Supabase:**
   ```
   DATABASE_URL=postgresql://postgres.xyz123:TuPassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=no-verify
   NODE_ENV=development
   ```
   
   📝 **Usa la MISMA connection string que configuraste en Supabase (Paso B.4)**

5. **Guarda y cierra** el archivo

### Paso B1.2: Ejecutar el script de creación

```powershell
# Asegúrate de estar en la carpeta raíz (no en Backend)
cd ..

# Ejecuta el script
node create-superadmin.js
```

### Paso B1.3: Ingresa los datos del SuperAdmin

El script te pedirá:

```
🔑 Creando usuario SuperAdmin...

Username: admin
Nombre completo: Administrador Principal
Email: admin@tournament.com
Password (mínimo 8 caracteres): ********
```

**💡 RECOMENDACIONES:**
- **Username:** `admin` o `superadmin` (fácil de recordar)
- **Password:** Mínimo 8 caracteres, usa algo seguro
- **Email:** Usa un email real tuyo

### Paso B1.4: Guardar credenciales

El script mostrará:

```
✅ SuperAdmin creado exitosamente:
   Username: admin
   Name: Administrador Principal
   Email: admin@tournament.com
   Password: tu_password_aqui

⚠️  GUARDA ESTAS CREDENCIALES EN UN LUGAR SEGURO
```

**🔐 IMPORTANTE - Guarda esto:**

```
SUPERADMIN CREDENTIALS
======================
Username: admin
Email: admin@tournament.com
Password: [tu password]

Creado el: 1 de abril de 2026
Database: Supabase - [nombre-proyecto]
```

### Paso B1.5: Eliminar el archivo .env local (Seguridad)

**⚠️ IMPORTANTE:** Ahora que ya creaste el usuario, **elimina el .env local**:

```powershell
cd Backend
Remove-Item .env
```

**¿Por qué?** El archivo `.env` tiene tu connection string. No debe quedar en tu PC ni subirse a Git.

### ✅ Verificación

Para verificar que el usuario se creó correctamente:

1. **Opción 1: Supabase Table Editor**
   - Ve a Supabase Dashboard → Table Editor
   - Abre la tabla `users`
   - Deberías ver tu usuario con `role = 'superadmin'`

2. **Opción 2: SQL Query**
   - En Supabase SQL Editor, ejecuta:
     ```sql
     SELECT id, username, email, role, nombre 
     FROM users 
     WHERE role = 'superadmin';
     ```
   - Deberías ver tu usuario

### 📋 Resumen - ¿Qué acabas de hacer?

- ✅ Creaste un archivo `.env` temporal con tu DATABASE_URL
- ✅ Ejecutaste el script `create-superadmin.js`
- ✅ Creaste el primer usuario en la base de datos (en la tabla `users`)
- ✅ Guardaste las credenciales en un lugar seguro
- ✅ Eliminaste el archivo `.env` local por seguridad

### ❓ Preguntas Frecuentes

**P: ¿Puedo crear más superadmins?**
R: Sí, ejecuta el script de nuevo. Te preguntará si quieres crear otro.

**P: ¿Puedo crear usuarios desde la aplicación?**
R: Sí, una vez desplegada la app, el superadmin puede crear más usuarios desde la interfaz.

**P: ¿Qué diferencia hay entre superadmin y admin?**
R:
- **superadmin:** Acceso total, puede gestionar todos los torneos y usuarios
- **admin:** Puede gestionar torneos específicos
- **player:** Solo puede ver sus partidos

**P: Olvidé la contraseña del superadmin, ¿qué hago?**
R: Ejecuta el script de nuevo y crea un nuevo superadmin. O usa el script `Backend/reset-password.js` (si existe).

**P: El archivo .env ya existe en Backend, ¿lo sobreescribo?**
R: Si ya existe, ábrelo y verifica que tenga el `DATABASE_URL` correcto. Si no está, agrégalo.

**🎯 Siguiente paso:** Ve al **PASO 2** de esta guía para desplegar el Backend en Vercel.

---

### Opción C: Railway

1. Ve a https://railway.app
2. Sign Up (con GitHub)
3. New Project → Provision PostgreSQL
4. Variables → Copia `DATABASE_URL`

### Opción D: Vercel Postgres

1. Ve a https://vercel.com
2. Storage → Create Database → Postgres
3. Copia la `POSTGRES_URL`
4. **Nota:** Requiere un plan de pago después del trial

---

## 🎯 PASO 2: Desplegar el BACKEND (API)

### 2.1 Preparación Local

Abre PowerShell en tu carpeta del proyecto:

```powershell
cd "c:\Users\shadad\OneDrive - BINIT TECH\Documents\Santiago\Proyectos Copilot\Tournament Tracker\Backend"
```

### 2.2 Instalar Vercel CLI

```powershell
npm install -g vercel
```

Si da error de permisos, usa:
```powershell
npm install -g vercel --force
```

### 2.3 Login en Vercel

```powershell
vercel login
```

Esto abrirá tu navegador. Elige:
- "Continue with GitHub" (recomendado)
o
- "Continue with Email"

### 2.4 Desplegar el Backend

```powershell
# Asegúrate de estar en la carpeta Backend
cd Backend

# Deploy
vercel
```

Te hará estas preguntas:

```
? Set up and deploy "Backend"? → Y (presiona Enter)
? Which scope? → (elige tu cuenta)
? Link to existing project? → N
? What's your project's name? → tournament-tracker-api (o lo que quieras)
? In which directory is your code located? → ./ (presiona Enter)
? Want to override the settings? → N
```

Vercel desplegará tu API. Al final verás:

```
✅ Deployed to production. Run `vercel --prod` to overwrite later.
🔍 Inspect: https://vercel.com/tu-usuario/tournament-tracker-api
📝 Preview: https://tournament-tracker-api-xxx.vercel.app
```

**⚠️ COPIA ESA URL!** Es la URL de tu API.

### 2.5 Configurar Variables de Entorno del Backend

```powershell
# Agrega DATABASE_URL (la que copiaste en el Paso 1)
vercel env add DATABASE_URL

# Te preguntará:
# ? What's the value of DATABASE_URL? → Pega tu connection string
# ? Add to which environment? → Production, Preview, Development (selecciona las 3)

# Agrega JWT_SECRET
vercel env add JWT_SECRET

# Te preguntará:
# ? What's the value of JWT_SECRET? → Escribe un secreto largo y aleatorio
#   Ejemplo: mi_super_secreto_jwt_seguro_2024_!@#$%
# ? Add to which environment? → Production, Preview, Development (selecciona las 3)

# Agrega NODE_ENV
vercel env add NODE_ENV

# Te preguntará:
# ? What's the value of NODE_ENV? → production
# ? Add to which environment? → Production (solo Production)
```

### 2.6 Re-desplegar con las Variables

```powershell
vercel --prod
```

Esto redespliegue el backend con todas las variables de entorno.

### 2.7 Verificar que las Migraciones se Ejecutaron

**✅ Si usaste Supabase (PASO 1B):** Ya ejecutaste las migraciones en el SQL Editor de Supabase. Puedes saltar este paso.

**Si usaste otro proveedor (Neon, Railway, etc.):**

**OPCIÓN 1: Desde tu PC**

1. Crea un archivo `.env` en la carpeta Backend (si no lo creaste en el PASO 1B):

   ```powershell
   cd Backend
   New-Item -Path ".env" -ItemType File -Force
   notepad .env
   ```

2. Agrega tu connection string:
   ```
   DATABASE_URL=TU_CONNECTION_STRING_AQUI
   NODE_ENV=development
   ```

3. Ejecuta las migraciones:
   ```powershell
   node src/db/migrate.js
   ```

   Deberías ver:
   ```
   ✅ Ejecutando migración: 001_init_postgres.sql
   ✅ Migración completada: 001_init_postgres.sql
   ✅ Migraciones completadas exitosamente
   ```

4. **Elimina el .env** por seguridad:
   ```powershell
   Remove-Item .env
   ```

**OPCIÓN 2: SQL Editor directo**

1. Abre tu proveedor PostgreSQL (Neon, Railway, etc.)
2. Busca "SQL Editor" o "Query"
3. Copia el contenido de `Backend/src/db/migrations/001_init_postgres.sql`
4. Pega y ejecuta

### 2.8 Verificar que el Backend Funciona

En tu navegador o con curl:

```powershell
# Health check
curl https://tu-api.vercel.app/api/health

# Debería devolver algo como: {"status":"ok"}

# Test de login
curl -X POST https://tu-api.vercel.app/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"tu_password"}'

# Debería devolver un token JWT
```

✅ **¡Backend completado!**

---

## 🎯 PASO 3: Desplegar el FRONTEND

### 3.1 Preparación

```powershell
cd "c:\Users\shadad\OneDrive - BINIT TECH\Documents\Santiago\Proyectos Copilot\Tournament Tracker\Frontend"
```

### 3.2 Desplegar el Frontend

```powershell
vercel
```

Importante:

- Si en Vercel el proyecto frontend tiene `Root Directory = Frontend`, el deploy debe dispararse desde la raiz del repo o desde el dashboard de Vercel.
- Si ejecutas `vercel` parado dentro de `Frontend/`, entonces el `Root Directory` del proyecto en Vercel debe quedar vacio.
- No combines `cd Frontend` con `Root Directory = Frontend`, porque Vercel buscara `Frontend` dentro de `Frontend` y fallara con "The specified Root Directory \"Frontend\" does not exist".

Te hará estas preguntas:

```
? Set up and deploy "Frontend"? → Y
? Which scope? → (tu cuenta)
? Link to existing project? → N
? What's your project's name? → tournament-tracker (o lo que quieras)
? In which directory is your code located? → ./
? Want to override the settings? → N
```

Al finalizar:
```
✅ Preview: https://tournament-tracker-xxx.vercel.app
```

### 3.3 Configurar Variable de Entorno del Frontend

Aquí conectamos el Frontend con el Backend:

```powershell
# Usa la URL del Backend que copiaste en el paso 2.4
vercel env add VITE_BACKEND_URL

# Te preguntará:
# ? What's the value of VITE_BACKEND_URL? → https://tu-api.vercel.app
# (Sin /api al final, el código ya lo agrega)
# ? Add to which environment? → Production, Preview, Development (todas)
```

### 3.4 Re-desplegar con las Variables

```powershell
vercel --prod
```

Si haces el deploy desde `Frontend/`, revisa antes que el `Root Directory` del proyecto en Vercel este vacio. Si el proyecto mantiene `Root Directory = Frontend`, corre el redeploy desde la raiz del repo o usa Redeploy desde Vercel.

✅ **¡Frontend completado!**

---

## 🎯 PASO 4: Verificación Final

### 4.1 Abre tu Aplicación

Ve a: `https://tournament-tracker-xxx.vercel.app` (usa la URL que te dio Vercel)

### 4.2 Prueba el Login

1. En la página de login, usa:
   - Username: `admin`
   - Password: (el que pusiste al crear el superadmin)

2. Si todo funciona, deberías entrar al dashboard

### 4.3 Verifica la Consola del Navegador

Presiona `F12` → Pestaña "Console"

- ✅ No debería haber errores de CORS
- ✅ No debería haber errores de conexión

Si ves errores tipo `CORS policy` o `Failed to fetch`:
- Verifica que `VITE_BACKEND_URL` esté bien configurada
- Asegúrate de haber re-desplegado después de agregar la variable

---

## 🔧 Configuración de CORS (si hay problemas)

Si ves errores de CORS, actualiza el Backend:

1. Abre `Backend/src/app.js`
2. Busca la configuración de CORS
3. Asegúrate de que incluya tu dominio del Frontend:

```javascript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://tournament-tracker-xxx.vercel.app',  // Tu dominio del frontend
    /\.vercel\.app$/  // Permite todos los subdominios de vercel
  ],
  credentials: true
}));
```

4. Re-despliega:
```powershell
cd Backend
vercel --prod
```

---

## 📱 Configurar un Dominio Personalizado (Opcional)

### Para el Frontend

1. Ve a tu proyecto en https://vercel.com
2. Settings → Domains
3. Agrega tu dominio (ej: `miapp.com`)
4. Sigue las instrucciones para configurar los DNS

### Para el Backend

1. Ve a tu proyecto API en https://vercel.com  
2. Settings → Domains
3. Agrega tu dominio API (ej: `api.miapp.com`)
4. Actualiza `VITE_BACKEND_URL` en el Frontend:
   ```powershell
   vercel env add VITE_BACKEND_URL
   # Valor: https://api.miapp.com
   ```
5. Re-despliega el Frontend

---

## 🐛 Troubleshooting Común

### Error: "Cannot connect to database"

**Solución:**
1. Verifica que `DATABASE_URL` esté correctamente configurada en Vercel
2. Ve a tu proyecto Backend en vercel.com → Settings → Environment Variables
3. Revisa que la connection string tenga `sslmode=no-verify` al final
4. Si usas Neon, verifica que tu IP no esté bloqueada

### Error: "CORS policy blocked"

**Solución:**
1. Ve a `Backend/src/app.js`
2. Agrega tu dominio del Frontend al array de `origin` en CORS
3. Re-despliega el Backend

### Error: "Cannot GET /api/..."

**Solución:**
1. Verifica que la URL del Backend sea correcta
2. Asegúrate de que `VITE_BACKEND_URL` NO termine en `/api`
3. El código del Frontend agrega `/api` automáticamente

### Frontend no puede conectarse al Backend

**Solución:**
1. Verifica `VITE_BACKEND_URL` en Vercel:
   ```
   https://vercel.com/tu-usuario/tournament-tracker/settings/environment-variables
   ```
2. Debe ser: `https://tu-api.vercel.app` (sin /api)
3. Re-despliega: `vercel --prod`

### Las migraciones no se ejecutan

**Solución:**
1. Ejecuta las migraciones manualmente desde tu PC (ver paso 2.7)
2. O copia el SQL directamente al SQL Editor de tu proveedor

### Error: "Connection terminated unexpectedly" (Supabase específico)

**Solución:**
1. Asegúrate de usar la connection string en modo **"Transaction"** (no "Session" ni "Direct")
2. Verifica que hayas agregado `?sslmode=no-verify` al final
3. En Supabase Dashboard → Settings → Database → verifica que el proyecto esté activo (no "Paused")

### Error: "too many connections" (Supabase)

**Solución:**
1. Supabase Free tier limita las conexiones
2. En `Backend/src/db/connection.js`, reduce el pool:
   ```javascript
   max: 5,  // Cambia de 10 a 5
   ```
3. Re-despliega el Backend

### Error: "password authentication failed" (Supabase)

**Solución:**
1. Verifica que la contraseña en la connection string sea correcta
2. Si hay caracteres especiales (`@`, `#`, `%`, etc.) en la password, codifícalos:
   - `@` → `%40`
   - `#` → `%23`
   - `%` → `%25`
   - Ejemplo: `P@ss#123` → `P%40ss%23123`

### Supabase proyecto en "Paused"

Los proyectos gratuitos de Supabase se pausan después de 1 semana de inactividad.

**Solución:**
1. Ve a https://supabase.com/dashboard
2. Click en tu proyecto
3. Si dice "Paused", click en "Restore project"
4. Espera 1-2 minutos
5. Prueba de nuevo

---

## ✅ Checklist Final

### Base de Datos (Supabase)
- [ ] Cuenta creada en Supabase
- [ ] Proyecto PostgreSQL creado
- [ ] Connection string copiada (Transaction Mode)
- [ ] `?sslmode=no-verify` agregado al final de la connection string
- [ ] Migraciones ejecutadas en SQL Editor
- [ ] Todas las 11 tablas creadas y visibles en Table Editor
- [ ] Database password guardada en lugar seguro

### Usuario SuperAdmin (IMPORTANTE)
- [ ] Archivo `.env` creado temporalmente en Backend
- [ ] Script `create-superadmin.js` ejecutado
- [ ] Usuario superadmin creado exitosamente
- [ ] Credenciales del superadmin guardadas en lugar seguro:
  - [ ] Username guardado
  - [ ] Email guardado
  - [ ] Password guardado
- [ ] Usuario verificado en Supabase Table Editor (tabla `users`)
- [ ] Archivo `.env` local eliminado por seguridad

### Backend
- [ ] Backend desplegado en Vercel
- [ ] Variables de entorno configuradas:
  - [ ] `DATABASE_URL` (con la connection string de Supabase)
  - [ ] `JWT_SECRET`
  - [ ] `NODE_ENV=production`
- [ ] Backend re-desplegado después de agregar variables (`vercel --prod`)
- [ ] Migraciones verificadas (tablas creadas en Supabase)
- [ ] Endpoint `/api/health` responde correctamente
- [ ] Login funciona (probado con curl o Postman usando credenciales del superadmin)

### Frontend
- [ ] Frontend desplegado en Vercel
- [ ] Variable `VITE_BACKEND_URL` configurada (url del backend sin /api)
- [ ] Frontend re-desplegado después de agregar variable
- [ ] Aplicación abre en el navegador
- [ ] Login funciona desde la interfaz
- [ ] Sin errores en consola del navegador (F12)
- [ ] Sin errores de CORS

### Verificación Final
- [ ] Puedo hacer login con el usuario superadmin
- [ ] Puedo crear un torneo
- [ ] Los datos se guardan en Supabase (verificar en Table Editor)
- [ ] URLs anotadas en sección "Resumen de URLs"

---

## 📊 Resumen de URLs

Anota aquí tus URLs para referencia:

```
Base de Datos:
└─ Connection String: postgresql://...

Backend (API):
└─ URL: https://_____________________.vercel.app
└─ Dashboard: https://vercel.com/[usuario]/[proyecto-api]

Frontend (App):
└─ URL: https://_____________________.vercel.app
└─ Dashboard: https://vercel.com/[usuario]/[proyecto-frontend]
```

---

## 💡 Tips y Mejores Prácticas de Supabase

### 🔐 Seguridad

1. **NUNCA** compartas tu Database Password públicamente
2. **NUNCA** subas archivos `.env` con tu connection string a Git
3. Usa variables de entorno en Vercel (no hardcodees la connection string)
4. Si accidentalmente expones la password, resetéala:
   - Supabase Dashboard → Settings → Database → Reset Database Password

### 📈 Monitoreo

1. **Revisa tu uso regularmente:**
   - Supabase Dashboard → Home → verás:
     - Database size
     - Bandwidth usado
     - Requests

2. **Plan Free limits:**
   - 500 MB database
   - 2 GB bandwidth por mes
   - 50 MB file storage
   - Proyecto se pausa después de 1 semana de inactividad
   - Máximo: 2 proyectos gratuitos activos

3. **Si necesitas más:**
   - Upgrade a Pro: $25/mes
   - 8 GB database
   - 250 GB bandwidth
   - No se pausa por inactividad

### 🚀 Performance

1. **Usa indexes:** El archivo `001_init_postgres.sql` ya incluye los índices necesarios
2. **Monitorea queries lentas:**
   - Supabase Dashboard → Logs → Query Performance
3. **Connection Pooling:** Ya configurado en `connection.js`

### 🔄 Backups

1. **Supabase hace backups automáticos:**
   - Plan Free: Daily backups (7 días de retención)
   - Plan Pro: Point-in-time recovery

2. **Para hacer backup manual:**
   ```powershell
   # Instala pg_dump (viene con PostgreSQL)
   # Luego ejecuta:
   pg_dump "postgresql://[tu-connection-string]" > backup.sql
   ```

3. **Restaurar un backup:**
   - Supabase Dashboard → Database → Backups
   - Elige el backup y click "Restore"

### 📋 Comandos Útiles de Supabase

```sql
-- Ver todas las tablas
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Ver tamaño de la base de datos
SELECT pg_size_pretty(pg_database_size('postgres'));

-- Ver conexiones activas
SELECT count(*) FROM pg_stat_activity;

-- Ver tablas y su tamaño
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 🆘 Soporte y Recursos

- **Documentación:** https://supabase.com/docs
- **Discord Community:** https://discord.supabase.com
- **GitHub Issues:** https://github.com/supabase/supabase/issues
- **Status Page:** https://status.supabase.com (para ver si hay downtime)

### ⏸️ Pausar/Despausar Proyecto

Si tu proyecto se pausa por inactividad:

1. Ve a https://supabase.com/dashboard
2. Click en tu proyecto (dirá "Paused")
3. Click "Restore project"
4. Espera 1-2 minutos
5. **TIP:** Haz una request de vez en cuando para mantenerlo activo

---

## 🎯 Comandos Rápidos de Referencia

```powershell
# Re-desplegar Backend
cd Backend
vercel --prod

# Re-desplegar Frontend
cd Frontend
vercel --prod

# Nota:
# Si el proyecto frontend en Vercel tiene Root Directory = Frontend,
# este redeploy debe ejecutarse desde la raiz del repo o desde el dashboard.

# Ver logs del Backend
vercel logs https://tu-api.vercel.app

# Ver logs del Frontend
vercel logs https://tu-app.vercel.app

# Agregar/editar variables de entorno
vercel env add NOMBRE_VARIABLE
vercel env rm NOMBRE_VARIABLE
vercel env ls
```

---

## 🎉 ¡Listo!

Tu aplicación Tournament Tracker ahora está en producción con:
- ✅ Frontend React en Vercel
- ✅ Backend API en Vercel
- ✅ Base de datos PostgreSQL en la nube
- ✅ HTTPS automático
- ✅ Deploy automático desde Git (si conectas tu repo)

### Próximos Pasos

1. **Conecta tu repositorio Git** (opcional pero recomendado):
   - Ve a tu proyecto en vercel.com
   - Settings → Git
   - Connect GitHub repository
   - Ahora cada push a `main` desplegará automáticamente

2. **Configura dominios personalizados** (opcional)

3. **Agrega datos de prueba** usando las páginas de administración

4. **Monitorea tu aplicación**:
   - Analytics: https://vercel.com/tu-usuario/tu-proyecto/analytics
   - Logs: https://vercel.com/tu-usuario/tu-proyecto/logs

---

**¿Problemas?** Revisa la sección de Troubleshooting arriba o verifica los logs de Vercel.
