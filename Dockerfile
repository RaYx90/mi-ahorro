# Versión exacta para builds reproducibles
FROM node:20.19.0-alpine

WORKDIR /app

# Copiar package.json primero para aprovechar cache de capas
COPY package*.json ./

# Instalar dependencias (npm ci para builds deterministas)
RUN npm ci --omit=dev

# Copiar el resto de archivos
COPY . .

# Crear usuario no-root por seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Health check: espera un 401 (API protegida = servidor vivo)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- --server-response http://localhost:3000/api/transactions 2>&1 | grep -q "401 Unauthorized" && exit 0 || exit 1

CMD ["node", "server.js"]
