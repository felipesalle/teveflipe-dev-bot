import os
import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetForumTopicsRequest

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

async def search_query(query: str):
    env = load_env()
    session_prod = env.get('SESSION_PROD')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    if not session_prod:
        print(json.dumps({"ok": False, "error": "SESSION_PROD no encontrada"}))
        return

    c = TelegramClient(StringSession(session_prod), api_id, api_hash)
    await c.connect()

    canales = []
    if os.path.exists(MAP_FILE):
        with open(MAP_FILE, 'r', encoding='utf-8') as f:
            canales = json.load(f)

    results = []

    for canal in canales:
        if not canal.get('activo', True):
            continue

        prod_id = canal.get('produccion_id')
        if not prod_id:
            continue

        c_name = canal.get('nombre', 'Canal')
        is_forum = canal.get('is_forum', False)
        clean_pid = str(abs(prod_id))
        if clean_pid.startswith("100") and len(clean_pid) > 10:
            clean_pid = clean_pid[3:]

        try:
            ent = await c.get_input_entity(prod_id)
            found_items = []
            seen_topics = set()

            # 1. Si es un foro, buscar directamente en los títulos de temas (topics)
            if is_forum:
                try:
                    res_topics = await c(GetForumTopicsRequest(
                        peer=ent, q=query, offset_date=0, offset_id=0, offset_topic=0, limit=5
                    ))
                    if res_topics and res_topics.topics:
                        for t in res_topics.topics:
                            seen_topics.add(t.id)
                            tg_link = f"https://t.me/c/{clean_pid}/{t.id}"
                            found_items.append({
                                "tipo": "tema",
                                "title": t.title,
                                "top_id": t.id,
                                "msg_id": t.id,
                                "channel_id": prod_id,
                                "link": tg_link,
                                "date": t.date.strftime("%d/%m/%Y") if hasattr(t, 'date') and t.date else ""
                            })
                except Exception:
                    pass

            # 2. Buscar en mensajes / archivos dentro del canal o foro
            async for m in c.iter_messages(ent, search=query, limit=5):
                top_id = None
                if is_forum and m.reply_to:
                    top_id = getattr(m.reply_to, 'reply_to_top_id', None) or getattr(m.reply_to, 'reply_to_msg_id', None)

                # Si ya reportamos este tema como coincidencia principal, no duplicar
                if is_forum and top_id and top_id in seen_topics:
                    continue

                fn = m.file.name if m.file else None
                txt = m.text[:60] if m.text else None
                link_id = top_id if (is_forum and top_id) else m.id
                tg_link = f"https://t.me/c/{clean_pid}/{link_id}"

                found_items.append({
                    "tipo": "archivo",
                    "title": fn or txt or "Sin nombre",
                    "top_id": top_id,
                    "msg_id": m.id,
                    "channel_id": prod_id,
                    "link": tg_link,
                    "date": m.date.strftime("%d/%m/%Y")
                })

            if found_items:
                results.append({
                    "canal": c_name,
                    "is_forum": is_forum,
                    "coincidencias": len(found_items),
                    "items": found_items
                })

        except Exception:
            continue

    await c.disconnect()

    print(json.dumps({
        "ok": True,
        "query": query,
        "total_canales": len(results),
        "resultados": results
    }, ensure_ascii=False))

if __name__ == '__main__':
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Verano Azul"
    asyncio.run(search_query(q))
