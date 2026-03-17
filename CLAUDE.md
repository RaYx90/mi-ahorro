# Contexto del proyecto: mi-ahorro

## Qué es
App web de control de finanzas del hogar. Multi-usuario (registro manual en BD). Interfaz mobile-first en español.
Desplegada en un NAS doméstico con Docker. Acceso desde navegador local/LAN.

## Stack
- **Backend:** Node.js 20 + Express (server.js)
- **Base de datos:** PostgreSQL 17 (contenedor externo compartido, red `postgres`)
- **Frontend:** HTML/CSS/JS puro, sin frameworks (public/index.html)
- **Auth:** Login usuario/password (bcrypt hash), cookie de sesión express-session (httpOnly, secure, sameSite=lax, rolling 7 días)
- **Seguridad:** helmet (cabeceras HTTP), escapeHtml (anti-XSS), rate limiting login (5 intentos/15min), trust proxy para Caddy
- **TLS:** Caddy reverse proxy externo (contenedor caddy-proxy, red `caddy`)
- **Contenedor:** Docker + docker-compose

## Estructura de archivos
```
server.js               — servidor Express, API REST, auth, PostgreSQL (pg)
public/index.html       — frontend completo (CSS + HTML + JS en un solo archivo)
Dockerfile              — imagen node:20.19.0-alpine, usuario no-root nodejs (uid 1001)
docker-compose.yml      — servicio mi-ahorro, redes externas postgres y caddy
.env                    — variables de entorno locales (NO versionar)
.env.example            — plantilla de variables (sí versionar)
```

## Variables de entorno (.env)
| Variable | Descripción |
|---|---|
| SESSION_SECRET | Secreto para firmar cookies de sesión (aleatoria y larga) |
| DB_PASSWORD | Contraseña del usuario miahorro en PostgreSQL |

La connection string se construye en docker-compose.yml:
`postgresql://miahorro:${DB_PASSWORD}@postgres:5432/miahorro`

## Gestión de usuarios
No hay registro público. Los usuarios se crean manualmente:
```sh
# Desde local apuntando al PostgreSQL del NAS (o usar create-user.js)
PGHOST=192.168.1.199 PGDATABASE=miahorro PGUSER=admin PGPASSWORD=... node create-user.js "email@ejemplo.com" "password"
```
Tabla `users`: id, username (email), password_hash (bcrypt 12 rounds), created_at.

## API REST (todos los endpoints requieren sesión activa)
| Método | Ruta | Descripción |
|---|---|---|
| POST | /api/login | Login, body: `{username, password}` |
| POST | /api/logout | Cierra la sesión |
| GET | /api/transactions | Lista todas las transacciones |
| POST | /api/transactions | Crea transacción |
| PUT | /api/transactions/:id | Actualiza transacción |
| DELETE | /api/transactions/:id | Elimina transacción |
| GET | /api/investments | Lista todas las inversiones |
| POST | /api/investments | Crea inversión |
| PUT | /api/investments/:id | Actualiza inversión |
| DELETE | /api/investments/:id | Elimina inversión |

Sin sesión → 401. ID inexistente en PUT/DELETE → 404.

## Esquema PostgreSQL
```sql
users (id SERIAL PK, username TEXT UNIQUE, password_hash TEXT, created_at TIMESTAMPTZ)
transactions (id SERIAL PK, type TEXT CHECK, amount NUMERIC(12,2), description TEXT, category TEXT, date DATE, created_at TIMESTAMPTZ)
investments (id SERIAL PK, name TEXT, capital NUMERIC(12,2), monthly_return NUMERIC(12,2), start_date DATE, end_date DATE, notes TEXT, created_at TIMESTAMPTZ)
```
Índice en `transactions(date)`.

## Categorías válidas (sincronizadas entre server.js y index.html)
- **Ingresos:** salary, bonus, investment, hucha, other_in
- **Gastos:** food, home, transport, health, leisure, restaurant, bills, other_out

**Categorías informativas** (`INFO_ONLY_CATS = {'investment', 'hucha'}`): no suman en barras del gráfico ni en totales de ingresos/gastos, pero sí aparecen en el calendario y en el resumen de patrimonio (hucha sí cuenta en patrimonio; investment no, porque el capital está en la tabla investments).

## Flujo de desarrollo y despliegue

### Desarrollo local
```sh
# Con hot-reload (requiere PostgreSQL corriendo y DATABASE_URL en .env):
npm run dev

# Requiere APP_PASSWORD, SESSION_SECRET y DATABASE_URL en el .env
```

### Despliegue al NAS (flujo Git)
El NAS tiene el repo clonado en `/Volume2/Datos/Docker/mi-ahorro` (share Windows: `\\192.168.1.199\Datos\Docker\mi-ahorro`).

**Flujo desde local:**
```sh
# 1. Commit + push
git push origin main

# 2. Pull directo en el share del NAS
git -C "//192.168.1.199/Datos/Docker/mi-ahorro" pull

# 3. Build y deploy (SSH al NAS o desde terminal NAS)
docker compose build --no-cache && docker compose up -d
```

**Notas:**
- El `.env` en el NAS NO está en git — nunca se sobreescribe con el pull.
- `safe.directory` configurado en git global para `%(prefix)///192.168.1.199/Datos/Docker/mi-ahorro`.

### Servicios externos (sus propios repos/compose)
| Service | Repo | Red externa |
|---|---|---|
| `postgres` | `postgres` | `postgres` |
| `caddy-proxy` | `caddy-proxy` | `caddy` |

## Decisiones de arquitectura tomadas

### Cookie de sesión vs JWT
**Decisión: cookie de sesión (express-session)**
- Multi-usuario en NAS doméstico → no hay múltiples servidores ni microservicios
- `httpOnly` + `sameSite: lax` + `secure` protege contra XSS, CSRF e intercepción
- `trust proxy` para que Express detecte HTTPS detrás de Caddy

### PostgreSQL (compartido) vs SQLite
**Decisión: PostgreSQL** (migrado desde SQLite en 2026-03-15)
- BD compartida con gamelist-dotnet — un solo contenedor PostgreSQL para el NAS
- Tipos más ricos (NUMERIC, DATE, TIMESTAMPTZ) vs TEXT para todo
- Backups centralizados con pg_dump

### Frontend en un solo archivo vs React/Vue
**Decisión: HTML/CSS/JS puro en un archivo**
- Sin proceso de build → despliegue trivial
- Suficiente para la funcionalidad requerida

## Problemas de seguridad YA corregidos (no volver a reportar)
- ✅ Contraseña hardcodeada → login con usuario/password en BD (bcrypt)
- ✅ Sin rate limiting → express-rate-limit (5 intentos/15 min) en /api/login
- ✅ Password única compartida → usuarios individuales con hash bcrypt 12 rounds
- ✅ API REST sin autenticación → middleware `requireAuth` en todos los endpoints
- ✅ XSS por innerHTML sin sanitizar → función `escapeHtml()` aplicada en renderTransactions()
- ✅ Sin cabeceras de seguridad → `helmet()` como primer middleware
- ✅ Validación insuficiente → amount>0, description≤200, date regex, category/type contra lista
- ✅ PUT/DELETE sin verificar existencia → 404 si rowCount === 0
- ✅ npm install no determinista → cambiado a `npm ci` en Dockerfile
- ✅ node:20-alpine sin versión exacta → `node:20.19.0-alpine`
- ✅ Sin HEALTHCHECK → añadido en Dockerfile

## Deuda técnica conocida (pendiente)
- Sin paginación en GET /api/transactions (carga todo en memoria — irrelevante hasta miles de registros)
- Script `dev` usa npx nodemon — instalar nodemon como devDependency si se usa frecuentemente
- Sin tests (ninguno) — app personal de un solo usuario, no prioritario

## Historial de cambios
| Fecha | Cambio |
|---|---|
| 2026-03-15 | Categoría `hucha` añadida (server.js + frontend) |
| 2026-03-15 | Dots de colores en calendario para investment (azul) y hucha (amarillo) |
| 2026-03-15 | Selector de año en resumen anual — permite ver histórico y proyectar años futuros |
| 2026-03-15 | Columna "Ahorro" en totales del año (4 columnas: Ingresos, Gastos, Ahorro, Patrimonio) |
| 2026-03-15 | Patrimonio calculado como acumulado histórico — hucha suma, investment no |
| 2026-03-15 | INFO_ONLY_CATS: investment y hucha no distorsionan medias ni barras del gráfico |
| 2026-03-15 | Deploy cambiado a flujo Git: push local → git pull en NAS share → docker-compose |
| 2026-03-15 | Migración SQLite → PostgreSQL: server.js reescrito con pg, Dockerfile simplificado, TLS delegado a Caddy externo |
| 2026-03-16 | Redes Docker renombradas: postgres-net → postgres, caddy-net → caddy |
| 2026-03-16 | Healthcheck: 127.0.0.1 en vez de localhost (fix IPv6 en Alpine) |
| 2026-03-16 | Datos migrados a PostgreSQL compartido: 107 transactions + 1 investment |
| 2026-03-16 | Fix: trust proxy + sameSite lax para sesión detrás de Caddy |
| 2026-03-16 | Fix: pg devuelve DATE/NUMERIC como strings — parseFloat en frontend, type parsers en server |
| 2026-03-16 | Auth refactor: login con usuario/password en BD (bcrypt 12 rounds) + rate limiting (5/15min) |
| 2026-03-16 | Toggle mostrar/ocultar password en login |
| 2026-03-16 | Eliminado APP_PASSWORD — usuarios en tabla users |
| 2026-03-16 | Sesión rolling 7 días (maxAge 7d + rolling:true) — renueva al usar la app |
| 2026-03-16 | Toggle mostrar/ocultar password en login (ojo SVG) |
