const config = require('./config');
const telegram = require('./services/telegram');
const github = require('./services/github');
const gemini = require('./services/gemini');

/**
 * Manejador principal de cualquier actualización de Telegram (Webhook o Polling)
 */
async function handleUpdate(update) {
  try {
    // 1. Manejo de botones (Callback Queries)
    if (update.callback_query) {
      return await handleCallbackQuery(update.callback_query);
    }

    // 2. Manejo de mensajes de texto
    if (update.message && update.message.text) {
      return await handleMessage(update.message);
    }
  } catch (err) {
    console.error('[Bot Error Global]:', err);
  }
}

/**
 * Manejo de mensajes normales y comandos
 */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  // Control de Acceso: Solo el administrador autorizado
  if (config.adminId && userId !== config.adminId) {
    console.warn(`[Seguridad] Intento de acceso no autorizado de UserID: ${userId} (${msg.from.username || 'sin user'})`);
    await telegram.sendMessage(chatId, '⛔ <b>Acceso Denegado</b>\nEste es un bot de desarrollo privado.', { parse_mode: 'HTML' });
    return;
  }

  const lower = text.toLowerCase();

  // Comando /start o /help
  if (lower === '/start' || lower === '/help' || lower === 'ayuda') {
    await sendHelpMessage(chatId);
    return;
  }

  // Comando /workflows o /lista
  if (lower === '/workflows' || lower === '/wf' || lower === 'workflows') {
    await sendWorkflowsMenu(chatId);
    return;
  }

  // Comando /status o /runs
  if (lower === '/status' || lower === '/runs' || lower === 'status') {
    await sendStatusMessage(chatId);
    return;
  }

  // Comando /lastcommit o /commit
  if (lower === '/lastcommit' || lower === '/commit') {
    await sendLastCommitMessage(chatId);
    return;
  }

  // Comando /run <nombre>
  if (lower.startsWith('/run ') || lower.startsWith('ejecutar ')) {
    const target = text.replace(/^(\/run|ejecutar)\s+/i, '').trim();
    await handleDirectRun(chatId, target);
    return;
  }

  // Si no es comando, es una INSTRUCCIÓN EN LENGUAJE NATURAL PARA GEMINI
  await handleGeminiInstruction(chatId, text);
}

/**
 * Menú de Ayuda
 */
async function sendHelpMessage(chatId) {
  const helpText = `🤖 <b>Flipe DevBot (AI Agent en la Nube)</b> 🚀

Estoy conectado a tu repositorio:
📁 <code>${config.githubOwner}/${config.githubRepo}</code> (rama: <code>${config.githubBranch}</code>)

💡 <b>¿Cómo usarme?</b>
Solo escríbeme en lenguaje natural lo que deseas programar o crear.
<i>Ejemplo:</i>
• <code>"Crea un nuevo script que filtre los videos de Avatar por bitrate mayor a 5Mbps y súbelo al repositorio con su workflow."</code>
• <code>"Crea un script para verificar si faltan capítulos de series retro y añade un workflow con dispatch."</code>

⚡ <b>Comandos disponibles:</b>
• /workflows - Ver y disparar workflows de GitHub Actions.
• /status - Ver el estado de las últimas 5 ejecuciones en GitHub Actions.
• /run &lt;nombre&gt; - Ejecutar un workflow directamente.
• /lastcommit - Ver el último commit del repositorio.`;

  await telegram.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
}

/**
 * Lista de workflows con botones interactivos
 */
async function sendWorkflowsMenu(chatId) {
  await telegram.sendChatAction(chatId, 'typing');
  try {
    const workflows = await github.listWorkflows();
    if (!workflows || workflows.length === 0) {
      await telegram.sendMessage(chatId, '⚠️ No se encontraron workflows activos en el repositorio.');
      return;
    }

    const inlineKeyboard = [];
    // Agrupar en filas de a 2 botones
    for (let i = 0; i < Math.min(workflows.length, 20); i += 2) {
      const row = [];
      const wf1 = workflows[i];
      row.push({
        text: `⚡ ${wf1.name.substring(0, 25)}`,
        callback_data: `runwf_${wf1.filename}`
      });

      if (i + 1 < workflows.length && i + 1 < 20) {
        const wf2 = workflows[i + 1];
        row.push({
          text: `⚡ ${wf2.name.substring(0, 25)}`,
          callback_data: `runwf_${wf2.filename}`
        });
      }
      inlineKeyboard.push(row);
    }

    const text = `📋 <b>WORKFLOWS DE GITHUB ACTIONS</b> (${workflows.length} activos)
Toca cualquier botón para ejecutarlo inmediatamente:`;

    await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (err) {
    await telegram.sendMessage(chatId, `❌ Error obteniendo workflows: ${err.message}`);
  }
}

/**
 * Estado de ejecuciones recientes
 */
async function sendStatusMessage(chatId) {
  await telegram.sendChatAction(chatId, 'typing');
  try {
    const runs = await github.getWorkflowRuns(5);
    if (!runs || runs.length === 0) {
      await telegram.sendMessage(chatId, '⚠️ No hay ejecuciones registradas recientemente.');
      return;
    }

    let text = `📊 <b>ÚLTIMAS EJECUCIONES EN GITHUB ACTIONS:</b>\n\n`;
    runs.forEach(r => {
      let icon = '⚪';
      if (r.status === 'in_progress') icon = '🟡 En Ejecución';
      else if (r.status === 'queued') icon = '⏳ En Cola';
      else if (r.conclusion === 'success') icon = '🟢 Éxito';
      else if (r.conclusion === 'failure') icon = '🔴 Falló';
      else if (r.conclusion === 'cancelled') icon = '⚪ Cancelado';

      const date = new Date(r.created_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      text += `${icon} <b>${telegram.escapeHtml(r.name)}</b>\n`;
      text += `📅 ${date}\n`;
      text += `🔗 <a href="${r.html_url}">Ver detalles del log</a>\n\n`;
    });

    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    await telegram.sendMessage(chatId, `❌ Error obteniendo estado: ${err.message}`);
  }
}

/**
 * Último commit
 */
async function sendLastCommitMessage(chatId) {
  try {
    const c = await github.getLatestCommit();
    if (!c) {
      await telegram.sendMessage(chatId, '⚠️ No se encontró información del último commit.');
      return;
    }

    const text = `📌 <b>ÚLTIMO COMMIT EN REPOSITORIO</b>\n\n` +
      `🔀 <b>Hash:</b> <code>${c.sha}</code>\n` +
      `👤 <b>Autor:</b> ${telegram.escapeHtml(c.author)}\n` +
      `📝 <b>Mensaje:</b> ${telegram.escapeHtml(c.message)}\n` +
      `🔗 <a href="${c.html_url}">Ver en GitHub</a>`;

    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    await telegram.sendMessage(chatId, `❌ Error consultando commit: ${err.message}`);
  }
}

/**
 * Ejecución directa por texto
 */
async function handleDirectRun(chatId, target) {
  await telegram.sendChatAction(chatId, 'typing');
  try {
    // Si no termina en .yml, agregarle si aplica
    const wfName = target.endsWith('.yml') || target.endsWith('.yaml') ? target : `${target}.yml`;
    await github.triggerWorkflow(wfName);

    await telegram.sendMessage(
      chatId,
      `🚀 <b>Workflow activado con éxito:</b> <code>${wfName}</code>\n\n` +
      `📊 <a href="https://github.com/${config.githubOwner}/${config.githubRepo}/actions">Monitorear en GitHub Actions</a>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    await telegram.sendMessage(chatId, `❌ No se pudo ejecutar <code>${target}</code>: ${err.message}`, { parse_mode: 'HTML' });
  }
}

/**
 * Manejo de botones de ejecución de workflows
 */
async function handleCallbackQuery(cb) {
  const chatId = cb.message.chat.id;
  const data = cb.data;

  await telegram.answerCallbackQuery(cb.id, 'Procesando...');

  if (data.startsWith('runwf_')) {
    const filename = data.replace('runwf_', '');
    try {
      await github.triggerWorkflow(filename);
      await telegram.sendMessage(
        chatId,
        `🚀 <b>Workflow lanzado:</b> <code>${filename}</code>\n\n` +
        `📊 <a href="https://github.com/${config.githubOwner}/${config.githubRepo}/actions">Ver ejecución en vivo</a>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await telegram.sendMessage(chatId, `❌ Error lanzando <code>${filename}</code>: ${err.message}`, { parse_mode: 'HTML' });
    }
  }
}

/**
 * FLUJO NUBE DE GEMINI: Generación, Commit y Despacho automático
 */
async function handleGeminiInstruction(chatId, promptText) {
  // 1. Mensaje de inicio
  const ackMsg = await telegram.sendMessage(
    chatId,
    `🧠 <b>Analizando tu instrucción con Gemini...</b>\n\n<i>"${telegram.escapeHtml(promptText)}"</i>`,
    { parse_mode: 'HTML' }
  );
  const ackMsgId = ackMsg?.result?.message_id;

  await telegram.sendChatAction(chatId, 'typing');

  try {
    // 2. Llamada a Gemini
    const geminiRes = await gemini.generateCodeAndWorkflow(promptText);

    // Si fue una pregunta, saludo o conversación sin solicitud de código
    if (geminiRes.is_question_or_chat || !geminiRes.files || geminiRes.files.length === 0) {
      if (ackMsgId) {
        await telegram.editMessageText(
          chatId,
          ackMsgId,
          `🤖 <b>Flipe DevBot:</b>\n\n${telegram.escapeHtml(geminiRes.summary || '¿En qué puedo ayudarte hoy? Dime qué script o workflow necesitas que programe.')}`,
          { parse_mode: 'HTML' }
        );
      } else {
        await telegram.sendMessage(
          chatId,
          `🤖 <b>Flipe DevBot:</b>\n\n${telegram.escapeHtml(geminiRes.summary || '¿En qué puedo ayudarte hoy? Dime qué script o workflow necesitas que programe.')}`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }

    // Actualizar estado en Telegram
    if (ackMsgId) {
      await telegram.editMessageText(
        chatId,
        ackMsgId,
        `⚙️ <b>Código generado exitosamente.</b>\n\n` +
        `📦 <b>Archivos:</b> ${geminiRes.files.map(f => `<code>${f.path}</code>`).join(', ')}\n` +
        `🚀 <b>Subiendo commit atómico a GitHub...</b>`,
        { parse_mode: 'HTML' }
      );
    }

    await telegram.sendChatAction(chatId, 'upload_document');

    // 3. Commit atómico a GitHub
    const commitResult = await github.commitFiles(geminiRes.files, geminiRes.commit_message || `Agregado código vía Flipe DevBot`);

    // 4. Disparar workflow si corresponde
    let workflowTriggered = false;
    let workflowName = geminiRes.trigger_workflow;

    // Si no especificó trigger_workflow pero se creó un archivo .yml en .github/workflows/, usar ese
    if (!workflowName) {
      const ymlFile = geminiRes.files.find(f => f.path.startsWith('.github/workflows/') && (f.path.endsWith('.yml') || f.path.endsWith('.yaml')));
      if (ymlFile) workflowName = ymlFile.path.split('/').pop();
    }

    if (workflowName) {
      try {
        await github.triggerWorkflow(workflowName);
        workflowTriggered = true;
      } catch (wfErr) {
        console.warn(`[Workflow Auto-Dispatch Warning]: ${wfErr.message}`);
      }
    }

    // 5. Mensaje de éxito detallado
    let successText = `✅ <b>¡DESARROLLO COMPLETADO Y SUBIDO!</b>\n\n`;
    successText += `💡 <b>Resumen:</b>\n${telegram.escapeHtml(geminiRes.summary)}\n\n`;
    successText += `📁 <b>Archivos creados/actualizados:</b>\n`;
    geminiRes.files.forEach(f => {
      successText += `• <code>${telegram.escapeHtml(f.path)}</code>\n`;
    });
    successText += `\n🔗 <a href="${commitResult.url}">Ver Commit en GitHub (${commitResult.sha.substring(0, 7)})</a>\n`;

    if (workflowTriggered) {
      successText += `\n⚡ <b>Workflow activado automáticamente:</b> <code>${workflowName}</code>\n`;
      successText += `📊 <a href="https://github.com/${config.githubOwner}/${config.githubRepo}/actions">Monitorear ejecución en GitHub Actions</a>`;
    } else if (workflowName) {
      successText += `\n⚠️ El archivo de workflow <code>${workflowName}</code> fue subido al repositorio. (Para activarlo usa /workflows).`;
    }

    await telegram.sendMessage(chatId, successText, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error('[Error en Flujo Gemini]:', error);
    const errorText = `❌ <b>Ocurrió un error procesando tu solicitud:</b>\n\n<code>${telegram.escapeHtml(error.message)}</code>`;
    await telegram.sendMessage(chatId, errorText, { parse_mode: 'HTML' });
  }
}

/**
 * Motor de Long-Polling para ejecutar localmente o en un contenedor/VPS
 */
async function startPolling() {
  console.log(`🤖 Iniciando Flipe DevBot en modo Long-Polling...`);
  console.log(`📡 Escuchando al bot: https://t.me/felipesync_dev_bot`);
  console.log(`🔒 Administrador autorizado: ${config.adminId}`);
  console.log(`📁 Repositorio objetivo: ${config.githubOwner}/${config.githubRepo}`);

  let offset = 0;

  // Enviar mensaje de aviso a Telegram si está configurado
  if (config.adminId) {
    await telegram.sendMessage(
      config.adminId,
      `🟢 <b>Flipe DevBot en línea y listo.</b>\n` +
      `Modo: Nube / Long-Polling activo.\n` +
      `Repositorio: <code>${config.githubOwner}/${config.githubRepo}</code>\n\n` +
      `Envíame cualquier instrucción en lenguaje natural para programar.`,
      { parse_mode: 'HTML' }
    );
  }

  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getUpdates?offset=${offset}&timeout=25`);
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          // Procesar actualización de forma asíncrona sin bloquear el loop
          handleUpdate(update).catch(e => console.error('[Update Err]:', e));
        }
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error('[Polling Network Glitch]:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// Si se ejecuta directamente vía CLI: 'node bot.js'
if (require.main === module) {
  startPolling();
}

module.exports = {
  handleUpdate,
  startPolling
};
