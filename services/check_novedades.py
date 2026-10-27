import os
import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')
MAP_FILE = os.path.join(BASE_DIR, 'canales_map.json')

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

async def check():
    env = load_env()
    session_prod = env.get('SESSION_PROD')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    if not session_prod:
        print(json.dumps({"error": "SESSION_PROD no encontrada en .env"}))
        return

    c = TelegramClient(StringSession(session_prod), api_id, api_hash)
    await c.connect()

    canales = []
    if os.path.exists(MAP_FILE):
        with open(MAP_FILE, 'r', encoding='utf-8') as f:
            canales = json.load(f)

    novedades = []
    al_dia = []
    errores = []

    for item in canales:
        if not item.get('activo', True):
            continue

        b_id = item.get('bunker_id')
        last_id = item.get('ultimo_id_sincronizado', 0)
        c_name = item.get('nombre', 'Canal')

        try:
            ent = await c.get_input_entity(b_id)
            topic_id = item.get('topic_id')
            if topic_id:
                latest = await c.get_messages(ent, reply_to=topic_id, limit=1)
            else:
                latest = await c.get_messages(ent, limit=1)

            cur_id = latest[0].id if latest else 0

            if cur_id > last_id:
                diff = cur_id - last_id
                novedades.append({
                    "id": item["id"],
                    "nombre": c_name,
                    "pendientes": diff,
                    "ultimo_id": cur_id,
                    "prev_id": last_id
                })
            else:
                al_dia.append(c_name)

        except Exception as e:
            # Canales donde SESSION_PROD no es miembro directo
            errores.append({"nombre": c_name, "error": str(e)})

    await c.disconnect()

    result = {
        "ok": True,
        "novedades": novedades,
        "al_dia": al_dia,
        "errores_acceso": len(errores)
    }

    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    asyncio.run(check())
