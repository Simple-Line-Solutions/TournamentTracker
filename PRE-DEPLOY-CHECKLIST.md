# ✅ Checklist Pre-Deploy a Vercel

Usa este checklist antes de desplegar para asegurarte de que todo esté listo.

## 📋 ANTES DE EMPEZAR

- [ ] Tengo una cuenta en Vercel (https://vercel.com)
- [ ] Tengo Git instalado (opcional pero recomendado)
- [ ] Tengo Node.js instalado (verifica: `node --version`)
- [ ] He leído `GUIA_DEPLOY_VERCEL.md`

---

## 🗄️ BASE DE DATOS

- [ ] Elegí mi proveedor de PostgreSQL:
  - [ ] Neon (https://neon.tech) - ⭐ Recomendado
  - [ ] Supabase (https://supabase.com)
  - [ ] Railway (https://railway.app)
  - [ ] Vercel Postgres (requiere pago)
  - [ ] Otro: ______________

- [ ] Creé mi base de datos PostgreSQL
- [ ] Copié el Connection String
- [ ] Modifiqué `sslmode=require` a `sslmode=no-verify` (si aplica)
- [ ] Guardé el Connection String en un lugar seguro

**Mi Connection String:** (guárdala aquí temporalmente)
```
postgresql://...
```

---

## 🔧 BACKEND - Verificación Local

### Archivos Críticos

- [ ] `Backend/package.json` incluye `pg` (no `better-sqlite3`)
- [ ] `Backend/src/db/connection.js` usa PostgreSQL
- [ ] `Backend/vercel.json` existe y está bien configurado
- [ ] `Backend/.env` existe con:
  ```
  DATABASE_URL=tu_connection_string
  JWT_SECRET=tu_secreto_jwt
  NODE_ENV=development
  ```

### Prueba Local (Opcional)

Si quieres probar antes de desplegar:

```powershell
cd Backend
npm install
node src/db/migrate.js   # Debe correr sin errores
node create-superadmin.js  # Crea tu usuario admin
npm start   # Debe iniciar sin errores
```

- [ ] Las migraciones corrieron exitosamente
- [ ] El servidor arranca en `http://localhost:3000`
- [ ] `http://localhost:3000/api/health` responde con `{"ok":true}`

---

## 🎨 FRONTEND - Verificación Local

### Archivos Críticos

- [ ] `Frontend/package.json` existe
- [ ] `Frontend/vercel.json` existe
- [ ] `Frontend/src/api.js` usa `VITE_BACKEND_URL` o `VITE_API_URL`

### Prueba Local (Opcional)

```powershell
cd Frontend
npm install
npm run dev   # Debe iniciar sin errores
```

- [ ] El servidor arranca (normalmente en `http://localhost:5173`)
- [ ] La página de login se ve correctamente

---

## 🚀 DEPLOY - BACKEND

### Instalación Vercel CLI

```powershell
npm install -g vercel
vercel login
```

- [ ] Vercel CLI instalado
- [ ] Login exitoso en Vercel

### Deploy Backend

```powershell
cd Backend
vercel
```

- [ ] Deploy exitoso
- [ ] Copié la URL del Backend: __________________________

### Variables de Entorno

```powershell
vercel env add DATABASE_URL    # Pega tu connection string
vercel env add JWT_SECRET      # Crea un secreto seguro
vercel env add NODE_ENV        # Valor: production
```

- [ ] `DATABASE_URL` configurada (todas: Production, Preview, Development)
- [ ] `JWT_SECRET` configurada (todas: Production, Preview, Development)
- [ ] `NODE_ENV` configurada (solo Production)

### Re-deploy con Variables

```powershell
vercel --prod
```

- [ ] Re-deploy exitoso
- [ ] Backend responde en `https://tu-api.vercel.app/api/health`

### Migraciones y Datos Iniciales

```powershell
# Opción 1: Desde tu PC (asegúrate de tener .env configurado)
node src/db/migrate.js
node create-superadmin.js

# Opción 2: Desde el SQL Editor de tu proveedor
# Copia y pega el contenido de Backend/src/db/migrations/001_init_postgres.sql
```

- [ ] Migraciones ejecutadas (tablas creadas)
- [ ] Usuario superadmin creado
- [ ] Guardé las credenciales del superadmin:
  ```
  Username: _______________
  Password: _______________
  ```

---

## 🚀 DEPLOY - FRONTEND

### Deploy Frontend

```powershell
cd Frontend
vercel
```

Si en Vercel este proyecto tiene `Root Directory = Frontend`, no corras `vercel` desde `Frontend/`: haz el deploy desde la raiz del repo o deja vacio el `Root Directory` del proyecto.

- [ ] Deploy exitoso
- [ ] Copié la URL del Frontend: __________________________

### Variables de Entorno

```powershell
vercel env add VITE_BACKEND_URL
# Valor: https://tu-api.vercel.app (sin /api al final)
```

- [ ] `VITE_BACKEND_URL` configurada (todas: Production, Preview, Development)
- [ ] La URL NO termina en `/api`

### Re-deploy con Variables

```powershell
vercel --prod
```

- [ ] Si hago deploy desde `Frontend/`, el `Root Directory` en Vercel esta vacio
- [ ] Si el `Root Directory` en Vercel es `Frontend`, hago el redeploy desde la raiz o desde el dashboard

- [ ] Re-deploy exitoso
- [ ] Frontend se ve correctamente en `https://tu-app.vercel.app`

---

## ✅ VERIFICACIÓN FINAL

### Backend

Abre tu navegador o usa curl:

```powershell
# Health check
curl https://tu-api.vercel.app/api/health

# Login test
curl -X POST https://tu-api.vercel.app/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"tu_password"}'
```

- [ ] `/api/health` responde `{"ok":true}`
- [ ] `/api/auth/login` devuelve un token JWT (no error 500 o 401)

### Frontend

Abre `https://tu-app.vercel.app` en tu navegador:

- [ ] La página carga correctamente
- [ ] No hay errores en la consola del navegador (F12)
- [ ] Puedo hacer login con el usuario superadmin
- [ ] Después del login, veo el dashboard/home

### Integración Frontend ↔ Backend

- [ ] No hay errores de CORS en la consola
- [ ] El frontend puede hacer requests al backend
- [ ] Los datos se cargan correctamente

---

## 🔧 SI ALGO FALLA

### Backend no responde

1. Verifica los logs: `vercel logs https://tu-api.vercel.app`
2. Revisa las variables de entorno en vercel.com
3. Chequea que `DATABASE_URL` sea correcta

### Frontend no se conecta al Backend

1. Verifica `VITE_BACKEND_URL` en vercel.com
2. Asegúrate de NO incluir `/api` al final
3. Re-despliega: `vercel --prod`
4. Limpia caché del navegador (Ctrl + Shift + R)

### CORS errors

1. Abre `Backend/src/app.js`
2. Verifica que la configuración de CORS incluya `.vercel.app`
3. Re-despliega el Backend

### Cannot connect to database

1. Prueba la conexión desde tu PC:
   ```powershell
   cd Backend
   node src/db/migrate.js
   ```
2. Si falla localmente, el problema es tu Connection String
3. Si funciona localmente pero no en Vercel, verifica la variable `DATABASE_URL`

---

## 📊 RESUMEN DE URLS

Llena esto para tener todo a mano:

```
┌─────────────────────────────────────────────────────────┐
│ BASE DE DATOS                                           │
├─────────────────────────────────────────────────────────┤
│ Proveedor: ___________                                  │
│ Connection String: postgresql://...                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ BACKEND (API)                                           │
├─────────────────────────────────────────────────────────┤
│ URL: https://________________________________.vercel.app│
│ Dashboard: https://vercel.com/[usuario]/[proyecto-api]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FRONTEND (APP)                                          │
├─────────────────────────────────────────────────────────┤
│ URL: https://________________________________.vercel.app│
│ Dashboard: https://vercel.com/[usuario]/[proyecto-app]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ CREDENCIALES SUPERADMIN                                 │
├─────────────────────────────────────────────────────────┤
│ Username: ___________                                   │
│ Password: ___________                                   │
│ Email: ___________                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 🎉 ¡TODO LISTO!

Si todos los checks están marcados, tu aplicación está en producción y funcionando.

**Próximos pasos:**
1. Conecta tu repositorio Git a Vercel para deploys automáticos
2. Configura un dominio personalizado (opcional)
3. Empieza a usar tu aplicación

**Documentación útil:**
- `GUIA_DEPLOY_VERCEL.md` - Guía paso a paso detallada
- `MIGRACION_POSTGRESQL_COMPLETA.md` - Detalles técnicos de la migración
- Vercel Docs: https://vercel.com/docs
