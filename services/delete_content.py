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

async def delete_msgs(channel_id: int, msg_ids: list):
    env = load_env()
    session_prod = env.get('SESSION_PROD')
    session_bunker = env.get('SESSION_BUNKER')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    session_to_use = session_prod or session_bunker
    if not session_to_use:
        print(json.dumps({"ok": False, "error": "No hay sesión configurada"}))
        return

    c = TelegramClient(StringSession(session_to_use), api_id, api_hash)
    await c.connect()

    try:
        ent = await c.get_input_entity(channel_id)
        await c.delete_messages(ent, msg_ids)
        print(json.dumps({
            "ok": True,
            "deleted_count": len(msg_ids),
            "deleted_msg_ids": msg_ids,
            "channel_id": channel_id
        }))
    except Exception as e:
        if session_bunker and session_to_use != session_bunker:
            try:
                await c.disconnect()
                c = TelegramClient(StringSession(session_bunker), api_id, api_hash)
                await c.connect()
                ent = await c.get_input_entity(channel_id)
                await c.delete_messages(ent, msg_ids)
                print(json.dumps({
                    "ok": True,
                    "deleted_count": len(msg_ids),
                    "deleted_msg_ids": msg_ids,
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
    raw_mids = sys.argv[2]
    if ',' in raw_mids:
        mids = [int(x.strip()) for x in raw_mids.split(',') if x.strip()]
    else:
        mids = [int(raw_mids.strip())]

    asyncio.run(delete_msgs(cid, mids))
