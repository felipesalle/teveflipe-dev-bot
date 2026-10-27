import os
import sys
import json
import re
import asyncio
import time
from collections import defaultdict
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetForumTopicsRequest

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BASE_DIR, '.env')
MAP_FILE = os.path.join(BASE_DIR, 'canales_map.json')
CACHE_FILE = os.path.join(BASE_DIR, 'audit_channel_latest.json')

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

def extract_season_episode(text):
    if not text:
        return None, None
    m = re.search(r'(?i)(?:^|[\s_\.\-\[\(])(\d{1,2})[xX](\d{1,3})(?:$|[\s_\.\-\]\)])', text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m2 = re.search(r'(?i)(?:^|[\s_\.\-\[\(])S(\d{1,2})[\s_\.\-]*E(\d{1,3})(?:$|[\s_\.\-\]\)])', text)
    if m2:
        return int(m2.group(1)), int(m2.group(2))
    m3 = re.search(r'(?i)\b(?:Temp(?:orada)?[\s_\.]*)(\d{1,2})[\s_\.]*(?:Cap(?:[ií]tulo)?|Ep(?:isodio)?[\s_\.]*)(\d{1,3})\b', text)
    if m3:
        return int(m3.group(1)), int(m3.group(2))
    m4 = re.search(r'(?i)\b(?:Cap(?:[ií]tulo)?|Ep(?:isodio)?)[\s_\.]*(\d{1,4})\b', text)
    if m4:
        return 1, int(m4.group(1))
    return None, None

def normalize_title(title: str) -> str:
    t = re.sub(r'\(?\d{4}\)?', '', title)
    t = re.sub(r'[\-_.]', ' ', t)
    return re.sub(r'\s+', ' ', t).lower().strip()

async def audit_channel(channel_id_or_key: str = 'series_tv', max_topics: int = 50):
    t0 = time.time()
    env = load_env()
    session_prod = env.get('SESSION_PROD')
    api_id = int(env.get('TELEGRAM_API_ID', 28045969))
    api_hash = env.get('TELEGRAM_API_HASH', 'd8e515c5687943e5e0bf046f87c3d2cc')

    if not session_prod:
        print(json.dumps({"ok": False, "error": "SESSION_PROD no encontrada"}))
        return

    canales = []
    if os.path.exists(MAP_FILE):
        with open(MAP_FILE, 'r', encoding='utf-8') as f:
            canales = json.load(f)

    target_channel = None
    for c_item in canales:
        if c_item.get('id') == channel_id_or_key or str(c_item.get('produccion_id')) == str(channel_id_or_key):
            target_channel = c_item
            break

    if not target_channel:
        for c_item in canales:
            if c_item.get('id') == 'series_tv':
                target_channel = c_item
                break

    if not target_channel or not target_channel.get('produccion_id'):
        print(json.dumps({"ok": False, "error": f"No se encontró canal configurado para '{channel_id_or_key}'"}))
        return

    c = TelegramClient(StringSession(session_prod), api_id, api_hash)
    await c.connect()

    prod_id = target_channel['produccion_id']
    ent = await c.get_input_entity(prod_id)

    # 1. Obtener todos los temas del canal
    all_topics = []
    offset_date = 0
    offset_id = 0
    offset_topic = 0
    effective_limit = 260 if max_topics <= 0 else max_topics

    while len(all_topics) < effective_limit:
        batch_limit = min(80, effective_limit - len(all_topics))
        res = await c(GetForumTopicsRequest(
            peer=ent,
            offset_date=offset_date,
            offset_id=offset_id,
            offset_topic=offset_topic,
            limit=batch_limit
        ))
        if not res or not res.topics:
            break

        new_topics = [t for t in res.topics if t.id != 1]
        if not new_topics:
            break

        all_topics.extend(new_topics)

        last_topic = res.topics[-1]
        offset_date = int(last_topic.date.timestamp()) if hasattr(last_topic.date, 'timestamp') else 0
        offset_id = getattr(last_topic, 'top_message', 0)
        offset_topic = last_topic.id

        if len(res.topics) < batch_limit:
            break

    all_topics = all_topics[:effective_limit]

    # 2. Agrupar por título normalizado para detectar temas duplicados
    topics_by_series = defaultdict(list)
    for t in all_topics:
        norm = normalize_title(t.title)
        topics_by_series[norm].append(t)

    series_with_duplicate_topics = []
    topics_to_scan = []

    for norm, t_list in topics_by_series.items():
        if len(t_list) > 1:
            series_with_duplicate_topics.append({
                "series": t_list[0].title,
                "count": len(t_list),
                "topics": [{"id": t.id, "title": t.title} for t in t_list]
            })
            # El tema principal suele ser el que tiene mayor top_message o mayor antigüedad,
            # pero los escaneamos para saber cuál es el completo
            topics_to_scan.append(t_list[0])
        else:
            topics_to_scan.append(t_list[0])

    # 3. Escanear temas concurrentemente
    sem = asyncio.Semaphore(6)

    async def scan_topic(topic):
        async with sem:
            episodes_by_season = defaultdict(lambda: defaultdict(list))
            total_msgs = 0
            async for m in c.iter_messages(ent, reply_to=topic.id, limit=120):
                if m.action:
                    continue
                total_msgs += 1
                fn = m.file.name if (m.file and m.file.name) else (m.text or "")
                size_bytes = m.file.size if m.file else 0
                s, e = extract_season_episode(fn)
                if s is not None and e is not None:
                    episodes_by_season[s][e].append({
                        "msg_id": m.id,
                        "size_bytes": size_bytes
                    })

            missing = []
            has_multi = False
            has_dupes = False
            total_caps = 0

            for s in sorted(episodes_by_season.keys()):
                eps_dict = episodes_by_season[s]
                ep_numbers = sorted(eps_dict.keys())
                ep_set = set(ep_numbers)
                total_caps += len(ep_set)

                min_e = min(ep_numbers) if ep_numbers else 1
                max_e = max(ep_numbers) if ep_numbers else 0
                start_e = 1 if min_e <= 1 else min_e
                expected = set(range(start_e, max_e + 1))
                gaps = sorted(expected - ep_set)
                for g in gaps:
                    missing.append(f"{s}x{g:02d}")

                for e in ep_numbers:
                    files = eps_dict[e]
                    if len(files) > 1:
                        sizes = [f["size_bytes"] for f in files]
                        min_s, max_s = min(sizes), max(sizes)
                        if max_s >= min_s * 1.25 and min_s > 0:
                            has_multi = True
                        else:
                            has_dupes = True

            clean_pid = str(abs(prod_id))
            if clean_pid.startswith("100") and len(clean_pid) > 10:
                clean_pid = clean_pid[3:]
            link = f"https://t.me/c/{clean_pid}/{topic.id}"

            return {
                "id": topic.id,
                "title": topic.title,
                "link": link,
                "total_messages": total_msgs,
                "total_capitulos": total_caps,
                "completa": len(missing) == 0 and total_caps > 0,
                "faltantes": missing,
                "has_multi_calidad": has_multi,
                "has_dupes": has_dupes
            }

    results = await asyncio.gather(*[scan_topic(t) for t in topics_to_scan])
    await c.disconnect()

    completas = [r for r in results if r["completa"]]
    incompletas = [r for r in results if not r["completa"] and r["total_capitulos"] > 0]
    multi_calidad = [r for r in results if r["has_multi_calidad"]]
    con_dupes = [r for r in results if r["has_dupes"]]

    report = {
        "ok": True,
        "canal_nombre": target_channel["nombre"],
        "canal_id": prod_id,
        "duracion_segundos": round(time.time() - t0, 1),
        "total_temas_escaneados": len(all_topics),
        "total_series_unicas": len(topics_to_scan),
        "total_completas": len(completas),
        "total_incompletas": len(incompletas),
        "total_series_con_temas_duplicados": len(series_with_duplicate_topics),
        "total_multi_calidad": len(multi_calidad),
        "total_con_dupes": len(con_dupes),
        "temas_duplicados_ejemplos": [s["series"] for s in series_with_duplicate_topics[:8]],
        "incompletas": [
            {
                "id": inc["id"],
                "title": inc["title"],
                "faltantes": inc["faltantes"][:5],
                "faltantes_total": len(inc["faltantes"]),
                "link": inc["link"]
            }
            for inc in incompletas[:12]
        ],
        "multi_calidad_ejemplos": [r["title"] for r in multi_calidad[:8]],
        "redundantes_ejemplos": [r["title"] for r in con_dupes[:8]]
    }

    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'series_tv'
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    asyncio.run(audit_channel(target, limit))
