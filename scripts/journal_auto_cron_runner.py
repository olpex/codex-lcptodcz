import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from urllib import error, parse, request


DEFAULT_BASE_URL = "https://codex-lcptodcz.vercel.app"
DEFAULT_INTERVAL_SECONDS = 30
DEFAULT_TIMEOUT_SECONDS = 240
MAX_LIMIT = 20

_stop_requested = False


def _handle_stop(_signum, _frame):
    global _stop_requested
    _stop_requested = True


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def _build_url(base_url: str, workload_limit: int, trainees_limit: int) -> str:
    query = parse.urlencode(
        {
            "workload_limit": workload_limit,
            "trainees_limit": trainees_limit,
        }
    )
    return f"{_normalize_base_url(base_url)}/api/api/v1/journal-monitors/auto-cron?{query}"


def _invoke(url: str, cron_secret: str, timeout_seconds: int) -> tuple[int, str]:
    req = request.Request(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {cron_secret}",
            "Content-Type": "application/json",
        },
    )
    with request.urlopen(req, timeout=timeout_seconds) as response:
        body = response.read().decode("utf-8", errors="replace").strip()
        return response.status, body


def _print_result(prefix: str, message: str) -> None:
    print(f"[{_utc_timestamp()}] {prefix}: {message}", flush=True)


def _run_once(url: str, cron_secret: str, timeout_seconds: int) -> bool:
    try:
        status_code, body = _invoke(url, cron_secret, timeout_seconds)
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            _print_result("warn", f"HTTP {status_code}, non-JSON response: {body}")
            return status_code < 400

        _print_result(
            "ok",
            (
                f"HTTP {status_code}, processed_sections={payload.get('processed_sections')}, "
                f"failed_sections={payload.get('failed_sections')}, "
                f"drive_intake_processed={payload.get('drive_intake_processed')}, "
                f"drive_intake_failed={payload.get('drive_intake_failed')}"
            ),
        )
        return status_code < 400
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        _print_result("error", f"HTTP {exc.code}: {body}")
        return False
    except Exception as exc:
        _print_result("error", str(exc))
        return False


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call the journal auto-cron endpoint on a fixed interval.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("APP_BASE_URL", DEFAULT_BASE_URL),
        help="Base application URL. Defaults to APP_BASE_URL or the production Vercel URL.",
    )
    parser.add_argument(
        "--cron-secret",
        default=os.environ.get("CRON_SECRET", ""),
        help="CRON_SECRET for the protected auto-cron endpoint. Defaults to CRON_SECRET env var.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.environ.get("JOURNAL_AUTO_CRON_INTERVAL", DEFAULT_INTERVAL_SECONDS)),
        help="Delay between successful or failed attempts, in seconds.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(os.environ.get("JOURNAL_AUTO_CRON_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)),
        help="HTTP timeout for each request, in seconds.",
    )
    parser.add_argument(
        "--workload-limit",
        type=int,
        default=int(os.environ.get("JOURNAL_AUTO_CRON_WORKLOAD_LIMIT", 1)),
        help="How many workload entries to process per call.",
    )
    parser.add_argument(
        "--trainees-limit",
        type=int,
        default=int(os.environ.get("JOURNAL_AUTO_CRON_TRAINEES_LIMIT", 1)),
        help="How many trainee entries to process per call.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single POST request and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not args.cron_secret:
        print("CRON_SECRET is required.", file=sys.stderr)
        return 1
    if args.interval < 1:
        print("--interval must be >= 1", file=sys.stderr)
        return 1
    if not 1 <= args.workload_limit <= MAX_LIMIT:
        print(f"--workload-limit must be between 1 and {MAX_LIMIT}", file=sys.stderr)
        return 1
    if not 1 <= args.trainees_limit <= MAX_LIMIT:
        print(f"--trainees-limit must be between 1 and {MAX_LIMIT}", file=sys.stderr)
        return 1

    signal.signal(signal.SIGINT, _handle_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_stop)

    url = _build_url(args.base_url, args.workload_limit, args.trainees_limit)
    _print_result(
        "start",
        (
            f"Polling {url} every {args.interval}s "
            f"(workload_limit={args.workload_limit}, trainees_limit={args.trainees_limit})"
        ),
    )

    while not _stop_requested:
        _run_once(url, args.cron_secret, args.timeout)
        if args.once:
            return 0
        deadline = time.monotonic() + args.interval
        while not _stop_requested and time.monotonic() < deadline:
            time.sleep(min(1, deadline - time.monotonic()))

    _print_result("stop", "Shutdown requested")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
