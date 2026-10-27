const config = require('../config');

const API_BASE = `https://api.telegram.org/bot${config.telegramToken}`;

async function callTelegram(method, payload) {
  try {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram Error] (${method}):`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`[Telegram Fetch Error] (${method}):`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    ...options
  };

  const res = await callTelegram('sendMessage', payload);
  if (!res.ok && payload.parse_mode) {
    // Si falla por formato HTML/Markdown, reintentar con texto plano
    const fallbackPayload = { ...payload };
    delete fallbackPayload.parse_mode;
    return await callTelegram('sendMessage', fallbackPayload);
  }
  return res;
}

async function editMessageText(chatId, messageId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    ...options
  };

  const res = await callTelegram('editMessageText', payload);
  if (!res.ok && payload.parse_mode) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.parse_mode;
    return await callTelegram('editMessageText', fallbackPayload);
  }
  return res;
}

async function sendChatAction(chatId, action = 'typing') {
  return await callTelegram('sendChatAction', { chat_id: chatId, action });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  return await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  sendMessage,
  editMessageText,
  sendChatAction,
  answerCallbackQuery,
  escapeHtml
};
