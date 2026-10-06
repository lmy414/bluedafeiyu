import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from contextlib import closing, contextmanager


@contextmanager
def connect(path):
    with closing(sqlite3.connect(path)) as db:
        with db:
            yield db

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "classification/sync-admin.py"
SPEC = importlib.util.spec_from_file_location("sync_work_types", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SyncTypesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / "admin.db"
        (self.root / "data").mkdir()
        (self.root / "reports").mkdir()
        categories = [{"id": key, "name": key, "description": "type", "status": "active"}
                      for key in ("meme", "illustration", "setting", "comic", "standing", "other")]
        records = [{"id": "a", "name": "A", "description": "", "commentary": "", "categoryIds": ["comic"]},
                   {"id": "b", "name": "B", "categoryIds": ["other"], "status": "hidden"},
                   {"id": "c", "name": "C", "categoryIds": ["standing"]}]
        self.write("data/categories.json", categories)
        self.write("data/works.json", records)
        self.write("data/owner-picks.json", [])
        self.write("reports/2026-10-07-classification.json", {"total": 2, "rows": [
            {"id": "a", "name": "A", "slug": "a", "after": "comic"},
            {"id": "c", "name": "C", "slug": "c", "after": "standing"}]})
        with connect(self.db) as db:
            db.executescript('''CREATE TABLE publish_runs(status TEXT);
            CREATE TABLE categories(id INTEGER PRIMARY KEY,category_id TEXT UNIQUE,name TEXT,description TEXT,status TEXT,legacy_order INTEGER,legacy_data TEXT);
            CREATE TABLE works(id INTEGER PRIMARY KEY,work_id TEXT UNIQUE,slug TEXT,name TEXT,description TEXT,commentary TEXT,status TEXT,needs_publish INTEGER,updated_at TEXT,legacy_data TEXT);
            CREATE TABLE works_rels(id INTEGER PRIMARY KEY,"order" INTEGER,parent_id INTEGER,path TEXT,categories_id INTEGER,FOREIGN KEY(parent_id) REFERENCES works(id),FOREIGN KEY(categories_id) REFERENCES categories(id));''')
            for i, category in enumerate(categories[:4], 1):
                db.execute("INSERT INTO categories(id,category_id,name,status) VALUES(?,?,?,'active')", (i, category["id"], category["name"]))
            for i, (key, status, pending) in enumerate((("a", "published", 0), ("b", "hidden", 1), ("c", "pending", 1)), 1):
                db.execute("INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)", (i, key, key, key.upper(), "", "", status, pending, "original-date", '{"history":"keep"}'))
                db.execute('INSERT INTO works_rels("order",parent_id,path,categories_id) VALUES(1,?,\'categories\',1)', (i,))
            db.execute('INSERT INTO works_rels("order",parent_id,path,categories_id) VALUES(2,1,\'categories\',2)')

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, value):
        (self.root / path).write_text(json.dumps(value), encoding="utf-8")

    def state(self):
        with connect(self.db) as db:
            return db.execute("SELECT work_id,status,needs_publish,updated_at FROM works ORDER BY id").fetchall()

    def test_dry_run_does_not_mutate(self):
        before = self.db.read_bytes()
        plan = MODULE.synchronize(self.db, self.root)
        self.assertEqual(plan["typeChanges"], 3)
        self.assertEqual(self.db.read_bytes(), before)

    def test_apply_preserves_workflow_and_history_and_is_idempotent(self):
        before = self.state()
        result = MODULE.synchronize(self.db, self.root, True)
        self.assertTrue(pathlib.Path(result["backup"]).is_file())
        self.assertEqual(self.state(), before)
        with connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM works_rels WHERE path='categories'").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM categories").fetchone()[0], 6)
            self.assertEqual(json.loads(db.execute("SELECT legacy_data FROM works WHERE work_id='a'").fetchone()[0])["history"], "keep")
        self.assertEqual(MODULE.synchronize(self.db, self.root, True)["typeChanges"], 0)

    def test_changed_title_rejected_without_partial_writes(self):
        with connect(self.db) as db:
            db.execute("UPDATE works SET name='Edited' WHERE work_id='a'")
        before = self.db.read_bytes()
        with self.assertRaisesRegex(ValueError, "title changed"):
            MODULE.synchronize(self.db, self.root, True)
        self.assertEqual(self.db.read_bytes(), before)

    def test_active_publication_blocks_sync(self):
        with connect(self.db) as db:
            db.execute("INSERT INTO publish_runs VALUES('in_progress')")
        with self.assertRaisesRegex(ValueError, "publication is in progress"):
            MODULE.synchronize(self.db, self.root, True)


if __name__ == "__main__":
    unittest.main()
