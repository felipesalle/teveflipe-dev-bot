const config = require('./config');
const telegram = require('./services/telegram');
const github = require('./services/github');
const gemini = require('./services/gemini');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);

// Estado en memoria para rastrear versiones anteriores encontradas en búsquedas
let activePreviousVersionByChat = {};
// Estado en memoria para acciones de auditoría de series (multi-calidad y purga)
let activeSeriesAuditByTopic = {};

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

  // Comando /novedades o preguntas sobre revisar contenido nuevo en búnkers
  const isAskingNovedades = lower === '/novedades' || 
    lower.includes('contenido nuevo') || 
    lower.includes('algo nuevo') || 
    lower.includes('revisar si hay') || 
    lower.includes('revises si hay') || 
    lower.includes('revisa si hay') || 
    lower.includes('checar si hay') ||
    lower.includes('checa si hay') ||
    lower.includes('hay novedades') ||
    lower.includes('hay algo pendiente');

  if (isAskingNovedades) {
    await handleCheckNovedades(chatId);
    return;
  }

  // Detección de intención de auditoría completa de canal
  const isAuditChannelQuery = lower.startsWith('/auditar_canal') || 
    lower.startsWith('/auditarcanal') ||
    lower.includes('auditame todo en canal') ||
    lower.includes('auditame todo el canal') ||
    lower.includes('audita todo el canal') ||
    lower.includes('auditar todo el canal') ||
    lower.includes('auditar canal') ||
    lower.includes('audita el canal') ||
    lower.includes('auditar canal de series') ||
    lower.includes('audita canal de series');

  if (isAuditChannelQuery) {
    await handleAuditChannel(chatId, text);
    return;
  }

  // Detección de intención de auditoría de episodios de series
  const isAuditQuery = lower.startsWith('/auditar') || 
    lower.startsWith('auditar') || 
    lower.startsWith('audita') || 
    lower.includes('faltan capítulos') || 
    lower.includes('faltan capitulos') || 
    lower.includes('faltan episodios') || 
    lower.includes('comprobar capítulos') || 
    lower.includes('comprobar capitulos') || 
    lower.includes('auditar serie') ||
    lower.includes('auditar la serie') ||
    lower.includes('audita la serie');

  if (isAuditQuery) {
    await handleAuditSeries(chatId, text);
    return;
  }

  // Intención explícita de desarrollo/código (solo aquí se deben generar scripts/workflows)
  const isDevIntent = lower.includes('script') || 
    lower.includes('workflow') || 
    lower.includes('programa') || 
    lower.includes('programar') || 
    lower.includes('código') || 
    lower.includes('codigo') || 
    lower.includes('desarrolla') || 
    lower.includes('crea un') || 
    lower.includes('haz un') ||
    lower.includes('automatiza');

  // Detección de intención de búsqueda de contenido (lenguaje natural o comando /buscar)
  const isSearchQuery = !isDevIntent && (
    lower.startsWith('/buscar') || 
    lower.startsWith('buscar') || 
    lower.startsWith('busca') || 
    lower.startsWith('buscame') || 
    lower.startsWith('búscame') || 
    lower.startsWith('dónde está') || 
    lower.startsWith('donde esta') || 
    lower.startsWith('dónde esta') || 
    lower.startsWith('donde está') || 
    lower.startsWith('tenemos') ||
    lower.startsWith('está ') ||
    lower.startsWith('esta ') ||
    lower.startsWith('hay ') ||
    lower.startsWith('encuentra') ||
    lower.startsWith('mira si') ||
    lower.startsWith('revisa si') ||
    lower.startsWith('fíjate si') ||
    lower.startsWith('fijate si') ||
    lower.includes('tenemos') ||
    lower.includes('buscar') ||
    lower.includes('busca')
  );

  if (isSearchQuery) {
    await handleSearchContent(chatId, text);
    return;
  }

  // Comando /canales o /bunkers
  if (lower === '/canales' || lower === '/bunkers' || lower === 'canales') {
    await sendCanalesMessage(chatId);
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
 * Lista de canales Búnker y Producción de TeVeFLIPE
 */
async function sendCanalesMessage(chatId) {
  try {
    const fs = require('fs');
    const path = require('path');
    const canales = JSON.parse(fs.readFileSync(path.join(__dirname, 'canales_map.json'), 'utf-8'));

    let text = `📡 <b>RED DE CANALES TEVEFLIPE (${canales.length} categorías)</b>\n\n`;
    canales.forEach(c => {
      text += `<b>${telegram.escapeHtml(c.nombre)}</b>\n`;
      text += `  📥 <b>Búnker:</b> <code>${c.bunker_id}</code> (${c.bunker_nombre}${c.topic_id ? ' - Topic ' + c.topic_id : ''})\n`;
      text += `  📤 <b>Producción:</b> <code>${c.produccion_id}</code> (${c.is_forum ? 'Foro/Temas' : 'Canal'})\n\n`;
    });

    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    await telegram.sendMessage(chatId, `❌ Error cargando canales: ${err.message}`);
  }
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
• /novedades - Escanear si hay contenido nuevo en los búnkers con títulos y sincronización.
• /buscar &lt;título&gt; - Buscar películas o series en Producción y obtener enlace directo.
• /auditar &lt;serie&gt; - Analizar temporadas, detectar capítulos faltantes, duplicados y multi-calidad.
• /auditar_canal - Auditoría integral de todo el canal de Series TV de Producción.
• /canales - Ver el mapa de los 15 canales Búnker y Producción de TeVeFLIPE.
• /workflows - Ver y disparar workflows de GitHub Actions.
• /status - Ver el estado de las últimas ejecuciones en GitHub Actions.
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
 * Comprobar novedades en tiempo real en los canales Búnker
 */
async function handleCheckNovedades(chatId) {
  const ack = await telegram.sendMessage(chatId, '🔍 <b>Consultando los canales búnker en tiempo real...</b>', { parse_mode: 'HTML' });
  const ackMsgId = ack?.result?.message_id;

  try {
    const pythonScript = path.join(__dirname, 'services', 'check_novedades.py');
    const { stdout, stderr } = await execPromise(`python "${pythonScript}"`);
    
    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo interpretar el reporte de los búnkers.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    const novedades = data.novedades || [];
    const alDia = data.al_dia || [];

    if (novedades.length === 0) {
      const allGoodText = `✅ <b>¡Todos los canales están al día!</b>\n\nNo se detectó contenido nuevo pendiente en los búnkers consultados.`;
      if (ackMsgId) {
        await telegram.editMessageText(chatId, ackMsgId, allGoodText, { parse_mode: 'HTML' });
      } else {
        await telegram.sendMessage(chatId, allGoodText, { parse_mode: 'HTML' });
      }
      return;
    }

    let report = `🔔 <b>REPORTE DE NOVEDADES EN BÚNKERS</b>\n\n`;
    report += `Se encontró contenido nuevo pendiente por sincronizar:\n\n`;

    novedades.forEach(n => {
      const cantStr = n.pendientes === 1 ? '1 archivo nuevo' : `~${n.pendientes} archivos nuevos`;
      report += `• <b>${telegram.escapeHtml(n.nombre)}</b>: <b>${cantStr}</b>\n`;
      if (n.titulos && n.titulos.length > 0) {
        const itemIcon = n.is_serie ? '📺' : '🎬';
        n.titulos.forEach(t => {
          report += `   ↳ ${itemIcon} <i>${telegram.escapeHtml(t)}</i>\n`;
        });
        if (n.mas_titulos > 0) {
          report += `   ↳ <i>...y ${n.mas_titulos} más</i>\n`;
        }
      }
      report += `\n`;
    });

    if (alDia.length > 0) {
      report += `👌 <b>Canales al día:</b> ${alDia.map(n => n.split(' - ')[0]).join(', ')}\n`;
    }

    report += `\n¿Deseas sincronizarlos a sus canales de Producción ahora?`;

    const buttons = {
      inline_keyboard: [
        [
          { text: '🚀 Sí, Sincronizar Ahora', callback_data: 'sync_now' },
          { text: '⏳ Más tarde', callback_data: 'sync_later' }
        ]
      ]
    };

    if (ackMsgId) {
      await telegram.editMessageText(chatId, ackMsgId, report, {
        parse_mode: 'HTML',
        reply_markup: buttons
      });
    } else {
      await telegram.sendMessage(chatId, report, {
        parse_mode: 'HTML',
        reply_markup: buttons
      });
    }

  } catch (err) {
    console.error('Error revisando novedades:', err);
    await telegram.sendMessage(chatId, `❌ Error consultando búnkers: ${err.message}`);
  }
}

/**
 * Auditar capítulos y temporadas de una serie en Producción
 */
async function handleAuditSeries(chatId, rawText) {
  await telegram.sendChatAction(chatId, 'typing');

  let cleanTitle = null;
  try {
    cleanTitle = await gemini.extractSearchEntity(rawText);
  } catch (e) {
    console.warn('Error en Gemini para auditar:', e.message);
  }

  if (!cleanTitle) {
    cleanTitle = rawText.replace(/^(\/auditar|auditar|audita|audita la serie|auditar la serie)\s+/i, '').replace(/[?¿]/g, '').trim();
  }

  if (!cleanTitle) {
    await telegram.sendMessage(chatId, '⚠️ Por favor indica el nombre de la serie que deseas auditar. Ej: <code>/auditar The Ark</code>', { parse_mode: 'HTML' });
    return;
  }

  const ack = await telegram.sendMessage(chatId, `📊 <b>Auditando episodios de "<code>${telegram.escapeHtml(cleanTitle)}</code>" en Producción...</b>`, { parse_mode: 'HTML' });
  const ackMsgId = ack?.result?.message_id;

  try {
    const pythonScript = path.join(__dirname, 'services', 'audit_series.py');
    const safeTitle = cleanTitle.replace(/"/g, '\\"');
    const { stdout } = await execPromise(`python "${pythonScript}" "${safeTitle}"`);

    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo procesar la respuesta de auditoría.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    let report = `📊 <b>AUDITORÍA DE SERIE: ${telegram.escapeHtml(data.serie)}</b>\n`;
    report += `📂 Canal: <b>${telegram.escapeHtml(data.canal)}</b> (Tema ID: <code>${data.topic_id}</code>)\n`;
    report += `🔗 <a href="${data.link}">Abrir Tema en Telegram</a>\n\n`;

    const actionButtons = [];

    data.seasons.forEach(s => {
      const icon = s.completa ? '✅' : '⚠️';
      const statusText = s.completa ? 'Completa' : '<b>Incompleta</b>';
      report += `${icon} <b>Temporada ${s.temporada}:</b> ${statusText} (${s.capitulos_unicos} caps, del ${s.rango})\n`;
      
      if (!s.completa && s.faltantes.length > 0) {
        report += `   ❌ <b>Faltan:</b> <code>${s.faltantes.join(', ')}</code>\n`;
        s.faltantes.slice(0, 3).forEach(f => {
          actionButtons.push([
            {
              text: `🔍 Buscar ${telegram.escapeHtml(data.serie)} ${f} en Origen`,
              callback_data: `searchorig_${encodeURIComponent(`${data.serie} ${f}`)}`
            }
          ]);
        });
      }

      if (s.multi_calidad && s.multi_calidad.length > 0) {
        report += `   💎 <i>Multi-Calidad: ${s.multi_calidad.length} caps con doble versión (Ligera MP4 + Cine MKV)</i>\n`;
      }

      if (s.duplicados_redundantes && s.duplicados_redundantes.length > 0) {
        report += `   🔁 <i>Duplicados idénticos: ${s.duplicados_redundantes.join(', ')}</i>\n`;
      }
      report += `\n`;
    });

    if (data.missing_all.length === 0) {
      report += `🎉 <b>¡La serie está completa al 100%! No falta ningún capítulo en la secuencia detectada.</b>\n`;
    }

    // Guardar contexto en caché para las acciones interactivas
    activeSeriesAuditByTopic[data.topic_id] = {
      channelId: data.channel_id,
      topicId: data.topic_id,
      serie: data.serie,
      ligeras: data.msg_ids_ligeras || [],
      cine: data.msg_ids_cine || [],
      redundantes: data.msg_ids_redundantes || []
    };

    if (data.total_multi_calidad > 0) {
      report += `\n💎 <b>Modo Multi-Calidad Activo (${data.total_multi_calidad} caps):</b>\n` +
        `<i>La serie dispone de versiones ligeras para streaming rápido y versiones pesadas de cine en alta definición.</i>\n`;
      
      actionButtons.push([
        { text: '🤝 Mantener Ambas (Multi-Calidad para la App)', callback_data: `multiact_keepboth_${data.topic_id}` }
      ]);
      actionButtons.push([
        { text: '🌟 Dejar solo Calidad Máxima (~3 GB)', callback_data: `multiact_keephigh_${data.topic_id}` },
        { text: '⚡ Dejar solo Versión Ligera (.mp4)', callback_data: `multiact_keeplow_${data.topic_id}` }
      ]);
    }

    if (data.total_redundantes > 0) {
      report += `\n⚠️ <b>${data.total_redundantes} archivos duplicados idénticos detectados.</b>\n`;
      actionButtons.push([
        { text: `🧹 Purgar Duplicados Idénticos (${data.total_redundantes})`, callback_data: `multiact_purgedupes_${data.topic_id}` }
      ]);
    }

    if (data.duplicate_topics && data.duplicate_topics.length > 0) {
      report += `\n⚠️ <b>¡Alerta de Temas Duplicados en Producción!</b>\n` +
        `Esta serie tiene más de un tema en el canal:\n` +
        `• <b>Tema Principal:</b> <a href="${data.link}">Tema #${data.topic_id}</a> (${data.total_mensajes} mensajes)\n`;
      data.duplicate_topics.forEach(dt => {
        report += `• <b>Tema Duplicado Redundante:</b> <a href="${dt.link}">Tema #${dt.id}</a> (${dt.total_mensajes} mensajes)\n`;
        actionButtons.push([
          { text: `🗑️ Purgar Tema Duplicado #${dt.id} (${dt.total_mensajes} msgs)`, callback_data: `deletetopic_${data.channel_id}_${dt.id}` }
        ]);
      });
      report += `\n`;
    }

    const replyMarkup = actionButtons.length > 0 ? { inline_keyboard: actionButtons } : undefined;

    if (ackMsgId) {
      await telegram.editMessageText(chatId, ackMsgId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    } else {
      await telegram.sendMessage(chatId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    }

  } catch (err) {
    console.error('Error auditando serie:', err);
    await telegram.sendMessage(chatId, `❌ Error en auditoría: ${err.message}`);
  }
}

/**
 * Auditoría general de todo el canal de Series TV de Producción
 */
async function handleAuditChannel(chatId, rawText) {
  await telegram.sendChatAction(chatId, 'typing');
  const ack = await telegram.sendMessage(
    chatId,
    `📊 <b>Iniciando auditoría general del canal de Series TV en Producción...</b>\n` +
    `<i>Analizando temas de series, detectando capítulos faltantes, temporadas incompletas y multi-calidad. Espera unos momentos...</i>`,
    { parse_mode: 'HTML' }
  );
  const ackMsgId = ack?.result?.message_id;

  try {
    const pythonScript = path.join(__dirname, 'services', 'audit_channel.py');
    const { stdout } = await execPromise(`python "${pythonScript}" series_tv 35`);
    
    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo procesar la respuesta de auditoría del canal.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    let report = `📊 <b>AUDITORÍA INTEGRAL DEL CANAL</b>\n`;
    report += `📂 Canal: <b>${telegram.escapeHtml(data.canal_nombre)}</b>\n`;
    report += `⏱️ Tiempo de análisis: <code>${data.duracion_segundos}s</code>\n\n`;

    report += `📈 <b>Resumen General:</b>\n`;
    report += `▫️ Total Series Analizadas: <b>${data.total_series_unicas || data.total_series}</b>\n`;
    report += `✅ Series 100% Completas: <b>${data.total_completas}</b>\n`;
    report += `⚠️ Series con Capítulos Faltantes: <b>${data.total_incompletas}</b>\n`;
    if (data.total_series_con_temas_duplicados > 0) {
      report += `👥 Series con Temas Duplicados en Producción: <b>${data.total_series_con_temas_duplicados}</b>\n`;
    }
    report += `💎 Series en Modo Multi-Calidad: <b>${data.total_multi_calidad}</b>\n`;
    report += `🔁 Series con Duplicados Redundantes: <b>${data.total_con_dupes}</b>\n\n`;

    const buttons = [];

    if (data.incompletas && data.incompletas.length > 0) {
      report += `⚠️ <b>Series Incompletas que Requieren Atención:</b>\n`;
      data.incompletas.slice(0, 8).forEach((inc, idx) => {
        report += `${idx + 1}. <a href="${inc.link}"><b>${telegram.escapeHtml(inc.title)}</b></a>: Faltan <code>${inc.faltantes.join(', ')}</code>` + (inc.faltantes_total > 5 ? ` <i>(+${inc.faltantes_total - 5} más)</i>` : '') + `\n`;
        
        buttons.push([
          {
            text: `🔍 Auditar a fondo: ${telegram.escapeHtml(inc.title).slice(0, 25)}`,
            callback_data: `auditone_${encodeURIComponent(inc.title.slice(0, 30))}`
          }
        ]);
      });
      report += `\n`;
    }

    if (data.multi_calidad_ejemplos && data.multi_calidad_ejemplos.length > 0) {
      report += `💎 <b>Series con Multi-Calidad detectadas:</b>\n<i>${data.multi_calidad_ejemplos.join(', ')}</i>\n\n`;
    }

    report += `💡 <i>Puedes auditar cualquier serie individual escribiendo: <code>/auditar &lt;nombre&gt;</code></i>`;

    const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons.slice(0, 6) } : undefined;

    if (ackMsgId) {
      await telegram.editMessageText(chatId, ackMsgId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    } else {
      await telegram.sendMessage(chatId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    }

  } catch (err) {
    console.error('Error en auditoría de canal:', err);
    await telegram.sendMessage(chatId, `❌ Error en auditoría del canal: ${err.message}`);
  }
}

/**
 * Buscar contenido en canales de Producción con corrección inteligente de IA
 */
async function handleSearchContent(chatId, rawText) {
  await telegram.sendChatAction(chatId, 'typing');

  // 1. Extraer título canónico y corregir typos con Gemini
  let targetQuery = null;
  try {
    targetQuery = await gemini.extractSearchEntity(rawText);
  } catch (e) {
    console.warn('Error en Gemini extractSearchEntity:', e.message);
  }

  // Fallback por regex si Gemini no responde
  if (!targetQuery) {
    targetQuery = rawText.replace(/^(\/buscar|buscar|dónde está|donde esta|tenemos|está la serie|esta la serie|está la peli|esta la peli|la serie|la película|la pelicula)\s+/i, '').replace(/[?¿]/g, '').trim();
  }

  if (!targetQuery) {
    await telegram.sendMessage(chatId, '⚠️ Por favor indica el título de la película o serie que deseas buscar.');
    return;
  }

  const queryNote = (targetQuery.toLowerCase() !== rawText.toLowerCase().replace(/[?¿]/g, '').trim())
    ? `🔍 <b>Buscando "<code>${telegram.escapeHtml(targetQuery)}</code>" en Producción...</b>\n<i>(Interpretado de: "${telegram.escapeHtml(rawText)}")</i>`
    : `🔍 <b>Buscando "<code>${telegram.escapeHtml(targetQuery)}</code>" en Producción...</b>`;

  const ack = await telegram.sendMessage(chatId, queryNote, { parse_mode: 'HTML' });
  const ackMsgId = ack?.result?.message_id;

  try {
    const pythonScript = path.join(__dirname, 'services', 'search_content.py');
    const safeQuery = targetQuery.replace(/"/g, '\\"');
    const { stdout } = await execPromise(`python "${pythonScript}" "${safeQuery}"`);

    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo procesar la respuesta de búsqueda.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    const resultados = data.resultados || [];
    if (resultados.length === 0) {
      activePreviousVersionByChat[chatId] = null;
      const notFoundText = `❌ No se encontró ningún resultado para "<b>${telegram.escapeHtml(targetQuery)}</b>" en los canales de Producción.`;
      const originBtn = {
        inline_keyboard: [
          [
            { text: '🔍 ¿Buscar en Canales Origen / Fuentes?', callback_data: `searchorig_${encodeURIComponent(targetQuery.slice(0, 30))}` }
          ]
        ]
      };
      if (ackMsgId) {
        await telegram.editMessageText(chatId, ackMsgId, notFoundText, { parse_mode: 'HTML', reply_markup: originBtn });
      } else {
        await telegram.sendMessage(chatId, notFoundText, { parse_mode: 'HTML', reply_markup: originBtn });
      }
      return;
    }

    // Guardar versión previa detectada en Producción
    if (resultados[0].items && resultados[0].items.length > 0) {
      const fItem = resultados[0].items[0];
      activePreviousVersionByChat[chatId] = {
        title: fItem.title,
        channelId: fItem.channel_id,
        msgId: fItem.msg_id
      };
    } else {
      activePreviousVersionByChat[chatId] = null;
    }

    let report = `🔎 <b>RESULTADOS PARA: "${telegram.escapeHtml(targetQuery)}"</b>\n\n`;
    const searchBetterButtons = [];
    let optionIndex = 0;

    resultados.forEach(r => {
      report += `📂 <b>${telegram.escapeHtml(r.canal)}</b>:\n`;
      r.items.slice(0, 4).forEach(it => {
        optionIndex++;
        const sizeTag = it.size_str ? ` [${it.size_str}]` : '';
        if (it.tipo === 'tema') {
          report += `<b>${optionIndex}.</b> 📺 <b>Tema del Foro: ${telegram.escapeHtml(it.title)}</b>\n`;
          report += `   🔗 <a href="${it.link}">Abrir Tema en Telegram</a>\n\n`;
        } else {
          report += `<b>${optionIndex}.</b> 🎬 <b>${telegram.escapeHtml(it.title)}</b>${sizeTag}\n`;
          report += `   📅 ${it.date} | 🔗 <a href="${it.link}">Abrir Archivo en Telegram</a>\n\n`;
        }

        let cleanForSearch = it.title.replace(/\.(mkv|mp4|avi|ts|mov)$/i, '').replace(/[_\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
        cleanForSearch = cleanForSearch.slice(0, 30);

        searchBetterButtons.push({
          num: optionIndex,
          cleanTitle: cleanForSearch,
          display: it.title.slice(0, 24)
        });
      });
    });

    const inlineKeyboard = [];
    if (searchBetterButtons.length === 1) {
      inlineKeyboard.push([
        { text: '💎 ¿Buscar mejor versión en Canales Origen?', callback_data: `searchorig_${encodeURIComponent(searchBetterButtons[0].cleanTitle)}` }
      ]);
    } else if (searchBetterButtons.length > 1) {
      searchBetterButtons.slice(0, 3).forEach(b => {
        inlineKeyboard.push([
          { text: `💎 Mejor versión de #${b.num} (${b.display})`, callback_data: `searchorig_${encodeURIComponent(b.cleanTitle)}` }
        ]);
      });
    }

    const betterBtn = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

    if (ackMsgId) {
      await telegram.editMessageText(chatId, ackMsgId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: betterBtn });
    } else {
      await telegram.sendMessage(chatId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: betterBtn });
    }

  } catch (err) {
    console.error('Error buscando contenido:', err);
    await telegram.sendMessage(chatId, `❌ Error en búsqueda: ${err.message}`);
  }
}

/**
 * Buscar en canales origen (Fuentes de Nivel 1)
 */
async function handleSearchOrigin(chatId, query, messageId) {
  const loadingText = `🔍 <b>Buscando "<code>${telegram.escapeHtml(query)}</code>" en Canales Origen (Películas, Series, Comunidad Castellana)...</b>`;
  if (messageId) {
    await telegram.editMessageText(chatId, messageId, loadingText, { parse_mode: 'HTML' });
  } else {
    await telegram.sendMessage(chatId, loadingText, { parse_mode: 'HTML' });
  }

  try {
    const pythonScript = path.join(__dirname, 'services', 'search_origin.py');
    const safeQuery = query.replace(/"/g, '\\"');
    const { stdout } = await execPromise(`python "${pythonScript}" "${safeQuery}"`);

    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo procesar la respuesta de canales origen.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    const resultados = data.resultados || [];
    if (resultados.length === 0) {
      const notFound = `❌ Tampoco se encontró contenido para "<b>${telegram.escapeHtml(query)}</b>" en los canales origen de Películas, Series o Comunidad Castellana.`;
      if (messageId) {
        await telegram.editMessageText(chatId, messageId, notFound, { parse_mode: 'HTML' });
      } else {
        await telegram.sendMessage(chatId, notFound, { parse_mode: 'HTML' });
      }
      return;
    }

    let report = `💎 <b>OPCIONES ENCONTRADAS EN CANALES ORIGEN: "${telegram.escapeHtml(query)}"</b>\n\n`;
    const copyButtons = [];
    let optionCount = 0;

    resultados.forEach(r => {
      report += `📥 <b>${telegram.escapeHtml(r.canal)}</b>:\n`;
      r.items.slice(0, 3).forEach((it) => {
        optionCount++;
        const bestTag = (optionCount === 1 && it.size_mb > 1000) ? ' 🌟 <i>(Mayor calidad/peso)</i>' : '';
        report += `<b>${optionCount}. ${telegram.escapeHtml(it.title)}</b>${bestTag}\n`;
        report += `   ⚖️ Peso: <b>${it.size_str || 'N/A'}</b> | 📅 ${it.date}\n`;
        report += `   🔗 <a href="${it.link}">Ver en Canal Origen</a>\n\n`;

        copyButtons.push([
          {
            text: `📥 Copiar Opción ${optionCount} (${it.size_str || 'Video'}) al Búnker`,
            callback_data: `copybunk_${it.channel_id}_${it.msg_id}_${it.content_type}`
          }
        ]);
      });
    });

    const replyMarkup = copyButtons.length > 0 ? { inline_keyboard: copyButtons } : undefined;

    if (messageId) {
      await telegram.editMessageText(chatId, messageId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    } else {
      await telegram.sendMessage(chatId, report, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
    }

  } catch (err) {
    console.error('Error buscando en canales origen:', err);
    await telegram.sendMessage(chatId, `❌ Error consultando canales origen: ${err.message}`);
  }
}

/**
 * Copiar archivo desde canal origen al Búnker correspondiente
 */
async function handleCopyToBunker(chatId, fromCid, msgId, cType, messageId) {
  const loading = `⏳ <b>Copiando archivo al Búnker TeVeFLIPE...</b>`;
  if (messageId) {
    await telegram.editMessageText(chatId, messageId, loading, { parse_mode: 'HTML' });
  } else {
    await telegram.sendMessage(chatId, loading, { parse_mode: 'HTML' });
  }

  try {
    const pythonScript = path.join(__dirname, 'services', 'copy_to_bunker.py');
    const { stdout } = await execPromise(`python "${pythonScript}" "${fromCid}" "${msgId}" "${cType}"`);

    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      throw new Error('No se pudo procesar la respuesta de copia al búnker.');
    }

    if (!data.ok) throw new Error(data.error || 'Error desconocido al copiar');

    let successMsg = `✅ <b>¡COPIADO CON ÉXITO AL BÚNKER!</b> 📥\n\n` +
      `📦 <b>Archivo:</b> <code>${telegram.escapeHtml(data.filename)}</code>\n` +
      `📁 <b>Búnker Destino:</b> <b>${telegram.escapeHtml(data.bunker_name)}</b>\n`;

    if (data.topic_title) {
      successMsg += `🏷️ <b>Tema de Serie:</b> <b>${telegram.escapeHtml(data.topic_title)}</b> (ID: <code>${data.topic_id}</code>)\n`;
    }
    successMsg += `\n`;

    const oldVer = activePreviousVersionByChat[chatId];
    const syncButtons = [];

    if (oldVer && oldVer.channelId && oldVer.msgId) {
      successMsg += `♻️ <b>Se detectó una versión anterior en Producción:</b>\n` +
        `• <i>${telegram.escapeHtml(oldVer.title)}</i>\n\n` +
        `¿Deseas reemplazarla eliminando la anterior de Producción para evitar duplicados?`;

      syncButtons.push([
        { text: '🗑️ Reemplazar y Borrar Antigua', callback_data: `replaceold_${oldVer.channelId}_${oldVer.msgId}` }
      ]);
      syncButtons.push([
        { text: '🚀 Conservar Ambas y Sincronizar', callback_data: 'sync_now' }
      ]);
      syncButtons.push([
        { text: '⏳ Más tarde', callback_data: 'sync_later' }
      ]);
    } else {
      successMsg += `¿Deseas sincronizarlo a los canales de Producción ahora?`;
      syncButtons.push([
        { text: '🚀 Sí, Sincronizar Ahora', callback_data: 'sync_now' },
        { text: '⏳ Más tarde', callback_data: 'sync_later' }
      ]);
    }

    const replyMarkup = { inline_keyboard: syncButtons };

    if (messageId) {
      await telegram.editMessageText(chatId, messageId, successMsg, { parse_mode: 'HTML', reply_markup: replyMarkup });
    } else {
      await telegram.sendMessage(chatId, successMsg, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }

  } catch (err) {
    console.error('Error copiando a bunker:', err);
    await telegram.sendMessage(chatId, `❌ Error copiando al búnker: ${err.message}`);
  }
}

/**
 * Reemplazar versión antigua (eliminar de Producción y disparar sincronización)
 */
async function handleReplaceOld(chatId, oldCid, oldMid, messageId) {
  const loading = `♻️ <b>Eliminando versión anterior de Producción y lanzando sincronización...</b>`;
  if (messageId) {
    await telegram.editMessageText(chatId, messageId, loading, { parse_mode: 'HTML' });
  }

  try {
    const pythonScript = path.join(__dirname, 'services', 'delete_content.py');
    await execPromise(`python "${pythonScript}" "${oldCid}" "${oldMid}"`);

    // Disparar sincronización para publicar la nueva versión
    await github.triggerWorkflow('sync_novedades.yml');

    const doneText = `♻️ <b>¡REEMPLAZO REALIZADO CON ÉXITO!</b>\n\n` +
      `🗑️ La versión anterior en menor calidad ha sido eliminada de Producción para evitar duplicados.\n` +
      `🚀 La nueva versión de mayor calidad se está sincronizando y publicando en Producción.\n\n` +
      `📊 <a href="https://github.com/${config.githubOwner}/${config.githubRepo}/actions">Monitorear en GitHub Actions</a>`;

    if (messageId) {
      await telegram.editMessageText(chatId, messageId, doneText, { parse_mode: 'HTML' });
    } else {
      await telegram.sendMessage(chatId, doneText, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Error reemplazando versión antigua:', err);
    await telegram.sendMessage(chatId, `❌ Error en reemplazo: ${err.message}`);
  }
}

/**
 * Manejo de botones de ejecución de workflows y confirmaciones
 */
async function handleCallbackQuery(cb) {
  const chatId = cb.message.chat.id;
  const data = cb.data;

  await telegram.answerCallbackQuery(cb.id, 'Procesando...');

  if (data.startsWith('searchorig_')) {
    const rawQ = decodeURIComponent(data.replace('searchorig_', ''));
    await handleSearchOrigin(chatId, rawQ, cb.message.message_id);
    return;
  }

  if (data.startsWith('auditone_')) {
    const sTitle = decodeURIComponent(data.replace('auditone_', ''));
    await handleAuditSeries(chatId, `/auditar ${sTitle}`);
    return;
  }

  if (data.startsWith('multiact_keepboth_')) {
    const topicId = data.replace('multiact_keepboth_', '');
    const item = activeSeriesAuditByTopic[topicId];
    const sName = item?.serie || 'la serie';
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `🤝 <b>Configuración confirmada para "${telegram.escapeHtml(sName)}":</b>\n\n` +
      `Se mantienen ambas versiones (Ligera MP4 + Cine HD) para que la app TeVeFLIPE (${config.androidPackage || 'com.felipe.flipegramtv'}) ofrezca selección de calidad inteligente al reproducir.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data.startsWith('multiact_keephigh_')) {
    const topicId = data.replace('multiact_keephigh_', '');
    const item = activeSeriesAuditByTopic[topicId];
    if (!item || !item.ligeras || item.ligeras.length === 0) {
      await telegram.sendMessage(chatId, '⚠️ No se encontraron IDs de versiones ligeras para eliminar.');
      return;
    }
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `🗑️ <b>Eliminando ${item.ligeras.length} archivos de versiones ligeras...</b> Conservando solo Máxima Calidad Cine.`,
      { parse_mode: 'HTML' }
    );
    try {
      const pythonScript = path.join(__dirname, 'services', 'delete_content.py');
      const midsStr = item.ligeras.join(',');
      await execPromise(`python "${pythonScript}" "${item.channelId}" "${midsStr}"`);
      await telegram.sendMessage(
        chatId,
        `🌟 <b>¡Limpieza completada!</b> Se eliminaron las versiones ligeras de <b>${telegram.escapeHtml(item.serie)}</b>. El canal conserva ahora únicamente los archivos en Máxima Calidad Cine.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      await telegram.sendMessage(chatId, `❌ Error eliminando archivos: ${e.message}`);
    }
    return;
  }

  if (data.startsWith('multiact_keeplow_')) {
    const topicId = data.replace('multiact_keeplow_', '');
    const item = activeSeriesAuditByTopic[topicId];
    if (!item || !item.cine || item.cine.length === 0) {
      await telegram.sendMessage(chatId, '⚠️ No se encontraron IDs de versiones pesadas para eliminar.');
      return;
    }
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `🗑️ <b>Eliminando ${item.cine.length} archivos pesados de cine...</b> Conservando versión Ligera (.mp4).`,
      { parse_mode: 'HTML' }
    );
    try {
      const pythonScript = path.join(__dirname, 'services', 'delete_content.py');
      const midsStr = item.cine.join(',');
      await execPromise(`python "${pythonScript}" "${item.channelId}" "${midsStr}"`);
      await telegram.sendMessage(
        chatId,
        `⚡ <b>¡Limpieza completada!</b> Se eliminaron las versiones pesadas de <b>${telegram.escapeHtml(item.serie)}</b>. El canal conserva ahora la versión ligera de carga ultra rápida.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      await telegram.sendMessage(chatId, `❌ Error eliminando archivos: ${e.message}`);
    }
    return;
  }

  if (data.startsWith('multiact_purgedupes_')) {
    const topicId = data.replace('multiact_purgedupes_', '');
    const item = activeSeriesAuditByTopic[topicId];
    if (!item || !item.redundantes || item.redundantes.length === 0) {
      await telegram.sendMessage(chatId, '⚠️ No se encontraron IDs de duplicados redundantes para purgar.');
      return;
    }
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `🧹 <b>Purgando ${item.redundantes.length} duplicados redundantes...</b>`,
      { parse_mode: 'HTML' }
    );
    try {
      const pythonScript = path.join(__dirname, 'services', 'delete_content.py');
      const midsStr = item.redundantes.join(',');
      await execPromise(`python "${pythonScript}" "${item.channelId}" "${midsStr}"`);
      await telegram.sendMessage(
        chatId,
        `🧹 <b>¡Purga completada!</b> Se eliminaron ${item.redundantes.length} archivos duplicados idénticos de <b>${telegram.escapeHtml(item.serie)}</b>.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      await telegram.sendMessage(chatId, `❌ Error purgando duplicados: ${e.message}`);
    }
    return;
  }

  if (data.startsWith('deletetopic_')) {
    const parts = data.replace('deletetopic_', '').split('_');
    const cid = parseInt(parts[0], 10);
    const tid = parseInt(parts[1], 10);
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `🗑️ <b>Eliminando tema duplicado #${tid} de Producción...</b>`,
      { parse_mode: 'HTML' }
    );
    try {
      const pythonScript = path.join(__dirname, 'services', 'delete_topic.py');
      await execPromise(`python "${pythonScript}" "${cid}" "${tid}"`);
      await telegram.sendMessage(
        chatId,
        `✅ <b>¡Tema duplicado #${tid} eliminado con éxito de Producción!</b> El canal ahora conserva únicamente el tema principal.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      await telegram.sendMessage(chatId, `❌ Error eliminando tema duplicado: ${e.message}`);
    }
    return;
  }

  if (data.startsWith('replaceold_')) {
    const parts = data.replace('replaceold_', '').split('_');
    const oldCid = parseInt(parts[0], 10);
    const oldMid = parseInt(parts[1], 10);
    await handleReplaceOld(chatId, oldCid, oldMid, cb.message.message_id);
    return;
  }

  if (data.startsWith('copybunk_')) {
    const parts = data.replace('copybunk_', '').split('_');
    const fromCid = parseInt(parts[0], 10);
    const msgId = parseInt(parts[1], 10);
    const cType = parts[2] || 'pelicula';
    await handleCopyToBunker(chatId, fromCid, msgId, cType, cb.message.message_id);
    return;
  }

  if (data === 'sync_now') {
    try {
      await github.triggerWorkflow('sync_novedades.yml');
      await telegram.editMessageText(
        chatId,
        cb.message.message_id,
        `🚀 <b>¡Sincronización iniciada con éxito!</b>\n\n` +
        `El workflow <code>sync_novedades.yml</code> está procesando los búnkers en GitHub Actions.\n\n` +
        `📊 <a href="https://github.com/${config.githubOwner}/${config.githubRepo}/actions">Monitorear en GitHub Actions</a>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await telegram.sendMessage(chatId, `❌ Error activando sincronización: ${err.message}`);
    }
    return;
  }

  if (data === 'sync_later') {
    await telegram.editMessageText(
      chatId,
      cb.message.message_id,
      `⏳ <b>Sincronización pospuesta.</b>\n\nNo se ha movido nada. Cuando quieras sincronizar, solo envíame /novedades o pregúntame de nuevo.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

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

  // Iniciar servidor HTTP mínimo para health-check de Koyeb / Render / Cloud
  const http = require('http');
  const PORT = process.env.PORT || 8000;
  try {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('🤖 TeVeFLIPE DevBot is running 24/7 on Koyeb!\n');
    });
    server.listen(PORT, () => {
      console.log(`🌐 Health-check HTTP server escuchando en puerto ${PORT}`);
    });
  } catch (e) {
    console.warn('[HTTP Server Warning]:', e.message);
  }

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
