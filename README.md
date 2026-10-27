# 🤖 Flipe DevBot (Telegram AI Developer Agent)

Bot de Telegram inteligente conectado con **Gemini 2.5 Flash** y la **API de GitHub** para automatizar el desarrollo y ejecución de scripts y workflows en el repositorio [`felipesalle/teveflipe-bot-sync`](https://github.com/felipesalle/teveflipe-bot-sync).

---

## 🚀 Capacidades

1. **Programación en Lenguaje Natural con Gemini:**
   - Escríbele cualquier requerimiento en lenguaje natural por Telegram.
   - Gemini redacta el script en Python y genera el workflow de GitHub Actions (`.github/workflows/*.yml`) con soporte para activación manual (`workflow_dispatch`).
   - El bot realiza un commit atómico directamente en GitHub y activa el workflow inmediatamente.

2. **Gestión de Workflows:**
   - `/workflows`: Menú con botones interactivos para disparar cualquier workflow con un solo toque.
   - `/run <nombre>`: Ejecuta un workflow específico por nombre.
   - `/status`: Consulta las 5 ejecuciones más recientes de GitHub Actions y su resultado (Éxito, Fallo, En Ejecución).
   - `/lastcommit`: Muestra el último commit registrado en el repositorio.

3. **Seguridad Integrada:**
   - Solo responde al `TELEGRAM_ADMIN_ID` autorizado.

---

## 🛠️ Instalación y Configuración

```bash
cd c:\Users\Felipe\Documents\PROYECTOS\teveflipe-dev-bot
npm install
```

Crea o revisa tu archivo `.env`:
```env
TELEGRAM_BOT_TOKEN=8698623418:AAHueFasAndyDyd0xtCdkSViSFocEMi-xTM
TELEGRAM_ADMIN_ID=6740086
GEMINI_API_KEY=tu_clave_gemini
GITHUB_TOKEN=tu_github_pat
GITHUB_OWNER=felipesalle
GITHUB_REPO=teveflipe-bot-sync
GITHUB_BRANCH=main
GEMINI_MODEL=gemini-2.5-flash
```

---

## ▶️ Ejecución

### Modo 1: Long-Polling (Sin necesidad de puertos abiertos ni dominio HTTPS)
```bash
npm start
```
*Ideal para correr en tu PC con PM2, o en un servicio gratuito de Background Worker en Render o VPS.*

### Modo 2: Webhook Serverless (Vercel / Render Web Service)
El archivo [`api/webhook.js`](api/webhook.js) está listo para desplegarse como función serverless en Vercel.
Para activar el webhook:
```bash
curl -F "url=https://tu-dominio.vercel.app/api/webhook" https://api.telegram.org/bot<TOKEN>/setWebhook
```
