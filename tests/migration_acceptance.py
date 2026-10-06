#!/usr/bin/env python3
"""Upgrade a frozen first-phase SQLite schema without recreating users/trips."""

import argparse
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
LEGACY_TABLES = ("users", "trips", "trip_members", "request_receipts")


def snapshot(db):
    return {table: db.execute("SELECT * FROM " + table + " ORDER BY 1,2").fetchall() for table in LEGACY_TABLES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="agenttt-v1-migration-") as directory:
        data_dir = Path(directory) / "data"
        data_dir.mkdir()
        db_path = data_dir / "agenttt.sqlite"
        with sqlite3.connect(db_path) as db:
            db.executescript((ROOT / "tests/schema-v1.sql").read_text(encoding="utf-8"))
            for user_id, email in (("u_guest_01", "test@test.com"), ("u_guest_02", "other@test.com")):
                db.execute("INSERT INTO users(id,name,email,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)", (user_id, "既有使用者 " + user_id, email, "0912345678", "historical-password-hash-" + user_id, "guest", "2026-01-01T00:00:00Z"))
            db.execute("INSERT INTO trips(id,owner_id,name,start_date,end_date,station,status,status_manual,budget,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("legacy_keep_01", "u_guest_01", "升級前的自訂行程", "2099-01-02", "2099-01-04", "台中站", "cancelled", 1, 1234, 9, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"))
            for user_id, role in (("u_guest_01", "owner"), ("u_guest_02", "member")):
                db.execute("INSERT INTO trip_members(trip_id,user_id,role,joined_at) VALUES(?,?,?,?)", ("legacy_keep_01", user_id, role, "2026-01-01T00:00:00Z"))
            db.execute("INSERT INTO request_receipts(user_id,operation,request_key,payload_hash,response_json,created_at) VALUES(?,?,?,?,?,?)", ("u_guest_01", "create_trip", "legacy-request-key", "historical-payload-hash", '{"id":"legacy_keep_01"}', "2026-01-01T00:00:00Z"))
            before = snapshot(db)
            assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        env = dict(os.environ, AGENTTT_DATA_DIR=str(data_dir))
        for attempt in range(2):
            subprocess.run([args.php, str(ROOT / "scripts/init-db.php")], env=env, check=True, capture_output=True, text=True, timeout=15)
            with sqlite3.connect(db_path) as db:
                assert db.execute("PRAGMA user_version").fetchone()[0] == 2, "Version 1 must migrate to version 2"
                assert snapshot(db) == before, "Migration must preserve every legacy row and password hash"
                for table in ("trip_items", "trip_expenses", "expense_participants"):
                    assert db.execute("SELECT count(*) FROM " + table).fetchone()[0] == 0, table
                assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            print("PASS: " + ("version 1 to 2 migration preserves users, hashes, trips, members and receipts" if attempt == 0 else "repeated migration preserves existing data"), flush=True)


if __name__ == "__main__":
    main()
