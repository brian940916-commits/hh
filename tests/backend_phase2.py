#!/usr/bin/env python3
"""HTTP acceptance for itinerary entries, expenses and integer settlements."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import sqlite3
import sys
import unittest
import uuid

sys.dont_write_bytecode = True
import backend_http as common


class PhaseTwoAcceptance(unittest.TestCase):
    trip_payload = common.BackendAcceptance.trip_payload
    create_trip = common.BackendAcceptance.create_trip
    get_trip = common.BackendAcceptance.get_trip
    error = common.BackendAcceptance.error

    @classmethod
    def setUpClass(cls):
        common.BackendAcceptance.setUpClass.__func__(cls)

    def setUp(self):
        self.client = common.Client()
        self.user = self.client.login()
        self.trip, _, _ = self.create_trip()

    def details(self, trip_id=None, client=None):
        client = client or self.client
        status, result, headers = client.request("GET", f"trips/{trip_id or self.trip['id']}/details")
        self.assertEqual(status, 200, result)
        self.assertEqual(headers.get("X-AgentTT-User-Id"), client.user_id)
        return result["data"]

    def item_payload(self, **overrides):
        payload = {"name": "鐵道散步", "date": "2099-01-02", "startTime": "09:00", "endTime": "10:00", "type": "attraction", "priority": "must", "note": "帶水"}
        payload.update(overrides)
        return payload

    def expense_payload(self, **overrides):
        payload = {"name": "午餐", "amount": 101, "category": "food", "date": "2099-01-02", "payerId": "u_guest_01", "participantIds": ["u_guest_01"], "note": "現金"}
        payload.update(overrides)
        return payload

    def mutation(self, method, suffix, payload, *, trip_id=None, version=None, client=None, key=None):
        client = client or self.client
        trip_id = trip_id or self.trip["id"]
        before = self.details(trip_id, client)
        body = dict(payload, version=before["trip"]["version"] if version is None else version)
        headers = {"Idempotency-Key": key or "phase2-" + uuid.uuid4().hex} if method == "POST" else None
        status, result, response_headers = client.request(method, f"trips/{trip_id}/{suffix}", body, headers=headers)
        self.assertEqual(status, 201 if method == "POST" else 200, result)
        self.assertEqual(response_headers.get("X-AgentTT-User-Id"), client.user_id)
        details = result["data"]
        self.assertEqual(details["trip"]["version"], body["version"] + 1)
        self.assertEqual(details["trip"]["id"], trip_id)
        return details, body, (headers or {}).get("Idempotency-Key")

    def add_item(self, payload=None, **kwargs):
        before = self.details(kwargs.get("trip_id"))["items"]
        details, body, key = self.mutation("POST", "items", payload or self.item_payload(), **kwargs)
        fresh = [item for item in details["items"] if item["id"] not in {item["id"] for item in before}]
        self.assertEqual(len(fresh), 1)
        return details, fresh[0], body, key

    def add_expense(self, payload=None, **kwargs):
        before = self.details(kwargs.get("trip_id"))["expenses"]
        details, body, key = self.mutation("POST", "expenses", payload or self.expense_payload(), **kwargs)
        fresh = [expense for expense in details["expenses"] if expense["id"] not in {expense["id"] for expense in before}]
        self.assertEqual(len(fresh), 1)
        return details, fresh[0], body, key

    def add_member(self, user_id="u_guest_02", trip_id=None):
        with sqlite3.connect(self.db_path) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("INSERT INTO trip_members(trip_id,user_id,role,joined_at) VALUES(?,?,?,?)", (trip_id or self.trip["id"], user_id, "member", "2099-01-01T00:00:00Z"))

    def test_empty_details_and_get_are_read_only(self):
        with sqlite3.connect(self.db_path) as db:
            before = db.execute("SELECT * FROM trips WHERE id=?", (self.trip["id"],)).fetchone()
        details = self.details()
        self.assertEqual(details["trip"]["version"], 1)
        self.assertEqual(details["items"], [])
        self.assertEqual(details["expenses"], [])
        self.assertEqual(details["summary"]["totalSpent"], 0)
        self.assertEqual(details["summary"]["remaining"], 3000)
        self.assertFalse(details["summary"]["overBudget"])
        with sqlite3.connect(self.db_path) as db:
            after = db.execute("SELECT * FROM trips WHERE id=?", (self.trip["id"],)).fetchone()
        self.assertEqual(before, after)

    def test_item_create_update_delete_roundtrip(self):
        details, item, _, _ = self.add_item()
        self.assertEqual(item["tripId"], self.trip["id"])
        self.assertEqual(item["position"], 0)
        for field, value in self.item_payload().items():
            self.assertEqual(item[field], value)
        details, _, _ = self.mutation("PATCH", "items/" + item["id"], {"name": "河岸散步", "startTime": "10:00", "endTime": "11:15", "priority": "optional", "note": "改帶雨傘"})
        self.assertEqual(details["items"][0]["name"], "河岸散步")
        self.assertEqual(details["items"][0]["priority"], "optional")
        details, _, _ = self.mutation("DELETE", "items/" + item["id"], {})
        self.assertEqual(details["items"], [])
        self.assertEqual(self.details(), details)

    def test_item_reorder_move_day_and_compact_positions(self):
        ids = [self.add_item(self.item_payload(name=f"景點 {index}"))[1]["id"] for index in range(3)]
        details, _, _ = self.mutation("PUT", "items/order", {"date": "2099-01-02", "itemIds": list(reversed(ids))})
        self.assertEqual([item["id"] for item in details["items"]], list(reversed(ids)))
        self.assertEqual([item["position"] for item in details["items"]], [0, 1, 2])
        details, _, _ = self.mutation("PATCH", "items/" + ids[1], {"date": "2099-01-03"})
        original = [item for item in details["items"] if item["date"] == "2099-01-02"]
        moved = [item for item in details["items"] if item["date"] == "2099-01-03"]
        self.assertEqual([item["id"] for item in original], [ids[2], ids[0]])
        self.assertEqual([item["position"] for item in original], [0, 1])
        self.assertEqual(moved[0]["id"], ids[1])
        self.assertEqual(moved[0]["position"], 0)
        details, _, _ = self.mutation("DELETE", "items/" + ids[2], {})
        remaining = [item for item in details["items"] if item["date"] == "2099-01-02"]
        self.assertEqual([(item["id"], item["position"]) for item in remaining], [(ids[0], 0)])

    def test_invalid_item_fields_are_atomic(self):
        before = self.details()
        invalids = [{"name": " "}, {"date": "2099-01-01"}, {"date": "2099-02-30"}, {"startTime": "9:00"}, {"startTime": "24:00"}, {"endTime": "09:00"}, {"type": "invalid"}, {"priority": "invalid"}, {"note": []}, {"tripId": "another_trip"}, {"version": 0}]
        for invalid in invalids:
            with self.subTest(invalid=invalid):
                body = dict(self.item_payload(), version=1, **{key: value for key, value in invalid.items() if key != "version"})
                body["version"] = invalid.get("version", 1)
                self.error(self.client.request("POST", f"trips/{self.trip['id']}/items", body, headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        self.assertEqual(self.details(), before)

    def test_reorder_requires_complete_same_day_unique_ids(self):
        _, first, _, _ = self.add_item()
        _, second, _, _ = self.add_item(self.item_payload(name="第二項"))
        before = self.details()
        for item_ids in ([], [first["id"]], [first["id"], first["id"]], [first["id"], "foreign_item"]):
            with self.subTest(ids=item_ids):
                self.error(self.client.request("PUT", f"trips/{self.trip['id']}/items/order", {"version": before["trip"]["version"], "date": "2099-01-02", "itemIds": item_ids}), 422)
        self.assertEqual(self.details(), before)

    def test_all_detail_mutations_require_csrf(self):
        _, item, _, _ = self.add_item()
        _, expense, _, _ = self.add_expense()
        before = self.details()
        version = before["trip"]["version"]
        other = common.Client()
        other.login("other@test.com")
        cases = [("POST", "items", self.item_payload()), ("PATCH", "items/" + item["id"], {"name": "禁止"}), ("DELETE", "items/" + item["id"], {}), ("PUT", "items/order", {"date": "2099-01-02", "itemIds": [item["id"]]}), ("POST", "expenses", self.expense_payload()), ("PATCH", "expenses/" + expense["id"], {"amount": 999}), ("DELETE", "expenses/" + expense["id"], {})]
        for method, suffix, payload in cases:
            with self.subTest(method=method, suffix=suffix):
                body = dict(payload, version=version)
                headers = {"Idempotency-Key": "csrf-" + uuid.uuid4().hex}
                self.error(self.client.request(method, f"trips/{self.trip['id']}/{suffix}", body, csrf=False, headers=headers), 403)
                headers["X-CSRF-Token"] = other.csrf
                self.error(self.client.request(method, f"trips/{self.trip['id']}/{suffix}", body, headers=headers), 403)
        self.assertEqual(self.details(), before)

    def test_unauthenticated_and_nonmember_cannot_read_or_write(self):
        anonymous = common.Client()
        self.error(anonymous.request("GET", f"trips/{self.trip['id']}/details"), 401)
        other = common.Client()
        other.login("other@test.com")
        self.error(other.request("GET", f"trips/{self.trip['id']}/details"), 404)
        self.error(other.request("POST", f"trips/{self.trip['id']}/items", dict(self.item_payload(), version=1), headers={"Idempotency-Key": "denied-" + uuid.uuid4().hex}), 404)
        self.error(other.request("POST", f"trips/{self.trip['id']}/expenses", dict(self.expense_payload(), version=1), headers={"Idempotency-Key": "denied-" + uuid.uuid4().hex}), 404)

    def test_member_reads_but_every_mutation_is_forbidden(self):
        self.add_member()
        _, item, _, _ = self.add_item()
        _, expense, _, _ = self.add_expense()
        before = self.details()
        other = common.Client()
        other.login("other@test.com")
        readable = self.details(client=other)
        self.assertFalse(readable["trip"]["canEdit"])
        self.assertEqual(readable["items"], before["items"])
        cases = [("POST", "items", self.item_payload()), ("PATCH", "items/" + item["id"], {"name": "禁止"}), ("DELETE", "items/" + item["id"], {}), ("PUT", "items/order", {"date": "2099-01-02", "itemIds": [item["id"]]}), ("POST", "expenses", self.expense_payload()), ("PATCH", "expenses/" + expense["id"], {"amount": 999}), ("DELETE", "expenses/" + expense["id"], {})]
        for method, suffix, payload in cases:
            with self.subTest(method=method, suffix=suffix):
                self.error(other.request(method, f"trips/{self.trip['id']}/{suffix}", dict(payload, version=before["trip"]["version"]), headers={"Idempotency-Key": "member-" + uuid.uuid4().hex}), 403)
        self.assertEqual(self.details(), before)

    def test_child_ids_cannot_be_used_under_another_trip(self):
        _, item, _, _ = self.add_item()
        _, expense, _, _ = self.add_expense()
        separate, _, _ = self.create_trip()
        for method, suffix, payload in (("PATCH", "items/" + item["id"], {"name": "wrong trip"}), ("DELETE", "items/" + item["id"], {}), ("PATCH", "expenses/" + expense["id"], {"amount": 500}), ("DELETE", "expenses/" + expense["id"], {})):
            with self.subTest(method=method, suffix=suffix):
                self.error(self.client.request(method, f"trips/{separate['id']}/{suffix}", dict(payload, version=1)), 404)
        self.assertEqual(self.details(separate["id"])["trip"]["version"], 1)
        self.assertEqual(len(self.details()["items"]), 1)
        self.assertEqual(len(self.details()["expenses"]), 1)

    def test_non_guest_owner_cannot_mutate(self):
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE trips SET owner_id='u_host_01' WHERE id=?", (self.trip["id"],))
            db.execute("INSERT INTO trip_members(trip_id,user_id,role,joined_at) VALUES(?,'u_host_01','owner','2099-01-01')", (self.trip["id"],))
        host = common.Client()
        host.login("host@test.com")
        self.assertFalse(self.details(client=host)["trip"]["canEdit"])
        self.error(host.request("POST", f"trips/{self.trip['id']}/items", dict(self.item_payload(), version=1), headers={"Idempotency-Key": "host-" + uuid.uuid4().hex}), 403)

    def test_item_idempotency_replays_old_version_without_duplicates(self):
        details, item, body, key = self.add_item()
        self.mutation("PATCH", "items/" + item["id"], {"note": "later mutation"})
        status, replay, _ = self.client.request("POST", f"trips/{self.trip['id']}/items", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, replay)
        self.assertEqual(replay["data"], details)
        body["name"] = "different payload"
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/items", body, headers={"Idempotency-Key": key}), 409)
        self.assertEqual(len(self.details()["items"]), 1)
        self.assertEqual(self.details()["trip"]["version"], 3)

    def test_expense_idempotency_and_operation_scope(self):
        details, _, body, key = self.add_expense()
        status, replay, _ = self.client.request("POST", f"trips/{self.trip['id']}/expenses", body, headers={"Idempotency-Key": key})
        self.assertEqual(status, 201, replay)
        self.assertEqual(replay["data"], details)
        self.add_item(key=key)
        separate, _, _ = self.create_trip()
        self.add_expense(trip_id=separate["id"], key=key)
        self.assertEqual(len(self.details()["expenses"]), 1)
        body["amount"] = 102
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/expenses", body, headers={"Idempotency-Key": key}), 409)

    def test_global_version_protects_cross_component_edits(self):
        self.add_item()
        self.error(self.client.request("POST", f"trips/{self.trip['id']}/expenses", dict(self.expense_payload(), version=1), headers={"Idempotency-Key": "stale-" + uuid.uuid4().hex}), 409)
        status, data, _ = self.client.request("PATCH", f"trips/{self.trip['id']}", {"version": 2, "budget": 1234})
        self.assertEqual(status, 200, data)
        item = self.details()["items"][0]
        self.error(self.client.request("PATCH", f"trips/{self.trip['id']}/items/{item['id']}", {"version": 2, "name": "stale"}), 409)
        self.assertEqual(self.details()["trip"]["version"], 3)
        self.assertEqual(self.details()["summary"]["budget"], 1234)

    def test_expense_create_update_delete_recalculates_summary(self):
        details, expense, _, _ = self.add_expense()
        self.assertEqual(expense["tripId"], self.trip["id"])
        self.assertEqual(details["summary"]["totalSpent"], 101)
        details, _, _ = self.mutation("PATCH", "expenses/" + expense["id"], {"name": "晚餐", "amount": 250, "category": "other", "note": "已改"})
        self.assertEqual(details["summary"]["totalSpent"], 250)
        self.assertEqual(details["summary"]["remaining"], 2750)
        details, _, _ = self.mutation("DELETE", "expenses/" + expense["id"], {})
        self.assertEqual(details["expenses"], [])
        self.assertEqual(details["summary"]["totalSpent"], 0)
        self.assertEqual(self.details(), details)

    def test_invalid_expense_fields_are_atomic(self):
        before = self.details()
        invalids = [{"name": ""}, {"amount": 0}, {"amount": -1}, {"amount": 1.5}, {"amount": "100"}, {"amount": None}, {"amount": 1000000001}, {"category": "invalid"}, {"date": "2099-01-05"}, {"payerId": "u_guest_02"}, {"participantIds": []}, {"participantIds": ["u_guest_02"]}, {"participantIds": "u_guest_01"}, {"note": {}}, {"tripId": "another_trip"}]
        for invalid in invalids:
            with self.subTest(invalid=invalid):
                self.error(self.client.request("POST", f"trips/{self.trip['id']}/expenses", dict(self.expense_payload(**invalid), version=1), headers={"Idempotency-Key": "invalid-" + uuid.uuid4().hex}), 422)
        self.assertEqual(self.details(), before)

    def test_expense_partial_patch_replaces_participants_and_payer(self):
        self.add_member()
        _, expense, _, _ = self.add_expense()
        details, _, _ = self.mutation("PATCH", "expenses/" + expense["id"], {"payerId": "u_guest_02", "participantIds": ["u_guest_02", "u_guest_01", "u_guest_02"], "date": "2099-01-03"})
        self.assertEqual(details["expenses"][0]["participantIds"], ["u_guest_01", "u_guest_02"])
        self.assertEqual(details["expenses"][0]["payerId"], "u_guest_02")
        self.assertEqual(details["expenses"][0]["date"], "2099-01-03")
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM expense_participants WHERE expense_id=?", (expense["id"],)).fetchone()[0], 2)

    def test_three_way_integer_remainder_and_settlements_balance(self):
        self.add_member()
        self.add_member("u_admin_01")
        details, _, _, _ = self.add_expense(self.expense_payload(amount=100, participantIds=["u_guest_02", "u_guest_01", "u_admin_01"]))
        summary = details["summary"]
        balances = {row["userId"]: row for row in summary["balances"]}
        self.assertEqual({user: row["share"] for user, row in balances.items()}, {"u_admin_01": 34, "u_guest_01": 33, "u_guest_02": 33})
        self.assertEqual(sum(row["paid"] for row in balances.values()), 100)
        self.assertEqual(sum(row["share"] for row in balances.values()), 100)
        self.assertEqual(sum(row["balance"] for row in balances.values()), 0)
        remaining = {user: row["balance"] for user, row in balances.items()}
        for payment in summary["settlements"]:
            self.assertIsInstance(payment["amount"], int)
            self.assertGreater(payment["amount"], 0)
            remaining[payment["fromUserId"]] += payment["amount"]
            remaining[payment["toUserId"]] -= payment["amount"]
        self.assertEqual(set(remaining.values()), {0})
        self.assertEqual(self.details()["summary"], summary)

    def test_mixed_expenses_over_budget_and_exact_settlement(self):
        self.add_member()
        status, data, _ = self.client.request("PATCH", f"trips/{self.trip['id']}", {"version": 1, "budget": 150})
        self.assertEqual(status, 200, data)
        self.add_expense(self.expense_payload(participantIds=["u_guest_01", "u_guest_02"]))
        details, _, _, _ = self.add_expense(self.expense_payload(name="車票", amount=99, category="transport", payerId="u_guest_02", participantIds=["u_guest_01"]))
        summary = details["summary"]
        self.assertEqual(summary["totalSpent"], 200)
        self.assertEqual(summary["budget"], 150)
        self.assertEqual(summary["remaining"], -50)
        self.assertTrue(summary["overBudget"])
        categories = {row["category"]: row["amount"] for row in summary["byCategory"]}
        self.assertEqual(categories["food"], 101)
        self.assertEqual(categories["transport"], 99)
        balances = {row["userId"]: row for row in summary["balances"]}
        self.assertEqual(balances["u_guest_01"]["balance"], -49)
        self.assertEqual(balances["u_guest_02"]["balance"], 49)
        self.assertEqual(summary["settlements"], [{"fromUserId": "u_guest_01", "toUserId": "u_guest_02", "amount": 49}])

    def test_deleting_trip_cascades_children_and_participants(self):
        self.add_member()
        self.add_item()
        self.add_expense(self.expense_payload(participantIds=["u_guest_01", "u_guest_02"]))
        version = self.details()["trip"]["version"]
        status, result, _ = self.client.request("DELETE", f"trips/{self.trip['id']}", {"version": version})
        self.assertEqual(status, 204, result)
        with sqlite3.connect(self.db_path) as db:
            for table in ("trip_items", "trip_expenses", "expense_participants", "trip_members"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table} WHERE trip_id=?", (self.trip["id"],)).fetchone()[0], 0, table)

    def test_date_shortening_cannot_orphan_items_or_expenses(self):
        _, item, _, _ = self.add_item(self.item_payload(date="2099-01-04"))
        _, expense, _, _ = self.add_expense(self.expense_payload(date="2099-01-04"))
        before = self.details()
        self.error(self.client.request("PATCH", f"trips/{self.trip['id']}", {"version": before["trip"]["version"], "endDate": "2099-01-03"}), 422)
        self.assertEqual(self.details(), before)
        self.mutation("DELETE", "items/" + item["id"], {})
        version = self.details()["trip"]["version"]
        self.error(self.client.request("PATCH", f"trips/{self.trip['id']}", {"version": version, "endDate": "2099-01-03"}), 422)
        self.mutation("DELETE", "expenses/" + expense["id"], {})
        version = self.details()["trip"]["version"]
        status, result, _ = self.client.request("PATCH", f"trips/{self.trip['id']}", {"version": version, "endDate": "2099-01-03"})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["data"]["endDate"], "2099-01-03")

    def test_optional_defaults_and_all_supported_types(self):
        for kind in ("attraction", "restaurant", "activity", "hotel", "train"):
            payload = self.item_payload(type=kind)
            payload.pop("note")
            payload.pop("priority")
            _, item, _, _ = self.add_item(payload)
            self.assertEqual(item["note"], "")
            self.assertEqual(item["priority"], "must")
        for category in ("transport", "accommodation", "food", "activity", "other"):
            self.add_expense(self.expense_payload(category=category, amount=1))
        self.assertEqual(self.details()["summary"]["totalSpent"], 5)

    def test_html_and_sql_characters_remain_plain_saved_data(self):
        name = "<img src=x onerror=alert(1)> '; DELETE FROM users; --"
        _, item, _, _ = self.add_item(self.item_payload(name=name, note="<script>alert(1)</script>"))
        _, expense, _, _ = self.add_expense(self.expense_payload(name=name))
        self.assertEqual(item["name"], name)
        self.assertEqual(expense["name"], name)
        self.assertEqual(common.Client().login()["id"], "u_guest_01")

    def test_two_clients_using_same_version_only_one_can_commit(self):
        clients = [common.Client(), common.Client()]
        for client in clients:
            client.login()
        def create_item(index):
            return clients[index].request("POST", f"trips/{self.trip['id']}/items", dict(self.item_payload(name=f"writer {index}"), version=1), headers={"Idempotency-Key": "writer-" + uuid.uuid4().hex})
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create_item, range(2)))
        self.assertEqual(sorted(result[0] for result in results), [201, 409])
        self.assertEqual(self.details()["trip"]["version"], 2)
        self.assertEqual(len(self.details()["items"]), 1)

    def test_simultaneous_same_request_key_has_one_effect(self):
        clients = [common.Client(), common.Client()]
        for client in clients:
            client.login()
        key = "simultaneous-" + uuid.uuid4().hex
        body = dict(self.expense_payload(), version=1)
        def create_expense(client):
            return client.request("POST", f"trips/{self.trip['id']}/expenses", body, headers={"Idempotency-Key": key})
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create_expense, clients))
        self.assertEqual([result[0] for result in results], [201, 201])
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(self.details()["trip"]["version"], 2)
        self.assertEqual(len(self.details()["expenses"]), 1)


def create_browser_fixture():
    test = PhaseTwoAcceptance()
    PhaseTwoAcceptance.setUpClass()
    test.setUp()
    test.add_member()
    status, result, _ = test.client.request("PATCH", f"trips/{test.trip['id']}", {"version": 1, "budget": 1000})
    test.assertEqual(status, 200, result)
    test.add_item(test.item_payload(name="唯讀成員行程項目"))
    return {"memberTripId": test.trip["id"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("AGENTTT_BASE_URL", "http://127.0.0.1:8090"))
    parser.add_argument("--data-dir", default=os.environ.get("AGENTTT_DATA_DIR"), required=not bool(os.environ.get("AGENTTT_DATA_DIR")))
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    parser.add_argument("--create-browser-fixture", action="store_true")
    config, remaining = parser.parse_known_args()
    common.CONFIG = config
    if config.create_browser_fixture:
        print(json.dumps(create_browser_fixture()))
    else:
        unittest.main(argv=[__file__, *remaining], verbosity=2)
