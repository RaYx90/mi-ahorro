#!/bin/sh
set -e

# Generar certificados SSL autofirmados si no existen en el volumen.
# Al estar en el volumen, sobreviven a reconstrucciones de imagen y se pueden
# reemplazar por certificados reales (Let's Encrypt, etc.) sin tocar el Dockerfile.
if [ ! -f "${CERT_PATH}/key.pem" ] || [ ! -f "${CERT_PATH}/cert.pem" ]; then
    echo "🔑 Generando certificados SSL autofirmados en ${CERT_PATH}..."
    openssl req -x509 -newkey rsa:2048 \
        -keyout "${CERT_PATH}/key.pem" \
        -out "${CERT_PATH}/cert.pem" \
        -days 365 -nodes \
        -subj "/CN=localhost" 2>/dev/null
    echo "✅ Certificados generados (válidos 365 días)"
else
    echo "🔒 Certificados SSL existentes encontrados en ${CERT_PATH}"
fi

# Arrancar la aplicación
exec node server.js
