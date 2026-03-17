# 💰 Mi Ahorro — Control de Finanzas del Hogar

App web para llevar el control de ingresos, gastos, ahorro e inversiones del hogar. Multi-usuario con login seguro.

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)

## Características

- 📱 **Diseño mobile-first** — pensada para usar desde el móvil
- 💚 Registrar **ingresos** y **gastos** por categoría
- 📊 **Balance mensual** con tasa de ahorro y calendario visual
- 📈 **Resumen anual** con gráfico de barras, proyección y selector de año
- 💼 **Inversiones** — seguimiento de capital, rendimiento mensual y vencimiento
- 🏦 **Categorías informativas** — hucha e inversión no distorsionan medias ni barras
- 🔒 **Login seguro** — usuario/password con bcrypt, sesión rolling 7 días
- 🛡️ **Seguridad** — helmet, rate limiting, escapeHtml, cookie httpOnly+secure
- 🐳 **Docker** — despliega en tu NAS en minutos

## Tech Stack

| Capa | Tecnología |
|---|---|
| Backend | Node.js 20 + Express |
| Base de datos | PostgreSQL 17 (contenedor externo compartido) |
| Frontend | HTML/CSS/JS puro (un solo archivo, sin frameworks) |
| Auth | Sesión express-session (cookie httpOnly, secure, sameSite=lax, rolling 7d) |
| Seguridad | helmet + rate limiting (5 intentos/15min) + bcrypt 12 rounds |
| Reverse Proxy | Caddy (contenedor externo) — TLS automático vía DuckDNS |
| Despliegue | Docker + Docker Compose |

## Servicios Docker

| Servicio | Descripción |
|---|---|
| `mi-ahorro` | Node.js + Express (puerto interno 3000) |

**Servicios externos** (sus propios repos):

| Servicio | Repo | Red Docker |
|---|---|---|
| `postgres` | [postgres](https://github.com/RaYx90/postgres) | `postgres` |
| `caddy-proxy` | [caddy-proxy](https://github.com/RaYx90/caddy-proxy) | `caddy` |

## Requisitos

- Docker Engine + Compose
- PostgreSQL corriendo (contenedor `postgres` en red `postgres`)
- Caddy corriendo (contenedor `caddy-proxy` en red `caddy`) para HTTPS

## Puesta en marcha

### 1. Clonar

```bash
git clone https://github.com/RaYx90/mi-ahorro.git
cd mi-ahorro
```

### 2. Configurar variables de entorno

Crea un fichero `.env`:

```env
SESSION_SECRET=una_cadena_aleatoria_larga
DB_PASSWORD=password_del_usuario_miahorro_en_postgres
```

### 3. Levantar

```bash
docker compose up -d
```

La app estará disponible en **https://miahorro.duckdns.org:1443** (vía Caddy) o en el puerto 3000 directo.

### 4. Crear usuarios

No hay registro público. Los usuarios se crean manualmente:

```bash
DATABASE_URL="postgresql://miahorro:password@localhost:5432/miahorro" node create-user.js "email@ejemplo.com" "password"
```

## Estructura

```
mi-ahorro/
├── server.js               → API REST + auth + PostgreSQL (pg)
├── create-user.js          → Script para crear usuarios en BD
├── public/
│   └── index.html          → Frontend completo (CSS + HTML + JS)
├── Dockerfile              → node:20.19.0-alpine, usuario no-root
├── docker-compose.yml      → Servicio mi-ahorro + redes externas
├── .env.example            → Plantilla de variables
└── CLAUDE.md               → Documentación técnica detallada
```

## API REST

Todos los endpoints requieren sesión activa (401 sin login).

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/login` | Login (body: `{username, password}`) |
| POST | `/api/logout` | Cerrar sesión |
| GET | `/api/transactions` | Listar transacciones |
| POST | `/api/transactions` | Crear transacción |
| PUT | `/api/transactions/:id` | Actualizar transacción |
| DELETE | `/api/transactions/:id` | Eliminar transacción |
| GET | `/api/investments` | Listar inversiones |
| POST | `/api/investments` | Crear inversión |
| PUT | `/api/investments/:id` | Actualizar inversión |
| DELETE | `/api/investments/:id` | Eliminar inversión |

## Categorías

**Ingresos:** Nomina, Extra, Inversion, Hucha, Otros

**Gastos:** Compra, Hogar, Transporte, Salud, Ocio, Restaurante, Facturas, Otros

> Hucha e inversión son **informativas** — no distorsionan medias ni barras del gráfico anual.

## Backup

```bash
# Backup de la BD
docker exec postgres pg_dump -U miahorro miahorro > backup_miahorro.sql

# Restaurar
docker exec -i postgres psql -U miahorro miahorro < backup_miahorro.sql
```

## Licencia

MIT
