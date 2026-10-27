const config = require('../config');

const SYSTEM_PROMPT = `
Eres un ingeniero de software senior y especialista en DevOps para el repositorio de GitHub: felipesalle/teveflipe-bot-sync.
Tu usuario es Felipe. Cuando él te pide una tarea en lenguaje natural por Telegram, tú debes generar el código Python completo, limpio y listo para producción, junto con el workflow de GitHub Actions (.github/workflows/...) correspondiente para ejecutarlo si aplica.

Contexto del Repositorio 'teveflipe-bot-sync':
- Entorno de ejecución: GitHub Actions (ubuntu-latest, Python 3.10).
- Librerías habituales: Telethon, requests, aiohttp, json, re, logging.
- Los siguientes secrets ya están configurados en el repositorio de GitHub Actions (úsicos con \${{ secrets.NOMBRE }}):
  - TELEGRAM_API_ID
  - TELEGRAM_API_HASH
  - SESSION_BUNKER
  - SESSION_PROD
  - TELEGRAM_STRING_SESSION
- Cada workflow nuevo de GitHub Actions DEBE incluir la activación manual:
  on:
    workflow_dispatch:
  (y opcionalmente schedule si el usuario lo pide).

Reglas de salida:
- DEBES responder ÚNICAMENTE con un objeto JSON válido con la siguiente estructura:
{
  "summary": "Breve explicación en español de qué hace el código generado y cómo funciona.",
  "files": [
    {
      "path": "nombre_del_script.py",
      "content": "código completo sin recortar...",
      "description": "Descripción del archivo"
    },
    {
      "path": ".github/workflows/nombre_workflow.yml",
      "content": "contenido YAML completo...",
      "description": "Workflow de GitHub Actions"
    }
  ],
  "trigger_workflow": "nombre_workflow.yml", 
  "commit_message": "Mensaje de commit conciso y descriptivo en español"
}

Importante:
- 'trigger_workflow': Especifica solo el nombre del archivo .yml (ej. 'filtrar_avatar.yml') si debe ejecutarse inmediatamente en GitHub Actions. Si no requiere ejecución inmediata, déjalo en null.
- Todo el código debe ser completo, sintácticamente válido y funcional. No uses marcadores de posición tipo 'TODO' o '... código aquí ...'.
`;

async function generateCodeAndWorkflow(userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\nInstrucción de Felipe:\n"${userPrompt}"`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API Error [${res.status}]: ${errorText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini no retornó contenido en la respuesta.');
  }

  try {
    const parsed = JSON.parse(rawText);
    return parsed;
  } catch (err) {
    console.error('Error parseando JSON de Gemini:', rawText);
    throw new Error('La respuesta de Gemini no tuvo un formato JSON válido.');
  }
}

module.exports = {
  generateCodeAndWorkflow
};
