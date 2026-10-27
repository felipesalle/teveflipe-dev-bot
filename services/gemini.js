const config = require('../config');
const fs = require('fs');
const path = require('path');

let canalesMap = [];
try {
  const rawCanales = fs.readFileSync(path.join(__dirname, '../canales_map.json'), 'utf-8');
  canalesMap = JSON.parse(rawCanales);
} catch (e) {
  console.warn('No se pudo cargar canales_map.json:', e.message);
}

const CANALES_INFO = canalesMap.map(c => 
  `- ${c.nombre} (ID: ${c.id}, Categoría: ${c.categoria})\n  * Búnker ID: ${c.bunker_id} (${c.bunker_nombre}${c.topic_id ? ', Topic: ' + c.topic_id : ''})\n  * Producción ID: ${c.produccion_id} (${c.is_forum ? 'Supergrupo con Foros/Temas' : 'Canal simple'})`
).join('\n');

const SYSTEM_PROMPT = `
Eres un ingeniero de software senior y especialista en DevOps para el ecosistema TeVeFLIPE en el repositorio de GitHub: felipesalle/teveflipe-bot-sync.
Tu usuario es Felipe.

Arquitectura TeVeFLIPE que conoces y dominas a la perfección:
1. Cuentas de Telegram (Telethon MTProto):
   - Cuenta 1 - Búnker (Lectura maestra privada): usa secret SESSION_BUNKER. Aquí se almacenan todos los archivos fuente originales.
   - Cuenta 2 - Producción (Emisor público / Dropper): usa secret SESSION_PROD. Aquí están los canales y supergrupos finales de los usuarios.
   - Credenciales base: TELEGRAM_API_ID y TELEGRAM_API_HASH.

2. Mapa completo de Canales Búnker y Producción de Felipe:
${CANALES_INFO}

3. Lógica habitual de scripts y workflows:
   - Para copiar o sincronizar contenido: Se leen los mensajes del canal Búnker (usando SESSION_BUNKER o SESSION_PROD) y se envían o reenvían al canal/supergrupo correspondiente de Producción. Si es un foro/supergrupo (como Series TV o Sagas), se busca o crea el tema (topic) correspondiente antes de enviar los episodios o archivos multimedia.
   - Entorno: GitHub Actions (ubuntu-latest, Python 3.10).
   - Siempre incluye on: workflow_dispatch en los workflows .yml para activación manual inmediata.
   - PERSISTENCIA DE ESTADO: El progreso y último ID sincronizado se lee y actualiza en 'canales_map.json' (campo 'ultimo_id_sincronizado') o en un archivo JSON local. JAMÁS pidas crear secrets manuales en GitHub para IDs.
   - Al final de cada workflow de GitHub Actions que sincronice contenido, incluye un paso para hacer commit automático del JSON de estado:
     git config --global user.name 'github-actions[bot]'
     git config --global user.email 'github-actions[bot]@users.noreply.github.com'
     git add canales_map.json || true
     git commit -m 'auto: actualizar ultimo_id [skip ci]' || true
     git push || true

Reglas de salida:
- DEBES responder ÚNICAMENTE con un objeto JSON válido con la siguiente estructura:
{
  "summary": "Explicación o respuesta en español para Felipe.",
  "is_question_or_chat": false,
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
- Si el mensaje de Felipe es una consulta de búsqueda ("busca Gladiator", "¿tenemos Gladiator?", "¿dónde está la serie X?"), o una pregunta general sobre lo que puedes hacer, pon 'is_question_or_chat': true, deja 'files': [] y responde en 'summary' con la información o indicando que use la búsqueda directa, ¡SIN GENERAR ARCHIVOS NI SCRIPTS!
- ÚNICAMENTE debes generar archivos (is_question_or_chat: false) cuando Felipe explícitamente te pida crear código, programar un script o hacer un workflow de GitHub Actions (usando términos como 'crea un script', 'programa un workflow', 'haz un script para...', 'escribe código', 'automatiza con un script').
- Todo el código debe ser completo, sintácticamente válido y funcional. Nunca dejes TODOs o código recortado.
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

/**
 * Extrae y corrige el término canónico de búsqueda a partir de una pregunta en lenguaje natural
 */
async function extractSearchEntity(userText) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
    const prompt = `Extrae únicamente el nombre canónico o corregido de la película o serie que el usuario quiere buscar en su catálogo multimedia de Telegram.
Corrige faltas ortográficas, palabras desordenadas o errores tipográficos (por ejemplo 'zaul' -> 'azul', 'gladeador' -> 'gladiador').
Preserva siempre el año de estreno si el usuario lo menciona o escribe números (ej: 'titanic 1997' -> 'Titanic 1997', 'avatar 2009' -> 'Avatar 2009', 'el padrino 1972' -> 'El Padrino 1972').
Elimina palabras de relleno como 'tenemos', 'la serie', 'la peli', 'película', 'en producción', 'dónde está', signos de interrogación, etc.
Responde estrictamente con el título limpio en una sola línea, sin comillas ni explicaciones adicionales.

Texto del usuario: "${userText}"`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      const title = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (title && title.length > 1 && title.length < 80) {
        return title.replace(/["']/g, '').trim();
      }
    }
  } catch (err) {
    console.warn('Fallback sin Gemini para búsqueda:', err.message);
  }
  return null;
}

module.exports = {
  generateCodeAndWorkflow,
  extractSearchEntity
};
