import os
import sys
import json
import re
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')

ORIGIN_CHANNELS = [
    {"id": -1001905652210, "nombre": "🎬 Películas Origen", "tipo": "pelicula"},
    {"id": -1002257262928, "nombre": "📺 Series Origen", "tipo": "serie"},
    {"id": -1002160549536, "nombre": "🇪🇸 Comunidad Castellana", "tipo": "series_especificas"}
]

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

def is_direct_video(fn):
    if not fn:
        return False
    fn_lower = fn.lower()
    is_vid = fn_lower.endswith(('.mkv', '.mp4', '.avi', '.ts', '.mov'))
    is_part = bool(re.search(r'\.part\d+\.', fn_lower))
    return is_vid and not is_part

def clean_display_title(fn, txt):
    s = fn or (txt.split('\n')[0] if txt else '')
    s = s.replace('_', ' ').strip()
    # Limpiar extension
    s = re.sub(r'\.(mkv|mp4|avi|ts|mov)$', '', s, flags=re.IGNORECASE)
    return s[:65]

async def search_in_origins(query: str):
    env = load_env()
    session_bunker = env.get('SESSION_BUNKER')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    if not session_bunker:
        print(json.dumps({"ok": False, "error": "SESSION_BUNKER no configurada"}))
        return

    c = TelegramClient(StringSession(session_bunker), api_id, api_hash)
    await c.connect()

    results = []
    q_words = [w.lower() for w in query.split() if len(w) > 2]

    for canal in ORIGIN_CHANNELS:
        cid = canal["id"]
        c_name = canal["nombre"]
        ctype = canal["tipo"]
        clean_cid = str(abs(cid))
        if clean_cid.startswith("100") and len(clean_cid) > 10:
            clean_cid = clean_cid[3:]

        try:
            ent = await c.get_input_entity(cid)
            video_matches = []
            other_matches = []

            # Escanear hasta 120 coincidencias para no perder versiones en el historial
            async for m in c.iter_messages(ent, search=query, limit=120):
                if not m.file and not m.text:
                    continue

                fn = m.file.name if m.file else None
                txt = (m.text.split('\n')[0][:70] if m.text else '')
                raw_title = fn or txt or ""

                if not raw_title:
                    continue

                # Filtrado de relevancia: asegurar que al menos una palabra clave relevante esté en el título
                raw_lower = raw_title.lower()
                if q_words and not any(w in raw_lower for w in q_words):
                    continue

                size_mb = 0
                size_str = ""
                if m.file:
                    size_bytes = m.file.size
                    if size_bytes >= 1024**3:
                        size_str = f"{round(size_bytes / (1024**3), 2)} GB"
                    else:
                        size_str = f"{round(size_bytes / (1024**2), 1)} MB"
                    size_mb = round(size_bytes / (1024**2), 1)

                item = {
                    "msg_id": m.id,
                    "channel_id": cid,
                    "content_type": "serie" if "serie" in ctype else "pelicula",
                    "title": clean_display_title(fn, txt),
                    "raw_title": raw_title,
                    "size_str": size_str,
                    "size_mb": size_mb,
                    "link": f"https://t.me/c/{clean_cid}/{m.id}",
                    "date": m.date.strftime("%d/%m/%Y")
                }

                if is_direct_video(fn):
                    video_matches.append(item)
                else:
                    # No incluir partes individuales de rar (.part02, .part03...) para evitar saturar
                    if not re.search(r'\.part0?[2-9]\d*\.rar', raw_lower):
                        other_matches.append(item)

            # Priorizar videos directos (.mkv, .mp4) ordenados de mayor a menor tamaño
            video_matches.sort(key=lambda x: x["size_mb"], reverse=True)
            other_matches.sort(key=lambda x: x["size_mb"], reverse=True)

            # Combinar dando prioridad a videos directos
            final_items = video_matches[:5]
            if len(final_items) < 3 and other_matches:
                final_items.extend(other_matches[:3 - len(final_items)])

            if final_items:
                results.append({
                    "canal": c_name,
                    "channel_id": cid,
                    "coincidencias": len(final_items),
                    "items": final_items
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
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Gladiator"
    asyncio.run(search_in_origins(q))
