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

def format_size(size_bytes):
    if not size_bytes:
        return "0 KB"
    if size_bytes >= 1024**3:
        return f"{size_bytes / (1024**3):.2f} GB"
    if size_bytes >= 1024**2:
        return f"{size_bytes / (1024**2):.1f} MB"
    return f"{size_bytes / 1024:.0f} KB"

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

    matching_topics = []
    target_channel = None
    ent_target = None
    q_lower = series_query.lower().strip()

    for canal in canales:
        if not canal.get('activo', True) or not canal.get('is_forum', False):
            continue

        prod_id = canal.get('produccion_id')
        if not prod_id:
            continue

        try:
            ent = await c.get_input_entity(prod_id)
            res = await c(GetForumTopicsRequest(peer=ent, q=series_query, offset_date=0, offset_id=0, offset_topic=0, limit=10))
            if res and res.topics:
                for t in res.topics:
                    if t.id == 1:
                        continue
                    t_title = t.title.lower()
                    if q_lower in t_title or t_title in q_lower:
                        matching_topics.append(t)
                        target_channel = canal
                        ent_target = ent
            if matching_topics:
                break
        except Exception:
            continue

    if not matching_topics:
        await c.disconnect()
        print(json.dumps({
            "ok": False,
            "error": f"No se encontró ningún tema de serie para '{series_query}' en los foros de Producción."
        }, ensure_ascii=False))
        return

    # Si hay múltiples temas coincidentes, escanearlos para determinar cuál es el principal
    topics_scan_summary = []
    for t in matching_topics:
        cnt = 0
        async for m in c.iter_messages(ent_target, reply_to=t.id, limit=150):
            if not m.action:
                cnt += 1
        topics_scan_summary.append((t, cnt))

    # Ordenar por número de mensajes descendente: el que tiene más mensajes es el Principal
    topics_scan_summary.sort(key=lambda x: x[1], reverse=True)
    target_topic = topics_scan_summary[0][0]
    
    duplicate_topics_info = []
    if len(topics_scan_summary) > 1:
        clean_pid = str(abs(target_channel["produccion_id"]))
        if clean_pid.startswith("100") and len(clean_pid) > 10:
            clean_pid = clean_pid[3:]
        for dt, count in topics_scan_summary[1:]:
            duplicate_topics_info.append({
                "id": dt.id,
                "title": dt.title,
                "total_mensajes": count,
                "link": f"https://t.me/c/{clean_pid}/{dt.id}"
            })

    # Escanear el tema principal a fondo
    episodes_by_season = defaultdict(lambda: defaultdict(list))
    total_messages = 0

    async for m in c.iter_messages(ent_target, reply_to=target_topic.id):
        if m.action:
            continue
        total_messages += 1
        fn = m.file.name if (m.file and m.file.name) else (m.text or "")
        size_bytes = m.file.size if m.file else 0
        s, e = extract_season_episode(fn)
        if s is not None and e is not None:
            episodes_by_season[s][e].append({
                "msg_id": m.id,
                "name": fn,
                "size_bytes": size_bytes,
                "size_str": format_size(size_bytes),
                "is_video": bool(m.video or (m.document and m.document.mime_type and 'video' in m.document.mime_type))
            })

    await c.disconnect()

    # Análisis de temporadas, huecos y multi-calidad
    seasons_report = []
    missing_all = []
    all_multi_calidad = []
    all_redundantes = []
    msg_ids_ligeras = []
    msg_ids_cine = []
    msg_ids_redundantes = []

    for s in sorted(episodes_by_season.keys()):
        eps_dict = episodes_by_season[s]
        ep_numbers = sorted(eps_dict.keys())
        ep_set = set(ep_numbers)
        
        min_e = min(ep_numbers) if ep_numbers else 1
        max_e = max(ep_numbers) if ep_numbers else 0
        
        start_e = 1 if min_e <= 1 else min_e
        expected_range = set(range(start_e, max_e + 1))
        missing_eps = sorted(expected_range - ep_set)

        for mep in missing_eps:
            missing_all.append(f"{s}x{mep:02d}")

        season_multi = []
        season_dupes = []

        for e in ep_numbers:
            files = sorted(eps_dict[e], key=lambda x: x["size_bytes"])
            if len(files) > 1:
                f_min = files[0]
                f_max = files[-1]
                is_multi = (f_max["size_bytes"] >= f_min["size_bytes"] * 1.25 and f_min["size_bytes"] > 0)
                
                if is_multi:
                    season_multi.append({
                        "ep": f"{s}x{e:02d}",
                        "ligera": {"msg_id": f_min["msg_id"], "size": f_min["size_str"], "name": f_min["name"]},
                        "cine": {"msg_id": f_max["msg_id"], "size": f_max["size_str"], "name": f_max["name"]}
                    })
                    msg_ids_ligeras.append(f_min["msg_id"])
                    msg_ids_cine.append(f_max["msg_id"])
                    if len(files) > 2:
                        for extra in files[1:-1]:
                            season_dupes.append(f"{s}x{e:02d}")
                            msg_ids_redundantes.append(extra["msg_id"])
                else:
                    season_dupes.append(f"{s}x{e:02d}")
                    for extra in files[1:]:
                        msg_ids_redundantes.append(extra["msg_id"])

        all_multi_calidad.extend(season_multi)
        all_redundantes.extend(season_dupes)

        total_files = sum(len(files) for files in eps_dict.values())
        seasons_report.append({
            "temporada": s,
            "total_archivos": total_files,
            "capitulos_unicos": len(ep_set),
            "rango": f"{min_e} a {max_e}",
            "completa": len(missing_eps) == 0,
            "faltantes": [f"{s}x{mep:02d}" for mep in missing_eps],
            "multi_calidad": season_multi,
            "duplicados_redundantes": season_dupes
        })

    clean_pid = str(abs(target_channel["produccion_id"]))
    if clean_pid.startswith("100") and len(clean_pid) > 10:
        clean_pid = clean_pid[3:]
    topic_link = f"https://t.me/c/{clean_pid}/{target_topic.id}"

    result = {
        "ok": True,
        "serie": target_topic.title,
        "topic_id": target_topic.id,
        "channel_id": target_channel["produccion_id"],
        "canal": target_channel["nombre"],
        "link": topic_link,
        "total_mensajes": total_messages,
        "duplicate_topics": duplicate_topics_info,
        "seasons": seasons_report,
        "missing_all": missing_all,
        "total_multi_calidad": len(all_multi_calidad),
        "total_redundantes": len(all_redundantes),
        "msg_ids_ligeras": msg_ids_ligeras,
        "msg_ids_cine": msg_ids_cine,
        "msg_ids_redundantes": msg_ids_redundantes
    }

    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "The Ark"
    asyncio.run(audit_series(q))
