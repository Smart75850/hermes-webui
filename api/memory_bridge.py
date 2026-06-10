"""
Hermes Memory Bridge — exposes structured memory data from SQLite databases
for the Hermes Native UI D3 memory graph.

Data sources:
  memory.db  → focus_stack (55 rows), memories (structured)
  state.db   → 5239 messages with FTS5 search

Endpoints (called from routes.py):
  handle_memory_graph()  → GET /api/memory/graph
  handle_memory_focus()  → GET /api/memory/focus
  handle_memory_search() → GET /api/memory/search?q=...
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from urllib.parse import parse_qs, unquote

HERMES_HOME = Path.home() / ".hermes"
MEMORY_DB = HERMES_HOME / "memory.db"
STATE_DB = HERMES_HOME / "state.db"


def _safe_str(val, max_len=200):
    if val is None:
        return ""
    s = str(val)
    return s[:max_len] if len(s) > max_len else s


def handle_memory_graph(handler, parsed) -> bool:
    """GET /api/memory/graph — return D3 force-graph nodes + links."""
    nodes = []
    links = []
    link_set = set()

    try:
        db = sqlite3.connect(str(MEMORY_DB))
        db.row_factory = sqlite3.Row

        # ── 1. Focus stack nodes ──
        focus_rows = db.execute(
            "SELECT id, topic, hit_count, is_active, started_at, updated_at, conclusions "
            "FROM focus_stack ORDER BY updated_at DESC"
        ).fetchall()

        for row in focus_rows:
            nid = f"focus_{row['id']}"
            # topic is stored as JSON array string like ["topic1","topic2"]
            topic_raw = row["topic"] or "[]"
            try:
                topics = json.loads(topic_raw) if isinstance(topic_raw, str) else topic_raw
                if isinstance(topics, list):
                    title = topics[0] if topics else "untitled"
                else:
                    title = str(topics)[:60]
            except (json.JSONDecodeError, IndexError):
                title = str(topic_raw)[:60]

            nodes.append({
                "id": nid,
                "title": _safe_str(title, 60),
                "type": "focus_active" if row["is_active"] else "focus_inactive",
                "hit_count": row["hit_count"] or 0,
                "salience": min(5, 1 + (row["hit_count"] or 0)),
                "is_active": bool(row["is_active"]),
                "started_at": row["started_at"],
                "updated_at": row["updated_at"],
                "conclusions": _safe_str(row["conclusions"], 120),
            })

        # ── 2. Memories nodes ──
        mem_rows = db.execute(
            "SELECT mem_id, type, title, body, salience, entities, tags, links, parent_id, timestamp "
            "FROM memories ORDER BY timestamp DESC LIMIT 100"
        ).fetchall()

        for row in mem_rows:
            nid = str(row["mem_id"] or f"mem_{row['id'] if 'id' in row.keys() else '?'}")
            title = _safe_str(row["title"] or row["body"], 60) or "untitled"

            nodes.append({
                "id": nid,
                "title": title,
                "type": f"mem_{row['type']}" if row["type"] else "memory",
                "salience": row["salience"] or 1,
                "entities": _safe_str(row["entities"], 200),
                "tags": _safe_str(row["tags"], 200),
                "parent_id": str(row["parent_id"]) if row["parent_id"] else None,
                "timestamp": row["timestamp"],
            })

            # Parse links from memories table
            raw_links = row["links"]
            if raw_links:
                try:
                    parsed_links = json.loads(raw_links) if isinstance(raw_links, str) else raw_links
                    if isinstance(parsed_links, list):
                        for link in parsed_links:
                            if isinstance(link, dict):
                                target = str(link.get("target_id") or link.get("targetId") or "")
                                rel = str(link.get("relation") or "related")
                                if target:
                                    lid = f"{nid}-{target}"
                                    rev = f"{target}-{nid}"
                                    if lid not in link_set and rev not in link_set:
                                        link_set.add(lid)
                                        links.append({
                                            "source": nid,
                                            "target": target,
                                            "kind": rel,
                                        })
                except (json.JSONDecodeError, TypeError):
                    pass

        # ── 3. Time-based links between nearby focus topics ──
        focus_for_links = [n for n in nodes if n["type"].startswith("focus")]
        focus_for_links.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
        for i in range(len(focus_for_links) - 1):
            a, b = focus_for_links[i], focus_for_links[i + 1]
            # Link if updated within 1 hour of each other
            ta = a.get("updated_at") or 0
            tb = b.get("updated_at") or 0
            if abs(ta - tb) < 3600:
                lid = f"time_{a['id']}-{b['id']}"
                if lid not in link_set:
                    link_set.add(lid)
                    links.append({
                        "source": a["id"],
                        "target": b["id"],
                        "kind": "temporal",
                    })

        # ── 4. Parent-child links from memories ──
        for node in nodes:
            pid = node.get("parent_id")
            if pid:
                # Check if parent node exists
                parent_exists = any(n["id"] == pid for n in nodes)
                if parent_exists:
                    lid = f"parent_{node['id']}-{pid}"
                    if lid not in link_set:
                        link_set.add(lid)
                        links.append({
                            "source": node["id"],
                            "target": pid,
                            "kind": "parent_of",
                        })

        db.close()

        from api.helpers import j
        return j(handler, {
            "nodes": nodes,
            "links": links,
            "node_count": len(nodes),
            "link_count": len(links),
        })

    except Exception as e:
        from api.helpers import j
        return j(handler, {"error": str(e), "nodes": [], "links": []})


def handle_memory_focus(handler, parsed) -> bool:
    """GET /api/memory/focus — full focus stack data."""
    try:
        db = sqlite3.connect(str(MEMORY_DB))
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT id, topic, hit_count, is_active, started_at, updated_at, conclusions "
            "FROM focus_stack ORDER BY updated_at DESC"
        ).fetchall()
        db.close()

        items = []
        for row in rows:
            topic_raw = row["topic"] or "[]"
            try:
                topics = json.loads(topic_raw) if isinstance(topic_raw, str) else topic_raw
            except json.JSONDecodeError:
                topics = [str(topic_raw)]

            items.append({
                "id": row["id"],
                "topic": topics if isinstance(topics, list) else [str(topics)],
                "hit_count": row["hit_count"] or 0,
                "is_active": bool(row["is_active"]),
                "started_at": row["started_at"],
                "updated_at": row["updated_at"],
                "conclusions": _safe_str(row["conclusions"], 200),
            })

        from api.helpers import j
        return j(handler, {"focus_stack": items, "total": len(items)})

    except Exception as e:
        from api.helpers import j
        return j(handler, {"error": str(e), "focus_stack": []})


def handle_memory_search(handler, parsed) -> bool:
    """GET /api/memory/search?q=keyword&limit=20 — FTS5 search on state.db messages."""
    qs = parse_qs(parsed.query or "")
    query = (qs.get("q") or [""])[0].strip()
    limit = min(100, int((qs.get("limit") or ["20"])[0]))

    if not query:
        from api.helpers import j
        return j(handler, {"error": "missing q parameter", "results": []})

    try:
        db = sqlite3.connect(str(STATE_DB))
        db.row_factory = sqlite3.Row

        # FTS5 search on messages_fts
        results = db.execute(
            "SELECT m.id, m.session_id, m.role, m.content, m.tool_name, m.timestamp, "
            "s.source as session_source "
            "FROM messages m "
            "JOIN messages_fts fts ON m.id = fts.rowid "
            "LEFT JOIN sessions s ON m.session_id = s.id "
            "WHERE messages_fts MATCH ? "
            "ORDER BY rank "
            "LIMIT ?",
            (query, limit),
        ).fetchall()

        db.close()

        items = []
        for r in results:
            items.append({
                "id": r["id"],
                "session_id": _safe_str(r["session_id"], 20),
                "role": r["role"],
                "content": _safe_str(r["content"], 300),
                "tool_name": r["tool_name"],
                "timestamp": r["timestamp"],
                "session_source": r["session_source"] or "",
            })

        from api.helpers import j
        return j(handler, {"query": query, "results": items, "total": len(items)})

    except Exception as e:
        from api.helpers import j
        return j(handler, {"error": str(e), "results": []})
