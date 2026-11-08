import json
import os
import sys
from telethon import TelegramClient
from telethon.sessions import StringSession

async def get_connected_client(env, preferred_order=('SESSION_BUNKER', 'SESSION_PROD')):
    """
    Intenta conectar a Telegram utilizando las sesiones disponibles en orden de preferencia.
    Si una sesión falla (por ejemplo AuthKeyDuplicatedError o no autorizada), prueba la siguiente.
    """
    sessions = []
    for k in preferred_order:
        s = (env.get(k) or '').strip().strip("'").strip('"')
        if s and len(s) >= 50 and s not in [item[1] for item in sessions]:
            sessions.append((k, s))

    # Añadir cualquier otra sesión que no esté en preferred_order
    for k in ['SESSION_BUNKER', 'SESSION_PROD']:
        s = (env.get(k) or '').strip().strip("'").strip('"')
        if s and len(s) >= 50 and s not in [item[1] for item in sessions]:
            sessions.append((k, s))

    if not sessions:
        raise ValueError("No hay variables de sesión configuradas (SESSION_BUNKER o SESSION_PROD)")

    api_id_default = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash_default = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    last_error = None
    for key_name, s_str in sessions:
        # Si la sesión es de Kodi (29978684), Telethon funciona con ambos API_ID
        try:
            client = TelegramClient(StringSession(s_str), api_id_default, api_hash_default)
            await client.connect()
            if await client.is_user_authorized():
                return client
            else:
                await client.disconnect()
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(f"No fue posible conectar con ninguna sesión disponible: {last_error}")
