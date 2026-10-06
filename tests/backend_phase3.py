#!/usr/bin/env python3
"""Registration, invitation and membership acceptance through real HTTP."""

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import sqlite3
import sys
import unittest
import uuid

sys.dont_write_bytecode = True
import backend_http as common


class PhaseThreeAcceptance(unittest.TestCase):
    trip_payload = common.BackendAcceptance.trip_payload
    create_trip = common.BackendAcceptance.create_trip
    get_trip = common.BackendAcceptance.get_trip
    error = common.BackendAcceptance.error

    @classmethod
    def setUpClass(cls):
        common.BackendAcceptance.setUpClass.__func__(cls)

    def setUp(self):
        self.client = common.Client()
        self.client.login()
        self.recipient = common.Client()
        self.recipient.login("other@test.com")
        self.trip, _, _ = self.create_trip()

    def anonymous(self):
        client = common.Client()
        status, data, _ = client.request("GET", "session")
        self.assertEqual(status, 200, data)
        self.assertIsNone(data["data"]["user"])
        client.csrf = data["data"]["csrfToken"]
        return client

    def registration_payload(self, **overrides):
        result = {"name": "新旅客", "email": "acceptance-" + uuid.uuid4().hex + "@example.com", "password": "Practice 123!"}
        result.update(overrides)
        return result

    def register(self, client=None, payload=None, key=None):
        client = client or self.anonymous()
        payload = payload or self.registration_payload()
        key = key or "register-" + uuid.uuid4().hex
        status, data, _ = client.request("POST", "register", payload, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, data)
        self.assertEqual(data["data"], {"created": True, "email": payload["email"].strip().lower()})
        return client, payload, key

    def details(self, trip_id=None, client=None):
        client = client or self.client
        status, data, headers = client.request("GET", f"trips/{trip_id or self.trip['id']}/details")
        self.assertEqual(status, 200, data)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        return data["data"]

    def incoming(self, client=None):
        client = client or self.recipient
        status, data, headers = client.request("GET", "invitations")
        self.assertEqual(status, 200, data)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        return data["data"]

    def incoming_one(self, invite_id, client=None):
        records = [item for item in self.incoming(client) if item["id"] == invite_id]
        self.assertEqual(len(records), 1)
        return records[0]

    def invite(self, email="other@test.com", trip_id=None, client=None, key=None):
        client = client or self.client
        trip_id = trip_id or self.trip["id"]
        before = self.details(trip_id, client)
        body = {"version": before["trip"]["version"], "email": email}
        key = key or "invite-" + uuid.uuid4().hex
        status, data, headers = client.request("POST", f"trips/{trip_id}/invitations", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, data)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        details = data["data"]
        self.assertEqual(details["trip"]["version"], before["trip"]["version"] + 1)
        invitation = next(item for item in details["invitations"] if item["recipient"]["email"] == email.strip().lower())
        return details, invitation, body, key

    def respond(self, invitation, action="accept", client=None, key=None):
        client = client or self.recipient
        key = key or "response-" + uuid.uuid4().hex
        body = {"version": invitation["version"]}
        status, data, headers = client.request("POST", f"invitations/{invitation['id']}/{action}", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 200, data)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        self.assertEqual(set(data["data"]), {"invitation"})
        return data["data"]["invitation"], body, key

    def revoke(self, invitation):
        version = self.details()["trip"]["version"]
        status, data, _ = self.client.request("DELETE", f"trips/{self.trip['id']}/invitations/{invitation['id']}", {"version": version})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["data"]["trip"]["version"], version + 1)
        return data["data"]

    def remove(self, user_id="u_guest_02"):
        version = self.details()["trip"]["version"]
        status, data, _ = self.client.request("DELETE", f"trips/{self.trip['id']}/members/{user_id}", {"version": version})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["data"]["trip"]["version"], version + 1)
        return data["data"]

    def expense(self, **overrides):
        before = self.details()
        body = {"version": before["trip"]["version"], "name": "成員移除保護測試", "amount": 101, "category": "food", "date": "2099-01-02", "payerId": "u_guest_01", "participantIds": ["u_guest_01"], "note": ""}
        body.update(overrides)
        status, data, _ = self.client.request("POST", f"trips/{self.trip['id']}/expenses", body, headers={"Idempotency-Key": "expense-" + uuid.uuid4().hex})
        self.assertEqual(status, 201, data)
        return data["data"]["expenses"][-1]

    def test_registration_keeps_anonymous_session_and_normalizes_safe_user(self):
        client = self.anonymous()
        csrf = client.csrf
        _, payload, _ = self.register(client, self.registration_payload(name="  旅客姓名  ", email="  Mixed-" + uuid.uuid4().hex + "@EXAMPLE.COM  "))
        status, data, _ = client.request("GET", "session")
        self.assertEqual(status, 200)
        self.assertIsNone(data["data"]["user"])
        self.assertEqual(data["data"]["csrfToken"], csrf)
        user = client.login(payload["email"].strip(), payload["password"])
        self.assertEqual(user["name"], "旅客姓名")
        self.assertEqual(user["email"], payload["email"].strip().lower())
        self.assertEqual(user["role"], "guest")
        self.assertEqual(user["phone"], "")
        self.assertNotIn(user["id"], ("u_guest_01", "u_guest_02", "u_host_01", "u_admin_01"))
        self.assertFalse(any("password" in key.lower() for key in user))

    def test_password_spaces_and_unicode_are_preserved(self):
        for password in ("  exact password  ", "八個字密碼測試喔", "x" * 72):
            with self.subTest(password_length=len(password.encode())):
                client, payload, _ = self.register(payload=self.registration_payload(password=password))
                self.assertEqual(client.login(payload["email"], password)["email"], payload["email"])
                if len(password.encode()) == 72:
                    anonymous = self.anonymous()
                    self.error(anonymous.request("POST", "login", {"email": payload["email"], "password": password + "x"}), 401)
                    self.error(anonymous.request("POST", "login", {"email": payload["email"], "password": password + "\u0000"}), 401)

    def test_invalid_registration_fields_do_not_create_users(self):
        client = self.anonymous()
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT count(*) FROM users").fetchone()[0]
        invalids = [{"name": " "}, {"name": "\u3000"}, {"name": "x" * 81}, {"email": "missing-at-sign"}, {"email": "非ASCII@example.com"}, {"email": "a" * 255 + "@example.com"}, {"password": "1234567"}, {"password": "三個字"}, {"password": "x" * 73}, {"password": "中文字" * 9}, {"password": "1234\u000056789"}, {"role": "admin"}, {"ownerId": "u_admin_01"}, {"phone": "0911111111"}]
        for invalid in invalids:
            with self.subTest(invalid=invalid):
                self.error(client.request("POST", "register", self.registration_payload(**invalid), headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users").fetchone()[0], before)

    def test_registration_requires_anonymous_csrf_and_request_key(self):
        client = self.anonymous()
        payload = self.registration_payload()
        self.error(client.request("POST", "register", payload, csrf=False, headers={"Idempotency-Key": "csrf-" + uuid.uuid4().hex}), 403)
        another = self.anonymous()
        self.error(client.request("POST", "register", payload, headers={"X-CSRF-Token": another.csrf, "Idempotency-Key": "csrf-" + uuid.uuid4().hex}), 403)
        self.error(client.request("POST", "register", payload), 400)
        response = self.client.request("POST", "register", payload, headers={"Idempotency-Key": "logged-in-" + uuid.uuid4().hex})
        self.error(response, 403)
        self.assertEqual(response[2].get("X-AgentTT-User-Id"), "u_guest_01")

    def test_registration_replay_is_stable_and_changed_payload_conflicts(self):
        client, payload, key = self.register()
        status, replay, _ = client.request("POST", "register", payload, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, replay)
        self.assertEqual(replay["data"], {"created": True, "email": payload["email"]})
        changed = dict(payload, password="Different 123!")
        self.error(client.request("POST", "register", changed, headers={"Idempotency-Key": key}), 409)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users WHERE email=?", (payload["email"],)).fetchone()[0], 1)

    def test_existing_email_and_different_anonymous_scope_do_not_replace_account(self):
        client, payload, key = self.register()
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT * FROM users WHERE email=?", (payload["email"],)).fetchone()
        self.error(client.request("POST", "register", dict(payload, email=" " + payload["email"].upper() + " "), headers={"Idempotency-Key": "new-" + uuid.uuid4().hex}), 409)
        other = self.anonymous()
        self.error(other.request("POST", "register", payload, headers={"Idempotency-Key": key}), 409)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT * FROM users WHERE email=?", (payload["email"],)).fetchone(), before)

    def test_registration_storage_contains_hashes_but_no_plain_password_or_plain_payload_sha(self):
        client, payload, key = self.register(payload=self.registration_payload(password="Secret-to-this-test-123!"))
        with sqlite3.connect(self.db_path) as db:
            row = db.execute("SELECT password_hash FROM users WHERE email=?", (payload["email"],)).fetchone()
            self.assertTrue(row[0].startswith("$2y$"), "Registration must use the bcrypt-compatible PHP hash")
            receipts = db.execute("SELECT * FROM registration_receipts WHERE request_key=?", (key,)).fetchall()
            self.assertEqual(len(receipts), 1)
            columns = [column[1] for column in db.execute("PRAGMA table_info(registration_receipts)")]
            receipt = dict(zip(columns, receipts[0]))
            self.assertNotIn(payload["password"], json.dumps(receipt))
            self.assertEqual(json.loads(receipt["response_json"]), {"created": True, "email": payload["email"]})
            ordinary_hashes = {hashlib.sha256(json.dumps(payload, sort_keys=sort, ensure_ascii=ascii_only, separators=separators).encode()).hexdigest() for sort in (True, False) for ascii_only in (True, False) for separators in ((",", ":"), (", ", ": "))}
            self.assertNotIn(receipt["payload_hash"], ordinary_hashes)
            self.assertFalse(any("password" in column.lower() or "hmac_key" in column.lower() for column in columns))
        self.assertNotIn(payload["password"].encode(), self.db_path.read_bytes())
        for session_file in (self.db_path.parent / "sessions").glob("sess_*"):
            self.assertNotIn(payload["password"].encode(), session_file.read_bytes(), "Registration must not persist the password in PHP sessions")
        self.assertEqual(client.login(payload["email"], payload["password"])["role"], "guest")

    def test_concurrent_registration_of_same_email_has_one_account(self):
        clients = [self.anonymous(), self.anonymous()]
        payload = self.registration_payload()
        def register(client):
            return client.request("POST", "register", payload, headers={"Idempotency-Key": "race-" + uuid.uuid4().hex})
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(register, clients))
        self.assertEqual(sorted(result[0] for result in results), [201, 409])
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users WHERE email=?", (payload["email"],)).fetchone()[0], 1)

    def test_same_anonymous_scope_concurrent_replay_has_one_effect(self):
        first = self.anonymous()
        second = common.Client()
        second.csrf = first.csrf
        for cookie in first.cookies:
            second.cookies.set_cookie(copy.copy(cookie))
        payload = self.registration_payload()
        key = "same-scope-" + uuid.uuid4().hex
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda client: client.request("POST", "register", payload, headers={"Idempotency-Key": key}), [first, second]))
        self.assertEqual([result[0] for result in results], [201, 201])
        self.assertEqual(results[0][1], results[1][1])
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users WHERE email=?", (payload["email"],)).fetchone()[0], 1)

    def test_real_registered_accounts_invite_accept_and_read_only_expense_flow(self):
        owner, owner_payload, _ = self.register()
        owner_user = owner.login(owner_payload["email"], owner_payload["password"])
        recipient, recipient_payload, _ = self.register()
        recipient_user = recipient.login(recipient_payload["email"], recipient_payload["password"])
        trip, _, _ = self.create_trip(client=owner)
        _, invite, _, _ = self.invite(recipient_payload["email"], trip_id=trip["id"], client=owner)
        self.error(recipient.request("GET", f"trips/{trip['id']}/details"), 404)
        accepted, _, _ = self.respond(invite, client=recipient)
        self.assertEqual(accepted["status"], "accepted")
        self.assertTrue(accepted["canOpenTrip"])
        self.assertEqual(self.details(trip["id"], recipient)["invitations"], [])
        before = self.details(trip["id"], owner)
        body = {"version": before["trip"]["version"], "name": "兩帳號分攤", "amount": 101, "category": "food", "date": "2099-01-02", "payerId": owner_user["id"], "participantIds": [owner_user["id"], recipient_user["id"]]}
        status, data, _ = owner.request("POST", f"trips/{trip['id']}/expenses", body, headers={"Idempotency-Key": "expense-" + uuid.uuid4().hex})
        self.assertEqual(status, 201, data)
        visible = self.details(trip["id"], recipient)
        self.assertEqual(visible["summary"]["totalSpent"], 101)
        self.assertFalse(visible["trip"]["canEdit"])
        self.assertEqual(sum(row["balance"] for row in visible["summary"]["balances"]), 0)
        self.error(recipient.request("PATCH", f"trips/{trip['id']}", {"version": visible["trip"]["version"], "name": "禁止改寫"}), 403)

    def test_pending_invitation_does_not_grant_membership(self):
        details, invitation, _, _ = self.invite(email=" OTHER@TEST.COM ")
        self.assertEqual(details["trip"]["version"], 2)
        self.assertEqual(invitation["version"], 1)
        self.assertEqual(invitation["status"], "pending")
        self.assertFalse(self.incoming_one(invitation["id"])["canOpenTrip"])
        self.error(self.recipient.request("GET", f"trips/{self.trip['id']}/details"), 404)
        self.assertNotIn("u_guest_02", [member["userId"] for member in details["trip"]["members"]])

    def test_incoming_data_is_private_and_member_cannot_see_owner_invitation_list(self):
        _, invitation, _, _ = self.invite()
        incoming = self.incoming_one(invitation["id"])
        self.assertEqual(incoming["recipient"]["id"], "u_guest_02")
        self.assertEqual(incoming["inviter"]["id"], "u_guest_01")
        self.assertEqual(set(incoming["trip"]), {"id", "name", "startDate", "endDate", "station"})
        self.assertNotIn("password", json.dumps(incoming).lower())
        self.assertNotIn(invitation["id"], [item["id"] for item in self.incoming(self.client)])
        self.respond(invitation)
        self.assertEqual(self.details(client=self.recipient)["invitations"], [])
        self.assertEqual(len(self.details()["invitations"]), 1)

    def test_only_recipient_can_accept_or_decline(self):
        _, invitation, _, _ = self.invite()
        third = common.Client()
        third.login("admin@test.com")
        for client in (self.client, third):
            for action in ("accept", "decline"):
                self.error(client.request("POST", f"invitations/{invitation['id']}/{action}", {"version": 1}, headers={"Idempotency-Key": "forbidden-" + uuid.uuid4().hex}), 404)
        self.assertEqual(self.incoming_one(invitation["id"])["status"], "pending")

    def test_invalid_invitees_and_unknown_fields_do_not_change_trip(self):
        before = self.details()
        for email in ("not-existing@example.com", "host@test.com", "admin@test.com", "test@test.com", "not-an-email"):
            with self.subTest(email=email):
                self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", {"version": 1, "email": email}, headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", {"version": 1, "email": "other@test.com", "role": "owner"}, headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        self.assertEqual(self.details(), before)

    def test_duplicate_pending_and_existing_member_are_rejected(self):
        _, invitation, _, _ = self.invite()
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", {"version": 2, "email": "other@test.com"}, headers={"Idempotency-Key": "duplicate-" + uuid.uuid4().hex}), 409)
        self.respond(invitation)
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", {"version": 3, "email": "other@test.com"}, headers={"Idempotency-Key": "member-" + uuid.uuid4().hex}), 409)
        self.assertEqual(self.details()["trip"]["version"], 3)

    def test_decline_and_reinvite_reuses_identity_and_increments_versions(self):
        _, invitation, _, _ = self.invite()
        declined, _, _ = self.respond(invitation, "decline")
        self.assertEqual(declined["status"], "declined")
        self.assertEqual(declined["version"], 2)
        self.assertFalse(declined["canOpenTrip"])
        self.assertEqual(self.details()["trip"]["version"], 3)
        details, reinvited, _, _ = self.invite()
        self.assertEqual(reinvited["id"], invitation["id"])
        self.assertEqual(reinvited["version"], 3)
        self.assertEqual(reinvited["status"], "pending")
        self.assertEqual(details["trip"]["version"], 4)
        accepted, _, _ = self.respond(reinvited)
        self.assertEqual(accepted["version"], 4)
        self.assertEqual(self.details()["trip"]["version"], 5)

    def test_revoke_pending_blocks_old_accept_then_allows_reinvite(self):
        _, invitation, _, _ = self.invite()
        revoked = self.revoke(invitation)
        self.assertEqual(revoked["invitations"][0]["status"], "revoked")
        self.error(self.recipient.request("POST", f"invitations/{invitation['id']}/accept", {"version": 1}, headers={"Idempotency-Key": "old-" + uuid.uuid4().hex}), 409)
        _, reinvited, _, _ = self.invite()
        self.assertEqual(reinvited["id"], invitation["id"])
        self.assertEqual(reinvited["version"], 3)
        self.respond(reinvited)

    def test_member_removal_revokes_invite_and_immediately_revokes_read_access(self):
        _, invitation, _, _ = self.invite()
        self.respond(invitation)
        details = self.remove()
        self.assertNotIn("u_guest_02", [member["userId"] for member in details["trip"]["members"]])
        current = self.incoming_one(invitation["id"])
        self.assertEqual(current["status"], "revoked")
        self.assertEqual(current["version"], 3)
        self.assertFalse(current["canOpenTrip"])
        self.error(self.recipient.request("GET", f"trips/{self.trip['id']}/details"), 404)

    def test_expense_payer_or_participant_blocks_removal_without_writing(self):
        _, invitation, _, _ = self.invite()
        self.respond(invitation)
        expense = self.expense(payerId="u_guest_02", participantIds=["u_guest_01"])
        for references in ("payer", "participant"):
            before = self.details()
            response = self.client.request("DELETE", f"trips/{self.trip['id']}/members/u_guest_02", {"version": before["trip"]["version"]})
            self.error(response, 409)
            self.assertEqual(response[1]["error"]["code"], "MEMBER_HAS_EXPENSES")
            self.assertEqual(self.details(), before)
            if references == "payer":
                status, data, _ = self.client.request("PATCH", f"trips/{self.trip['id']}/expenses/{expense['id']}", {"version": before["trip"]["version"], "payerId": "u_guest_01", "participantIds": ["u_guest_02"]})
                self.assertEqual(status, 200, data)
        before = self.details()
        status, data, _ = self.client.request("PATCH", f"trips/{self.trip['id']}/expenses/{expense['id']}", {"version": before["trip"]["version"], "participantIds": ["u_guest_01"]})
        self.assertEqual(status, 200, data)
        self.remove()

    def test_owner_unknown_member_and_member_self_removal_are_rejected(self):
        self.error(self.client.request("DELETE", f"trips/{self.trip['id']}/members/u_guest_01", {"version": 1}), 409)
        self.error(self.client.request("DELETE", f"trips/{self.trip['id']}/members/nonexistent_user", {"version": 1}), 404)
        _, invitation, _, _ = self.invite()
        self.respond(invitation)
        self.error(self.recipient.request("DELETE", f"trips/{self.trip['id']}/members/u_guest_02", {"version": 3}), 403)

    def test_invitation_child_id_is_bound_to_trip(self):
        _, invitation, _, _ = self.invite()
        separate, _, _ = self.create_trip()
        self.error(self.client.request("DELETE", f"trips/{separate['id']}/invitations/{invitation['id']}", {"version": 1}), 404)
        self.assertEqual(self.details(separate["id"])["trip"]["version"], 1)
        self.assertEqual(self.incoming_one(invitation["id"])["status"], "pending")

    def test_all_membership_writes_require_csrf_and_nonmember_has_no_rights(self):
        _, invitation, _, _ = self.invite()
        for client, method, path, body in ((self.client, "POST", f"trips/{self.trip['id']}/invitations", {"version": 2, "email": "other@test.com"}), (self.client, "DELETE", f"trips/{self.trip['id']}/invitations/{invitation['id']}", {"version": 2}), (self.client, "DELETE", f"trips/{self.trip['id']}/members/u_guest_01", {"version": 2}), (self.recipient, "POST", f"invitations/{invitation['id']}/accept", {"version": 1}), (self.recipient, "POST", f"invitations/{invitation['id']}/decline", {"version": 1})):
            with self.subTest(method=method, path=path):
                self.error(client.request(method, path, body, csrf=False, headers={"Idempotency-Key": "csrf-" + uuid.uuid4().hex}), 403)
        self.error(self.recipient.request("POST", f"trips/{self.trip['id']}/invitations", {"version": 2, "email": "test@test.com"}, headers={"Idempotency-Key": "nonmember-" + uuid.uuid4().hex}), 404)
        anonymous = self.anonymous()
        self.error(anonymous.request("GET", "invitations"), 401)
        self.error(anonymous.request("POST", f"invitations/{invitation['id']}/accept", {"version": 1}, headers={"Idempotency-Key": "anonymous-" + uuid.uuid4().hex}), 401)

    def test_stale_trip_and_invitation_versions_do_not_mutate(self):
        _, invitation, _, _ = self.invite()
        self.error(self.client.request("DELETE", f"trips/{self.trip['id']}/invitations/{invitation['id']}", {"version": 1}), 409)
        self.error(self.recipient.request("POST", f"invitations/{invitation['id']}/accept", {"version": 99}, headers={"Idempotency-Key": "stale-" + uuid.uuid4().hex}), 409)
        self.error(self.recipient.request("POST", f"invitations/{invitation['id']}/accept", {"version": "1"}, headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        self.assertEqual(self.details()["trip"]["version"], 2)
        self.assertEqual(self.incoming_one(invitation["id"])["status"], "pending")

    def test_invite_receipt_replay_and_changed_payload(self):
        details, invitation, body, key = self.invite()
        status, replay, _ = self.client.request("POST", f"trips/{self.trip['id']}/invitations", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, replay)
        self.assertEqual(replay["data"], details)
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", dict(body, email="test@test.com"), headers={"Idempotency-Key": key}), 409)
        self.assertEqual(self.details()["trip"]["version"], 2)
        self.assertEqual(len(self.details()["invitations"]), 1)

    def test_response_receipt_replay_does_not_repeat_membership(self):
        _, invitation, _, _ = self.invite()
        accepted, body, key = self.respond(invitation)
        status, replay, _ = self.recipient.request("POST", f"invitations/{invitation['id']}/accept", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 200, replay)
        self.assertEqual(replay["data"], {"invitation": accepted})
        self.error(self.recipient.request("POST", f"invitations/{invitation['id']}/accept", body, headers={"Idempotency-Key": "new-key-" + uuid.uuid4().hex}), 409)
        self.assertEqual(self.details()["trip"]["version"], 3)
        self.assertEqual(sum(member["userId"] == "u_guest_02" for member in self.details()["trip"]["members"]), 1)

    def test_old_accept_receipt_is_not_the_current_truth_after_removal(self):
        _, invitation, _, _ = self.invite()
        accepted, body, key = self.respond(invitation)
        self.remove()
        _, pending, _, _ = self.invite()
        status, replay, _ = self.recipient.request("POST", f"invitations/{invitation['id']}/accept", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 200, replay)
        self.assertEqual(replay["data"]["invitation"], accepted)
        current = self.incoming_one(invitation["id"])
        self.assertEqual(current["status"], "pending")
        self.assertEqual(current["version"], pending["version"])
        self.assertFalse(current["canOpenTrip"])
        self.error(self.recipient.request("GET", f"trips/{self.trip['id']}/details"), 404)

    def test_deleted_trip_receipts_cannot_resurrect_invite_or_membership(self):
        _, invitation, invite_body, invite_key = self.invite()
        _, accept_body, accept_key = self.respond(invitation)
        status, data, _ = self.client.request("DELETE", f"trips/{self.trip['id']}", {"version": 3})
        self.assertEqual(status, 204, data)
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/invitations", invite_body, headers={"Idempotency-Key": invite_key}), 404)
        self.error(self.recipient.request("POST", f"invitations/{invitation['id']}/accept", accept_body, headers={"Idempotency-Key": accept_key}), 404)
        self.assertNotIn(invitation["id"], [item["id"] for item in self.incoming()])

    def test_concurrent_accept_and_decline_process_invitation_once(self):
        _, invitation, _, _ = self.invite()
        other_session = common.Client()
        other_session.login("other@test.com")
        def response(pair):
            client, action = pair
            return client.request("POST", f"invitations/{invitation['id']}/{action}", {"version": 1}, headers={"Idempotency-Key": "race-" + uuid.uuid4().hex})
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(response, [(self.recipient, "accept"), (other_session, "decline")]))
        self.assertEqual(sorted(result[0] for result in results), [200, 409])
        current = self.incoming_one(invitation["id"])
        self.assertEqual(current["version"], 2)
        self.assertEqual(self.details()["trip"]["version"], 3)
        member_ids = [member["userId"] for member in self.details()["trip"]["members"]]
        self.assertEqual("u_guest_02" in member_ids, current["status"] == "accepted")

    def test_concurrent_same_accept_key_replays_without_duplicate_member(self):
        _, invitation, _, _ = self.invite()
        clients = [self.recipient, common.Client()]
        clients[1].login("other@test.com")
        key = "race-same-" + uuid.uuid4().hex
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda client: client.request("POST", f"invitations/{invitation['id']}/accept", {"version": 1}, headers={"Idempotency-Key": key}), clients))
        self.assertEqual([result[0] for result in results], [200, 200])
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(self.details()["trip"]["version"], 3)
        self.assertEqual(sum(member["userId"] == "u_guest_02" for member in self.details()["trip"]["members"]), 1)

    def test_pending_incoming_sorting_and_get_do_not_write(self):
        _, first, _, _ = self.invite()
        self.respond(first)
        separate, _, _ = self.create_trip()
        self.invite(trip_id=separate["id"])
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT * FROM trip_invitations ORDER BY id").fetchall()
        incoming = self.incoming()
        states = [item["status"] for item in incoming]
        last_pending = max((index for index, state in enumerate(states) if state == "pending"), default=-1)
        first_history = min((index for index, state in enumerate(states) if state != "pending"), default=len(states))
        self.assertLess(last_pending, first_history)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT * FROM trip_invitations ORDER BY id").fetchall(), before)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("AGENTTT_BASE_URL", "http://127.0.0.1:8090"))
    parser.add_argument("--data-dir", default=os.environ.get("AGENTTT_DATA_DIR"), required=not bool(os.environ.get("AGENTTT_DATA_DIR")))
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    config, remaining = parser.parse_known_args()
    common.CONFIG = config
    unittest.main(argv=[__file__, *remaining], verbosity=2)
