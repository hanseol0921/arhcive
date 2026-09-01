# -*- coding: utf-8 -*-
"""Compare every saved PDF body with the live Weverse DOM and rebuild differences."""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright
from pypdf import PdfReader

from weverse_archive import (
    BASE_DIR, SESSION_FILE, build_yt_dlp_cookiefile, fetch_audit_raws,
    load_config, process_posts,
)

RESULT_FILE = BASE_DIR / "paragraph_audit_v34.json"


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def _load_raw_urls() -> dict[str, str]:
    result: dict[str, str] = {}
    raw_dir = BASE_DIR / "raw_responses"
    for path in raw_dir.glob("*.json") if raw_dir.exists() else []:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        rows = data if isinstance(data, list) else data.get("data", []) if isinstance(data, dict) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("postId") or row.get("id") or row.get("postID") or "")
            url = str(row.get("shareUrl") or row.get("url") or "")
            if pid and url:
                result[pid] = url
    return result


def _pdf_entries(output_dir: Path) -> list[dict]:
    raw_urls = _load_raw_urls()
    entries = []
    for pdf in sorted(output_dir.rglob("*.pdf")) if output_dir.exists() else []:
        try:
            md = PdfReader(str(pdf)).metadata or {}
        except Exception:
            continue
        pid = str(md.get("/WeversePostID") or "").strip()
        if not pid:
            continue
        source = str(md.get("/WeverseBodyText") or "")
        url = str(md.get("/WeversePostURL") or raw_urls.get(pid) or "")
        if not url and not pid.startswith("0-"):
            url = f"https://weverse.io/boynextdoor/artist/{pid}?hl=ko"
        entries.append({"post_id": pid, "pdf": str(pdf), "pdf_body": source, "url": url})
    return entries


async def _extract(page, entry: dict) -> dict:
    pid, url, source = entry["post_id"], entry["url"], entry["pdf_body"]
    if not url:
        return {**entry, "status": "no_url"}
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_selector(".WeverseViewer", timeout=10000)
        result = await page.evaluate("""({source}) => {
          const compact=s=>(s||'').replace(/\\s+/g,'');
          const target=compact(source);
          const candidates=[...document.querySelectorAll('.WeverseViewer p')]
            .map(p=>(p.innerText||'').trim())
            .filter(Boolean)
            .filter(t=>!target || compact(t)===target || compact(t).includes(target) || target.includes(compact(t)))
            .sort((a,b)=>Math.abs(compact(a).length-target.length)-Math.abs(compact(b).length-target.length));
          return candidates[0] || '';
        }""", {"source": source})
        live = str(result or "").strip()
        if not live:
            return {**entry, "status": "body_not_found"}
        if _compact(live) != _compact(source):
            return {**entry, "status": "content_mismatch", "live_body": live}
        return {**entry, "status": "different" if live != source else "same", "live_body": live}
    except Exception as exc:
        return {**entry, "status": "error", "error": f"{type(exc).__name__}: {str(exc).splitlines()[0][:180]}"}


async def audit(output_dir: Path, concurrency: int = 6) -> dict:
    entries = _pdf_entries(output_dir)
    prior = {}
    if RESULT_FILE.exists():
        try:
            old = json.loads(RESULT_FILE.read_text(encoding="utf-8"))
            prior = {x["post_id"]: x for x in old.get("results", []) if x.get("status") in {"same", "different"}}
        except Exception:
            prior = {}
    pending = [x for x in entries if x["post_id"] not in prior]
    print(f"[v34 전체 문단 비교] 전체 {len(entries)}개 / 이어서 확인 {len(pending)}개", flush=True)
    results = dict(prior)
    queue: asyncio.Queue = asyncio.Queue()
    for item in pending:
        queue.put_nowait(item)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        kwargs = {"storage_state": str(SESSION_FILE)} if SESSION_FILE.exists() else {}
        context = await browser.new_context(**kwargs)

        async def worker() -> None:
            page = await context.new_page()
            while not queue.empty():
                try:
                    item = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                row = await _extract(page, item)
                results[item["post_id"]] = row
                done = len(results)
                if done % 10 == 0 or row["status"] not in {"same", "different"}:
                    payload = {"version": 34, "results": list(results.values())}
                    RESULT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(f"[v34 문단 비교] {done}/{len(entries)} | {item['post_id']} | {row['status']}", flush=True)
                queue.task_done()
            await page.close()

        await asyncio.gather(*(worker() for _ in range(max(1, concurrency))))
        await context.storage_state(path=str(SESSION_FILE))
        await browser.close()

    payload = {"version": 34, "results": list(results.values())}
    RESULT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


async def rebuild(payload: dict, output_dir: Path) -> None:
    changed = {x["post_id"]: x["live_body"] for x in payload["results"] if x.get("status") == "different"}
    print(f"[v34 PDF 재생성 대상] 실제 문단이 다른 {len(changed)}개", flush=True)
    if not changed:
        return
    raws, failed = fetch_audit_raws(list(changed))
    for raw in raws:
        pid = str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
        if pid in changed:
            raw["_renderedBody"] = changed[pid]
            raw["_renderedBodyVerified"] = True
            raw["_renderedBodySource"] = "v34_live_dom"
    cookiefile = build_yt_dlp_cookiefile(SESSION_FILE, BASE_DIR / "yt_dlp_cookies.txt")
    config = load_config()
    await process_posts(
        raws, output_dir,
        target_author_name=config.get("target_author_name", ""),
        cookiefile=cookiefile,
        force_rebuild_ids=set(changed),
    )
    if failed:
        print("[v34 API 조회 실패] " + ", ".join(failed), flush=True)


async def main() -> None:
    config = load_config()
    output_dir = BASE_DIR / config.get("output_dir", "output")
    payload = await audit(output_dir)
    await rebuild(payload, output_dir)


if __name__ == "__main__":
    asyncio.run(main())
