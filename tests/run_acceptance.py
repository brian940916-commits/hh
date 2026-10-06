#!/usr/bin/env python3
"""Initialize temporary SQLite, test real PHP HTTP/browser flows, then clean up."""

import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def stop(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def wait_ready(process, base):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("PHP server exited before the health check passed")
        try:
            with urllib.request.urlopen(base + "/api/index.php?path=%2Fhealth", timeout=1) as response:
                if response.status == 200 and "data" in json.load(response):
                    return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    raise RuntimeError("PHP health endpoint did not become available")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--php", default=os.environ.get("PHP_BIN", "php"))
    parser.add_argument("--http-only", action="store_true", help="Run HTTP tests only; browser tests are not counted as passed")
    parser.add_argument("--playwright-module", default=os.environ.get("PLAYWRIGHT_MODULE"))
    parser.add_argument("--chromium", default=os.environ.get("CHROMIUM_EXECUTABLE"))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="agenttt-acceptance-") as temp:
        data_dir = Path(temp) / "data"
        env = dict(os.environ, AGENTTT_DATA_DIR=str(data_dir))
        if args.playwright_module:
            env["PLAYWRIGHT_MODULE"] = args.playwright_module
        if args.chromium:
            env["CHROMIUM_EXECUTABLE"] = args.chromium
        subprocess.run([args.php, str(ROOT / "scripts/init-db.php")], env=env, check=True)
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env["AGENTTT_BASE_URL"] = base
        command = [args.php, "-S", f"127.0.0.1:{port}", "-t", str(ROOT / "public"), str(ROOT / "public/router.php")]
        process = None
        log_path = Path(temp) / "php-server.log"
        try:
            with log_path.open("w", encoding="utf-8") as log:
                process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, base)
                subprocess.run([sys.executable, str(ROOT / "tests/backend_http.py"), "--base-url", base, "--data-dir", str(data_dir), "--php", args.php], env=env, check=True)
                databases = list(data_dir.glob("*.sqlite")) + list(data_dir.glob("*.sqlite3")) + list(data_dir.glob("*.db"))
                if len(databases) != 1:
                    raise RuntimeError("Expected a single acceptance SQLite database")
                with sqlite3.connect(databases[0]) as db:
                    before = db.execute("SELECT * FROM trips ORDER BY id").fetchall()
                stop(process)
                process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
                wait_ready(process, base)
                with sqlite3.connect(databases[0]) as db:
                    after = db.execute("SELECT * FROM trips ORDER BY id").fetchall()
                if before != after:
                    raise AssertionError("Server restart changed or lost stored trips")
                print("PASS: persisted SQLite trips survive a real PHP server restart", flush=True)
                if args.http_only:
                    print("Browser tests not requested (--http-only).", flush=True)
                else:
                    subprocess.run(["node", str(ROOT / "tests/browser_acceptance.cjs")], cwd=ROOT, env=env, check=True)
        except Exception:
            stop(process)
            print("PHP server log:", file=sys.stderr)
            print("\n".join(log_path.read_text(encoding="utf-8").splitlines()[-100:]) if log_path.exists() else "No server log was created", file=sys.stderr)
            raise
        finally:
            stop(process)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, AssertionError, subprocess.CalledProcessError) as error:
        print(f"Acceptance failed: {error}", file=sys.stderr)
        sys.exit(1)
