"""Apply reviewed single work types to Payload SQLite, preserving content and workflow state."""
import argparse
import datetime
import json
import pathlib
import sqlite3
from contextlib import closing


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def synchronize(database, site, apply=False, backup_dir=None):
    database = pathlib.Path(database).resolve(strict=True)
    site = pathlib.Path(site).resolve(strict=True)
    report = read(site / "reports/2026-10-07-classification.json")
    categories = read(site / "data/categories.json")
    allowed = {c["id"] for c in categories if c["status"] == "active"}
    if allowed != {"meme", "illustration", "comic", "standing", "setting", "other"}:
        raise ValueError("Expected the six approved active types")
    rows = report["rows"]
    if len(rows) != report["total"] or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Incomplete or duplicate classification report")
    targets = {r["id"]: r["after"] for r in rows}
    if any(t not in allowed for t in targets.values()):
        raise ValueError("Unknown reviewed work type")
    raw = {w["id"]: w for file in ("works.json", "owner-picks.json")
           for w in read(site / "data" / file)}
    for key, work in raw.items():
        if work.get("status") in {"hidden", "deleted", "removed"}:
            types = work.get("categoryIds", [])
            if len(types) != 1 or types[0] not in allowed:
                raise ValueError("Historical record must have one reviewed type: " + key)
            targets[key] = types[0]
    conn = sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        # BEGIN IMMEDIATE holds one consistent snapshot and excludes concurrent database writers.
        conn.execute("BEGIN IMMEDIATE")
        active = conn.execute("SELECT count(*) FROM publish_runs WHERE status='in_progress'").fetchone()[0]
        if active:
            raise ValueError("A publication is in progress; finish it before changing types")
        works = {w["work_id"]: dict(w) for w in conn.execute("SELECT * FROM works")}
        missing = set(targets) - set(works)
        if missing:
            raise ValueError("Missing backend records: " + ", ".join(sorted(missing)))
        for row in rows:
            work = works[row["id"]]
            if work["slug"] != row["slug"] or work["name"] != row["name"]:
                raise ValueError("Backend identity or title changed: " + row["id"])
        current_types = {}
        for rel in conn.execute("SELECT r.parent_id,c.category_id FROM works_rels r JOIN categories c ON c.id=r.categories_id WHERE r.path='categories' ORDER BY r.\"order\""):
            current_types.setdefault(rel["parent_id"], []).append(rel["category_id"])
        unknown_invalid = [key for key, w in works.items() if key not in targets
                           and (len(current_types.get(w["id"], [])) != 1
                                or current_types[w["id"]][0] not in allowed)]
        if unknown_invalid:
            raise ValueError("Unreviewed backend records need classification: " + ", ".join(unknown_invalid))
        changed = sum(current_types.get(works[key]["id"], []) != [value] for key, value in targets.items())
        plan = {"reviewed": len(rows), "backendRecords": len(works), "typeChanges": changed, "apply": apply}
        if not apply:
            conn.rollback()
            return plan
        # Back up through a second read connection before this transaction changes any rows.
        backup_root = pathlib.Path(backup_dir).resolve() if backup_dir else database.parent / "backups"
        backup_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        backup_path = backup_root / ("taxonomy-" + stamp + ".db")
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as reader:
            with closing(sqlite3.connect(backup_path)) as backup:
                reader.backup(backup)
        category_map = {c["category_id"]: c["id"] for c in conn.execute("SELECT id,category_id FROM categories")}
        for order, category in enumerate(categories):
            value = json.dumps(category, ensure_ascii=False)
            if category["id"] in category_map:
                conn.execute("UPDATE categories SET name=?,description=?,status=?,legacy_order=?,legacy_data=? WHERE id=?",
                             (category["name"], category["description"], category["status"], order, value, category_map[category["id"]]))
            else:
                cursor = conn.execute("INSERT INTO categories(category_id,name,description,status,legacy_order,legacy_data) VALUES(?,?,?,?,?,?)",
                                      (category["id"], category["name"], category["description"], category["status"], order, value))
                category_map[category["id"]] = cursor.lastrowid
        for key, work_type in targets.items():
            work = works[key]
            if current_types.get(work["id"], []) != [work_type]:
                conn.execute("DELETE FROM works_rels WHERE parent_id=? AND path='categories'", (work["id"],))
                conn.execute('INSERT INTO works_rels("order",parent_id,path,categories_id) VALUES(1,?,\'categories\',?)',
                             (work["id"], category_map[work_type]))
            legacy = json.loads(work["legacy_data"] or "{}")
            legacy["categoryIds"] = [work_type]
            source = raw.get(key)
            if source and source.get("i18n"):
                # The public text must match before reusing its translated prose and new source hash.
                if any((work.get(field) or "") != (source.get(field) or "") for field in ("name", "description", "commentary")):
                    raise ValueError("Backend prose changed; cannot reuse translations: " + key)
                legacy["i18n"] = source["i18n"]
            conn.execute("UPDATE works SET legacy_data=? WHERE id=?", (json.dumps(legacy, ensure_ascii=False), work["id"]))
        for updated in conn.execute("SELECT * FROM works"):
            before = works[updated["work_id"]]
            if any(updated[key] != value for key, value in before.items() if key != "legacy_data"):
                raise ValueError("A protected work field changed: " + updated["work_id"])
        invalid = conn.execute("SELECT w.work_id FROM works w LEFT JOIN works_rels r ON r.parent_id=w.id AND r.path='categories' GROUP BY w.id HAVING count(r.id) != 1").fetchall()
        if invalid or conn.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Backend relations failed validation")
        conn.commit()
        return {**plan, "singleType": True, "backup": str(backup_path)}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--site", default=str(pathlib.Path(__file__).resolve().parents[2]))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir")
    args = parser.parse_args()
    print(json.dumps(synchronize(args.database, args.site, args.apply, args.backup_dir), ensure_ascii=False))
