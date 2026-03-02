# 💰 Mi Ahorro - Control de Finanzas del Hogar

App sencilla y visual para llevar el control de ingresos, gastos y ahorro del hogar.

![Mobile First](https://img.shields.io/badge/Mobile-First-green)
![Docker Ready](https://img.shields.io/badge/Docker-Ready-blue)

## ✨ Características

- 📱 **Diseño mobile-first** - Pensada para usar desde el móvil
- 💚 Registrar **ingresos** y **gastos** por categoría
- 📊 **Balance mensual** y tasa de ahorro
- 📈 **Gráfico anual** de evolución
- 🏷️ **Categorías predefinidas** para hogar
- 💾 Base de datos SQLite (un solo archivo, fácil de respaldar)
- 🐳 **Lista para Docker** - Despliega en tu NAS en minutos

## 🚀 Instalación

### Opción 1: Docker Compose (Recomendado para NAS)

```bash
# Clonar o copiar los archivos
cd mi-ahorro

# Iniciar
docker-compose up -d

# Ver logs
docker-compose logs -f
```

La app estará disponible en `http://tu-nas-ip:3000`

### Opción 2: Docker manual

```bash
# Construir imagen
docker build -t mi-ahorro .

# Ejecutar
docker run -d \
  --name mi-ahorro \
  -p 3000:3000 \
  -v mi-ahorro-data:/app/data \
  --restart unless-stopped \
  mi-ahorro
```

### Opción 3: Sin Docker (desarrollo)

```bash
# Instalar dependencias
npm install

# Crear carpeta de datos
mkdir -p data

# Iniciar
npm start
```

## 📁 Estructura

```
mi-ahorro/
├── public/
│   └── index.html      # Frontend (HTML + CSS + JS)
├── data/
│   └── finanzas.db     # Base de datos SQLite
├── server.js           # API REST con Express
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 🔧 API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/transactions` | Listar transacciones |
| POST | `/api/transactions` | Crear transacción |
| PUT | `/api/transactions/:id` | Actualizar transacción |
| DELETE | `/api/transactions/:id` | Eliminar transacción |
| GET | `/api/stats?year=2025` | Estadísticas anuales |
| GET | `/api/export` | Exportar datos (backup) |
| POST | `/api/import` | Importar datos |

## 💾 Backup

La base de datos es un único archivo `finanzas.db`. Para hacer backup:

**Desde Docker:**
```bash
docker cp mi-ahorro:/app/data/finanzas.db ./backup-finanzas.db
```

**Exportar como JSON:**
Visita `http://tu-ip:3000/api/export` para descargar un JSON con todos los datos.

## ⚙️ Configuración

Variables de entorno disponibles:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | 3000 | Puerto del servidor |
| `DB_PATH` | `./data/finanzas.db` | Ruta de la base de datos |
| `NODE_ENV` | development | Entorno (production/development) |

## 📱 Uso

1. **Navega entre meses** con las flechas ◀ ▶
2. **Añade movimientos** pulsando el botón + verde
3. **Selecciona tipo**: Ingreso 💚 o Gasto ❤️
4. **Elige categoría**, cantidad y descripción
5. **Visualiza tu tasa de ahorro** - objetivo recomendado: 20-30%
6. **Consulta el resumen anual** pulsando "Ver año"

## 🏠 Categorías

**Ingresos:**
- 💼 Nómina
- 🎁 Extra
- 📈 Inversión
- 💰 Otros

**Gastos:**
- 🛒 Compra
- 🏠 Hogar
- 🚗 Transporte
- 💊 Salud
- 🎮 Ocio
- 🍽️ Restaurante
- 📄 Facturas
- 📦 Otros

## 📄 Licencia

MIT - Libre para uso personal y modificación.

---

Hecho con ❤️ para el control financiero del hogar
