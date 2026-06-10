"""
Standalone Memory Bridge Server — serves Hermes SQLite data for the Native UI.
Runs on port 8790, independent of Hermes WebUI (8788).
"""
import json, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERMES_HOME = Path.home() / ".hermes"
MEMORY_DB = HERMES_HOME / "memory.db"
STATE_DB = HERMES_HOME / "state.db"
PORT = 8791

def safe_str(val, max_len=200):
    if val is None: return ""
    s = str(val)
    return s[:max_len] if len(s) > max_len else s

def to_ts(val):
    """Convert a value to Unix timestamp float. Handles ISO strings and numeric timestamps."""
    if val is None: return 0.0
    if isinstance(val, (int, float)): return float(val)
    s = str(val).strip()
    if not s: return 0.0
    try:
        # Try numeric first
        return float(s)
    except ValueError:
        pass
    try:
        # Try ISO datetime string
        # Handle timezone suffix like +08:00
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        # Python < 3.11 doesn't support +00:00 in fromiso
        # Strip timezone and parse
        if "+" in s[10:] or s[10:].count("-") > 2:
            s = s[:19]  # Take just "2026-06-07T22:05:29"
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return 0.0

def handle_graph():
    nodes, links = [], []
    link_set = set()
    try:
        db = sqlite3.connect(str(MEMORY_DB)); db.row_factory = sqlite3.Row

        # Focus stack nodes
        for row in db.execute("SELECT id,topic,hit_count,is_active,started_at,updated_at,conclusions FROM focus_stack ORDER BY updated_at DESC").fetchall():
            nid = f"focus_{row['id']}"
            try:
                topics = json.loads(row["topic"]) if isinstance(row["topic"],str) else row["topic"]
                title = topics[0] if isinstance(topics,list) and topics else str(topics)[:60]
            except: title = str(row["topic"])[:60]
            nodes.append({"id":nid,"title":safe_str(title,60),"type":"focus_active" if row["is_active"] else "focus_inactive",
                "hit_count":row["hit_count"] or 0,"salience":min(5,1+(row["hit_count"] or 0)),
                "is_active":bool(row["is_active"]),"started_at":to_ts(row["started_at"]),"updated_at":to_ts(row["updated_at"]),
                "conclusions":safe_str(row["conclusions"],120)})

        # Memories nodes
        for row in db.execute("SELECT mem_id,type,title,body,salience,entities,tags,links,parent_id,timestamp FROM memories ORDER BY timestamp DESC LIMIT 100").fetchall():
            nid = str(row["mem_id"] or f"mem_{hash(row['title'] or row['body'] or '?')}")
            title = safe_str(row["title"] or row["body"],60) or "untitled"
            nodes.append({"id":nid,"title":title,"type":f"mem_{row['type']}" if row["type"] else "memory",
                "salience":row["salience"] or 1,"entities":safe_str(row["entities"],200),
                "tags":safe_str(row["tags"],200),"parent_id":str(row["parent_id"]) if row["parent_id"] else None,
                "timestamp":row["timestamp"]})
            raw_links = row["links"]
            if raw_links:
                try:
                    parsed = json.loads(raw_links) if isinstance(raw_links,str) else raw_links
                    if isinstance(parsed,list):
                        for l in parsed:
                            if isinstance(l,dict):
                                t = str(l.get("target_id") or l.get("targetId") or "")
                                if t:
                                    lid=f"{nid}-{t}"; rev=f"{t}-{nid}"
                                    if lid not in link_set and rev not in link_set:
                                        link_set.add(lid); links.append({"source":nid,"target":t,"kind":str(l.get("relation","related"))})
                except: pass

        # Time-based links
        fnodes = sorted([n for n in nodes if n["type"].startswith("focus")], key=lambda x:to_ts(x.get("updated_at")), reverse=True)
        for i in range(len(fnodes)-1):
            a,b = fnodes[i], fnodes[i+1]
            ta = to_ts(a.get("updated_at"))
            tb = to_ts(b.get("updated_at"))
            if abs(ta - tb) < 3600:
                lid=f"time_{a['id']}-{b['id']}"
                if lid not in link_set: link_set.add(lid); links.append({"source":a["id"],"target":b["id"],"kind":"temporal"})

        # Parent-child
        for node in nodes:
            pid=node.get("parent_id")
            if pid and any(n["id"]==pid for n in nodes):
                lid=f"parent_{node['id']}-{pid}"
                if lid not in link_set: link_set.add(lid); links.append({"source":node["id"],"target":pid,"kind":"parent_of"})

        db.close()
        return {"nodes":nodes,"links":links,"node_count":len(nodes),"link_count":len(links)}
    except Exception as e:
        return {"error":str(e),"nodes":[],"links":[]}

def handle_focus():
    try:
        db = sqlite3.connect(str(MEMORY_DB)); db.row_factory = sqlite3.Row
        items = []
        for row in db.execute("SELECT id,topic,hit_count,is_active,started_at,updated_at,conclusions FROM focus_stack ORDER BY updated_at DESC").fetchall():
            try: topics = json.loads(row["topic"]) if isinstance(row["topic"],str) else row["topic"]
            except: topics = [str(row["topic"])]
            items.append({"id":row["id"],"topic":topics if isinstance(topics,list) else [str(topics)],
                "hit_count":row["hit_count"] or 0,"is_active":bool(row["is_active"]),
                "started_at":row["started_at"],"updated_at":row["updated_at"],
                "conclusions":safe_str(row["conclusions"],200)})
        db.close()
        return {"focus_stack":items,"total":len(items)}
    except Exception as e:
        return {"error":str(e),"focus_stack":[]}

def handle_search(query, limit=20):
    if not query: return {"error":"missing q","results":[]}
    try:
        db = sqlite3.connect(str(STATE_DB)); db.row_factory = sqlite3.Row
        rows = db.execute("SELECT m.id,m.session_id,m.role,m.content,m.tool_name,m.timestamp,s.source as session_source FROM messages m JOIN messages_fts fts ON m.id=fts.rowid LEFT JOIN sessions s ON m.session_id=s.id WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?",(query,min(100,limit))).fetchall()
        db.close()
        return {"query":query,"results":[{"id":r["id"],"session_id":safe_str(r["session_id"],20),"role":r["role"],"content":safe_str(r["content"],300),"tool_name":r["tool_name"],"timestamp":r["timestamp"],"session_source":r["session_source"] or ""} for r in rows],"total":len(rows)}
    except Exception as e:
        return {"error":str(e),"results":[]}

class Handler(BaseHTTPRequestHandler):
    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET,OPTIONS"); self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == "/api/memory/graph":
            return self._json(handle_graph())
        if p.path == "/api/memory/focus":
            return self._json(handle_focus())
        if p.path == "/api/memory/search":
            qs = parse_qs(p.query or "")
            q = (qs.get("q") or [""])[0].strip()
            limit = int((qs.get("limit") or ["20"])[0])
            return self._json(handle_search(q, limit))
        if p.path == "/api/cron":
            return self._json(handle_cron())
        if p.path == "/api/workspace":
            qs = parse_qs(p.query or "")
            path = (qs.get("path") or [""])[0] or ""
            return self._json(handle_workspace(path))
        if p.path == "/api/kanban":
            return self._json(handle_kanban())
        if p.path == "/health":
            return self._json({"status":"ok","port":PORT})
        return self._json({"error":"not found"}, 404)

    def log_message(self, format, *args): pass  # silent

def handle_cron():
    """Read Hermes cron jobs from jobs.json"""
    try:
        jobs_file = HERMES_HOME / "cron" / "jobs.json"
        if not jobs_file.exists():
            return {"jobs": [], "error": "jobs.json not found"}
        data = json.loads(jobs_file.read_text(encoding="utf-8"))
        jobs = data.get("jobs", [])
        return {
            "jobs": [{
                "id": j.get("id",""), "name": j.get("name",""),
                "enabled": j.get("enabled",True), "state": j.get("state","?"),
                "schedule": j.get("schedule_display",""), "last_status": j.get("last_status","?"),
                "last_run": j.get("last_run_at",""), "next_run": j.get("next_run_at",""),
            } for j in jobs],
            "total": len(jobs),
        }
    except Exception as e:
        return {"error": str(e), "jobs": []}

def handle_workspace(subpath=""):
    """List files in Hermes workspace directory"""
    try:
        ws = HERMES_HOME / "workspace"
        if subpath:
            target = ws / subpath
            if not str(target.resolve()).startswith(str(ws.resolve())):
                return {"error": "path traversal blocked", "files": []}
        else:
            target = ws
        if not target.exists():
            return {"files": [], "path": subpath, "error": "not found"}
        items = []
        for p in sorted(target.iterdir()):
            try:
                st = p.stat()
                items.append({
                    "name": p.name,
                    "type": "dir" if p.is_dir() else "file",
                    "size": st.st_size if p.is_file() else 0,
                    "mtime": st.st_mtime,
                })
            except Exception:
                pass
        return {"files": items, "path": subpath, "total": len(items)}
    except Exception as e:
        return {"error": str(e), "files": []}

def handle_kanban():
    """Read Kanban tasks from kanban.db"""
    try:
        KANBAN_DB = HERMES_HOME / "kanban.db"
        if not KANBAN_DB.exists():
            return {"boards": [], "tasks": []}
        db = sqlite3.connect(str(KANBAN_DB)); db.row_factory = sqlite3.Row
        tasks = db.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50").fetchall()
        db.close()
        columns = ["triage","todo","ready","running","blocked","done"]
        return {
            "columns": columns,
            "tasks": [{
                "id": r["id"], "title": r["title"] or "", "body": r["body"] or "",
                "status": r["status"] or "todo", "priority": r["priority"] or "medium",
                "assignee": r["assignee"] or "", "created_at": r["created_at"],
            } for r in tasks],
            "total": len(tasks),
        }
    except Exception as e:
        return {"error": str(e), "tasks": []}

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Memory Bridge Server running on http://127.0.0.1:{PORT}")
    server.serve_forever()
