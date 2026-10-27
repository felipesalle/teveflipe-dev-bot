require('dotenv').config();

const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  adminId: process.env.TELEGRAM_ADMIN_ID ? String(process.env.TELEGRAM_ADMIN_ID).trim() : null,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  githubToken: process.env.GITHUB_TOKEN,
  githubOwner: process.env.GITHUB_OWNER || 'felipesalle',
  githubRepo: process.env.GITHUB_REPO || 'teveflipe-bot-sync',
  githubBranch: process.env.GITHUB_BRANCH || 'main'
};

const requiredKeys = ['telegramToken', 'adminId', 'geminiApiKey', 'githubToken'];
for (const key of requiredKeys) {
  if (!config[key]) {
    console.warn(`[Config] Advertencia: Variable de entorno faltante o incompleta: ${key}`);
  }
}

module.exports = config;
