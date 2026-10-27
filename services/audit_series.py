import os
import sys
import json
import re
import asyncio
from collections import defaultdict
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

def extract_season_episode(text):
    if not text:
        return None, None
    # 1. 3x04, 3X04
    m = re.search(r'(?i)(?:^|[\s_\.\-\[\(])(\d{1,2})[xX](\d{1,3})(?:$|[\s_\.\-\]\)])', text)
    if m:
        return int(m.group(1)), int(m.group(2))
    # 2. S01E02 or S1E2
    m2 = re.search(r'(?i)(?:^|[\s_\.\-\[\(])S(\d{1,2})[\s_\.\-]*E(\d{1,3})(?:$|[\s_\.\-\]\)])', text)
    if m2:
        return int(m2.group(1)), int(m2.group(2))
    # 3. Temporada 1 Episodio 2
    m3 = re.search(r'(?i)\b(?:Temp(?:orada)?[\s_\.]*)(\d{1,2})[\s_\.]*(?:Cap(?:[ií]tulo)?|Ep(?:isodio)?[\s_\.]*)(\d{1,3})\b', text)
    if m3:
        return int(m3.group(1)), int(m3.group(2))
    # 4. Cap 12 or Episodio 12 (asume temporada 1 si es numeración continua)
    m4 = re.search(r'(?i)\b(?:Cap(?:[ií]tulo)?|Ep(?:isodio)?)[\s_\.]*(\d{1,4})\b', text)
    if m4:
        return 1, int(m4.group(1))
    return None, None

async def audit_series(series_query: str):
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

    target_topic = None
    target_channel = None
    ent_target = None

    q_lower = series_query.lower().strip()

    # Buscar en los foros de series
    for canal in canales:
        if not canal.get('activo', True) or not canal.get('is_forum', False):
            continue

        prod_id = canal.get('produccion_id')
        if not prod_id:
            continue

        try:
            ent = await c.get_input_entity(prod_id)
            res = await c(GetForumTopicsRequest(peer=ent, q=series_query, offset_date=0, offset_id=0, offset_topic=0, limit=5))
            if res and res.topics:
                for t in res.topics:
                    t_title = t.title.lower()
                    if q_lower in t_title or t_title in q_lower:
                        target_topic = t
                        target_channel = canal
                        ent_target = ent
                        break
            if target_topic:
                break
        except Exception:
            continue

    if not target_topic:
        await c.disconnect()
        print(json.dumps({
            "ok": False,
            "error": f"No se encontró ningún tema de serie para '{series_query}' en los foros de Producción."
        }, ensure_ascii=False))
        return

    # Escanear todos los mensajes del tema encontrado
    episodes_by_season = defaultdict(list)
    total_messages = 0

    async for m in c.iter_messages(ent_target, reply_to=target_topic.id):
        if m.action:
            continue
        total_messages += 1
        fn = m.file.name if m.file else (m.text or "")
        s, e = extract_season_episode(fn)
        if s is not None and e is not None:
            episodes_by_season[s].append((e, m.id, fn))

    await c.disconnect()

    # Análisis de huecos y duplicados
    seasons_report = []
    missing_all = []

    for s in sorted(episodes_by_season.keys()):
        raw_list = episodes_by_season[s]
        ep_numbers = [item[0] for item in raw_list]
        ep_set = set(ep_numbers)
        
        min_e = min(ep_numbers)
        max_e = max(ep_numbers)
        
        # Calcular huecos esperados
        start_e = 1 if min_e <= 1 else min_e
        expected_range = set(range(start_e, max_e + 1))
        missing_eps = sorted(expected_range - ep_set)

        for mep in missing_eps:
            missing_all.append(f"{s}x{mep:02d}")

        # Detectar duplicados
        counts = defaultdict(int)
        for num in ep_numbers:
            counts[num] += 1
        dupes = [num for num, cnt in counts.items() if cnt > 1]

        seasons_report.append({
            "temporada": s,
            "total_archivos": len(raw_list),
            "capitulos_unicos": len(ep_set),
            "rango": f"{min_e} a {max_e}",
            "completa": len(missing_eps) == 0,
            "faltantes": [f"{s}x{mep:02d}" for mep in missing_eps],
            "duplicados": [f"{s}x{d:02d}" for d in dupes]
        })

    clean_pid = str(abs(target_channel["produccion_id"]))
    if clean_pid.startswith("100") and len(clean_pid) > 10:
        clean_pid = clean_pid[3:]
    topic_link = f"https://t.me/c/{clean_pid}/{target_topic.id}"

    result = {
        "ok": True,
        "serie": target_topic.title,
        "topic_id": target_topic.id,
        "canal": target_channel["nombre"],
        "link": topic_link,
        "total_mensajes": total_messages,
        "seasons": seasons_report,
        "missing_all": missing_all
    }

    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "The Ark"
    asyncio.run(audit_series(q))
