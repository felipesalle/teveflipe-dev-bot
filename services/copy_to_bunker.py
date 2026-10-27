import os
import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')

# Mapeo de búnkers destino
BUNKER_PELICULAS = -1002146236969  # REPOSITORIO DE PELÍCULAS
BUNKER_SERIES = -1002097175258      # SERIES TV

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

async def copy_to_bunker(from_channel_id: int, msg_id: int, content_type: str = "pelicula"):
    env = load_env()
    session_bunker = env.get('SESSION_BUNKER')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    if not session_bunker:
        print(json.dumps({"ok": False, "error": "SESSION_BUNKER no configurada"}))
        return

    c = TelegramClient(StringSession(session_bunker), api_id, api_hash)
    await c.connect()

    try:
        ent_from = await c.get_input_entity(from_channel_id)
        target_bunker_id = BUNKER_SERIES if content_type == "serie" else BUNKER_PELICULAS
        ent_to = await c.get_input_entity(target_bunker_id)

        # Obtener información del mensaje origen
        source_msg = await c.get_messages(ent_from, ids=msg_id)
        if not source_msg:
            raise Exception("Mensaje no encontrado en el canal origen")

        fn = source_msg.file.name if source_msg.file else (source_msg.text.split('\n')[0][:60] if source_msg.text else "Archivo")

        # Reenviar al búnker sin autor
        forwarded = await c.forward_messages(
            entity=ent_to,
            messages=msg_id,
            from_peer=ent_from,
            drop_author=True
        )

        new_id = forwarded[0].id if isinstance(forwarded, list) else forwarded.id
        bunker_name = "SERIES TV" if content_type == "serie" else "REPOSITORIO DE PELÍCULAS"

        print(json.dumps({
            "ok": True,
            "filename": fn,
            "bunker_name": bunker_name,
            "new_msg_id": new_id,
            "bunker_id": target_bunker_id
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "ok": False,
            "error": str(e)
        }, ensure_ascii=False))
    finally:
        await c.disconnect()

if __name__ == '__main__':
    # Uso: python copy_to_bunker.py <from_channel_id> <msg_id> <tipo>
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Argumentos insuficientes"}))
        sys.exit(1)

    from_cid = int(sys.argv[1])
    m_id = int(sys.argv[2])
    ctype = sys.argv[3] if len(sys.argv) > 3 else "pelicula"

    asyncio.run(copy_to_bunker(from_cid, m_id, ctype))
