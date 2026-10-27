FROM node:20-slim

# Instalar Python3, pip y herramientas mínimas
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY requirements.txt ./

# Instalar dependencias de Node y Python
RUN npm install --omit=dev && \
    pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copiar todo el código fuente
COPY . .

# Puerto para Koyeb / Cloud Healthcheck
ENV PORT=8000
EXPOSE 8000

# Iniciar bot
CMD ["node", "bot.js"]
