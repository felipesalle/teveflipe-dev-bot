import os
import sys
import json
import re
import random
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import ForwardMessagesRequest, GetForumTopicsRequest, CreateForumTopicRequest

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')

BUNKER_PELICULAS = -1002146236969  # REPOSITORIO DE PELÍCULAS
BUNKER_SERIES = -1002097175258      # SERIES TV

def load_env():
    env = dict(os.environ)
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    if k.strip() not in env:
                        env[k.strip()] = v.strip()
    return env

def extract_series_title(filename: str) -> str:
    if not filename:
        return "Serie"
    t = re.sub(r'\.[a-zA-Z0-9]{2,4}$', '', filename)
    t = re.sub(r'\[.*?\]', '', t)
    t = re.sub(r'(?i)\b(?:S\d{1,2}[\s_\.\-]*E\d{1,3}|\d{1,2}[xX]\d{1,3}|Cap(?:[ií]tulo)?[\s_\.]*\d+|Temp(?:orada)?[\s_\.]*\d+)\b', '', t)
    t = re.sub(r'[\-_.]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t or filename[:30]

async def copy_to_bunker(from_channel_id: int, msg_id: int, content_type: str = "pelicula", custom_title: str = None):
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

        source_msg = await c.get_messages(ent_from, ids=msg_id)
        if not source_msg:
            raise Exception("Mensaje no encontrado en el canal origen")

        fn = source_msg.file.name if source_msg.file else (source_msg.text.split('\n')[0][:60] if source_msg.text else "Archivo")

        topic_id = None
        topic_title = None

        if content_type == "serie":
            # Extraer o usar título de serie
            series_title = custom_title or extract_series_title(fn)
            
            # Buscar tema existente en el Búnker
            res = await c(GetForumTopicsRequest(peer=ent_to, q=series_title, offset_date=0, offset_id=0, offset_topic=0, limit=10))
            if res and res.topics:
                q_lower = series_title.lower()
                for t in res.topics:
                    if t.id == 1:
                        continue
                    t_lower = t.title.lower()
                    if q_lower in t_lower or t_lower in q_lower:
                        topic_id = t.id
                        topic_title = t.title
                        break

            # Si no existe, crear el tema en el Búnker
            if not topic_id:
                created = await c(CreateForumTopicRequest(
                    peer=ent_to,
                    title=series_title,
                    random_id=random.randint(1, 1 << 60)
                ))
                for upd in getattr(created, 'updates', []):
                    if hasattr(upd, 'message') and hasattr(upd.message, 'id'):
                        topic_id = upd.message.id
                        topic_title = series_title
                        break
                if not topic_id:
                    # Fallback si no viene en updates directo
                    res2 = await c(GetForumTopicsRequest(peer=ent_to, q=series_title, offset_date=0, offset_id=0, offset_topic=0, limit=2))
                    if res2 and res2.topics:
                        topic_id = res2.topics[0].id
                        topic_title = res2.topics[0].title

        # Reenviar al búnker: si es serie va al topic_id con top_msg_id, si es película va a la raíz
        req_kwargs = {
            "from_peer": ent_from,
            "id": [msg_id],
            "to_peer": ent_to,
            "drop_author": True,
            "random_id": [random.randint(1, 1 << 60)]
        }
        if topic_id:
            req_kwargs["top_msg_id"] = topic_id

        forwarded = await c(ForwardMessagesRequest(**req_kwargs))
        new_id = getattr(forwarded, 'id', None)
        if not new_id and hasattr(forwarded, 'updates'):
            for u in forwarded.updates:
                if hasattr(u, 'message') and hasattr(u.message, 'id'):
                    new_id = u.message.id
                    break

        bunker_name = "SERIES TV" if content_type == "serie" else "REPOSITORIO DE PELÍCULAS"

        print(json.dumps({
            "ok": True,
            "filename": fn,
            "bunker_name": bunker_name,
            "new_msg_id": new_id,
            "bunker_id": target_bunker_id,
            "topic_id": topic_id,
            "topic_title": topic_title
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "ok": False,
            "error": str(e)
        }, ensure_ascii=False))
    finally:
        await c.disconnect()

if __name__ == '__main__':
    # Uso: python copy_to_bunker.py <from_channel_id> <msg_id> <tipo> [custom_title]
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Argumentos insuficientes"}))
        sys.exit(1)

    from_cid = int(sys.argv[1])
    m_id = int(sys.argv[2])
    ctype = sys.argv[3] if len(sys.argv) > 3 else "pelicula"
    custom_t = sys.argv[4] if len(sys.argv) > 4 else None

    asyncio.run(copy_to_bunker(from_cid, m_id, ctype, custom_t))
