#!/usr/bin/env python3
"""Real HTTP acceptance tests; run against an isolated AGENTTT_DATA_DIR only."""

import argparse
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


CONFIG = None
ROOT = Path(__file__).resolve().parents[1]


class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        handlers = [urllib.request.HTTPCookieProcessor(self.cookies)]
        if urllib.parse.urlparse(CONFIG.base_url).hostname in ("127.0.0.1", "localhost", "::1"):
            handlers.insert(0, urllib.request.ProxyHandler({}))
        self.opener = urllib.request.build_opener(*handlers)
        self.csrf = None
        self.user_id = None

    def request(self, method, path, payload=None, *, csrf=True, headers=None, raw=None):
        request_headers = {"Accept": "application/json"}
        if csrf and self.csrf:
            request_headers["X-CSRF-Token"] = self.csrf
        if headers:
            request_headers.update(headers)
        if raw is not None:
            body = raw
            request_headers["Content-Type"] = "application/json"
        elif payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        else:
            body = None
        url = CONFIG.base_url.rstrip("/") + "/api/index.php?path=" + urllib.parse.quote("/" + path.lstrip("/"), safe="/")
        request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            parsed = json.loads(content) if content else None
            return response.status, parsed, response.headers

    def login(self, email="test@test.com", password="test123"):
        status, result, _ = self.request("GET", "session")
        assert status == 200, (status, result)
        self.csrf = result["data"]["csrfToken"]
        status, result, _ = self.request("POST", "login", {"email": email, "password": password})
        assert status == 200, (status, result)
        self.csrf = result["data"]["csrfToken"]
        self.user_id = result["data"]["user"]["id"]
        return result["data"]["user"]


class BackendAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data_dir = Path(CONFIG.data_dir).resolve()
        if data_dir == ROOT or ROOT in data_dir.parents:
            raise RuntimeError("Tests must use an isolated data directory outside the repository")
        candidates = list(data_dir.glob("*.sqlite")) + list(data_dir.glob("*.sqlite3")) + list(data_dir.glob("*.db"))
        if len(candidates) != 1:
            raise RuntimeError(f"Expected one initialized SQLite database in {data_dir}; got {len(candidates)}")
        cls.db_path = candidates[0]

    def setUp(self):
        self.client = Client()
        self.user = self.client.login()

    def trip_payload(self, **overrides):
        result = {"name": "HTTP 驗收 " + uuid.uuid4().hex[:12], "startDate": "2099-01-02", "endDate": "2099-01-04", "station": "台中", "budget": 3000}
        result.update(overrides)
        return result

    def create_trip(self, client=None, payload=None, key=None):
        client = client or self.client
        payload = payload or self.trip_payload()
        key = key or "acceptance-" + uuid.uuid4().hex
        status, result, headers = client.request("POST", "trips", payload, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, result)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        return result["data"], payload, key

    def get_trip(self, trip_id, client=None):
        actor = client or self.client
        status, result, headers = actor.request("GET", "trips/" + trip_id)
        self.assertEqual(status, 200, result)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), actor.user_id)
        return result["data"]

    def error(self, response, expected):
        status, result, _ = response
        self.assertEqual(status, expected, result)
        self.assertIsInstance(result.get("error"), dict)
        self.assertTrue(result["error"].get("code"))
        self.assertTrue(result["error"].get("message"))

    def test_health_and_anonymous_session(self):
        anonymous = Client()
        status, data, headers = anonymous.request("GET", "health")
        self.assertEqual(status, 200, data)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        status, data, headers = anonymous.request("GET", "session")
        self.assertEqual(status, 200, data)
        self.assertIsNone(data["data"]["user"])
        self.assertGreaterEqual(len(data["data"]["csrfToken"]), 32)
        self.assertIn("no-store", headers.get("Cache-Control", ""))

    def test_passwords_are_never_returned(self):
        self.assertEqual(self.user["id"], "u_guest_01")
        self.assertEqual(self.user["role"], "guest")
        self.assertNotIn("password", self.user)
        self.assertNotIn("password_hash", self.user)
        status, data, _ = self.client.request("GET", "session")
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["user"], self.user)
        self.assertNotIn("test123", json.dumps(data))

    def test_login_regenerates_session_and_cookie_is_http_only(self):
        client = Client()
        status, data, _ = client.request("GET", "session")
        self.assertEqual(status, 200)
        client.csrf = data["data"]["csrfToken"]
        old_values = {cookie.value for cookie in client.cookies}
        client.login()
        new_values = {cookie.value for cookie in client.cookies}
        self.assertTrue(old_values and new_values)
        self.assertTrue(old_values.isdisjoint(new_values), "Login must replace the anonymous session ID")
        self.assertTrue(any(cookie.has_nonstandard_attr("HttpOnly") for cookie in client.cookies))

    def test_wrong_password_does_not_authenticate(self):
        client = Client()
        status, data, _ = client.request("GET", "session")
        self.assertEqual(status, 200)
        client.csrf = data["data"]["csrfToken"]
        self.error(client.request("POST", "login", {"email": "test@test.com", "password": "wrong-password"}), 401)
        status, data, _ = client.request("GET", "session")
        self.assertEqual(status, 200)
        self.assertIsNone(data["data"]["user"])

    def test_unauthenticated_trip_access(self):
        client = Client()
        self.error(client.request("GET", "trips"), 401)
        self.error(client.request("GET", "trips/trip_demo_01"), 401)

    def test_csrf_missing_and_wrong_session_are_rejected(self):
        payload = self.trip_payload()
        headers = {"Idempotency-Key": "csrf-" + uuid.uuid4().hex}
        self.error(self.client.request("POST", "trips", payload, csrf=False, headers=headers), 403)
        other = Client()
        other.login("other@test.com")
        headers["X-CSRF-Token"] = other.csrf
        self.error(self.client.request("POST", "trips", payload, headers=headers), 403)
        trip, _, _ = self.create_trip()
        for method, path, body in (("PATCH", "trips/" + trip["id"], {"version": 1, "name": "invalid CSRF write"}), ("DELETE", "trips/" + trip["id"], {"version": 1}), ("POST", "logout", {})):
            with self.subTest(method=method, path=path):
                self.error(self.client.request(method, path, body, csrf=False), 403)
                self.error(self.client.request(method, path, body, headers={"X-CSRF-Token": other.csrf}), 403)
        self.assertEqual(self.get_trip(trip["id"]), trip)
        anonymous = Client()
        anonymous.request("GET", "session")
        self.error(anonymous.request("POST", "login", {"email": "test@test.com", "password": "test123"}, csrf=False), 403)

    def test_logout_invalidates_access(self):
        stale = Client()
        for cookie in self.client.cookies:
            stale.cookies.set_cookie(copy.copy(cookie))
        status, result, _ = self.client.request("POST", "logout", {})
        self.assertIn(status, (200, 204), result)
        self.error(self.client.request("GET", "trips"), 401)
        self.error(stale.request("GET", "trips"), 401)
        status, result, _ = self.client.request("GET", "session")
        self.assertEqual(status, 200)
        self.assertIsNone(result["data"]["user"])

    def test_create_list_read_roundtrip(self):
        trip, payload, _ = self.create_trip()
        self.assertTrue(trip["id"])
        self.assertNotEqual(trip["id"], "trip_demo_01")
        self.assertEqual(trip["ownerId"], "u_guest_01")
        self.assertEqual(trip["version"], 1)
        self.assertTrue(trip["canEdit"])
        self.assertEqual(trip["effectiveStatus"], "planning")
        self.assertTrue(any(member["userId"] == "u_guest_01" for member in trip["members"]))
        for key, value in payload.items():
            self.assertEqual(trip[key], value)
        self.assertEqual(self.get_trip(trip["id"]), trip)
        status, result, headers = self.client.request("GET", "trips")
        self.assertEqual(status, 200, result)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), "u_guest_01")
        self.assertTrue(any(item["id"] == trip["id"] for item in result["data"]))

    def test_idempotency_replay_creates_one_trip(self):
        trip, payload, key = self.create_trip()
        status, data, _ = self.client.request("POST", "trips", payload, headers={"Idempotency-Key": key})
        self.assertIn(status, (200, 201), data)
        self.assertEqual(data["data"], trip)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM trips WHERE name = ?", (payload["name"],)).fetchone()[0], 1)

    def test_idempotency_key_rejects_changed_payload(self):
        trip, payload, key = self.create_trip()
        payload["name"] += " changed"
        self.error(self.client.request("POST", "trips", payload, headers={"Idempotency-Key": key}), 409)
        self.assertNotEqual(self.get_trip(trip["id"])["name"], payload["name"])

    def test_idempotency_receipts_are_scoped_to_the_user(self):
        first, payload, key = self.create_trip()
        other = Client()
        other.login("other@test.com")
        second, _, _ = self.create_trip(client=other, payload=payload, key=key)
        self.assertNotEqual(second["id"], first["id"])
        self.assertEqual(second["ownerId"], "u_guest_02")
        self.error(other.request("GET", "trips/" + first["id"]), 404)

    def test_idempotency_key_is_required(self):
        self.error(self.client.request("POST", "trips", self.trip_payload()), 400)

    def test_invalid_trip_inputs_do_not_create_rows(self):
        cases = [{"name": "   "}, {"name": "\u3000"}, {"startDate": "2099-02-30"}, {"startDate": "0000-01-01"}, {"endDate": "2098-12-31"}, {"station": ""}, {"budget": -1}, {"budget": 1.5}, {"budget": None}, {"name": "x" * 81}, {"ownerId": "u_admin_01"}, {"status": "completed"}]
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT count(*) FROM trips").fetchone()[0]
        for invalid in cases:
            with self.subTest(invalid=invalid):
                self.error(self.client.request("POST", "trips", self.trip_payload(**invalid), headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM trips").fetchone()[0], before)

    def test_other_user_cannot_read_edit_delete_owner_trip(self):
        trip, _, _ = self.create_trip()
        other = Client()
        other.login("other@test.com")
        self.error(other.request("GET", "trips/" + trip["id"]), 404)
        self.error(other.request("PATCH", "trips/" + trip["id"], {"version": 1, "name": "stolen"}), 404)
        self.error(other.request("DELETE", "trips/" + trip["id"], {"version": 1}), 404)
        status, data, _ = other.request("GET", "trips")
        self.assertEqual(status, 200)
        self.assertNotIn(trip["id"], [item["id"] for item in data["data"]])

    def test_member_can_read_but_cannot_mutate(self):
        trip, _, _ = self.create_trip()
        with sqlite3.connect(self.db_path) as db:
            db.execute("INSERT INTO trip_members(trip_id,user_id,role,joined_at) VALUES (?,?,?,?)", (trip["id"], "u_guest_02", "member", "2099-01-01T00:00:00Z"))
        member = Client()
        member.login("other@test.com")
        visible = self.get_trip(trip["id"], member)
        self.assertFalse(visible["canEdit"])
        self.error(member.request("PATCH", "trips/" + trip["id"], {"version": 1, "name": "member edit"}), 403)
        self.error(member.request("DELETE", "trips/" + trip["id"], {"version": 1}), 403)

    def test_host_and_admin_do_not_gain_owner_rights(self):
        trip, _, _ = self.create_trip()
        for email in ("host@test.com", "admin@test.com"):
            with self.subTest(email=email):
                client = Client()
                client.login(email)
                self.error(client.request("GET", "trips/" + trip["id"]), 404)

    def test_patch_and_manual_status_increment_version(self):
        trip, _, _ = self.create_trip()
        status, data, _ = self.client.request("PATCH", "trips/" + trip["id"], {"version": 1, "name": "已修改", "budget": 5000, "status": "cancelled"})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["data"]["version"], 2)
        self.assertEqual(data["data"]["name"], "已修改")
        self.assertEqual(data["data"]["budget"], 5000)
        self.assertEqual(data["data"]["status"], "cancelled")
        self.assertEqual(data["data"]["effectiveStatus"], "cancelled")
        self.assertEqual(self.get_trip(trip["id"]), data["data"])

    def test_stale_version_does_not_overwrite(self):
        trip, _, _ = self.create_trip()
        status, data, _ = self.client.request("PATCH", "trips/" + trip["id"], {"version": 1, "name": "first writer"})
        self.assertEqual(status, 200, data)
        self.error(self.client.request("PATCH", "trips/" + trip["id"], {"version": 1, "name": "stale writer"}), 409)
        self.error(self.client.request("DELETE", "trips/" + trip["id"], {"version": 1}), 409)
        self.assertEqual(self.get_trip(trip["id"])["name"], "first writer")

    def test_invalid_patch_is_atomic(self):
        trip, _, _ = self.create_trip()
        for invalid in ({"status": "invalid"}, {"ownerId": "u_guest_02"}, {"version": 0}, {"version": "1"}, {"endDate": "2098-01-01"}, {"budget": -10}):
            payload = {"version": 1, "name": "must not be persisted", **invalid}
            with self.subTest(payload=payload):
                self.error(self.client.request("PATCH", "trips/" + trip["id"], payload), 422)
        self.assertEqual(self.get_trip(trip["id"]), trip)

    def test_delete_requires_version_and_removes_trip(self):
        trip, _, _ = self.create_trip()
        self.error(self.client.request("DELETE", "trips/" + trip["id"], {}), 422)
        status, result, _ = self.client.request("DELETE", "trips/" + trip["id"], {"version": 1})
        self.assertEqual(status, 204, result)
        self.assertIsNone(result)
        self.error(self.client.request("GET", "trips/" + trip["id"]), 404)

    def test_effective_status_read_does_not_write(self):
        trip, _, _ = self.create_trip(payload=self.trip_payload(startDate="2020-01-01", endDate="2020-01-02"))
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT status,status_manual,version,updated_at FROM trips WHERE id=?", (trip["id"],)).fetchone()
        visible = self.get_trip(trip["id"])
        self.assertEqual(visible["status"], "planning")
        self.assertEqual(visible["effectiveStatus"], "completed")
        self.client.request("GET", "trips")
        with sqlite3.connect(self.db_path) as db:
            after = db.execute("SELECT status,status_manual,version,updated_at FROM trips WHERE id=?", (trip["id"],)).fetchone()
        self.assertEqual(after, before, "GET must never silently change persisted status/version")

    def test_malformed_json_reports_client_error(self):
        response = self.client.request("POST", "trips", raw=b'{"broken":', headers={"Idempotency-Key": "broken-" + uuid.uuid4().hex})
        self.error(response, 400)

    def test_sql_characters_and_html_are_plain_data(self):
        name = "<img src=x onerror=alert(1)> ' ; DROP TABLE users; --"
        trip, _, _ = self.create_trip(payload=self.trip_payload(name=name))
        self.assertEqual(self.get_trip(trip["id"])["name"], name)
        self.assertEqual(Client().login()["id"], "u_guest_01")

    def test_init_is_idempotent_and_preserves_existing_data(self):
        trip, _, _ = self.create_trip()
        with sqlite3.connect(self.db_path) as db:
            before = {table: db.execute("SELECT * FROM " + table + " ORDER BY 1,2").fetchall() for table in ("users", "trips", "trip_members", "request_receipts")}
        env = dict(os.environ, AGENTTT_DATA_DIR=CONFIG.data_dir)
        for _ in range(2):
            subprocess.run([CONFIG.php, str(ROOT / "scripts/init-db.php")], env=env, check=True, capture_output=True, text=True, timeout=15)
        with sqlite3.connect(self.db_path) as db:
            after = {table: db.execute("SELECT * FROM " + table + " ORDER BY 1,2").fetchall() for table in before}
        self.assertEqual(after, before)
        self.assertEqual(self.get_trip(trip["id"])["id"], trip["id"])

    def test_private_files_are_not_downloadable(self):
        for path in ("/.git/config", "/backend/config.php", "/storage/agenttt.sqlite", "/storage/sessions/", "/scripts/init-db.php", "/tests/backend_http.py", "/../storage/agenttt.sqlite"):
            with self.subTest(path=path):
                request = urllib.request.Request(CONFIG.base_url.rstrip("/") + path)
                try:
                    response = self.client.opener.open(request, timeout=10)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    self.assertIn(response.status, (400, 403, 404), path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("AGENTTT_BASE_URL", "http://127.0.0.1:8090"))
    parser.add_argument("--data-dir", default=os.environ.get("AGENTTT_DATA_DIR"), required=not bool(os.environ.get("AGENTTT_DATA_DIR")))
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    CONFIG, remaining = parser.parse_known_args()
    unittest.main(argv=[__file__, *remaining], verbosity=2)
