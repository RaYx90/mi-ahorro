# Contexto del proyecto: mi-ahorro

## Qué es
App web de control de finanzas del hogar. Un solo usuario. Interfaz mobile-first en español.
Desplegada en un NAS doméstico con Docker. Acceso desde navegador local/LAN.

## Stack
- **Backend:** Node.js + Express (server.js)
- **Base de datos:** SQLite3 (archivo en volumen Docker `/app/data/finanzas.db`)
- **Frontend:** HTML/CSS/JS puro, sin frameworks (public/index.html, ~514 líneas)
- **Auth:** Cookie de sesión con express-session (httpOnly, secure, sameSite=strict, 8h)
- **Seguridad:** helmet (cabeceras HTTP), escapeHtml manual (anti-XSS)
- **Contenedor:** Docker + docker-compose

## Estructura de archivos
```
server.js               — servidor Express, API REST, auth
public/index.html       — frontend completo (CSS + HTML + JS en un solo archivo)
data/finanzas.db        — base de datos SQLite (en volumen Docker, NO versionar)
certs/                  — certificados SSL (en volumen Docker, NO versionar)
docker-entrypoint.sh    — genera certs si no existen, luego arranca node
Dockerfile              — imagen node:20.19.0-alpine, usuario no-root nodejs (uid 1001)
docker-compose.yml      — dos volúmenes: mi-ahorro-data y mi-ahorro-certs
.env                    — variables de entorno locales (NO versionar)
.env.example            — plantilla de variables (sí versionar)
```

## Variables de entorno (.env)
| Variable | Descripción |
|---|---|
| APP_PASSWORD | Contraseña de acceso a la app |
| SESSION_SECRET | Secreto para firmar cookies de sesión (aleatoria y larga) |
| PORT | Puerto HTTP (default: 3000) |
| HTTPS_PORT | Puerto HTTPS (default: 3443) |
| DB_PATH | Ruta SQLite (default: /app/data/finanzas.db) |
| CERT_PATH | Ruta certificados SSL (default: /app/certs) |

## API REST (todos los endpoints requieren sesión activa)
| Método | Ruta | Descripción |
|---|---|---|
| POST | /api/login | Login, body: `{password}` |
| POST | /api/logout | Cierra la sesión |
| GET | /api/transactions | Lista todas las transacciones |
| POST | /api/transactions | Crea transacción |
| PUT | /api/transactions/:id | Actualiza transacción |
| DELETE | /api/transactions/:id | Elimina transacción |

Sin sesión → 401. ID inexistente en PUT/DELETE → 404.

## Esquema SQLite
```sql
transactions (id, type TEXT CHECK IN('income','expense'), amount REAL, description TEXT, category TEXT, date TEXT, created_at DATETIME)
```
Índice en `date`.

## Categorías válidas (sincronizadas entre server.js y index.html)
- **Ingresos:** salary, bonus, investment, other_in
- **Gastos:** food, home, transport, health, leisure, restaurant, bills, other_out

## Flujo de desarrollo y despliegue

### Desarrollo local (Windows con Docker Desktop)
```sh
# Con Docker (pruebas locales por HTTP — usa docker-compose.dev.yml):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# App en http://localhost:3000 (cookie sin "secure", funciona en HTTP)

# Con hot-reload sin Docker (crear data/ primero):
cmd /c "npm run dev"
# Requiere APP_PASSWORD y SESSION_SECRET en el .env
```

> docker-compose.dev.yml activa NODE_ENV=development para que la cookie de sesión
> funcione sobre HTTP. En producción (NAS) siempre usar solo docker-compose.yml con HTTPS.

### Despliegue al NAS
1. Copiar al NAS **estos archivos** (excluir node_modules/, data/, certs/, .env):
   - server.js, public/, package.json, package-lock.json, Dockerfile, docker-compose.yml, docker-entrypoint.sh, .env.example
2. En el NAS: crear/actualizar `.env` con valores de producción (nueva SESSION_SECRET)
3. En el NAS: `docker compose down && docker compose up --build -d`
4. Los volúmenes `mi-ahorro-data` y `mi-ahorro-certs` conservan la BD y los certs

### Renovar certificados SSL en el NAS
```sh
docker compose exec mi-ahorro sh
# Dentro del contenedor:
rm /app/certs/key.pem /app/certs/cert.pem
exit
docker compose restart mi-ahorro
# El entrypoint regenera los certs automáticamente
```

## Decisiones de arquitectura tomadas

### Cookie de sesión vs JWT
**Decisión: cookie de sesión (express-session)**
- App de un solo usuario en NAS doméstico → no hay múltiples servidores ni microservicios
- El logout con JWT no es inmediato (el token sigue válido hasta expirar); con cookie de sesión sí
- `httpOnly` + `sameSite: strict` + `secure` protege contra XSS, CSRF e intercepción en red
- JWT añadiría complejidad sin ningún beneficio real en este contexto

### SQLite vs PostgreSQL/MySQL
**Decisión: SQLite**
- Un solo usuario, escrituras ocasionales → SQLite es más que suficiente
- Sin servidor de BD separado → despliegue más simple en NAS
- La BD es un único archivo, fácil de hacer backup

### Frontend en un solo archivo vs React/Vue
**Decisión: HTML/CSS/JS puro en un archivo**
- Sin proceso de build → despliegue trivial
- Sin dependencias de frontend → sin vulnerabilidades de npm en el cliente
- Suficiente para la funcionalidad requerida

### Certificados en volumen vs en imagen Docker
**Decisión: generados en docker-entrypoint.sh, almacenados en volumen**
- No quedan claves privadas quemadas en la imagen
- Permiten renovación sin reconstruir la imagen (`rm certs + restart`)
- Se pueden reemplazar por certs reales (Let's Encrypt) sin modificar el Dockerfile

## Problemas de seguridad YA corregidos (no volver a reportar)
- ✅ Contraseña hardcodeada en el cliente → movida a .env, autenticación en el backend
- ✅ API REST sin autenticación → middleware `requireAuth` en todos los endpoints
- ✅ XSS por innerHTML sin sanitizar → función `escapeHtml()` aplicada en renderTransactions()
- ✅ Sin cabeceras de seguridad → `helmet()` como primer middleware
- ✅ Certs en la imagen Docker → generados en entrypoint, almacenados en volumen
- ✅ Errores genéricos sin logging → `console.error(err)` en todos los manejadores
- ✅ Validación insuficiente → amount>0, description≤200, date regex, category/type contra lista
- ✅ PUT/DELETE sin verificar existencia → 404 si `this.changes === 0`
- ✅ Sin .gitignore → creado (excluye node_modules, data, certs, .env)
- ✅ npm install no determinista → cambiado a `npm ci` en Dockerfile
- ✅ node:20-alpine sin versión exacta → `node:20.19.0-alpine`
- ✅ Sin HEALTHCHECK → añadido en Dockerfile
- ✅ sessionStorage para auth → eliminado, ahora todo es cookie de servidor

## Deuda técnica conocida (pendiente)
- Sin paginación en GET /api/transactions (carga todo en memoria — irrelevante hasta miles de registros)
- Sin volumen para certs en docker-compose de producción con certs Let's Encrypt reales
- Vulnerabilidades en sqlite3 nativo (npm audit) — pendiente de actualización del paquete
- Script `dev` usa npx nodemon — instalar nodemon como devDependency si se usa frecuentemente
