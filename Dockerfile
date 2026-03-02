# Versión exacta para builds reproducibles
FROM node:20.19.0-alpine

# Instalar dependencias necesarias para sqlite3 y openssl
RUN apk add --no-cache python3 make g++ openssl wget

# Crear directorio de la app
WORKDIR /app

# Copiar package.json primero para aprovechar cache de capas
COPY package*.json ./

# Instalar dependencias (npm ci para builds deterministas)
RUN npm ci --only=production

# Copiar el resto de archivos
COPY . .

# Crear directorios necesarios y asignar permisos
RUN mkdir -p /app/data /app/certs && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Copiar y preparar entrypoint
RUN chmod +x /app/docker-entrypoint.sh

# Ejecutar como usuario no-root por seguridad
USER nodejs

# Exponer puertos
EXPOSE 3000 3443

# Variables de entorno por defecto (sobreescribir en docker-compose o .env)
ENV NODE_ENV=production
ENV PORT=3000
ENV HTTPS_PORT=3443
ENV DB_PATH=/app/data/finanzas.db
ENV CERT_PATH=/app/certs

# Health check: espera un 401 (API protegida = servidor vivo)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- --server-response http://localhost:3000/api/transactions 2>&1 | grep -q "401 Unauthorized" && exit 0 || exit 1

# Entrypoint que genera certs si no existen y arranca el servidor
CMD ["sh", "/app/docker-entrypoint.sh"]
