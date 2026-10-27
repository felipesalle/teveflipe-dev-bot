import os
import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')

def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    return env

async def delete_msg(channel_id: int, msg_id: int):
    env = load_env()
    session_prod = env.get('SESSION_PROD')
    session_bunker = env.get('SESSION_BUNKER')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    # Intentar con SESSION_PROD primero, luego con SESSION_BUNKER si falla
    session_to_use = session_prod or session_bunker
    if not session_to_use:
        print(json.dumps({"ok": False, "error": "No hay sesión configurada"}))
        return

    c = TelegramClient(StringSession(session_to_use), api_id, api_hash)
    await c.connect()

    try:
        ent = await c.get_input_entity(channel_id)
        await c.delete_messages(ent, [msg_id])
        print(json.dumps({
            "ok": True,
            "deleted_msg_id": msg_id,
            "channel_id": channel_id
        }))
    except Exception as e:
        # Reintentar con SESSION_BUNKER si era de bunker
        if session_bunker and session_to_use != session_bunker:
            try:
                await c.disconnect()
                c = TelegramClient(StringSession(session_bunker), api_id, api_hash)
                await c.connect()
                ent = await c.get_input_entity(channel_id)
                await c.delete_messages(ent, [msg_id])
                print(json.dumps({
                    "ok": True,
                    "deleted_msg_id": msg_id,
                    "channel_id": channel_id
                }))
                return
            except Exception as e2:
                print(json.dumps({"ok": False, "error": str(e2)}))
                return
        print(json.dumps({"ok": False, "error": str(e)}))
    finally:
        await c.disconnect()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Argumentos insuficientes"}))
        sys.exit(1)

    cid = int(sys.argv[1])
    mid = int(sys.argv[2])
    asyncio.run(delete_msg(cid, mid))
