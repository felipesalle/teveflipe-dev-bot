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
MAP_FILE = os.path.join(BASE_DIR, 'canales_map.json')

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

def clean_movie_title(fn, txt):
    s = (fn or (txt.split('\n')[0] if txt else '')).strip()
    s = re.sub(r'\.(mkv|mp4|avi|ts|mov)$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'(?i)[\[\(_]?(?:1080p|720p|2160p|4k|x264|x265|hevc|web-?dl|bluray|hdtv|dvdrip|castellano|spanish|dual|sub)[\]\)_]?', '', s)
    s = re.sub(r'@[A-Za-z0-9_]+', '', s)
    s = s.replace('_', ' ').strip(' -_')
    return s.strip()

def clean_series_title(fn, txt):
    s = (fn or (txt.split('\n')[0] if txt else '')).strip()
    s = re.sub(r'\.(mkv|mp4|avi|ts|mov)$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'(?i)[_\s\.\-]*(?:S\d+E\d+|\d+x\d+|Cap[ií]tulo\s*\d+|Temporada\s*\d+|Episodio\s*\d+).*$', '', s)
    s = re.sub(r'@[A-Za-z0-9_]+', '', s)
    s = s.replace('_', ' ').strip(' -_')
    return s.strip()

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
    # Intentar obtener la versión más reciente directamente desde GitHub (teveflipe-bot-sync)
    try:
        import urllib.request
        url = "https://raw.githubusercontent.com/felipesalle/teveflipe-bot-sync/main/canales_map.json"
        with urllib.request.urlopen(url, timeout=5) as resp:
            if resp.status == 200:
                canales = json.loads(resp.read().decode('utf-8'))
                with open(MAP_FILE, 'w', encoding='utf-8') as f:
                    json.dump(canales, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    if not canales and os.path.exists(MAP_FILE):
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
                
                # Extraer títulos de los mensajes nuevos
                titulos = []
                mas_titulos = 0
                actual_file_count = 0
                is_serie = item.get('is_forum', False) or 'serie' in item.get('id', '')
                
                try:
                    if topic_id:
                        new_msgs = await c.get_messages(ent, reply_to=topic_id, min_id=last_id, limit=30)
                    else:
                        new_msgs = await c.get_messages(ent, min_id=last_id, limit=30)
                        
                    seen = set()
                    media_msgs = [m for m in new_msgs if not m.action and (m.file or m.text)]
                    actual_file_count = len(media_msgs)
                    
                    for m in media_msgs:
                        fn = m.file.name if m.file else None
                        txt = m.text or ""
                        
                        t_clean = ""
                        if is_serie:
                            top_id = getattr(m.reply_to, 'reply_to_top_id', None) or getattr(m.reply_to, 'reply_to_msg_id', None)
                            if top_id:
                                try:
                                    h = await c.get_messages(ent, ids=top_id)
                                    if h and hasattr(h, 'action') and hasattr(h.action, 'title'):
                                        t_clean = h.action.title.strip()
                                except Exception:
                                    pass
                            if not t_clean:
                                t_clean = clean_series_title(fn, txt)
                        else:
                            t_clean = clean_movie_title(fn, txt)
                            
                        if t_clean and t_clean.lower() not in seen:
                            seen.add(t_clean.lower())
                            titulos.append(t_clean)
                            
                    if len(titulos) > 4:
                        mas_titulos = len(titulos) - 4
                        titulos = titulos[:4]
                except Exception:
                    pass

                pendientes_final = actual_file_count if (actual_file_count > 0 and diff <= 30) else diff

                novedades.append({
                    "id": item["id"],
                    "nombre": c_name,
                    "pendientes": pendientes_final,
                    "titulos": titulos,
                    "mas_titulos": mas_titulos,
                    "is_serie": is_serie,
                    "ultimo_id": cur_id,
                    "prev_id": last_id
                })
            else:
                al_dia.append(c_name)

        except Exception as e:
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
