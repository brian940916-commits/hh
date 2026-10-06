#!/usr/bin/env python3
"""Upgrade frozen phase-one/two schemas while retaining rows and PHP sessions."""

import argparse
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
LEGACY_TABLES = ("users", "trips", "trip_members", "request_receipts")
PHASE_TWO_TABLES = ("trip_items", "trip_expenses", "expense_participants")


def snapshot(db, tables):
    return {table: db.execute("SELECT * FROM " + table + " ORDER BY 1,2").fetchall() for table in tables}


def seed_legacy(db, version, password_hash):
    # All demo accounts and the demo trip are intentionally absent. Upgrade may
    # not seed them again or overwrite these independently created records.
    for user_id, email in (("legacy_owner", "owner@example.com"), ("legacy_member", "member@example.com")):
        db.execute("INSERT INTO users(id,name,email,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)", (user_id, "既有使用者 " + user_id, email, "0912345678", password_hash, "guest", "2026-01-01T00:00:00Z"))
    db.execute("INSERT INTO trips(id,owner_id,name,start_date,end_date,station,status,status_manual,budget,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("legacy_keep_01", "legacy_owner", "升級前的自訂行程", "2099-01-02", "2099-01-04", "台中站", "cancelled", 1, 1234, 9, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"))
    for user_id, role in (("legacy_owner", "owner"), ("legacy_member", "member")):
        db.execute("INSERT INTO trip_members(trip_id,user_id,role,joined_at) VALUES(?,?,?,?)", ("legacy_keep_01", user_id, role, "2026-01-01T00:00:00Z"))
    db.execute("INSERT INTO request_receipts(user_id,operation,request_key,payload_hash,response_json,created_at) VALUES(?,?,?,?,?,?)", ("legacy_owner", "create_trip", "legacy-request-key", "historical-payload-hash", '{"id":"legacy_keep_01"}', "2026-01-01T00:00:00Z"))
    if version == 2:
        db.execute("INSERT INTO trip_items(id,trip_id,date,start_time,end_time,name,type,note,priority,position) VALUES(?,?,?,?,?,?,?,?,?,?)", ("legacy_item", "legacy_keep_01", "2099-01-03", "10:00", "11:00", "升級前景點", "attraction", "不可丟失的備註", "must", 0))
        db.execute("INSERT INTO trip_expenses(id,trip_id,name,amount,category,date,payer_id,note) VALUES(?,?,?,?,?,?,?,?)", ("legacy_expense", "legacy_keep_01", "升級前費用", 101, "food", "2099-01-03", "legacy_member", "現金分攤"))
        for user_id in ("legacy_owner", "legacy_member"):
            db.execute("INSERT INTO expense_participants(expense_id,trip_id,user_id) VALUES(?,?,?)", ("legacy_expense", "legacy_keep_01", user_id))
        db.execute("INSERT INTO request_receipts(user_id,operation,request_key,payload_hash,response_json,created_at) VALUES(?,?,?,?,?,?)", ("legacy_owner", "create_expense:legacy_keep_01", "legacy-expense-key", "legacy-expense-hash", '{"expenses":[{"id":"legacy_expense"}]}', "2026-01-01T00:00:00Z"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    args = parser.parse_args()
    password = "Legacy exact password"
    password_hash = subprocess.run([args.php, "-r", "echo password_hash($argv[1], PASSWORD_BCRYPT);", password], check=True, capture_output=True, text=True).stdout
    for version in (1, 2):
        with tempfile.TemporaryDirectory(prefix=f"agenttt-v{version}-migration-") as directory:
            data_dir = Path(directory) / "data"
            data_dir.mkdir()
            db_path = data_dir / "agenttt.sqlite"
            session_dir = data_dir / "sessions"
            session_dir.mkdir()
            session_file = session_dir / "sess_legacysessionabc123"
            session_bytes = b'user_id|s:12:"legacy_owner";csrf_token|s:64:"' + b"a" * 64 + b'";'
            session_file.write_bytes(session_bytes)
            tables = LEGACY_TABLES + (PHASE_TWO_TABLES if version == 2 else ())
            with sqlite3.connect(db_path) as db:
                db.executescript((ROOT / f"tests/schema-v{version}.sql").read_text(encoding="utf-8"))
                seed_legacy(db, version, password_hash)
                before = snapshot(db, tables)
                assert db.execute("PRAGMA user_version").fetchone()[0] == version
            env = dict(os.environ, AGENTTT_DATA_DIR=str(data_dir))
            for attempt in range(2):
                subprocess.run([args.php, str(ROOT / "scripts/init-db.php")], env=env, check=True, capture_output=True, text=True, timeout=15)
                with sqlite3.connect(db_path) as db:
                    assert db.execute("PRAGMA user_version").fetchone()[0] == 3, f"Version {version} must migrate to version 3"
                    assert snapshot(db, tables) == before, "Migration must preserve every legacy row and password hash"
                    assert db.execute("SELECT count(*) FROM users WHERE id LIKE 'u_%'").fetchone()[0] == 0, "Deleted demo accounts must not be seeded again"
                    assert db.execute("SELECT count(*) FROM trips WHERE id='trip_demo_01'").fetchone()[0] == 0
                    for table in ("registration_receipts", "trip_invitations"):
                        assert db.execute("SELECT count(*) FROM " + table).fetchone()[0] == 0, table
                    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
                    retained_hash = db.execute("SELECT password_hash FROM users WHERE id='legacy_owner'").fetchone()[0]
                assert session_file.read_bytes() == session_bytes, "Schema migration must preserve existing session bytes"
                verify = subprocess.run([args.php, "-r", "exit(password_verify($argv[1], $argv[2]) ? 0 : 1);", password, retained_hash], check=False, capture_output=True)
                assert verify.returncode == 0, "Legacy password must still verify after upgrade"
                print(f"PASS: schema {version} to 3 " + ("upgrade" if attempt == 0 else "repeat") + " preserves legacy rows, password hashes, session bytes and deleted demo state", flush=True)
            with sqlite3.connect(db_path) as db:
                db.execute("PRAGMA user_version=4")
                before_future = snapshot(db, tables)
            result = subprocess.run([args.php, str(ROOT / "scripts/init-db.php")], env=env, check=False, capture_output=True, text=True, timeout=15)
            assert result.returncode != 0, "An unknown future schema must fail closed"
            with sqlite3.connect(db_path) as db:
                assert db.execute("PRAGMA user_version").fetchone()[0] == 4
                assert snapshot(db, tables) == before_future
            assert session_file.read_bytes() == session_bytes
            print(f"PASS: unknown schema after legacy {version} fixture fails closed without rewriting data", flush=True)


if __name__ == "__main__":
    main()
