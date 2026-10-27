import os
import sys
import json
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

    for canal in ORIGIN_CHANNELS:
        cid = canal["id"]
        c_name = canal["nombre"]
        clean_cid = str(abs(cid))
        if clean_cid.startswith("100") and len(clean_cid) > 10:
            clean_cid = clean_cid[3:]

        try:
            ent = await c.get_input_entity(cid)
            found = []
            async for m in c.iter_messages(ent, search=query, limit=10):
                if not m.file and not m.text:
                    continue

                fn = m.file.name if m.file else None
                txt = (m.text.split('\n')[0][:70] if m.text else '')
                
                size_mb = 0
                size_str = ""
                if m.file:
                    size_bytes = m.file.size
                    if size_bytes >= 1024**3:
                        size_str = f"{round(size_bytes / (1024**3), 2)} GB"
                    else:
                        size_str = f"{round(size_bytes / (1024**2), 1)} MB"
                    size_mb = round(size_bytes / (1024**2), 1)

                tg_link = f"https://t.me/c/{clean_cid}/{m.id}"

                found.append({
                    "msg_id": m.id,
                    "channel_id": cid,
                    "title": fn or txt or "Archivo multimedia",
                    "size_str": size_str,
                    "size_mb": size_mb,
                    "link": tg_link,
                    "date": m.date.strftime("%d/%m/%Y")
                })

            if found:
                # Ordenar de mayor a menor tamaño para identificar la mejor calidad
                found.sort(key=lambda x: x["size_mb"], reverse=True)
                results.append({
                    "canal": c_name,
                    "channel_id": cid,
                    "coincidencias": len(found),
                    "items": found
                })

        except Exception as e:
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
