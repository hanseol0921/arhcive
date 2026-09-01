# -*- coding: utf-8 -*-
"""
weverse_archive.py
--------------------
[사용법]
1. 먼저 weverse_login.py를 실행해서 로그인 세션을 만들어두세요.
2. config.example.json을 config.json으로 복사하고 값을 채워넣으세요.
3. python weverse_archive.py 실행
4. 자동으로 브라우저가 뜨면, 직접 위버스 안에서
   원하는 그룹 > 원하는 멤버의 게시글 탭으로 이동하세요.
5. 멤버 게시글 탭이 보이면 터미널에서 Enter를 누르세요.
6. 첫 실행 이후에는 스크립트가 자동 스크롤하며 새 글만 찾고, 기존 저장 구간에서 멈춥니다.
7. 이전 실패 글은 post_id로 직접 재시도하므로 과거 글까지 다시 스크롤할 필요가 없습니다.

결과물은 output/게시날짜/ 폴더 아래에 정리됩니다.
"""
from __future__ import annotations

import asyncio
import http.cookiejar
import base64
import hashlib
import shutil
import hmac
import time
import urllib.parse
import json
import re
import sys
import traceback
import html as html_lib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime

import requests
from playwright.async_api import async_playwright

from weverse_parse import find_post_list_candidates, parse_post, Post
from pdf_builder import build_post_pdf, repair_pdf_unicode_file

# Windows 콘솔에서 한글/특수문자 출력 시 깨지거나 죽는 것을 방지
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = Path(__file__).parent
SESSION_FILE = BASE_DIR / "weverse_session.json"
CONFIG_FILE = BASE_DIR / "config.json"
RAW_DIR = BASE_DIR / "raw_responses"
SAVED_POSTS_FILE = BASE_DIR / "saved_posts.json"
SCAN_STATE_FILE = BASE_DIR / "scan_state.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        print(f"config.json이 없습니다. config.example.json을 복사해서 config.json으로 만들어주세요.")
        raise SystemExit(1)
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))

def _normalize_visible_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _fmt_seconds(sec: float) -> str:
    sec = max(0, int(sec or 0))
    h, rem = divmod(sec, 3600)
    m, ss = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{ss:02d}" if h else f"{m:02d}:{ss:02d}"


def _progress(stage: str, done: int, total: int, started: float, *, ok: int = 0, failed: int = 0,
              current: str = "", force_newline: bool = False) -> None:
    total = max(total, 1)
    pct = min(100.0, done * 100.0 / total)
    width = 24
    fill = min(width, int(width * done / total))
    bar = "█" * fill + "░" * (width - fill)
    elapsed = max(0.0, time.monotonic() - started)
    eta = (elapsed / done * (total - done)) if done else 0.0
    tail = f" 성공 {ok} / 실패 {failed}"
    if current:
        tail += f" | {current}"
    line = f"[{stage}] [{bar}] {done}/{total} ({pct:5.1f}%) | 경과 {_fmt_seconds(elapsed)} | 남음 {_fmt_seconds(eta)} |{tail}"
    # 같은 줄 갱신. 예외/상세 로그가 출력될 때만 줄바꿈됩니다.
    print("\r" + line[:220].ljust(220), end="\n" if force_newline or done >= total else "", flush=True)


def _strip_unicode_emoji_for_compare(text: str) -> str:
    # Python stdlib만으로 자주 쓰는 emoji/variation selector/ZWJ를 비교에서 제거합니다.
    out = []
    for ch in text or "":
        cp = ord(ch)
        if (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF or
            cp in (0xFE0F, 0x200D, 0x20E3) or 0x1F1E6 <= cp <= 0x1F1FF):
            continue
        out.append(ch)
    return _normalize_visible_text("".join(out))

def _is_generic_weverse_title(text: str) -> bool:
    t = _normalize_visible_text(text or "").strip().lower()
    if not t:
        return False
    return t in {"global fandom platform - weverse", "global fandom platform weverse", "weverse"} or ("global fandom platform" in t and "weverse" in t)


def _contains_unicode_emoji(text: str) -> bool:
    for ch in text or "":
        cp = ord(ch)
        if (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF or cp in (0xFE0F, 0x200D, 0x20E3) or 0x1F1E6 <= cp <= 0x1F1FF):
            return True
    return False


def _extract_og_body_from_html(html_text: str, base_text: str, author: str = "") -> str:
    """브라우저를 띄우지 않고 SSR/OG 메타에서 화면 본문을 얻습니다.
    Weverse가 메타에 본문을 제공하는 글만 빠르게 확정하고, 애매한 글은 브라우저 단계로 넘깁니다.
    """
    if not html_text:
        return ""
    patterns = [
        r'<meta[^>]+property=["\\\']og:title["\\\'][^>]+content=["\\\'](.*?)["\\\'][^>]*>',
        r'<meta[^>]+content=["\\\'](.*?)["\\\'][^>]+property=["\\\']og:title["\\\'][^>]*>',
        r'<meta[^>]+name=["\\\']twitter:title["\\\'][^>]+content=["\\\'](.*?)["\\\'][^>]*>',
    ]
    candidates=[]
    for pat in patterns:
        m=re.search(pat, html_text, re.I|re.S)
        if m:
            candidates.append(html_lib.unescape(m.group(1)).strip())
    for text in candidates:
        if "커뮤니티 포스트 - " in text:
            text = text.split("커뮤니티 포스트 - ", 1)[1]
        if author and text.endswith(" - " + author):
            text = text[:-(len(author)+3)]
        base_cmp = _strip_unicode_emoji_for_compare(base_text).replace(" ", "")
        text_cmp = _strip_unicode_emoji_for_compare(text).replace(" ", "")
        # 메타가 실제 본문을 포함한다고 확신할 수 있을 때만 채택.
        if not base_cmp:
            continue
        anchor = base_cmp[:min(24, len(base_cmp))]
        if len(anchor) >= 8 and anchor in text_cmp and len(text_cmp) <= max(len(base_cmp)*3+120, 500):
            return text.strip()
    return ""


def _fast_probe_one_rendered(raw: dict, cookie_map: dict[str, str]) -> tuple[str, str, str]:
    pid = str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
    url = str(raw.get("shareUrl") or raw.get("url") or "")
    base = str(raw.get("plainBody") or raw.get("body") or "")
    a = raw.get("author")
    author = str((a or {}).get("profileName") or (a or {}).get("nickname") or (a or {}).get("name") or "") if isinstance(a, dict) else ""
    if not url:
        return pid, "", "no_url"
    try:
        r = requests.get(url, headers=HEADERS, cookies=cookie_map, timeout=8, allow_redirects=True)
        if r.status_code >= 400 or "chrome-error" in r.url:
            return pid, "", f"http_{r.status_code}"
        text = _extract_og_body_from_html(r.text, base, author)
        return pid, text, "og" if text else "uncertain"
    except Exception as e:
        return pid, "", type(e).__name__



async def enrich_rendered_body_texts(raw_posts: list[dict], *, browser_only: bool = False, selective_browser: bool = False) -> list[dict]:
    """실제 Weverse 화면 본문을 확보합니다.

    한 줄 글은 API 원문을 그대로 사용합니다. 줄바꿈이 있는 글만 실제
    Weverse DOM을 열어 일반 개행, <br>, 빈 문단 블록을 구분합니다.
    이모티콘/첨부 미디어 판별은 이 함수에서 변경하지 않습니다.
    """
    if not raw_posts:
        return raw_posts

    pending=[r for r in raw_posts if isinstance(r,dict) and not (r.get("_renderedBodyVerified") and r.get("_renderedBody"))]
    if not pending:
        return raw_posts

    # API plainBody는 일반 줄바꿈과 빈 문단을 모두 \n 하나로 평탄화합니다.
    # 한 줄 글은 API 원문을 그대로 쓰고, 줄바꿈이 있는 글만 실제 DOM에서
    # <p>/<br>/editor block 구조를 읽습니다.
    multiline_pending=[]
    for raw in pending:
        plain=str(raw.get("plainBody") or raw.get("body") or "")
        if plain and "\n" not in plain:
            raw["_renderedBody"]=plain
            raw["_renderedBodyVerified"]=True
            raw["_renderedBodySource"]="api_single_line"
        elif plain:
            multiline_pending.append(raw)
    pending=multiline_pending
    if not pending:
        return raw_posts

    # 1단계: 빠른 병렬 probe. API plainBody에 없는 Unicode emoji가 OG title에 남아 있으면
    # 브라우저를 띄우지 않고 바로 화면 본문으로 확정할 수 있습니다.
    # OG meta는 모든 공백을 평탄화하므로 문단 원문으로 채택하지 않습니다.
    if not browser_only and False:
        print(f"\n[본문 빠른 대조] {len(pending)}개 - 브라우저 대신 HTTP/OG를 병렬 확인합니다.")
        cookie_map=_session_cookie_map(SESSION_FILE)
        started=time.monotonic(); done=ok=fail=0
        by_pid={str(r.get("postId") or r.get("id") or r.get("postID") or ""):r for r in pending}
        workers=min(12,max(1,len(pending)))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures={ex.submit(_fast_probe_one_rendered,r,cookie_map):r for r in pending}
            for fut in as_completed(futures):
                raw=futures[fut]
                pid=str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
                try:
                    _pid,text,source=fut.result()
                except Exception:
                    text=""; source="exception"
                if text:
                    raw["_renderedBody"]=text
                    raw["_renderedBodyVerified"]=True
                    raw["_renderedBodySource"]="fast_og"
                    ok+=1
                else:
                    raw["_renderedBodyVerified"]=False
                    raw["_renderedBodyProbeReason"]=source
                    fail+=1
                done+=1
                _progress("빠른 본문",done,len(pending),started,ok=ok,failed=fail,current=f"post_id={pid}")
        print(f"[본문 빠른 대조 완료] 확정 {ok}개 / 브라우저 필요 {fail}개")

    browser_pending=pending
    if selective_browser and browser_pending:
        selected=[]
        skipped=0
        for r in browser_pending:
            url=str(r.get("shareUrl") or r.get("url") or "")
            plain=str(r.get("plainBody") or "")
            rich=str(r.get("body") or r.get("richBody") or r.get("htmlBody") or "")
            force=bool(r.get("_forceBrowserBodyCheck"))
            # 모먼트 직접 URL은 chrome-error로 끊기는 사례가 많으므로 감사 단계에서는 강제하지 않음.
            is_moment="/moment/" in url.lower()
            has_signal = bool(rich and _normalize_visible_text(rich) != _normalize_visible_text(plain))
            has_signal = has_signal or any((0x1F000 <= ord(ch) <= 0x1FAFF or 0x2600 <= ord(ch) <= 0x27BF or ord(ch) == 0xFE0F) for ch in (plain+rich))
            if (force or has_signal) and not is_moment:
                selected.append(r)
            else:
                r["_renderedBodyAuditSkipped"] = True
                r["_renderedBodyVerified"] = False
                skipped += 1
        browser_pending=selected
        if skipped:
            print(f"[본문 브라우저 최적화] 빠른 확인 실패 중 {skipped}개는 화면 대조 근거가 없어 브라우저 열기에서 제외했습니다.")
    if not browser_pending:
        return raw_posts

    print(f"\n[본문 문단 구조 확인] 줄바꿈이 있는 {len(browser_pending)}개만 실제 화면을 엽니다.")
    state_arg=str(SESSION_FILE) if SESSION_FILE.exists() else None
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        kwargs={"storage_state":state_arg} if state_arg else {}
        context=await browser.new_context(**kwargs)
        page=await context.new_page()
        ok=failed=0; started=time.monotonic()
        for idx,raw in enumerate(browser_pending,1):
            pid=str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
            base_text=str(raw.get("plainBody") or raw.get("body") or "")
            url=str(raw.get("shareUrl") or raw.get("url") or "")
            if not url:
                raw["_renderedBodyVerified"]=False; failed+=1
                _progress("브라우저 본문",idx,len(browser_pending),started,ok=ok,failed=failed,current=f"post_id={pid}")
                continue
            # Moment 특수 URL은 직접 진입이 자주 chrome-error로 끊깁니다. 8초 이상 붙잡지 않습니다.
            try:
                await page.goto(url,wait_until="domcontentloaded",timeout=8000)
                await page.wait_for_timeout(250)
                result=await page.evaluate("""({plain}) => {
                    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
                    const stripEmoji=s=>norm(s).replace(/[\\p{Extended_Pictographic}\\uFE0F\\u200D]/gu,'').replace(/\\s+/g,' ').trim();
                    const formattedText=el=>{
                      const fallback=(el.innerText||'').trim();
                      const nodes=[...el.querySelectorAll('p,[data-block="true"]')]
                        .filter(n=>!n.parentElement?.closest('p,[data-block="true"]'))
                        .map(n=>(n.innerText||'').trim());
                      if(nodes.length>=2){
                        const joined=nodes.join('\\n\\n');
                        if(norm(joined)===norm(fallback)) return joined;
                      }
                      const editorLines=[...el.querySelectorAll('[data-lexical-editor] > div,[contenteditable="true"] > div')]
                        .map(n=>(n.innerText||'').trim());
                      if(editorLines.length>=2){
                        const joined=editorLines.join('\\n');
                        if(norm(joined)===norm(fallback)) return joined;
                      }
                      return fallback;
                    };
                    const target=stripEmoji(plain);
                    const anchors=[];
                    if(target){anchors.push(target.slice(0,Math.min(40,target.length)));if(target.length>30)anchors.push(target.slice(Math.max(0,target.length-30)));}
                    const candidates=[];
                    for(const el of document.querySelectorAll('article, main, section, div, p')){
                      const txt=formattedText(el); if(!txt||!target)continue;
                      const stripped=stripEmoji(txt); const hit=anchors.some(a=>a.length>=8&&stripped.includes(a)); if(!hit)continue;
                      if(stripped.length>Math.max(target.length*3+250,700))continue;
                      let score=Math.abs(stripped.length-target.length); if(stripped===target)score-=10000; else if(stripped.includes(target))score-=5000;
                      candidates.push({txt,score,len:txt.length});
                    }
                    candidates.sort((a,b)=>a.score-b.score||a.len-b.len);
                    if(candidates.length)return {text:candidates[0].txt,source:'dom_paragraphs'};
                    const og=document.querySelector('meta[property="og:title"]')?.content||document.title||'';
                    return {text:og,source:'title'};
                }""",{"plain":base_text})
                text=str((result or {}).get("text") or "").strip(); source=str((result or {}).get("source") or "")
                if source=="title" and text:
                    if "커뮤니티 포스트 - " in text: text=text.split("커뮤니티 포스트 - ",1)[1]
                    a=raw.get("author"); author=str((a or {}).get("profileName") or (a or {}).get("nickname") or (a or {}).get("name") or "") if isinstance(a,dict) else ""
                    if author and text.endswith(" - "+author): text=text[:-(len(author)+3)]
                compact_base=_strip_unicode_emoji_for_compare(base_text).replace(" ","")
                compact_text=_strip_unicode_emoji_for_compare(text).replace(" ","")
                anchor=compact_base[:min(12,len(compact_base))]
                generic_title = _is_generic_weverse_title(text)
                valid = bool(text) and not generic_title and bool(compact_base) and bool(anchor and anchor in compact_text)
                if valid:
                    raw["_renderedBody"]=text; raw["_renderedBodyVerified"]=True; raw["_renderedBodySource"]="browser_"+source; ok+=1
                else:
                    raw["_renderedBodyVerified"]=False; failed+=1
            except Exception as e:
                raw["_renderedBodyVerified"]=False; failed+=1
                # 진행바를 깨는 긴 Playwright call log는 숨기고 한 줄 요약만 남깁니다.
                short=str(e).splitlines()[0][:120]
                print(f"\n  [본문 화면 대조 건너뜀] post_id={pid}: {type(e).__name__}: {short}")
            _progress("브라우저 본문",idx,len(browser_pending),started,ok=ok,failed=failed,current=f"post_id={pid}")
        try: await context.storage_state(path=str(SESSION_FILE))
        except Exception: pass
        await browser.close()
    print(f"[본문 브라우저 대조 완료] 성공 {ok}개 / 대조 불가 {failed}개")
    return raw_posts



async def enrich_rendered_body_texts_v24(raw_posts: list[dict], concurrency: int = 4) -> list[dict]:
    """v24 정확성 감사용 화면 본문 대조."""
    items=[r for r in raw_posts if isinstance(r,dict)]
    if not items:
        return raw_posts
    print(f"\n[v24 화면 본문 정확성 대조] {len(items)}개를 최대 {concurrency}개씩 병렬 확인합니다.")
    state_arg=str(SESSION_FILE) if SESSION_FILE.exists() else None
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        kwargs={"storage_state":state_arg} if state_arg else {}
        context=await browser.new_context(**kwargs)
        sem=asyncio.Semaphore(max(1,concurrency))
        started=time.monotonic(); done=ok=failed=0
        lock=asyncio.Lock()

        async def one(raw: dict):
            nonlocal done,ok,failed
            pid=str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
            base_text=str(raw.get("plainBody") or raw.get("body") or "")
            url=str(raw.get("shareUrl") or raw.get("url") or "")
            success=False; page=None
            async with sem:
                try:
                    if not url: raise RuntimeError("게시글 URL 없음")
                    page=await context.new_page()
                    await page.goto(url,wait_until="domcontentloaded",timeout=7000)
                    await page.wait_for_timeout(350)
                    result=await page.evaluate(r'''({plain}) => {
                      const norm=s=>(s||'').replace(/\s+/g,' ').trim();
                      const stripEmoji=s=>norm(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu,'').replace(/\s+/g,' ').trim();
                      const hasEmoji=s=>/[\p{Extended_Pictographic}\uFE0F]/u.test(s||'');
                      const target=stripEmoji(plain);
                      const root=document.querySelector('article') || document.querySelector('main') || document.body;
                      const nodes=[...root.querySelectorAll('p, div, span')];
                      const candidates=[];
                      if(target){
                        const anchors=[target.slice(0,Math.min(40,target.length))];
                        if(target.length>30) anchors.push(target.slice(Math.max(0,target.length-30)));
                        for(const el of nodes){
                          const txt=(el.innerText||'').trim(); if(!txt) continue;
                          const stripped=stripEmoji(txt);
                          if(stripped.length>Math.max(target.length*2+140,420)) continue;
                          if(!anchors.some(a=>a.length>=6 && stripped.includes(a))) continue;
                          let score=Math.abs(stripped.length-target.length)+Math.min(500,el.children.length*10);
                          if(stripped===target) score-=10000; else if(stripped.includes(target)) score-=5000;
                          candidates.push({txt,score,len:txt.length,source:'dom'});
                        }
                      } else {
                        for(const el of nodes){
                          const txt=(el.innerText||'').trim(); if(!txt || !hasEmoji(txt)) continue;
                          if(el.children.length>2 || txt.length>40) continue;
                          const noEmoji=stripEmoji(txt).replace(/[\s\p{P}\p{S}]/gu,'').trim();
                          if(noEmoji) continue;
                          candidates.push({txt,score:txt.length+el.children.length*10,len:txt.length,source:'emoji_only'});
                        }
                      }
                      candidates.sort((a,b)=>a.score-b.score||a.len-b.len);
                      if(candidates.length) return candidates[0];
                      if(target){
                        const og=document.querySelector('meta[property="og:title"]')?.content || document.title || '';
                        return {text:og,source:'title'};
                      }
                      return {text:'',source:'empty'};
                    }''',{"plain":base_text})
                    text=str((result or {}).get("text") or "").strip(); source=str((result or {}).get("source") or "")
                    if source=="title" and text:
                        if "커뮤니티 포스트 - " in text: text=text.split("커뮤니티 포스트 - ",1)[1]
                        a=raw.get("author"); author=str((a or {}).get("profileName") or (a or {}).get("nickname") or (a or {}).get("name") or "") if isinstance(a,dict) else ""
                        if author and text.endswith(" - "+author): text=text[:-(len(author)+3)]
                    compact_base=_strip_unicode_emoji_for_compare(base_text).replace(" ","")
                    compact_text=_strip_unicode_emoji_for_compare(text).replace(" ","")
                    if base_text:
                        anchor=compact_base[:min(12,len(compact_base))]
                        success=bool(text) and not _is_generic_weverse_title(text) and bool(anchor and anchor in compact_text)
                    else:
                        success=bool(text) and not _is_generic_weverse_title(text) and _contains_unicode_emoji(text) and not compact_text
                    if success:
                        raw["_renderedBody"]=text; raw["_renderedBodyVerified"]=True; raw["_renderedBodySource"]="v24_browser"
                    else:
                        raw.pop("_renderedBody",None); raw["_renderedBodyVerified"]=False; raw["_renderedBodySource"]="v24_empty_or_unverified"
                except Exception as e:
                    raw["_renderedBodyVerified"]=False; raw["_renderedBodyV24Error"]=f"{type(e).__name__}: {str(e).splitlines()[0][:120]}"
                finally:
                    if page is not None:
                        try: await page.close()
                        except Exception: pass
            async with lock:
                done+=1; ok+=1 if success else 0; failed+=0 if success else 1
                _progress("v24 화면 본문",done,len(items),started,ok=ok,failed=failed,current=f"post_id={pid}")
        await asyncio.gather(*(one(r) for r in items))
        try: await context.storage_state(path=str(SESSION_FILE))
        except Exception: pass
        await browser.close()
    print(f"[v24 화면 본문 대조 완료] 화면 원문 확정 {ok}개 / 빈 글·대조 불가 {failed}개")
    return raw_posts


def build_yt_dlp_cookiefile(session_file: Path, out_path: Path) -> Path | None:
    """weverse_session.json(Playwright storage_state)의 쿠키를 yt-dlp가 읽을 수 있는
    Netscape 형식 cookies.txt로 변환합니다. 위버스 자체 업로드 영상(라이브/VOD)은
    yt-dlp의 위버스 전용 추출기가 담당하는데, 멤버십 전용 콘텐츠는 로그인 쿠키가 있어야
    받을 수 있어서 필요합니다."""
    try:
        data = json.loads(session_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[경고] 쿠키 변환 실패 (세션 파일 읽기 오류): {e}")
        return None

    cj = http.cookiejar.MozillaCookieJar(str(out_path))
    count = 0
    for c in data.get("cookies", []):
        try:
            domain = c.get("domain", "")
            if not domain:
                continue
            expires = c.get("expires")
            expires = int(expires) if expires and expires > 0 else None
            cookie = http.cookiejar.Cookie(
                version=0,
                name=c.get("name", ""),
                value=c.get("value", ""),
                port=None,
                port_specified=False,
                domain=domain,
                domain_specified=domain.startswith("."),
                domain_initial_dot=domain.startswith("."),
                path=c.get("path", "/"),
                path_specified=True,
                secure=bool(c.get("secure", False)),
                expires=expires,
                discard=False,
                comment=None,
                comment_url=None,
                rest={"HttpOnly": ""} if c.get("httpOnly") else {},
            )
            cj.set_cookie(cookie)
            count += 1
        except Exception:
            continue

    try:
        cj.save(ignore_discard=True, ignore_expires=True)
        print(f"[디버그] yt-dlp용 쿠키 {count}개를 {out_path.name}에 저장했습니다.")
        return out_path
    except Exception as e:
        print(f"[경고] 쿠키 파일 저장 실패: {e}")
        return None


def safe_filename(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", s).strip()


# 실제 브라우저 네트워크 로그로 확인된, "이 멤버의 게시글 목록"을 돌려주는 API 패턴입니다.
# 예) https://global.apis.naver.com/weverse/wevweb/post/v1.0/member-XXXXXXXX/posts?...fieldSet=postsV1...
# 커뮤니티 전체 피드, 댓글, 알림, 상품 추천 등 관계없는 응답은 이 패턴에 안 걸리므로 자동으로 제외됩니다.
MEMBER_POSTS_URL_RE = re.compile(r"/post/v[\d.]+/member-[^/]+/posts(?:[/?]|$)")


# 위버스 Web API 서명에 사용되는 값. yt-dlp의 최신 Weverse extractor와 같은 방식입니다.
WEVERSE_API_BASE = "https://global.apis.naver.com/weverse/wevweb"
WEVERSE_APP_ID = "be4d79eb8fc7bd008ee82c8ec4ff6fd4"
WEVERSE_SIGNING_KEY = b"1b9cb6378d959b45714bec49971ade22e6e24e42"


def _session_cookie_map(session_file: Path) -> dict[str, str]:
    try:
        data = json.loads(session_file.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {c.get("name", ""): c.get("value", "") for c in data.get("cookies", []) if c.get("name")}


def _signed_weverse_get(endpoint: str, session_file: Path, timeout: int = 30, *, quiet: bool = False, failure_label: str = "상세 조회 실패") -> dict | None:
    """브라우저가 쓰는 것과 같은 서명 방식으로 위버스 내부 API GET 호출."""
    cookies = _session_cookie_map(session_file)
    query = {
        "appId": WEVERSE_APP_ID,
        "language": "ko",
        "os": "WEB",
        "platform": "WEB",
        "wpf": "pc",
    }
    sep = "&" if "?" in endpoint else "?"
    api_path = endpoint + sep + urllib.parse.urlencode(query)
    wmsgpad = str(int(time.time() * 1000))
    digest = hmac.HMAC(
        WEVERSE_SIGNING_KEY,
        f"{api_path[:255]}{wmsgpad}".encode(),
        digestmod=hashlib.sha1,
    ).digest()
    wmd = base64.b64encode(digest).decode()

    headers = {
        **HEADERS,
        "Accept": "application/json",
        "Origin": "https://weverse.io",
        "Referer": "https://weverse.io/",
    }
    if cookies.get("we2_access_token"):
        headers["Authorization"] = f"Bearer {cookies['we2_access_token']}"
    if cookies.get("we2_device_id"):
        headers["WEV-device-Id"] = cookies["we2_device_id"]

    try:
        r = requests.get(
            WEVERSE_API_BASE + api_path,
            headers=headers,
            params={"wmsgpad": wmsgpad, "wmd": wmd},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        if not quiet:
            print(f"  [{failure_label}] {endpoint}: {e}")
        return None


def fetch_post_detail(post_id: str) -> dict | None:
    """게시글 상세 응답. 일부 대용량 사진 게시글은 여기서도 20개만 내려올 수 있습니다."""
    return _signed_weverse_get(f"/post/v1.0/post-{post_id}?fieldSet=postV1", SESSION_FILE)


def fetch_post_preview(post_id: str) -> dict | None:
    """웹이 미리보기/재생정보에 사용하는 preview fieldSet도 함께 조회합니다.
    상세 응답보다 첨부정보가 더 풍부한 경우가 있어 대용량 게시글 보강에 사용합니다.
    """
    # preview는 모든 게시글에서 허용되는 엔드포인트가 아닙니다.
    # 403은 게시글 실패가 아니라 "보조 조회 사용 불가"이므로 기본적으로 조용히 무시합니다.
    return _signed_weverse_get(
        f"/post/v1.0/post-{post_id}/preview?fieldSet=postForPreview",
        SESSION_FILE,
        quiet=True,
        failure_label="보조 preview 조회 실패",
    )


def _post_id_of(raw: dict) -> str:
    if not isinstance(raw, dict):
        return ""
    return str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")


def _expected_photo_count_raw(raw: dict) -> int:
    if not isinstance(raw, dict):
        return 0
    summary = raw.get("summary") or {}
    try:
        return int(summary.get("photoCount") or summary.get("imageCount") or 0)
    except Exception:
        return 0


def _find_post_dicts(obj, post_id: str) -> list[dict]:
    """응답이 data/items 등으로 감싸져도 같은 post_id를 가진 게시글 dict를 모두 찾습니다."""
    found: list[dict] = []
    if isinstance(obj, dict):
        if _post_id_of(obj) == str(post_id):
            found.append(obj)
        for value in obj.values():
            found.extend(_find_post_dicts(value, post_id))
    elif isinstance(obj, list):
        for value in obj:
            found.extend(_find_post_dicts(value, post_id))
    return found


def _raw_richness(raw: dict) -> tuple[int, int, int]:
    """첨부 개수 > 기대 사진수 보존 > JSON 크기 순으로 더 풍부한 payload 선택."""
    if not isinstance(raw, dict):
        return (-1, -1, -1)
    p, v = _attachment_counts(raw)
    expected = _expected_photo_count_raw(raw)
    try:
        size = len(json.dumps(raw, ensure_ascii=False))
    except Exception:
        size = 0
    return (p + v, expected, size)


def choose_best_post_payload(base_raw: dict, *responses: dict | None) -> dict:
    """목록/상세/preview 중 같은 post_id의 가장 풍부한 게시글 payload를 선택합니다.
    summary의 원본 총개수는 더 풍부한 응답에 없더라도 base에서 보존합니다.
    """
    post_id = _post_id_of(base_raw)
    candidates = [base_raw]
    for response in responses:
        if isinstance(response, dict):
            candidates.extend(_find_post_dicts(response, post_id))
            if _post_id_of(response) == post_id:
                candidates.append(response)
    best = max(candidates, key=_raw_richness) if candidates else base_raw
    if best is not base_raw:
        best = dict(best)
    # 목록 summary가 실제 총 개수를 가장 잘 알려주는 경우가 있어 합쳐서 보존
    base_summary = base_raw.get("summary") or {}
    best_summary = dict(best.get("summary") or {})
    for key in ("photoCount", "imageCount", "videoCount", "thumbnails"):
        if key not in best_summary and key in base_summary:
            best_summary[key] = base_summary[key]
        elif key in ("photoCount", "imageCount", "videoCount"):
            try:
                best_summary[key] = max(int(best_summary.get(key) or 0), int(base_summary.get(key) or 0))
            except Exception:
                pass
    if best_summary:
        best["summary"] = best_summary
    # 링크/작성자/시간처럼 preview에서 빠질 수 있는 필드도 base에서 보존
    for key in ("shareUrl", "url", "publishedAt", "createdAt", "author", "plainBody", "postType", "membershipOnly", "isMembershipOnly"):
        if not best.get(key) and base_raw.get(key) is not None:
            best[key] = base_raw.get(key)
    return best


def _needs_preview_fallback(base_raw: dict, detail_raw: dict | None) -> bool:
    """preview는 상세 응답이 실제 사진 총개수를 못 채울 때만 보조적으로 사용합니다.

    preview 엔드포인트는 게시글 종류에 따라 403을 반환할 수 있으므로
    일반 상세조회/이모티콘 감사에서는 호출하지 않습니다.
    """
    candidate = choose_best_post_payload(base_raw, detail_raw) if detail_raw else base_raw
    expected = max(_expected_photo_count_raw(base_raw), _expected_photo_count_raw(candidate))
    photos, _videos = _attachment_counts(candidate)
    return expected > 0 and photos < expected


def fetch_best_post_payload(base_raw: dict) -> dict:
    """상세 응답을 우선 사용하고, 사진 첨부가 부족할 때만 preview를 보조 조회합니다."""
    pid = _post_id_of(base_raw)
    if not pid:
        return base_raw
    detail = fetch_post_detail(pid)
    best = choose_best_post_payload(base_raw, detail)
    if _needs_preview_fallback(base_raw, detail):
        preview = fetch_post_preview(pid)
        if preview:
            best = choose_best_post_payload(best, preview)
    return best


def _photo_attachment_key(att: dict) -> str:
    if not isinstance(att, dict):
        return ""
    data = att.get("data") if isinstance(att.get("data"), dict) else att
    url = data.get("url") or data.get("imageUrl") or data.get("originImgUrl") or ""
    if not url:
        return ""
    try:
        u = urllib.parse.urlsplit(str(url))
        return urllib.parse.urlunsplit((u.scheme.lower(), u.netloc.lower(), u.path, "", ""))
    except Exception:
        return str(url).split("?", 1)[0]


def _collect_photo_attachments(obj) -> list[dict]:
    """게시글 페이지 네트워크 응답에서 사진 첨부 객체를 보수적으로 수집합니다."""
    out: list[dict] = []
    if isinstance(obj, dict):
        typ = str(obj.get("type") or "").lower()
        if typ == "photo" and isinstance(obj.get("data"), dict):
            if _photo_attachment_key(obj):
                out.append(obj)
        for key, value in obj.items():
            lk = str(key).lower()
            if lk in ("photos", "photoitems", "images") and isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        url = item.get("url") or item.get("imageUrl") or item.get("originImgUrl")
                        if url:
                            out.append({"type": "photo", "data": item})
            out.extend(_collect_photo_attachments(value))
    elif isinstance(obj, list):
        for value in obj:
            out.extend(_collect_photo_attachments(value))
    return out


def _merge_captured_photo_attachments(base_raw: dict, captured_jsons: list[dict]) -> dict:
    """여러 lazy-load 응답에 흩어진 사진 첨부를 게시 순서대로 합칩니다.
    같은 URL은 중복 제거합니다. 기존 orderedAttachments의 순서를 우선 보존합니다.
    """
    merged = dict(base_raw)
    original = list(base_raw.get("orderedAttachments") or [])
    existing_other = [a for a in original if not (isinstance(a, dict) and str(a.get("type", "")).lower() == "photo")]
    photos: list[dict] = []
    seen: set[str] = set()
    for att in original:
        if isinstance(att, dict) and str(att.get("type", "")).lower() == "photo":
            key = _photo_attachment_key(att)
            if key and key not in seen:
                seen.add(key); photos.append(att)
    for data in captured_jsons:
        for att in _collect_photo_attachments(data):
            key = _photo_attachment_key(att)
            if key and key not in seen:
                seen.add(key); photos.append(att)
    merged["orderedAttachments"] = photos + existing_other
    return merged


def _is_photo_truncated(raw: dict) -> bool:
    expected = _expected_photo_count_raw(raw)
    actual, _ = _attachment_counts(raw)
    return expected > 0 and actual < expected


async def enrich_truncated_raws_browser(raws: list[dict]) -> list[dict]:
    """20장 제한이 의심되는 글만 게시글 페이지를 직접 열어 lazy-load JSON까지 수집합니다.
    스크롤 목록 전체를 다시 훑는 것이 아니라 해당 post_id URL만 방문합니다.
    확보 장수가 summary 총개수에 도달하지 못하면 이후 검증에서 실패 처리됩니다.
    """
    if not raws:
        return raws
    prepared: list[dict] = []
    truncated: list[tuple[int, dict]] = []
    for raw in raws:
        best = fetch_best_post_payload(raw) if _is_photo_truncated(raw) else raw
        prepared.append(best)
        if _is_photo_truncated(best):
            truncated.append((len(prepared)-1, best))
    if not truncated:
        return prepared

    print(f"\n[대용량 사진 보강] 20장 제한 의심 게시글 {len(truncated)}개를 post_id 페이지에서 추가 확인합니다.")
    if not SESSION_FILE.exists():
        return prepared
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, channel="chrome", args=["--disable-blink-features=AutomationControlled"])
        context = await browser.new_context(storage_state=str(SESSION_FILE), user_agent=HEADERS["User-Agent"], viewport={"width":1280,"height":900})
        await context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        for index, raw in truncated:
            pid = _post_id_of(raw)
            expected = _expected_photo_count_raw(raw)
            before, _ = _attachment_counts(raw)
            post_url = raw.get("shareUrl") or raw.get("url") or ""
            if not post_url:
                print(f"  [보강 실패] post_id={pid}: 원본 게시글 URL 없음 ({before}/{expected})")
                continue
            captured: list[dict] = []
            page = await context.new_page()
            async def capture(response):
                try:
                    if response.status != 200 or "json" not in (response.headers.get("content-type", "").lower()):
                        return
                    text = await response.text()
                    if pid not in text and pid not in response.url:
                        return
                    data = json.loads(text)
                    captured.append(data)
                except Exception:
                    return
            page.on("response", lambda r: asyncio.create_task(capture(r)))
            try:
                await page.goto(post_url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(1800)
                last = before
                stagnant = 0
                for _ in range(24):
                    current = _merge_captured_photo_attachments(raw, captured)
                    count, _ = _attachment_counts(current)
                    if count >= expected:
                        break
                    if count == last:
                        stagnant += 1
                    else:
                        stagnant = 0; last = count
                    await page.mouse.wheel(0, 1300)
                    await page.wait_for_timeout(450)
                    if stagnant >= 6:
                        await page.keyboard.press("End")
                        await page.wait_for_timeout(900)
                        stagnant = 0
                enriched = _merge_captured_photo_attachments(raw, captured)
                after, _ = _attachment_counts(enriched)

                # 페이지 lazy-load만으로 부족하면, 게시글의 가장 큰 사진을 눌러 갤러리 뷰어를
                # 열 수 있는 경우 ArrowRight로 실제 사진 순서를 끝까지 따라가 봅니다.
                # 오염 방지를 위해 '정확히 expected개'를 모으고 기존 사진과도 충분히 겹칠 때만 채택합니다.
                if after < expected and expected > 1:
                    try:
                        candidates = await page.locator("img").evaluate_all(
                            """imgs => imgs.map((img, i) => {
                                const r = img.getBoundingClientRect();
                                return {i, src: img.currentSrc || img.src || '', nw: img.naturalWidth || 0, nh: img.naturalHeight || 0,
                                        vw: r.width || 0, vh: r.height || 0, vis: r.width > 80 && r.height > 80};
                            }).filter(x => x.vis && /wevpstatic|pstatic/.test(x.src))
                              .sort((a,b) => (b.vw*b.vh + b.nw*b.nh) - (a.vw*a.vh + a.nw*a.nh))"""
                        )
                        if candidates:
                            await page.locator("img").nth(candidates[0]["i"]).click(timeout=3000)
                            await page.wait_for_timeout(500)
                            gallery_urls: list[str] = []
                            last_key = ""
                            same_rounds = 0
                            for _step in range(expected + 6):
                                visible = await page.locator("img").evaluate_all(
                                    """imgs => imgs.map((img, i) => {
                                        const r = img.getBoundingClientRect();
                                        const st = getComputedStyle(img);
                                        return {src: img.currentSrc || img.src || '', area: (r.width||0)*(r.height||0),
                                                nat: (img.naturalWidth||0)*(img.naturalHeight||0),
                                                visible: st.visibility !== 'hidden' && st.display !== 'none' && r.width > 160 && r.height > 160};
                                    }).filter(x => x.visible && /wevpstatic|pstatic/.test(x.src))
                                      .sort((a,b) => (b.area+b.nat)-(a.area+a.nat))"""
                                )
                                if visible:
                                    gurl = str(visible[0].get("src") or "")
                                    if gurl:
                                        key = _photo_attachment_key({"type":"photo","data":{"url":gurl}})
                                        if key and key not in {_photo_attachment_key({"type":"photo","data":{"url":u}}) for u in gallery_urls}:
                                            gallery_urls.append(gurl)
                                            same_rounds = 0
                                        elif key == last_key:
                                            same_rounds += 1
                                        last_key = key
                                if len(gallery_urls) >= expected:
                                    break
                                await page.keyboard.press("ArrowRight")
                                await page.wait_for_timeout(220)
                                if same_rounds >= 4:
                                    break

                            if len(gallery_urls) == expected:
                                existing_keys = {_photo_attachment_key(a) for a in (raw.get("orderedAttachments") or [])
                                                 if isinstance(a, dict) and str(a.get("type", "")).lower() == "photo"}
                                gallery_keys = {_photo_attachment_key({"type":"photo","data":{"url":u}}) for u in gallery_urls}
                                required_overlap = min(3, max(1, before))
                                if len(existing_keys.intersection(gallery_keys)) >= required_overlap:
                                    others = [a for a in (raw.get("orderedAttachments") or [])
                                              if not (isinstance(a, dict) and str(a.get("type", "")).lower() == "photo")]
                                    enriched = dict(raw)
                                    enriched["orderedAttachments"] = [
                                        {"type":"photo", "data":{"url":u}} for u in gallery_urls
                                    ] + others
                                    after = expected
                    except Exception:
                        pass

                prepared[index] = enriched
                if after >= expected:
                    print(f"  [보강 완료] post_id={pid}: 사진 {before}/{expected} → {after}/{expected}")
                else:
                    print(f"  [보강 미완료] post_id={pid}: 사진 {after}/{expected} 확보. 완료 처리하지 않습니다.")
            except Exception as e:
                print(f"  [보강 실패] post_id={pid}: {type(e).__name__}: {e}")
            finally:
                await page.close()
        if top_ids_this_scan:
            save_scan_state(top_ids_this_scan[:12], {
                "last_unique_ids_seen": len(set(top_ids_this_scan)),
                "last_strict_batches": boundary["strict_batches"],
            })
            print(f"[탐색 체크포인트] 다음 실행 기준 ID {min(12, len(top_ids_this_scan))}개를 저장했습니다.")

        try:
            await context.storage_state(path=str(SESSION_FILE))
        except Exception:
            pass
        await browser.close()
    return prepared


def _attachment_counts(raw: dict) -> tuple[int, int]:
    photos = videos = 0
    for att in raw.get("orderedAttachments") or []:
        typ = str(att.get("type", "")).lower() if isinstance(att, dict) else ""
        photos += typ == "photo"
        videos += typ == "video"
    return photos, videos


def needs_post_detail(raw: dict) -> bool:
    """상세 API가 꼭 필요한 게시글만 골라 호출해 전체 작업량을 줄입니다."""
    if not isinstance(raw, dict):
        return False
    photo_att, video_att = _attachment_counts(raw)
    summary = raw.get("summary") or {}
    try:
        photo_count = int(summary.get("photoCount") or summary.get("imageCount") or 0)
    except Exception:
        photo_count = 0
    try:
        video_count = int(summary.get("videoCount") or 0)
    except Exception:
        video_count = 0
    ext = raw.get("extension") or {}
    return (
        photo_count > photo_att
        or photo_att >= 20          # 딱 20장이면 목록 API 절단 가능성을 의심
        or video_att > 0
        or video_count > 0
        or isinstance(ext.get("video"), dict)
        or isinstance(ext.get("moment"), dict)
        or bool(raw.get("membershipOnly") or raw.get("isMembershipOnly"))
    )


def choose_richer_raw(list_raw: dict, detail_raw: dict | None) -> dict:
    if not detail_raw or not isinstance(detail_raw, dict):
        return list_raw
    # 상세 응답이 {data:{...}}로 감싸지는 변화에도 대응
    candidates = [detail_raw]
    if isinstance(detail_raw.get("data"), dict):
        candidates.insert(0, detail_raw["data"])
    target_id = str(list_raw.get("postId") or list_raw.get("id") or list_raw.get("postID") or "")
    for candidate in candidates:
        cid = str(candidate.get("postId") or candidate.get("id") or candidate.get("postID") or "")
        if cid == target_id:
            return candidate
    return list_raw


def fetch_cvideo_play_info(video_id: str) -> dict | None:
    """일반 게시글 첨부영상/모먼트 계열 cvideo의 재생 정보를 직접 조회합니다.
    yt-dlp WeverseMomentIE도 같은 endpoint를 사용합니다.
    """
    data = _signed_weverse_get(
        f"/cvideo/v1.0/cvideo-{video_id}/playInfo?videoId={urllib.parse.quote(str(video_id))}",
        SESSION_FILE,
    )
    if not isinstance(data, dict):
        return None
    play = data.get("playInfo")
    return play if isinstance(play, dict) else data


def _cvideo_source_urls(play_info: dict) -> list[str]:
    """Weverse가 제공한 후보 중 '최고 화질 하나'만 반환합니다.
    최고 화질 다운로드가 실패해도 저화질로 내려가지 않습니다.
    """
    if not isinstance(play_info, dict):
        return []

    videos = ((play_info.get("videos") or {}).get("list") or []) if isinstance(play_info.get("videos"), dict) else []
    ranked: list[tuple[int, int, str]] = []
    for item in videos:
        if not isinstance(item, dict) or not item.get("source"):
            continue
        enc = item.get("encodingOption") or {}
        bitrate = item.get("bitrate") or {}
        try:
            width = int(enc.get("width") or 0)
            height = int(enc.get("height") or 0)
            br = int(bitrate.get("video") or 0)
        except Exception:
            width = height = br = 0
        ranked.append((width * height, br, item.get("source")))
    if ranked:
        pixels, br, source = max(ranked, key=lambda x: (x[0], x[1]))
        print(f"       최고 화질 MP4 하나만 선택: {pixels} pixels / bitrate {br}")
        return [source]

    # 직접 MP4가 아예 없을 때만 HLS 중 최고 rendition 하나를 사용합니다.
    hls_ranked: list[tuple[int, int, str]] = []
    for stream in play_info.get("streams") or []:
        if not isinstance(stream, dict) or str(stream.get("type", "")).upper() != "HLS":
            continue
        params = {}
        for item in stream.get("keys") or []:
            if isinstance(item, dict) and item.get("type") == "param" and item.get("name"):
                params[str(item["name"])] = str(item.get("value", ""))
        renditions = stream.get("videos") or []
        for item in renditions:
            if not isinstance(item, dict) or not item.get("source"):
                continue
            enc = item.get("encodingOption") or {}
            bitrate = item.get("bitrate") or {}
            try:
                width = int(enc.get("width") or 0)
                height = int(enc.get("height") or 0)
                br = int(bitrate.get("video") or 0)
            except Exception:
                width = height = br = 0
            source = item.get("source")
            if params:
                parsed = urllib.parse.urlsplit(source)
                current = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
                current.update(params)
                source = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                                                  urllib.parse.urlencode(current), parsed.fragment))
            hls_ranked.append((width * height, br, source))
        if not renditions and stream.get("source"):
            source = stream.get("source")
            if params:
                parsed = urllib.parse.urlsplit(source)
                current = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
                current.update(params)
                source = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                                                  urllib.parse.urlencode(current), parsed.fragment))
            hls_ranked.append((0, 0, source))
    if hls_ranked:
        pixels, br, source = max(hls_ranked, key=lambda x: (x[0], x[1]))
        print(f"       직접 MP4 없음: 최고 HLS 하나만 선택: {pixels} pixels / bitrate {br}")
        return [source]
    return []


def _download_direct_mp4(url: str, dest: Path, referer: str = "") -> Path | None:
    """서명된 pstatic MP4를 yt-dlp를 거치지 않고 그대로 저장합니다."""
    try:
        headers = dict(HEADERS)
        if referer:
            headers["Referer"] = referer
        headers["Accept"] = "*/*"
        r = requests.get(url, headers=headers, timeout=60, stream=True)
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        if "text/html" in ctype or "application/json" in ctype:
            raise RuntimeError(f"영상 대신 {ctype} 응답을 받았습니다")
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                if chunk:
                    f.write(chunk)
        if dest.exists() and dest.stat().st_size > 0:
            return dest
    except Exception as e:
        try:
            if dest.exists(): dest.unlink()
        except Exception:
            pass
        print(f"    직접 MP4 다운로드 실패: {e}")
    return None


async def download_cvideo_ids(video_ids: list[str], post_url: str, dest_no_ext: Path,
                              cookiefile: Path | None = None,
                              video_id_groups: list[list[str]] | None = None) -> list[Path]:
    """첨부영상 1개당 여러 candidate videoId를 차례로 시도합니다.
    같은 첨부의 여러 ID를 서로 다른 영상으로 오인하지 않습니다.
    """
    groups = [g for g in (video_id_groups or []) if g]
    if not groups:
        groups = [[v] for v in video_ids]
    downloaded: list[Path] = []

    for idx, candidates in enumerate(groups, start=1):
        one_saved = None
        print(f"    ↳ 첨부영상 {idx}: 후보 videoId {len(candidates)}개 확인")
        for cand_no, video_id in enumerate(candidates, start=1):
            print(f"       - 후보 {cand_no}: {video_id}")
            play_info = fetch_cvideo_play_info(video_id)
            if not play_info:
                continue
            try:
                RAW_DIR.mkdir(exist_ok=True)
                (RAW_DIR / f"cvideo_{safe_filename(str(video_id))}.json").write_text(
                    json.dumps(play_info, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
            sources = _cvideo_source_urls(play_info)
            if not sources:
                continue
            one_dest = Path(str(dest_no_ext) + f"_{idx}")
            for source in sources:
                if ".mp4" in source.lower():
                    got = _download_direct_mp4(source, one_dest.with_suffix(".mp4"), referer=post_url)
                    if got:
                        one_saved = got
                        break
                else:
                    got_list = download_video(source, one_dest, cookiefile=cookiefile, referer=post_url)
                    if got_list:
                        one_saved = got_list[0]
                        break
            if one_saved:
                break
        if one_saved:
            downloaded.append(one_saved)
        else:
            print(f"    ↳ 첨부영상 {idx}은 모든 후보 ID/소스 다운로드에 실패했습니다.")
    return downloaded


def load_scan_state() -> dict:
    if not SCAN_STATE_FILE.exists():
        return {}
    try:
        data = json.loads(SCAN_STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_scan_state(checkpoint_ids: list[str], extra: dict | None = None) -> None:
    payload = load_scan_state()
    payload.update({
        "version": 18,
        "checkpoint_ids": [str(x) for x in checkpoint_ids if x][:12],
        "updated_at": datetime.now().isoformat(),
    })
    if extra:
        payload.update(extra)
    tmp = SCAN_STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SCAN_STATE_FILE)


async def ensure_authenticated_session() -> None:
    """API 재조회보다 먼저 Weverse 로그인 상태를 확정하고 최신 storage_state를 저장합니다.

    세션 파일이 유효하면 사용자가 아무 것도 할 필요가 없습니다. 로그인 토큰이 없으면
    브라우저에서 로그인한 뒤 Enter를 누르게 하고, 그 상태를 저장한 다음에만 API 작업을 시작합니다.
    """
    print("\n" + "=" * 70)
    print("[로그인 확인] 실패 게시글/API 조회 전에 로그인 상태부터 준비합니다.")
    print("=" * 70)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context_kwargs = {
            "user_agent": HEADERS["User-Agent"],
            "viewport": {"width": 1280, "height": 800},
        }
        if SESSION_FILE.exists():
            context_kwargs["storage_state"] = str(SESSION_FILE)
        context = await browser.new_context(**context_kwargs)
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = await context.new_page()
        await page.goto("https://www.weverse.io/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2500)

        def has_access_token(cookies):
            return any(c.get("name") == "we2_access_token" and c.get("value") for c in cookies)

        cookies = await context.cookies()
        if not has_access_token(cookies):
            print("[로그인 필요] 브라우저에서 Weverse 로그인을 완료한 뒤 터미널에서 Enter를 누르세요.")
            await asyncio.to_thread(input)
            await page.wait_for_timeout(1200)
            cookies = await context.cookies()
            if not has_access_token(cookies):
                await browser.close()
                raise RuntimeError("Weverse 로그인 토큰을 확인하지 못했습니다. 로그인 완료 후 다시 실행해주세요.")
        else:
            print("[로그인 확인 완료] 저장된 로그인 상태를 불러왔습니다.")

        await context.storage_state(path=str(SESSION_FILE))
        print("[로그인] 최신 세션을 저장했습니다. 이제 API 재조회를 시작합니다.")
        await browser.close()


async def collect_raw_responses(known_complete_ids: set[str] | None = None, full_integrity_scan: bool = False) -> list[dict]:
    """최근 게시글 목록 또는 전체 무결성 검사용 전체 목록을 수집합니다.

    saved_posts.json에 이미 완료된 post_id가 있으면 사용자가 멤버 탭으로 이동한 뒤
    Enter를 누른 다음 스크립트가 자동 스크롤합니다. 페이지 단위 API 응답이 전부
    이미 완료된 post_id로만 구성되면 기존 구간에 도달한 것으로 보고 즉시 종료합니다.
    기준점이 전혀 없는 첫 실행만 기존 수동 전체 수집 모드로 동작합니다.
    """
    known_complete_ids = {str(x) for x in (known_complete_ids or set()) if x}
    scan_state = load_scan_state()
    checkpoint_ids = {str(x) for x in scan_state.get("checkpoint_ids", []) if x}
    # v15 이전에는 체크포인트가 없으므로 단 한 묶음만 보고 멈추지 않습니다.
    safety_known_batches_required = 4 if not checkpoint_ids else 3
    boundary = {"checkpoint_seen": False, "known_batches": 0, "strict_batches": 0}
    top_ids_this_scan: list[str] = []
    RAW_DIR.mkdir(exist_ok=True)
    collected: list[dict] = []          # 확실한(멤버 게시글 목록 URL과 일치하는) 응답에서 수집
    fallback_collected: list[dict] = [] # 혹시 위 URL 패턴이 하나도 안 걸렸을 때 쓸 보험용
    seen_bodies = set()
    debug_log = BASE_DIR / "debug_responses.log"
    debug_log.write_text("", encoding="utf-8")  # 매 실행마다 초기화
    print(f"[디버그] 로그 파일 생성됨: {debug_log.resolve()}", flush=True)
    stats = {"total_responses": 0, "json_responses": 0, "json_no_posts_found": 0,
             "strict_matches": 0}
    reached_known_boundary = asyncio.Event()

    async with async_playwright() as p:
        if not SESSION_FILE.exists():
            print("로그인 세션이 없습니다. 처음 한 번만 weverse_login.py로 로그인해 주세요.")
            raise SystemExit(1)

        browser = await p.chromium.launch(
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            storage_state=str(SESSION_FILE),
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = await context.new_page()

        async def on_response(response):
            try:
                url = response.url
                ctype = response.headers.get("content-type", "")
                stats["total_responses"] += 1

                # 모든 응답을 조건 없이 로그 파일에 기록 (디버깅용)
                with open(debug_log, "a", encoding="utf-8") as lf:
                    lf.write(f"{response.status}\t{ctype}\t{url}\n")

                if response.status != 200:
                    return
                if "json" not in ctype.lower():
                    return

                stats["json_responses"] += 1

                body_text = await response.text()
                if not body_text or body_text in seen_bodies:
                    return
                seen_bodies.add(body_text)

                try:
                    data = json.loads(body_text)
                except Exception:
                    return

                posts = find_post_list_candidates(data)
                is_member_posts_url = bool(MEMBER_POSTS_URL_RE.search(url))

                if posts and is_member_posts_url:
                    # 확실한 케이스: URL 자체가 "이 멤버의 게시글 목록" API와 일치.
                    collected.extend(posts)
                    stats["strict_matches"] += 1
                    fname = RAW_DIR / f"resp_{len(seen_bodies)}.json"
                    fname.write_text(body_text, encoding="utf-8")

                    ids = [str(x.get("postId") or x.get("id") or x.get("postID") or "")
                           for x in posts if isinstance(x, dict)]
                    ids = [x for x in ids if x]
                    unseen = [x for x in ids if x not in known_complete_ids]
                    boundary["strict_batches"] += 1
                    for x in ids:
                        if x not in top_ids_this_scan:
                            top_ids_this_scan.append(x)
                    hit_checkpoint = bool(checkpoint_ids.intersection(ids))
                    if hit_checkpoint:
                        boundary["checkpoint_seen"] = True

                    if unseen:
                        # 새 글이 하나라도 있으면 경계 카운트는 다시 시작합니다.
                        boundary["known_batches"] = 0
                        print(f"  ↳ 새/미확인 게시글 {len(unseen)}개 감지 (고유 ID {len(set(top_ids_this_scan))}개 확인)")
                    elif known_complete_ids and ids:
                        # 체크포인트가 있는 경우: 이전 실행의 실제 상단 ID를 만난 뒤에만 안전 구간 계산.
                        # 체크포인트가 없는 v15 첫 실행: 연속 4묶음이 모두 기존 글일 때만 종료.
                        can_count = boundary["checkpoint_seen"] if checkpoint_ids else True
                        if can_count:
                            boundary["known_batches"] += 1
                            print(f"  ↳ 기존 글 구간 확인 {boundary['known_batches']}/{safety_known_batches_required} "
                                  f"(이번 묶음 {len(ids)}개, 고유 ID {len(set(top_ids_this_scan))}개)")
                            if boundary["known_batches"] >= safety_known_batches_required and not full_integrity_scan:
                                print("  ↳ 이전 체크포인트 뒤 안전 구간까지 확인 완료 → 자동 탐색 종료")
                                reached_known_boundary.set()
                        else:
                            print(f"  ↳ 기존 글 {len(ids)}개 확인 중 - 이전 체크포인트를 아직 찾는 중")
                    else:
                        print(f"  ↳ [멤버 게시글] {len(posts)}개 감지 (고유 ID {len(set(top_ids_this_scan))}개)")
                elif posts:
                    # 게시글 목록처럼 보이지만 URL 패턴이 다름 (커뮤니티 전체 피드 등일 수 있음).
                    # 나중에 strict 매칭이 하나도 없을 때만 보험용으로 사용하고, 기본적으로는 버립니다.
                    fallback_collected.extend(posts)
                    print(f"  (게시글 목록처럼 보이지만 멤버 게시글 URL이 아니라서 제외됨: {url})")
                else:
                    stats["json_no_posts_found"] += 1
                    # 게시글로 인식되지 않은 json도 참고용으로 저장 (최대 30개까지만)
                    if stats["json_no_posts_found"] <= 30:
                        fname = RAW_DIR / f"unmatched_{stats['json_no_posts_found']}.json"
                        fname.write_text(body_text, encoding="utf-8")
                    top_keys = list(data.keys()) if isinstance(data, dict) else type(data).__name__
                    print(f"  (json 응답이지만 게시글 목록으로 인식 안 됨: {url}  최상위 키: {top_keys})")
            except Exception as e:
                with open(debug_log, "a", encoding="utf-8") as lf:
                    lf.write(f"ERROR processing response: {e}\n")

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        await page.goto("https://www.weverse.io/")

        print("=" * 70)
        print("브라우저에서 원하는 그룹 > 원하는 멤버의 게시글 탭으로 이동하세요.")
        print("멤버 게시글 목록이 보이면 터미널에서 Enter를 누르세요.")
        if full_integrity_scan:
            print("[전체 무결성 검사] Enter 후 맨 처음 글부터 맨 끝 글까지 자동으로 전부 훑습니다.")
            print("저장 완료 구간을 만나도 중간에 멈추지 않습니다.")
        elif known_complete_ids:
            print("그 뒤에는 자동 스크롤합니다. 이전 실행 체크포인트를 찾은 뒤 안전 구간을 더 확인하고 멈춥니다.")
        else:
            print("기준점이 없으므로 이번에는 자동으로 게시글 목록 끝까지 훑습니다.")
        print("(응답이 하나도 안 잡히면 debug_responses.log 파일을 확인하세요)")
        print("=" * 70, flush=True)

        await asyncio.to_thread(input)
        if full_integrity_scan or not known_complete_ids:
            print("[전체 자동 탐색] 멤버 게시글 목록 끝까지 내려갑니다...")
            stagnant = 0
            last_unique = 0
            end_presses = 0
            for step in range(1200):
                unique_now = len({str(x.get("postId") or x.get("id") or x.get("postID") or "") for x in collected if isinstance(x, dict)})
                if unique_now > last_unique:
                    if unique_now // 100 > last_unique // 100:
                        print(f"  ↳ 현재 고유 게시글 {unique_now}개 확인")
                    last_unique = unique_now
                    stagnant = 0
                    end_presses = 0
                else:
                    stagnant += 1
                await page.mouse.wheel(0, 1900)
                await page.wait_for_timeout(700)
                if stagnant >= 14:
                    await page.keyboard.press("End")
                    await page.wait_for_timeout(1800)
                    end_presses += 1
                    stagnant = 0
                    unique_after = len({str(x.get("postId") or x.get("id") or x.get("postID") or "") for x in collected if isinstance(x, dict)})
                    if unique_after == last_unique and end_presses >= 3:
                        print(f"[전체 자동 탐색 완료] 목록 끝 도달. 고유 게시글 {unique_after}개 확인")
                        break
                    last_unique = max(last_unique, unique_after)
            else:
                print("[경고] 최대 스크롤 횟수에 도달했습니다. integrity_report.json에서 전체 발견 수를 확인하세요.")
        else:
            if not reached_known_boundary.is_set():
                print("[자동 탐색] 최근 게시글부터 기존 저장 구간까지 내려갑니다...")
                stagnant = 0
                last_count = len(collected)
                for _ in range(240):
                    if reached_known_boundary.is_set():
                        break
                    await page.mouse.wheel(0, 1700)
                    await page.wait_for_timeout(850)
                    if len(collected) == last_count:
                        stagnant += 1
                    else:
                        stagnant = 0
                        last_count = len(collected)
                    if stagnant >= 12:
                        await page.keyboard.press("End")
                        await page.wait_for_timeout(1800)
                        stagnant = 0
                if reached_known_boundary.is_set():
                    print("[자동 탐색 완료] 기존 저장 구간에 도달했습니다.")
                else:
                    print("[경고] 자동 탐색 중 기존 저장 구간을 찾지 못했습니다. 현재까지 수집한 글만 처리합니다.")

        print(f"\n[통계] 전체 응답 수: {stats['total_responses']}, "
              f"JSON 응답 수: {stats['json_responses']}, "
              f"멤버 게시글 URL과 일치한 응답 수: {stats['strict_matches']}, "
              f"게시글로 인식 안 된 JSON 응답 수: {stats['json_no_posts_found']}")
        print(f"자세한 로그: {debug_log}")
        print(f"인식 안 된 JSON 예시들: {RAW_DIR} 폴더의 unmatched_*.json 파일 참고\n")

        try:
            await context.storage_state(path=str(SESSION_FILE))
            print("[로그인] 최신 로그인 세션을 저장했습니다.", flush=True)
        except Exception as e:
            print(f"[로그인 세션 저장 경고] {e}", flush=True)

        await browser.close()

    if collected:
        return collected

    if fallback_collected:
        print("[경고] 멤버 게시글 목록 URL(member-*/posts)과 일치하는 응답이 없어서, "
              "대신 '게시글처럼 보이는' 모든 응답을 사용합니다. "
              "이 경우 관계없는 게시글이 섞여 들어갈 수 있으니 결과를 꼭 확인하세요.")
        return fallback_collected

    return collected



def _load_saved_posts_payload() -> dict:
    """saved_posts.json v2/v3 모두 읽습니다.

    v3부터는 각 post_id가 어느 로컬 폴더에 대응하는지도 루트 JSON에 기록합니다.
    게시글 폴더 안에는 .post_id 같은 관리 파일을 만들지 않습니다.
    """
    if not SAVED_POSTS_FILE.exists():
        return {"version": 3, "post_ids": [], "posts": {}}
    try:
        data = json.loads(SAVED_POSTS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {"version": 3, "post_ids": [str(x) for x in data if x], "posts": {}}
        if not isinstance(data, dict):
            return {"version": 3, "post_ids": [], "posts": {}}
        ids = [str(x) for x in data.get("post_ids", []) if x]
        posts = data.get("posts", {}) if isinstance(data.get("posts", {}), dict) else {}
        # posts 키 자체도 완료 ID 힌트로 인정합니다.
        ids = sorted(set(ids) | {str(x) for x in posts.keys() if x})
        return {"version": 3, "post_ids": ids, "posts": posts}
    except Exception as e:
        print(f"[경고] saved_posts.json 읽기 실패: {e}")
        return {"version": 3, "post_ids": [], "posts": {}}


def load_saved_post_ids(output_dir: Path) -> set[str]:
    """saved_posts.json은 '힌트'로만 읽습니다. 실제 건너뛰기는 폴더 완전성 검사로 결정합니다."""
    return set(_load_saved_posts_payload().get("post_ids", []))


def load_saved_post_index() -> dict[str, dict]:
    data = _load_saved_posts_payload().get("posts", {})
    return {str(k): v for k, v in data.items() if k and isinstance(v, dict)}


def save_saved_post_ids(saved: set[str], posts_index: dict[str, dict] | None = None) -> None:
    current = _load_saved_posts_payload()
    index = dict(current.get("posts", {}))
    if posts_index is not None:
        index.update({str(k): v for k, v in posts_index.items() if k and isinstance(v, dict)})
    # 완료 목록에서 빠진 ID의 오래된 폴더 매핑은 남겨 둡니다. 미완성 복구 시에도 필요하기 때문입니다.
    payload = {"version": 3, "post_ids": sorted(str(x) for x in saved if x), "posts": index}
    tmp = SAVED_POSTS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SAVED_POSTS_FILE)


def mark_post_saved(post_id: str, saved: set[str], post_dir: Path | None = None,
                    output_dir: Path | None = None, post: Post | None = None) -> None:
    pid = str(post_id)
    saved.add(pid)
    index = load_saved_post_index()
    if post_dir is not None and output_dir is not None:
        try:
            rel = str(post_dir.relative_to(output_dir)).replace("\\", "/")
        except Exception:
            rel = str(post_dir)
        entry = dict(index.get(pid, {}))
        entry["folder"] = rel
        if post is not None:
            entry["date"] = post.dt.strftime("%Y-%m-%d")
            entry["is_moment"] = bool(post.is_moment)
            entry["is_membership"] = bool(post.is_membership)
        index[pid] = entry
    save_saved_post_ids(saved, index)


_VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".m4v", ".ts"}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _pdf_has_post_id(pdf: Path, post_id: str) -> bool:
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:3])
        return str(post_id) in text
    except Exception:
        return False


def cleanup_legacy_post_id_files(output_dir: Path) -> int:
    """예전 버전이 게시글 폴더 안에 만든 .post_id 관리 파일을 정리합니다.
    중복 저장 방지는 프로젝트 루트의 saved_posts.json과 PDF의 원본 링크로 처리하므로
    게시글 폴더 안에는 별도 post id 파일을 남기지 않습니다.
    """
    if not output_dir.exists():
        return 0
    removed = 0
    for marker in output_dir.rglob(".post_id"):
        try:
            marker.unlink()
            removed += 1
        except OSError:
            pass
    return removed


_POST_FOLDER_RE = re.compile(r"^(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})(?:$|[_ (])")


def iter_post_dirs(output_dir: Path):
    """연/월 분류 여부와 관계없이 날짜로 시작하는 실제 게시글 폴더만 순회합니다."""
    if not output_dir.exists():
        return
    for folder in output_dir.rglob("*"):
        if folder.is_dir() and _POST_FOLDER_RE.match(folder.name):
            yield folder


def post_month_dir(output_dir: Path, dt: datetime) -> Path:
    """게시일 기준 output/YYYY/MM 경로."""
    return output_dir / dt.strftime("%Y") / dt.strftime("%m")


def migrate_existing_post_folders(output_dir: Path) -> tuple[int, list[str]]:
    """예전 루트/연도 직속 날짜 폴더를 output/YYYY/MM/날짜폴더 구조로 이동합니다.
    같은 이름이 이미 있으면 덮어쓰지 않고 (2), (3)... 식으로 안전하게 이동합니다.
    """
    if not output_dir.exists():
        return 0, []
    moved = 0
    notes: list[str] = []
    folders = list(iter_post_dirs(output_dir))
    # 부모를 옮기면서 탐색 경로가 흔들리지 않도록 얕은 경로부터 원본 목록을 고정해서 처리
    folders.sort(key=lambda x: len(x.parts))
    for folder in folders:
        m = _POST_FOLDER_RE.match(folder.name)
        if not m or not folder.exists():
            continue
        desired_parent = output_dir / m.group("year") / m.group("month")
        try:
            if folder.parent.resolve() == desired_parent.resolve():
                continue
        except Exception:
            if folder.parent == desired_parent:
                continue
        desired_parent.mkdir(parents=True, exist_ok=True)
        dest = desired_parent / folder.name
        if dest.exists():
            base = folder.name
            n = 2
            while (desired_parent / f"{base}({n})").exists():
                n += 1
            dest = desired_parent / f"{base}({n})"
            notes.append(f"이름 충돌: {folder} → {dest}")
        try:
            shutil.move(str(folder), str(dest))
            moved += 1
        except Exception as e:
            notes.append(f"이동 실패: {folder} ({e})")
    # 이동 후 비어 있는 연도/월 외의 예전 중간 폴더가 있어도 사용자 파일일 수 있으므로 임의 삭제하지 않음
    return moved, notes


def _read_pdf_post_meta(pdf: Path) -> dict:
    try:
        from pypdf import PdfReader
        md = PdfReader(str(pdf)).metadata or {}
        return {
            "post_id": str(md.get("/WeversePostID") or "").strip(),
            "photo_count": int(md.get("/WeversePhotoCount") or 0),
            "video_count": int(md.get("/WeverseVideoCount") or 0),
        }
    except Exception:
        return {"post_id": "", "photo_count": 0, "video_count": 0}


def bootstrap_saved_post_index(output_dir: Path) -> tuple[dict[str, dict], list[Path]]:
    """기존 PDF에서 post_id→폴더 인덱스를 빠르게 보강합니다.

    PDF가 이미 삭제된 폴더는 기존 v3 인덱스를 우선 사용합니다. v2에서 v27로 처음
    올라온 경우처럼 인덱스가 없는데 PDF 없는 폴더가 딱 하나이고, PDF에서 찾지 못한
    saved post_id도 딱 하나라면 안전하게 1:1로 연결합니다.
    """
    saved = load_saved_post_ids(output_dir)
    index = load_saved_post_index()
    folder_to_pid: dict[str, str] = {}
    unresolved: list[Path] = []

    for folder in iter_post_dirs(output_dir):
        rel = str(folder.relative_to(output_dir)).replace("\\", "/")
        pid = ""
        pdfs = sorted(folder.glob("*.pdf"))
        for pdf in pdfs:
            meta = _read_pdf_post_meta(pdf)
            if meta.get("post_id"):
                pid = str(meta["post_id"])
                break
        if pid:
            entry = dict(index.get(pid, {})) if isinstance(index.get(pid, {}), dict) else {}
            entry["folder"] = rel
            index[pid] = entry
            folder_to_pid[rel] = pid
        else:
            # 이미 v3 인덱스가 이 폴더를 가리키는지 확인
            indexed_pid = next((k for k, v in index.items()
                                if isinstance(v, dict) and str(v.get("folder") or "").replace("\\", "/") == rel), "")
            if indexed_pid:
                folder_to_pid[rel] = indexed_pid
            else:
                unresolved.append(folder)

    mapped_ids = set(folder_to_pid.values())
    unmatched_ids = sorted(saved - mapped_ids)
    if len(unresolved) == 1 and len(unmatched_ids) == 1:
        folder = unresolved[0]
        pid = unmatched_ids[0]
        rel = str(folder.relative_to(output_dir)).replace("\\", "/")
        entry = dict(index.get(pid, {})) if isinstance(index.get(pid, {}), dict) else {}
        entry["folder"] = rel
        index[pid] = entry
        folder_to_pid[rel] = pid
        unresolved = []
        print(f"[로컬 인덱스 복구] PDF가 없는 폴더를 saved_posts.json의 남은 post_id와 연결: {folder.name} → {pid}")

    save_saved_post_ids(saved, index)
    return index, unresolved


def local_quick_integrity_scan(output_dir: Path) -> tuple[list[str], list[str]]:
    """매 실행 시 로컬 파일만 빠르게 검사합니다.

    위버스 전체 목록을 다시 스크롤하지 않습니다. PDF/사진/영상이 실제로 빠진 폴더만
    post_id로 직접 재조회할 수 있도록 후보 ID를 반환합니다.
    """
    index, unresolved = bootstrap_saved_post_index(output_dir)
    reverse: dict[str, str] = {}
    for pid, entry in index.items():
        if isinstance(entry, dict) and entry.get("folder"):
            reverse[str(entry["folder"]).replace("\\", "/")] = str(pid)

    repair_ids: list[str] = []
    notices: list[str] = []
    folders = list(iter_post_dirs(output_dir))
    started = time.monotonic()
    for i, folder in enumerate(folders, 1):
        rel = str(folder.relative_to(output_dir)).replace("\\", "/")
        pid = reverse.get(rel, "")
        pdfs = sorted(folder.glob("*.pdf"))
        reason = ""
        if not pdfs:
            reason = "PDF 없음"
        elif any(p.stat().st_size <= 0 for p in pdfs):
            reason = "0바이트 PDF"
        else:
            meta = _read_pdf_post_meta(pdfs[0])
            if not pid and meta.get("post_id"):
                pid = str(meta["post_id"])
            images = [x for x in folder.iterdir() if x.is_file() and x.suffix.lower() in _IMAGE_EXTS and not x.name.startswith(".pdf_")]
            videos = [x for x in folder.iterdir() if x.is_file() and x.suffix.lower() in _VIDEO_EXTS]
            if any(x.stat().st_size <= 0 for x in images):
                reason = "0바이트 사진 파일 있음"
            elif any(x.stat().st_size <= 0 for x in videos):
                reason = "0바이트 영상 파일 있음"
            elif len(images) != int(meta.get("photo_count") or 0):
                reason = f"사진 파일 누락/초과 ({len(images)}/{int(meta.get('photo_count') or 0)})"
            elif len(videos) != int(meta.get("video_count") or 0):
                reason = f"영상 파일 누락/초과 ({len(videos)}/{int(meta.get('video_count') or 0)})"

        if reason:
            if pid:
                if pid not in repair_ids:
                    repair_ids.append(pid)
                notices.append(f"{folder.name} | post_id={pid} | {reason}")
            else:
                notices.append(f"{folder.name} | post_id 확인 불가 | {reason}")
        if folders:
            _progress("로컬 빠른 검사", i, len(folders), started, ok=i-len(repair_ids), failed=len(repair_ids), current=folder.name)

    # PDF도 없고 인덱스도 없어 post_id를 특정 못한 폴더는 별도 경고합니다.
    unresolved_rel = {str(x.relative_to(output_dir)).replace("\\", "/") for x in unresolved}
    for rel in sorted(unresolved_rel):
        if not any(rel.split("/")[-1] in n for n in notices):
            notices.append(f"{rel} | post_id 확인 불가 | PDF/인덱스 없음")
    return repair_ids, notices


def find_existing_post_dir(post: Post, output_dir: Path) -> Path | None:
    """연/월 구조를 포함한 기존 결과물에서 post_id에 해당하는 실제 폴더를 찾습니다.

    v27부터는 PDF가 삭제된 폴더도 saved_posts.json의 루트 인덱스로 찾을 수 있습니다.
    """
    if not output_dir.exists():
        return None
    indexed = load_saved_post_index().get(str(post.post_id), {})
    rel = indexed.get("folder") if isinstance(indexed, dict) else None
    if rel:
        candidate = output_dir / Path(str(rel))
        if candidate.exists() and candidate.is_dir():
            return candidate
    date_prefix = post.dt.strftime("%Y-%m-%d")
    # 정상 새 구조를 먼저 확인한 뒤, 혹시 남은 레거시 폴더도 재귀적으로 찾습니다.
    preferred_parent = post_month_dir(output_dir, post.dt)
    candidates: list[Path] = []
    if preferred_parent.exists():
        candidates.extend(x for x in preferred_parent.iterdir() if x.is_dir() and x.name.startswith(date_prefix))
    seen = {str(x.resolve()) for x in candidates if x.exists()}
    for folder in iter_post_dirs(output_dir):
        if not folder.name.startswith(date_prefix):
            continue
        try:
            key = str(folder.resolve())
        except Exception:
            key = str(folder)
        if key not in seen:
            candidates.append(folder); seen.add(key)
    for folder in candidates:
        for pdf in folder.glob("*.pdf"):
            if _pdf_has_post_id(pdf, post.post_id):
                return folder
    return None


def _sha256_text(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def _stable_media_url(url: str) -> str:
    """CDN 서명/만료 쿼리는 실행마다 바뀔 수 있어 비교에서 제외하고 실제 리소스 경로만 사용."""
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlsplit(str(url))
        return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", ""))
    except Exception:
        return str(url).split("?", 1)[0]


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_manifest_sha256(paths: list[Path]) -> str:
    rows = []
    for p in sorted(paths, key=lambda x: x.name):
        rows.append([p.name, p.stat().st_size, _file_sha256(p)])
    return _sha256_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))


def _expected_video_count(post: Post) -> int:
    signaled = bool(post.video_ids or post.video_urls or post.video_attachment_count or post.expected_video_count)
    if not signaled:
        return 0
    return max(post.expected_video_count, post.video_attachment_count or len(post.video_id_groups) or (1 if post.video_urls else 0), 1)


def _expected_photo_count(post: Post) -> int:
    return max(int(getattr(post, "expected_photo_count", 0) or 0), len(post.photo_urls))


def _post_validation_meta(post: Post, photo_paths: list[Path] | None = None,
                          video_paths: list[Path] | None = None) -> dict[str, str]:
    """API 원본을 문자 단위로 직렬화한 검증값. 공백/줄바꿈/글자 하나도 구분합니다."""
    # 모먼트는 실행 때마다 서명/재생 URL, 썸네일 URL, video id 후보가 달라질 수 있습니다.
    # 그 값을 SourceSHA256에 넣으면 실제 저장 파일은 같은데도 매 실행마다 "검증값 불일치"가 납니다.
    # 따라서 모먼트는 '게시물 자체의 안정적인 의미값'만 SourceSHA에 넣고, 실제 미디어 무결성은
    # 아래 PhotoFilesSHA256 / VideoFilesSHA256으로 별도 검증합니다.
    if post.is_moment:
        payload = {
            "post_id": post.post_id,
            "text": post.text or "",
            "is_moment": True,
            "is_membership": bool(post.is_membership),
            "photo_count": _expected_photo_count(post),
            "video_count": _expected_video_count(post),
        }
    else:
        payload = {
            "post_id": post.post_id,
            "text": post.text or "",
            "photo_urls": [_stable_media_url(x) for x in post.photo_urls],
            "video_urls": [_stable_media_url(x) for x in post.video_urls],
            "video_id_groups": post.video_id_groups,
            "video_thumb_urls": [_stable_media_url(x) for x in post.video_thumb_urls],
            "emoticon_urls": [_stable_media_url(x) for x in post.emoticon_urls],
            "video_count": _expected_video_count(post),
        }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    result = {
        "WeverseValidationVersion": "26",
        "WeversePostID": post.post_id,
        "WeverseSourceSHA256": _sha256_text(canonical),
        "WeverseTextSHA256": _sha256_text(post.text or ""),
        # PDF 자체가 사이트 이관의 원본 데이터가 될 수 있도록 본문 Unicode 원문도 그대로 보관합니다.
        # 화면 표시용 텍스트와 별개로 이 값은 이미지 치환 없이 정확한 원문입니다.
        "WeverseBodyText": post.text or "",
        "WeversePhotoCount": str(_expected_photo_count(post)),
        "WeverseVideoCount": str(_expected_video_count(post)),
        "WeverseVideoThumbCount": str(len(post.video_thumb_urls)),
        "WeverseEmoticonCount": str(len(post.emoticon_urls)),
    }
    if photo_paths is not None:
        result["WeversePhotoFilesSHA256"] = _file_manifest_sha256(photo_paths)
    if video_paths is not None:
        result["WeverseVideoFilesSHA256"] = _file_manifest_sha256(video_paths)
    return result


def _pdf_validation_matches(pdf: Path, post: Post, photo_paths: list[Path] | None = None,
                            video_paths: list[Path] | None = None) -> tuple[bool, str]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf))
        md = reader.metadata or {}
        expected = _post_validation_meta(post, photo_paths=photo_paths, video_paths=video_paths)
        for key, value in expected.items():
            actual = md.get("/" + key)
            if str(actual or "") != str(value):
                return False, f"PDF 검증값 불일치: {key}"
        return True, ""
    except Exception as e:
        return False, f"PDF 검증 실패: {e}"


def check_existing_post_complete(post: Post, post_dir: Path | None) -> tuple[bool, str]:
    """원본 API 데이터와 저장 결과를 비교해 완료 여부와 미완성 사유를 돌려줍니다.

    이 함수 자체는 로그를 출력하지 않습니다. 이미 완성된 게시글은 터미널에
    나타나지 않도록 하기 위함입니다.
    """
    if not post_dir or not post_dir.exists():
        return False, "저장 폴더 없음"

    pdfs = sorted(post_dir.glob("*.pdf"))
    if not pdfs:
        return False, "PDF 없음"

    images = [p for p in post_dir.iterdir()
              if p.is_file() and p.suffix.lower() in _IMAGE_EXTS and not p.name.startswith(".pdf_")]
    expected_photos = _expected_photo_count(post)
    # 원본이 100장이라고 알려주는데 URL을 20개밖에 확보하지 못했다면
    # 기존 폴더 파일 수와 무관하게 절대 완료 처리하지 않습니다.
    if len(post.photo_urls) != expected_photos:
        return False, f"원본 사진 URL 확보 부족 ({len(post.photo_urls)}/{expected_photos})"
    if len(images) != expected_photos:
        return False, f"사진 개수 불일치 ({len(images)}/{expected_photos})"
    if any(p.stat().st_size <= 0 for p in images):
        return False, "0바이트 사진 파일 있음"

    expected_videos = _expected_video_count(post)
    videos = [p for p in post_dir.iterdir() if p.is_file() and p.suffix.lower() in _VIDEO_EXTS]
    if len(videos) != expected_videos:
        return False, f"영상 개수 불일치 ({len(videos)}/{expected_videos})"
    if any(p.stat().st_size <= 0 for p in videos):
        return False, "0바이트 영상 파일 있음"

    ok, reason = _pdf_validation_matches(pdfs[0], post, photo_paths=images, video_paths=videos)
    if not ok:
        return False, reason

    return True, ""


def is_existing_post_complete(post: Post, post_dir: Path | None) -> bool:
    return check_existing_post_complete(post, post_dir)[0]


async def capture_video_stream_urls(post_url: str) -> list[str]:
    """일반 아티스트 게시글 첨부영상용 fallback.
    로그인된 Chrome으로 실제 게시글을 열어 재생 시 발생하는 mp4/m3u8 요청 URL을 잡습니다.
    """
    if not post_url or "weverse.io/" not in post_url:
        return []

    found: list[str] = []
    seen: set[str] = set()

    def add_url(url: str):
        if not isinstance(url, str):
            return
        low = url.lower()
        if (".m3u8" in low or ".mp4" in low) and url not in seen:
            seen.add(url)
            found.append(url)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                channel="chrome",
                args=["--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(
                storage_state=str(SESSION_FILE),
                user_agent=HEADERS["User-Agent"],
                viewport={"width": 1280, "height": 800},
            )
            page = await context.new_page()
            page.on("request", lambda req: add_url(req.url))
            page.on("response", lambda resp: add_url(resp.url))

            await page.goto(post_url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(2500)

            # 실제 <video>가 있으면 play()를 호출. 재생 버튼형 UI도 몇 가지 후보를 눌러봅니다.
            try:
                await page.evaluate("""() => {
                    document.querySelectorAll('video').forEach(v => {
                        v.muted = true;
                        const p = v.play();
                        if (p && p.catch) p.catch(() => {});
                    });
                }""")
            except Exception:
                pass

            for selector in [
                'button[aria-label*="재생"]',
                'button[aria-label*="Play"]',
                'button[title*="재생"]',
                'button[title*="Play"]',
            ]:
                try:
                    loc = page.locator(selector)
                    if await loc.count():
                        await loc.first.click(timeout=1500)
                        break
                except Exception:
                    pass

            await page.wait_for_timeout(6000)
            try:
                await context.storage_state(path=str(SESSION_FILE))
            except Exception:
                pass
            await browser.close()
    except Exception as e:
        print(f"    브라우저 영상 주소 탐색 실패 ({post_url}): {e}")

    return found


async def download_video_with_fallback(
    primary_urls: list[str], post_url: str, dest_no_ext: Path, cookiefile: Path | None = None
) -> list[Path]:
    """1차 yt-dlp 추출 실패 시 게시글 페이지에서 실제 mp4/m3u8 요청을 잡아 재시도."""
    downloaded: list[Path] = []
    for url in primary_urls:
        got = download_video(url, dest_no_ext, cookiefile=cookiefile, referer=post_url or url)
        if got:
            downloaded.extend(got)
            return sorted(set(downloaded))

    if post_url and "weverse.io/" in post_url:
        print("    ↳ 일반 게시글 첨부영상 fallback: 브라우저에서 실제 스트림 주소를 찾습니다...")
        streams = await capture_video_stream_urls(post_url)
        for stream in streams:
            got = download_video(stream, dest_no_ext, cookiefile=cookiefile, referer=post_url)
            if got:
                downloaded.extend(got)
        if streams and not downloaded:
            print(f"    ↳ 스트림 주소 {len(streams)}개는 찾았지만 다운로드에 실패했습니다.")
        elif not streams:
            print("    ↳ mp4/m3u8 요청을 찾지 못했습니다.")

    # glob 중복 제거
    uniq = []
    seen = set()
    for x in downloaded:
        key = str(x)
        if key not in seen:
            seen.add(key)
            uniq.append(x)
    return uniq


def download_file(url: str, dest: Path) -> bool:
    try:
        r = requests.get(url, headers=HEADERS, timeout=30, stream=True)
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"    다운로드 실패 ({url}): {e}")
        return False


def download_video(url: str, dest_no_ext: Path, cookiefile: Path | None = None, referer: str = "") -> list[Path]:
    """m3u8/mp4 원본 주소든, 위버스 게시글 페이지 주소든 yt-dlp로 최고 화질 다운로드 시도.
    (위버스 자체 업로드 영상은 원본 스트림 주소가 JSON에 없어서, 게시글 페이지 주소를
    그대로 넘기면 yt-dlp의 위버스 전용 추출기가 알아서 인증/추출합니다.)"""
    try:
        import yt_dlp
    except ImportError:
        print("    yt-dlp가 설치되어 있지 않습니다. pip install yt-dlp 로 설치하세요.")
        return []

    ydl_opts = {
        # 게시글 페이지 하나에 영상이 여러 개 있을 수도 있어서(playlist 취급되는 경우),
        # autonumber를 붙여 서로 덮어쓰지 않도록 함.
        "outtmpl": str(dest_no_ext) + "_%(autonumber)s.%(ext)s",
        "format": "bestvideo+bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "http_headers": {**HEADERS, **({"Referer": referer} if referer else {})},
    }
    if cookiefile and Path(cookiefile).exists():
        ydl_opts["cookiefile"] = str(cookiefile)
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        matches = sorted(dest_no_ext.parent.glob(dest_no_ext.name + "_*"))
        return matches if matches else []
    except Exception as e:
        print(f"    영상 다운로드 실패 ({url}): {e}")
        return []


def unique_folder_name(base_date_str: str, used: dict) -> str:
    """같은 날짜에 게시글이 여러 개면 (2), (3)... 을 붙여 구분."""
    count = used.get(base_date_str, 0) + 1
    used[base_date_str] = count
    if count == 1:
        return base_date_str
    return f"{base_date_str}({count})"


def find_large_photo_audit_post_ids(output_dir: Path) -> list[str]:
    """v13 이하의 20장 절단 버그 영향을 받을 가능성이 있는 기존 폴더를 찾습니다.
    사진 파일/기록이 19장 이상인 폴더만 대상으로 하므로 전체 post_id를 무작정 재조회하지 않습니다.
    """
    ids: list[str] = []
    if not output_dir.exists():
        return ids
    try:
        from pypdf import PdfReader
    except Exception:
        return ids
    for folder in iter_post_dirs(output_dir):
        image_count = sum(1 for x in folder.iterdir()
                          if x.is_file() and x.suffix.lower() in _IMAGE_EXTS and not x.name.startswith(".pdf_"))
        pdfs = list(folder.glob("*.pdf"))
        if not pdfs:
            continue
        for pdf in pdfs:
            try:
                reader = PdfReader(str(pdf))
                md = reader.metadata or {}
                try:
                    recorded = int(md.get("/WeversePhotoCount") or 0)
                except Exception:
                    recorded = 0
                if max(recorded, image_count) < 19:
                    continue
                pid = str(md.get("/WeversePostID") or "").strip()
                if not pid:
                    text = "\n".join((page.extract_text() or "") for page in reader.pages[:3])
                    m = re.search(r"weverse\.io/[^\s]+/(?:artist|posts?)/([0-9A-Za-z-]+)", text, re.I)
                    if m:
                        pid = m.group(1)
                if pid and pid not in ids:
                    ids.append(pid)
            except Exception:
                continue
    return ids


def find_mixed_media_audit_post_ids(output_dir: Path) -> list[str]:
    """v9 이전 일부 버전의 사진/영상 썸네일 파일명 충돌 가능성을 1회 검사합니다.

    PDF 메타데이터상 사진과 영상이 모두 있는 기존 게시글만 골라 post_id를 반환합니다.
    실제 썸네일이 사진을 덮어썼는지는 파일명만으로 확정할 수 없으므로, 이 후보들은
    v18 첫 실행에서 사진 전체를 원본 URL 순서대로 다시 받아 안전하게 복구합니다.
    """
    ids: list[str] = []
    if not output_dir.exists():
        return ids
    try:
        from pypdf import PdfReader
    except Exception:
        return ids
    for folder in iter_post_dirs(output_dir):
        pdfs = list(folder.glob("*.pdf"))
        if not pdfs:
            continue
        for pdf in pdfs:
            try:
                md = PdfReader(str(pdf)).metadata or {}
                photo_count = int(md.get("/WeversePhotoCount") or 0)
                video_count = int(md.get("/WeverseVideoCount") or 0)
                pid = str(md.get("/WeversePostID") or "").strip()
                if pid and photo_count > 0 and video_count > 0:
                    ids.append(pid)
                    break
            except Exception:
                continue
    return list(dict.fromkeys(ids))


def find_all_saved_post_ids(output_dir: Path) -> list[str]:
    """연/월 폴더 전체 PDF에서 저장된 post_id를 수집합니다."""
    return sorted(_extract_output_post_ids(output_dir).keys())


def _pdf_emoticon_count_for_post(output_dir: Path, post_id: str) -> int:
    """현재 저장 PDF가 기록한 이모티콘 개수. 없거나 읽기 실패면 -1."""
    try:
        from pypdf import PdfReader
        for folder in _iter_post_folders(output_dir):
            for pdf in folder.glob("*.pdf"):
                try:
                    md = PdfReader(str(pdf)).metadata or {}
                    pid = str(md.get("/WeversePostID") or md.get("WeversePostID") or "")
                    if pid == str(post_id):
                        raw = md.get("/WeverseEmoticonCount") or md.get("WeverseEmoticonCount")
                        return int(raw) if raw is not None else -1
                except Exception:
                    continue
    except Exception:
        pass
    return -1


def select_emoticon_rebuild_raws(raws: list[dict], output_dir: Path) -> tuple[list[dict], set[str]]:
    """v21 엄격 이모티콘 감사 대상 선택.

    실제 이모티콘이 감지된 글은 PDF를 다시 만들고, v19의 과탐 때문에 기존 PDF에
    프로필 이미지가 이모티콘으로 기록된 경우(기존 count>0, 새 strict count=0)도
    다시 만들어 잘못 들어간 이미지를 제거합니다.
    """
    picked: list[dict] = []
    ids: set[str] = set()
    for raw in raws:
        try:
            post = parse_post(raw)
        except Exception:
            post = None
        if not post:
            continue
        new_count = len(post.emoticon_urls)
        old_count = _pdf_emoticon_count_for_post(output_dir, post.post_id)
        needs_rebuild = new_count > 0 or (old_count > 0 and old_count != new_count)
        if not needs_rebuild:
            continue
        if old_count > 0 and new_count == 0:
            print(f"  [오탐 정리] post_id={post.post_id}: 기존 PDF 이모티콘 {old_count}개 → 실제 0개 (프로필/멤버 이미지 후보 제거)")
        else:
            print(f"  [이모티콘 확인] post_id={post.post_id}: 엄격 탐지 {new_count}개 / 기존 PDF 기록 {old_count if old_count >= 0 else '없음'}")
        picked.append(raw)
        ids.add(post.post_id)
    return picked, ids


def fetch_audit_raws(post_ids: list[str]) -> tuple[list[dict], list[str]]:
    raws: list[dict] = []
    failed: list[str] = []
    if not post_ids:
        return raws, failed
    print(f"\n[1회 저장물 재감사] 기존 후보 {len(post_ids)}개를 post_id로 직접 확인합니다.")
    started=time.monotonic()
    for idx,pid in enumerate(post_ids,1):
        # 재감사에서는 개별 403/404를 수백 줄 찍지 않고 진행률/마지막 요약에만 반영합니다.
        detail=_signed_weverse_get(f"/post/v1.0/post-{pid}?fieldSet=postV1",SESSION_FILE,quiet=True)
        if not detail:
            failed.append(pid)
            _progress("API 재감사",idx,len(post_ids),started,ok=len(raws),failed=len(failed),current=f"post_id={pid}")
            continue
        candidates=_find_post_dicts(detail,pid)
        raw=candidates[0] if candidates else detail
        if _needs_preview_fallback(raw,detail):
            preview=fetch_post_preview(pid)
            if preview: raw=choose_best_post_payload(raw,preview)
        raws.append(raw)
        _progress("API 재감사",idx,len(post_ids),started,ok=len(raws),failed=len(failed),current=f"post_id={pid}")
    print(f"[API 재감사 완료] 성공 {len(raws)}개 / 조회 불가 {len(failed)}개")
    if failed:
        sample=", ".join(failed[:10])
        more=f" 외 {len(failed)-10}개" if len(failed)>10 else ""
        print(f"  조회 불가 post_id: {sample}{more}")
    return raws, failed


def _api_body_screen_candidates(raws: list[dict], output_dir: Path) -> list[dict]:
    """브라우저 대조 후보를 API 단계에서 최대한 줄입니다.

    - v19~v21 오탐 흔적(기존 PDF emoticon count > 0)은 반드시 재확인
    - rich body/body가 plainBody와 다르거나 emoji/variation selector를 포함하면 재확인
    - API에 plainBody만 있는 글은 fast OG probe 대상으로 유지 (emoji가 plainBody에서 누락된 사례 대응)

    마지막 항목 때문에 첫 v23 감사에서는 API 성공 글을 fast probe는 모두 거치지만,
    Playwright는 fast probe 실패 글만 엽니다. 즉 900개 브라우저 순차 이동은 사라집니다.
    """
    out=[]
    for r in raws:
        if not isinstance(r,dict):
            continue
        pid=str(r.get("postId") or r.get("id") or r.get("postID") or "")
        if pid and _pdf_emoticon_count_for_post(output_dir,pid) > 0:
            r["_forceBrowserBodyCheck"] = True
        out.append(r)
    return out


def load_failed_items() -> list[dict]:
    failed_file = BASE_DIR / "failed_posts.json"
    if not failed_file.exists():
        return []
    try:
        data = json.loads(failed_file.read_text(encoding="utf-8"))
        items = data.get("failures", []) if isinstance(data, dict) else []
        return [x for x in items if isinstance(x, dict) and x.get("post_id")]
    except Exception:
        return []


def fetch_failed_post_raws() -> list[dict]:
    """이전 실행 실패 글을 스크롤 없이 post_id 상세 API로 직접 가져옵니다."""
    items = load_failed_items()
    if not items:
        return []
    print("\n" + "=" * 70)
    print(f"[실패 게시글 직접 재시도] {len(items)}개 - 전체 스크롤 없이 post_id로 조회")
    print("=" * 70)
    raws: list[dict] = []
    for item in items:
        pid = str(item.get("post_id"))
        raw = fetch_post_detail(pid)
        if raw:
            # 상세 응답 래핑 변화 대응
            if isinstance(raw.get("data"), dict):
                raw = raw["data"]
            raws.append(raw)
            print(f"  [재조회 성공] post_id={pid}")
        else:
            print(f"  [재조회 실패] post_id={pid} - 실패 목록에 유지")
    return raws


def merge_failed_file(current_failures: list[dict], processed_ids: set[str]) -> None:
    """이번에 처리한 글은 최신 결과로 교체하고, 이번 배치와 무관한 기존 실패는 보존합니다."""
    old = load_failed_items()
    keep = [x for x in old if str(x.get("post_id")) not in processed_ids]
    merged = keep + current_failures
    failed_file = BASE_DIR / "failed_posts.json"
    failed_file.write_text(
        json.dumps({"version": 2, "failures": merged}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


async def process_posts(raw_posts: list[dict], output_dir: Path, target_author_name: str = "",
                        cookiefile: Path | None = None, force_photo_refresh_ids: set[str] | None = None,
                        force_rebuild_ids: set[str] | None = None):
    raw_posts = await enrich_rendered_body_texts(raw_posts)
    force_photo_refresh_ids = force_photo_refresh_ids or set()
    force_rebuild_ids = force_rebuild_ids or set()
    parsed: dict[str, Post] = {}
    raw_by_id: dict[str, dict] = {}
    for raw in raw_posts:
        if not isinstance(raw, dict):
            continue
        pid = str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
        if pid:
            raw_by_id[pid] = raw

    # 상세 조회는 완료 여부를 원본과 정확히 대조하기 위해 필요하지만,
    # 이미 저장된 게시글까지 터미널에 표시하지는 않습니다.
    for pid, raw in raw_by_id.items():
        source_raw = raw
        if needs_post_detail(raw):
            source_raw = fetch_best_post_payload(raw)
            if isinstance(source_raw, dict):
                if raw.get("_renderedBody"):
                    source_raw["_renderedBody"] = raw.get("_renderedBody")
                source_raw["_renderedBodyVerified"] = raw.get("_renderedBodyVerified", False)
        post = parse_post(source_raw)
        if post:
            parsed[post.post_id] = post

    all_posts = sorted(parsed.values(), key=lambda p: p.dt)
    authors_found = sorted(set(p.author for p in all_posts))
    print(f"\n수집된 게시글의 작성자 목록: {authors_found}")

    if target_author_name:
        posts = [p for p in all_posts if p.author.strip() == target_author_name.strip()]
        if not posts:
            print(f"⚠ '{target_author_name}' 게시글을 찾지 못했습니다. 작성자 이름 설정을 확인해주세요.")
            return
    else:
        posts = all_posts

    output_dir.mkdir(parents=True, exist_ok=True)
    moved_folders, migration_notes = migrate_existing_post_folders(output_dir)
    if moved_folders:
        print(f"[정리] 기존 게시글 폴더 {moved_folders}개를 연도/월 구조로 이동했습니다.")
    for note in migration_notes:
        print(f"[정리 경고] {note}")
    removed_markers = cleanup_legacy_post_id_files(output_dir)
    if removed_markers:
        print(f"[정리] 예전 .post_id 관리 파일 {removed_markers}개를 삭제했습니다.")

    saved = load_saved_post_ids(output_dir)
    pending: list[Post] = []
    existing_dirs: dict[str, Path] = {}
    pending_reasons: dict[str, str] = {}
    changed_saved = False
    skipped = 0

    for p in posts:
        existing = find_existing_post_dir(p, output_dir)
        complete, reason = check_existing_post_complete(p, existing)

        # v18 1회 혼합 미디어 감사: 예전 버전에서 영상 썸네일이 사진 1,2번 JPG를
        # 덮어쓴 흔적은 파일 개수만으로는 잡히지 않을 수 있으므로 사진을 원본에서 다시 구성합니다.
        if p.post_id in force_photo_refresh_ids and existing:
            complete = False
            reason = "혼합 미디어 썸네일 충돌 1회 재감사 - 사진 전체 원본 재구성"

        if p.post_id in force_rebuild_ids:
            complete = False
            reason = "v19 이모티콘 PDF 1회 재감사 - 화면용 body 기준으로 PDF 재생성"

        if complete:
            skipped += 1
            existing_dirs[p.post_id] = existing
            if p.post_id not in saved:
                saved.add(p.post_id)
                changed_saved = True
            # PDF가 있는 정상 글도 루트 인덱스를 최신 폴더 경로로 보강합니다.
            idx = load_saved_post_index()
            try:
                rel = str(existing.relative_to(output_dir)).replace("\\", "/")
            except Exception:
                rel = str(existing)
            old_entry = idx.get(p.post_id, {}) if isinstance(idx.get(p.post_id, {}), dict) else {}
            if old_entry.get("folder") != rel:
                old_entry.update({
                    "folder": rel,
                    "date": p.dt.strftime("%Y-%m-%d"),
                    "is_moment": bool(p.is_moment),
                    "is_membership": bool(p.is_membership),
                })
                idx[p.post_id] = old_entry
                save_saved_post_ids(saved, idx)
            # 완성된 게시글은 의도적으로 아무 로그도 출력하지 않음.
            continue

        if p.post_id in saved:
            saved.discard(p.post_id)
            changed_saved = True
        if existing:
            existing_dirs[p.post_id] = existing
        pending_reasons[p.post_id] = reason
        pending.append(p)

    if changed_saved:
        save_saved_post_ids(saved)

    print("\n" + "=" * 70)
    print(f"대조 완료: 수집 {len(posts)}개 / 이미 완성되어 조용히 스킵 {skipped}개 / 처리 필요 {len(pending)}개")
    print("=" * 70)

    if not pending:
        print("새로 저장하거나 복구할 게시글이 없습니다. 모든 게시글이 완성 상태입니다.")
        merge_failed_file([], {p.post_id for p in posts})
        return

    # 같은 날짜에 여러 게시글이 있을 때 신규 폴더 번호를 안전하게 붙입니다.
    used_dates: dict[str, int] = {}
    failures: list[dict] = []
    completed_new = 0
    completed_repaired = 0

    for post in pending:
        date_str = post.dt.strftime("%Y-%m-%d")
        suffix_parts: list[str] = []
        if post.is_moment:
            suffix_parts.append("모먼트")
        if post.is_membership:
            suffix_parts.append("멤버십")
        suffix = ("_" + "_".join(suffix_parts)) if suffix_parts else ""
        base_folder_name = date_str + suffix

        existing_post_dir = existing_dirs.get(post.post_id)
        was_repair = existing_post_dir is not None
        if was_repair:
            post_dir = existing_post_dir
            folder_name = post_dir.name
            print(f"\n[미완성 재처리] {folder_name} | 이유: {pending_reasons.get(post.post_id, '검증 실패')}")
        else:
            month_dir = post_month_dir(output_dir, post.dt)
            month_dir.mkdir(parents=True, exist_ok=True)
            folder_name = unique_folder_name(base_folder_name, used_dates)
            while (month_dir / safe_filename(folder_name)).exists():
                folder_name = unique_folder_name(base_folder_name, used_dates)
            post_dir = month_dir / safe_filename(folder_name)
            post_dir.mkdir(parents=True, exist_ok=True)
            print(f"\n[미저장 게시글] {folder_name} | post_id={post.post_id}")

        failure_reasons: list[str] = []

        # 예전 버전의 20장 절단/순서 오류를 복구하는 글은 기존 사진을 그대로 믿지 않고
        # 확보한 전체 원본 URL 순서대로 사진을 전부 다시 받아 번호를 재구성합니다.
        repair_reason = pending_reasons.get(post.post_id, "")
        if was_repair and any(token in repair_reason for token in (
            "사진", "PhotoCount", "SourceSHA256", "PhotoFilesSHA256",
            "원본 사진 URL", "혼합 미디어 썸네일 충돌"
        )):
            removed = 0
            for old_image in list(post_dir.iterdir()):
                if old_image.is_file() and old_image.suffix.lower() in _IMAGE_EXTS and not old_image.name.startswith(".pdf_"):
                    try:
                        old_image.unlink(); removed += 1
                    except OSError:
                        pass
            if removed:
                print(f"    ↳ 기존 사진 {removed}개를 지우고 원본 순서대로 다시 받습니다.")

        expected_photo_count = _expected_photo_count(post)
        if len(post.photo_urls) != expected_photo_count:
            failure_reasons.append(
                f"원본 사진 URL 확보 부족 ({len(post.photo_urls)}/{expected_photo_count}) - 20장 제한 보강 실패"
            )

        # 사진 다운로드
        photo_paths: list[Path] = []
        for i, purl in enumerate(post.photo_urls, start=1):
            ext = ".jpg"
            m = re.search(r"\.(jpg|jpeg|png|webp|gif)(\?|$)", purl, re.I)
            if m:
                ext = "." + m.group(1).lower()
            dest = post_dir / f"{folder_name}_{i}{ext}"
            if dest.exists() and dest.stat().st_size > 0:
                photo_paths.append(dest)
                continue
            if download_file(purl, dest):
                photo_paths.append(dest)
            else:
                failure_reasons.append(f"사진 {i} 다운로드 실패")

        # 영상 다운로드
        downloaded_video_paths: list[Path] = []
        dest_no_ext = post_dir / folder_name
        if post.video_ids:
            downloaded_video_paths = await download_cvideo_ids(
                post.video_ids, post.url, dest_no_ext, cookiefile=cookiefile,
                video_id_groups=post.video_id_groups
            )
        if not downloaded_video_paths and post.video_urls:
            downloaded_video_paths = await download_video_with_fallback(
                post.video_urls, post.url, dest_no_ext, cookiefile=cookiefile
            )
        expected_video_count = _expected_video_count(post)
        if expected_video_count and len(downloaded_video_paths) < expected_video_count:
            failure_reasons.append(
                f"영상 저장 실패/누락 ({len(downloaded_video_paths)}/{expected_video_count})"
            )

        # 위버스 전용 이모티콘: PDF 삽입용 임시 파일
        temp_emoticons: list[Path] = []
        for i, emoticon_url in enumerate(post.emoticon_urls, start=1):
            ext = ".png"
            em = re.search(r"\.(png|jpg|jpeg|webp|gif)(?:\?|$)", emoticon_url, re.I)
            if em:
                ext = "." + em.group(1).lower()
            candidate = post_dir / f".pdf_emoticon_{i}{ext}"
            if download_file(emoticon_url, candidate):
                temp_emoticons.append(candidate)
        if len(temp_emoticons) != len(post.emoticon_urls):
            failure_reasons.append(
                f"이모티콘 준비 실패/누락 ({len(temp_emoticons)}/{len(post.emoticon_urls)})"
            )

        # 영상 미리보기: PDF 삽입용 임시 파일
        expected_slots = post.video_attachment_count or len(post.video_id_groups) or (1 if post.video_urls else 0)
        temp_video_thumbs: list[Path] = []
        video_entries = []
        for i in range(max(expected_slots, len(downloaded_video_paths))):
            vpath = downloaded_video_paths[i] if i < len(downloaded_video_paths) else None
            thumb_path = None
            if i < len(post.video_thumb_urls):
                thumb_url = post.video_thumb_urls[i]
                thumb_ext = ".jpg"
                tm = re.search(r"\.(jpg|jpeg|png|webp)(?:\?|$)", thumb_url, re.I)
                if tm:
                    thumb_ext = "." + tm.group(1).lower()
                candidate = post_dir / f".pdf_video_thumb_{i + 1}{thumb_ext}"
                if download_file(thumb_url, candidate):
                    thumb_path = candidate
                    temp_video_thumbs.append(candidate)
            video_entries.append((vpath, thumb_path))

        if len(temp_video_thumbs) != len(post.video_thumb_urls):
            failure_reasons.append(
                f"영상 미리보기 준비 실패/누락 ({len(temp_video_thumbs)}/{len(post.video_thumb_urls)})"
            )

        for old_thumb in list(post_dir.glob("*_video*_thumb.*")) + list(post_dir.glob("*video*preview*.*")):
            try:
                old_thumb.unlink()
            except OSError:
                pass

        pdf_path = post_dir / f"{folder_name}.pdf"
        display_dt = post.dt.strftime("%Y-%m-%d %H:%M")
        try:
            await build_post_pdf(
                pdf_path=pdf_path,
                post_date_str=display_dt,
                text=post.text,
                post_url=post.url,
                photo_paths=photo_paths,
                video_entries=video_entries,
                emoticon_paths=temp_emoticons,
                validation_meta=_post_validation_meta(post, photo_paths=photo_paths, video_paths=downloaded_video_paths),
            )
        except Exception as e:
            failure_reasons.append(f"PDF 생성 실패: {type(e).__name__}: {e}")
        finally:
            for tmp_emoticon in temp_emoticons:
                try:
                    tmp_emoticon.unlink()
                except OSError:
                    pass
            for tmp_thumb in temp_video_thumbs:
                try:
                    tmp_thumb.unlink()
                except OSError:
                    pass

        if not failure_reasons and pdf_path.exists():
            pdf_ok, pdf_reason = _pdf_validation_matches(
                pdf_path, post, photo_paths=photo_paths, video_paths=downloaded_video_paths
            )
            if not pdf_ok:
                failure_reasons.append(f"최종 원본 대조 실패: {pdf_reason}")
        elif not pdf_path.exists() and not any(x.startswith("PDF 생성 실패") for x in failure_reasons):
            failure_reasons.append("PDF 파일이 생성되지 않음")

        if not failure_reasons:
            mark_post_saved(post.post_id, saved, post_dir=post_dir, output_dir=output_dir, post=post)
            if was_repair:
                completed_repaired += 1
                print(f"[복구 완료] 미완성 폴더를 다시 완성했습니다: {folder_name}")
            else:
                completed_new += 1
                print(f"[저장 완료] {folder_name}")
        else:
            # 실패한 게시글은 완료 목록에 절대 남기지 않습니다.
            if post.post_id in saved:
                saved.discard(post.post_id)
                save_saved_post_ids(saved)
            unique_reasons = list(dict.fromkeys(failure_reasons))
            print(f"[실패] {folder_name}")
            for reason in unique_reasons:
                print(f"       - {reason}")
            failures.append({
                "post_id": post.post_id,
                "date": post.dt.isoformat(),
                "folder": folder_name,
                "url": post.url,
                "reasons": unique_reasons,
            })

    # 이번에 건드린 post_id만 최신 결과로 교체하고, 다른 과거 실패는 보존합니다.
    failed_file = BASE_DIR / "failed_posts.json"
    merge_failed_file(failures, {p.post_id for p in posts})

    print("\n" + "=" * 70)
    print("작업 결과")
    print(f"  이미 완성되어 스킵: {skipped}개")
    print(f"  새로 저장 완료:      {completed_new}개")
    print(f"  미완성 복구 완료:    {completed_repaired}개")
    print(f"  실패:                {len(failures)}개")

    if failures:
        print("\n[실패 목록]")
        for n, item in enumerate(failures, start=1):
            print(f"  {n}. {item['folder']} | post_id={item['post_id']}")
            for reason in item["reasons"]:
                print(f"     - {reason}")
            print(f"     - {item['url']}")
        print(f"\n실패 목록 파일: {failed_file}")
        print("실패한 게시글은 saved_posts.json에 완료 처리되지 않았으므로 다음 실행 때 자동 재시도됩니다.")
    else:
        print("\n실패한 게시글이 없습니다.")
    print("=" * 70)



def _extract_output_post_ids(output_dir: Path) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    if not output_dir.exists():
        return result
    try:
        from pypdf import PdfReader
    except Exception:
        return result
    for folder in iter_post_dirs(output_dir):
        pid = ""
        for pdf in folder.glob("*.pdf"):
            try:
                md = PdfReader(str(pdf)).metadata or {}
                pid = str(md.get("/WeversePostID") or "").strip()
                if not pid:
                    text = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(pdf)).pages[:3])
                    m = re.search(r"weverse\.io/[^\s]+/(?:artist|posts?)/([0-9A-Za-z-]+)", text, re.I)
                    if m:
                        pid = m.group(1)
                if pid:
                    break
            except Exception:
                continue
        if pid:
            result.setdefault(pid, []).append(str(folder.relative_to(output_dir)))
    return result


def write_integrity_report(output_dir: Path, discovered_ids: set[str]) -> None:
    folder_map = _extract_output_post_ids(output_dir)
    failed = load_failed_items()
    failed_ids = {str(x.get("post_id")) for x in failed}
    saved = load_saved_post_ids(output_dir)
    duplicate_folders = {pid: folders for pid, folders in folder_map.items() if len(folders) > 1}
    orphan_ids = sorted(set(folder_map) - discovered_ids)
    missing_ids = sorted(discovered_ids - set(folder_map))
    payload = {
        "version": 18,
        "created_at": datetime.now().isoformat(),
        "discovered_post_count": len(discovered_ids),
        "folder_post_count": len(folder_map),
        "saved_complete_count": len(discovered_ids & saved),
        "failed_count": len(failed_ids & discovered_ids),
        "missing_folder_post_ids": missing_ids,
        "orphan_folder_post_ids": orphan_ids,
        "duplicate_post_folders": duplicate_folders,
        "failures": failed,
    }
    path = BASE_DIR / "integrity_report.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n" + "=" * 70)
    print("전체 무결성 검사 보고서")
    print(f"  위버스에서 발견:       {len(discovered_ids)}개")
    print(f"  post ID가 확인된 폴더: {len(folder_map)}개")
    print(f"  완료 기록:             {len(discovered_ids & saved)}개")
    print(f"  현재 실패:             {len(failed_ids & discovered_ids)}개")
    print(f"  폴더 없음:             {len(missing_ids)}개")
    print(f"  위버스 목록엔 없고 폴더만 있음: {len(orphan_ids)}개")
    print(f"  같은 post ID 중복 폴더: {len(duplicate_folders)}개")
    print(f"  보고서: {path}")
    print("=" * 70)


def select_v22_text_rebuild_raws(raws: list[dict], output_dir: Path) -> tuple[list[dict], set[str]]:
    selected, ids = [], set()
    for raw in raws:
        if not isinstance(raw, dict):
            continue
        pid = str(raw.get("postId") or raw.get("id") or raw.get("postID") or "")
        if not pid:
            continue
        rendered = str(raw.get("_renderedBody") or "")
        plain = str(raw.get("plainBody") or raw.get("body") or "")
        old_count = _pdf_emoticon_count_for_post(output_dir, pid)
        if old_count > 0 or (rendered and rendered != plain):
            selected.append(raw); ids.add(pid)
    return selected, ids


async def main():
    config = load_config()
    output_dir = BASE_DIR / config.get("output_dir", "output")
    target_author = config.get("target_author_name", "")

    await ensure_authenticated_session()
    cookiefile = build_yt_dlp_cookiefile(SESSION_FILE, BASE_DIR / "yt_dlp_cookies.txt")

    # 실패 글은 먼저 post_id로 직접 재시도합니다.
    retry_raws = fetch_failed_post_raws()
    if retry_raws:
        retry_raws = await enrich_truncated_raws_browser(retry_raws)
        await process_posts(retry_raws, output_dir, target_author_name=target_author, cookiefile=cookiefile)

    # v27: 매 실행마다 '로컬 파일'만 빠르게 훑습니다.
    # 전체 Weverse 과거 목록을 다시 스크롤하지 않고, PDF/사진/영상이 실제로 사라진
    # 폴더만 saved_posts.json의 post_id 인덱스로 직접 API 조회해 복구합니다.
    if output_dir.exists():
        local_repair_ids, local_notices = local_quick_integrity_scan(output_dir)
        if local_notices:
            print("\n[로컬 누락 감지]")
            for line in local_notices:
                print("  - " + line)
        if local_repair_ids:
            print(f"[로컬 자동 복구] {len(local_repair_ids)}개만 post_id로 직접 확인합니다. 전체 과거 스크롤은 하지 않습니다.")
            local_raws, local_fetch_failed = fetch_audit_raws(local_repair_ids)
            if local_raws:
                local_raws = await enrich_truncated_raws_browser(local_raws)
                await process_posts(local_raws, output_dir, target_author_name=target_author, cookiefile=cookiefile)
            if local_fetch_failed:
                print(f"[로컬 자동 복구 보류] API 조회 불가 {len(local_fetch_failed)}개 - 다음 실행에서 다시 검사합니다.")
        elif local_notices:
            print("[로컬 검사] 누락은 발견했지만 post_id를 특정하지 못한 폴더가 있어 자동 복구하지 못했습니다.")
        else:
            print("[로컬 빠른 검사 완료] 기존 저장물의 PDF/사진/영상 누락 없음")

    state = load_scan_state()

    # v32는 v26~v28의 Unicode/본문 검사를 모두 포함합니다. 예전 완료 플래그가
    # 빠진 설치에서는 매 실행마다 전체 게시글을 API/브라우저로 다시 대조하던
    # 문제가 있었으므로 최신 감사 완료 상태에서 구형 감사를 즉시 종료합니다.
    if state.get("pdf_unicode_engine_audit_v32_done") and not state.get("pdf_extractable_unicode_audit_v26_done"):
        save_scan_state(state.get("checkpoint_ids", []), {
            "pdf_extractable_unicode_audit_v26_done": True,
            "pdf_unicode_text_audit_v25_done": True,
            "pdf_text_cleanup_audit_v24_done": True,
            "rendered_body_audit_v24_done": True,
        })
        state = load_scan_state()
        print("[속도 최적화] v32 완료 결과를 적용해 구형 v24~v26 전체 재감사를 건너뜁니다.")

    # v30: Chromium PDF 엔진 1회 감사.
    # 기존 PDF 중 emoji/VS/ZWJ 추출이 깨진 파일만 골라 post_id로 직접 재조회하여
    # Chromium 기반 PDF로 재생성합니다. 전체 Weverse 목록 스크롤은 하지 않습니다.
    if not state.get("pdf_unicode_engine_audit_v32_done"):
        from pypdf import PdfReader
        pdfs = sorted(output_dir.rglob("*.pdf")) if output_dir.exists() else []
        print("\n" + "#" * 70)
        print(f"[v32 PDF 정확 Unicode 1회 검사] 기존 PDF {len(pdfs)}개")
        print("- emoji를 이미지로 치환하지 않고 Chromium Unicode 텍스트로 보존")
        print("- 🩷/🩶/🫶/🥹/🙂 + FE0F/ZWJ까지 실제 추출 검증")
        print("- 깨진 PDF만 post_id로 직접 재생성 (전체 과거 스크롤 없음)")
        print("#" * 70)
        started = time.monotonic()
        bad_ids = []
        bad_without_id = []
        for i, pdf in enumerate(pdfs, 1):
            source_text = ""
            pid = ""
            try:
                md = PdfReader(str(pdf)).metadata or {}
                source_text = str(md.get("/WeverseBodyText") or "")
                pid = str(md.get("/WeversePostID") or "")
            except Exception:
                pass
            ok, reason, _ = repair_pdf_unicode_file(pdf, source_text=source_text, verify=True)
            if not ok:
                if pid:
                    bad_ids.append(pid)
                else:
                    bad_without_id.append(f"{pdf}: {reason}")
            _progress("v32 PDF Unicode", i, len(pdfs), started, ok=i-len(bad_ids)-len(bad_without_id), failed=len(bad_ids)+len(bad_without_id), current=pdf.name)

        bad_ids = list(dict.fromkeys(bad_ids))
        fetch_failed = []
        if bad_ids:
            print(f"\n[v32 PDF 재생성] Unicode가 깨진 {len(bad_ids)}개만 post_id로 직접 다시 만듭니다.")
            raws, fetch_failed = fetch_audit_raws(bad_ids)
            if raws:
                raws = await enrich_truncated_raws_browser(raws)
                await process_posts(raws, output_dir, target_author_name=target_author, cookiefile=cookiefile, force_rebuild_ids=set(bad_ids))

        # 재생성 뒤 한 번 더 로컬 검증. 실패가 하나라도 남으면 완료 플래그를 찍지 않습니다.
        remain = []
        for pdf in sorted(output_dir.rglob("*.pdf")) if output_dir.exists() else []:
            try:
                md = PdfReader(str(pdf)).metadata or {}
                source_text = str(md.get("/WeverseBodyText") or "")
            except Exception:
                source_text = ""
            ok, reason, _ = repair_pdf_unicode_file(pdf, source_text=source_text, verify=True)
            if not ok:
                remain.append(f"{pdf}: {reason}")

        if bad_without_id:
            print("[v32 post_id 식별 불가 PDF]")
            for item in bad_without_id[:20]:
                print("  - " + item)
        if fetch_failed:
            print(f"[v32 재생성 API 조회 실패] {len(fetch_failed)}개: " + ", ".join(fetch_failed))
        if remain or bad_without_id or fetch_failed:
            print(f"[v32 감사 보류] 아직 Unicode 검증 실패 PDF {len(remain)}개 - 다음 실행에서 다시 시도합니다.")
        else:
            save_scan_state(state.get("checkpoint_ids", []), {
                "pdf_unicode_engine_audit_v32_done": True,
                "pdf_unicode_engine_audit_v32_checked": len(pdfs),
                "pdf_unicode_engine_audit_v32_rebuilt": len(bad_ids),
                "pdf_unicode_engine_audit_v31_done": True,
                "pdf_unicode_engine_audit_v29_done": True,
                # v30가 v28/v29의 목적을 포함하므로 구버전 전체 검사를 다시 돌리지 않습니다.
                "pdf_unicode_integrity_audit_v28_done": True,
            })
            state = load_scan_state()
            print(f"[v32 PDF Unicode 검사 완료] {len(pdfs)}개 확인 / 재생성 {len(bad_ids)}개")

    # v28: v27에서 새 기능 추가 후에도 astral emoji가 깨진 PDF가 생길 수 있었던 회귀 방지.
    # API/브라우저를 다시 돌지 않고, 기존 PDF의 WeverseBodyText 메타데이터를 원문으로 삼아
    # 최종 PDF 자체의 ToUnicode를 직접 검사/교정합니다. 한 번 완료한 뒤에는 다시 전체 스캔하지 않습니다.
    if not state.get("pdf_unicode_integrity_audit_v28_done"):
        pdfs = sorted(output_dir.rglob("*.pdf")) if output_dir.exists() else []
        print("\n" + "#" * 70)
        print(f"[v28 PDF Unicode 무결성 1회 검사] 기존 PDF {len(pdfs)}개")
        print("- 🙂/😭/🥹 등 U+10000 이상 이모지를 실제 Unicode로 추출 가능한지 검사")
        print("- 잘못된 <1F642> 형태의 ToUnicode를 <D83DDE42> 형태로 직접 교정")
        print("- API 재조회/전체 위버스 스크롤 없이 로컬 PDF만 처리")
        print("#" * 70)
        started = time.monotonic()
        fixed_count = 0
        failed_count = 0
        failed_items = []
        for i, pdf in enumerate(pdfs, 1):
            source_text = ""
            try:
                from pypdf import PdfReader
                md = PdfReader(str(pdf)).metadata or {}
                source_text = str(md.get("/WeverseBodyText") or "")
            except Exception:
                source_text = ""
            ok, reason, repaired = repair_pdf_unicode_file(pdf, source_text=source_text, verify=True)
            if repaired:
                fixed_count += 1
            if not ok:
                failed_count += 1
                failed_items.append(f"{pdf}: {reason}")
            _progress("v28 PDF Unicode", i, len(pdfs), started, ok=i-failed_count, failed=failed_count, current=pdf.name)
        if failed_items:
            print("[v28 Unicode 검사 실패]")
            for item in failed_items[:30]:
                print("  - " + item)
            if len(failed_items) > 30:
                print(f"  ... 외 {len(failed_items)-30}개")
            print("[v28 감사 보류] 실패 PDF가 있어 다음 실행에서 다시 검사합니다.")
        else:
            save_scan_state(state.get("checkpoint_ids", []), {
                "pdf_unicode_integrity_audit_v28_done": True,
                "pdf_unicode_integrity_audit_v28_checked": len(pdfs),
                "pdf_unicode_integrity_audit_v28_fixed": fixed_count,
            })
            state = load_scan_state()
            print(f"[v28 PDF Unicode 검사 완료] {len(pdfs)}개 확인 / 실제 교정 {fixed_count}개")

    # v26 1회 PDF Unicode 텍스트 추출 교정 감사.
    # v25에서는 화면에는 emoji가 보이지만 U+10000 이상 emoji의 ToUnicode CMap이
    # 잘못 저장되어 PDF 텍스트 추출 시 깨지는 문제가 있었습니다.
    # v26은 모든 기존 PDF를 한 번 재생성해 실제 복사/추출 결과까지 원문 Unicode와 일치시킵니다.
    v26_audit_attempted = bool(state.get("pdf_extractable_unicode_audit_v26_done"))
    if not v26_audit_attempted:
        v26_audit_attempted = True
        all_saved_ids = find_all_saved_post_ids(output_dir)
        print("\n" + "#" * 70)
        print(f"[v26 PDF 이모지 텍스트 교정 1회 감사] 저장된 게시글 {len(all_saved_ids)}개")
        print("- 이모지를 이미지가 아닌 실제 Unicode 문자로 유지")
        print("- 🙂/😭/🥹 등 U+10000 이상 문자의 PDF ToUnicode 매핑 교정")
        print("- PDF 복사/텍스트 추출 결과도 원문과 동일하게 재생성")
        print("#" * 70)
        audit_raws, audit_fetch_failed = fetch_audit_raws(all_saved_ids)
        if audit_raws:
            audit_raws = await enrich_rendered_body_texts_v24(audit_raws, concurrency=4)
            rebuild_ids = {str(r.get("postId") or r.get("id") or r.get("postID") or "") for r in audit_raws if isinstance(r, dict)}
            rebuild_ids.discard("")
            print(f"\n[v26 PDF 재생성] API 확인 가능한 {len(rebuild_ids)}개 PDF를 다시 만듭니다.")
            await process_posts(audit_raws, output_dir, target_author_name=target_author, cookiefile=cookiefile, force_rebuild_ids=rebuild_ids)
        if not audit_fetch_failed:
            save_scan_state(state.get("checkpoint_ids", []), {
                "pdf_extractable_unicode_audit_v26_done": True,
                "pdf_extractable_unicode_audit_v26_checked": len(all_saved_ids),
                "pdf_extractable_unicode_audit_v26_rebuilt": len(audit_raws),
                # v26이 v25/v24의 교정 내용을 모두 포함하므로 이전 감사 재실행을 막습니다.
                "pdf_unicode_text_audit_v25_done": True,
                "pdf_text_cleanup_audit_v24_done": True,
                "rendered_body_audit_v24_done": True,
            })
            state = load_scan_state()
            print(f"[v26 PDF 이모지 텍스트 교정 완료] 재생성 {len(audit_raws)}개")
        else:
            print(f"[v26 PDF 이모지 텍스트 교정 미완료] API 조회 불가 {len(audit_fetch_failed)}개 - 다음 실행에서 다시 시도합니다.")
            print("  조회 불가 post_id: " + ", ".join(audit_fetch_failed))

    # v25 1회 PDF 본문 데이터 교정 감사.
    # v24까지 Unicode 이모지를 PNG로 표시했던 PDF를 실제 Unicode 텍스트로 다시 생성하고,
    # 모먼트 SourceSHA256도 변동 URL이 아닌 안정값 기준으로 교정합니다.
    if (not v26_audit_attempted) and not state.get("pdf_unicode_text_audit_v25_done"):
        all_saved_ids = find_all_saved_post_ids(output_dir)
        print("\n" + "#" * 70)
        print(f"[v25 PDF 본문 교정 1회 감사] 저장된 게시글 {len(all_saved_ids)}개")
        print("- 이모지 PNG 치환 제거 → 실제 Unicode 텍스트로 PDF 저장")
        print("- PDF 메타데이터 WeverseBodyText에 원문 Unicode를 그대로 보존")
        print("- 모먼트 SourceSHA256에서 매번 변하는 재생/썸네일 URL 제외")
        print("#" * 70)
        audit_raws, audit_fetch_failed = fetch_audit_raws(all_saved_ids)
        if audit_raws:
            audit_raws = await enrich_rendered_body_texts_v24(audit_raws, concurrency=4)
            rebuild_ids = {str(r.get("postId") or r.get("id") or r.get("postID") or "") for r in audit_raws if isinstance(r, dict)}
            rebuild_ids.discard("")
            print(f"\n[v25 PDF 본문 재생성] API 확인 가능한 {len(rebuild_ids)}개 PDF를 다시 만듭니다.")
            await process_posts(audit_raws, output_dir, target_author_name=target_author, cookiefile=cookiefile, force_rebuild_ids=rebuild_ids)
        if not audit_fetch_failed:
            save_scan_state(state.get("checkpoint_ids", []), {
                "pdf_unicode_text_audit_v25_done": True,
                "pdf_unicode_text_audit_v25_checked": len(all_saved_ids),
                "pdf_unicode_text_audit_v25_rebuilt": len(audit_raws),
            })
            state = load_scan_state()
            print(f"[v25 PDF 본문 교정 완료] 재생성 {len(audit_raws)}개")
        else:
            print(f"[v25 PDF 본문 교정 미완료] API 조회 불가 {len(audit_fetch_failed)}개 - 다음 실행에서 다시 시도합니다.")
            print("  조회 불가 post_id: " + ", ".join(audit_fetch_failed))

    # v24 1회 PDF 정화 + 본문/이모지 정확성 감사.
    if (not v26_audit_attempted) and not state.get("pdf_text_cleanup_audit_v24_done"):
        all_saved_ids=find_all_saved_post_ids(output_dir)
        print("\n"+"#"*70)
        print(f"[v24 PDF 정화 1회 감사] 저장된 게시글 {len(all_saved_ids)}개")
        print("- 잘못 삽입된 프로필/멤버 이미지를 기존 PDF에서 제거")
        print("- 빈 글에 Weverse 사이트 제목이 들어가는 버그 차단")
        print("- Unicode 이모지는 실제 게시글 화면을 병렬 대조해 복원")
        print("#"*70)
        audit_raws,audit_fetch_failed=fetch_audit_raws(all_saved_ids)
        if audit_raws:
            audit_raws=await enrich_rendered_body_texts_v24(audit_raws,concurrency=4)
            rebuild_ids={str(r.get("postId") or r.get("id") or r.get("postID") or "") for r in audit_raws if isinstance(r,dict)}
            rebuild_ids.discard("")
            print(f"\n[v24 PDF 정화 재생성] API 확인 가능한 {len(rebuild_ids)}개 PDF를 다시 만듭니다.")
            await process_posts(audit_raws,output_dir,target_author_name=target_author,cookiefile=cookiefile,force_rebuild_ids=rebuild_ids)
        save_scan_state(state.get("checkpoint_ids",[]),{
            "pdf_text_cleanup_audit_v24_done":True,
            "rendered_body_audit_v24_done":True,
            "rendered_body_audit_v23_done":True,
            "rendered_body_audit_v22_done":True,
            "pdf_text_cleanup_audit_v24_checked":len(all_saved_ids),
            "pdf_text_cleanup_audit_v24_rebuilt":len(audit_raws),
            "pdf_text_cleanup_audit_v24_api_unavailable":audit_fetch_failed,
        })
        state=load_scan_state()
        print(f"[v24 PDF 정화 완료] 재생성 {len(audit_raws)}개 / API 조회 불가 {len(audit_fetch_failed)}개")
        if audit_fetch_failed:
            print("  [확인 필요] API 조회 불가 post_id: "+", ".join(audit_fetch_failed))

    # v18 1회 혼합 미디어 복구 감사. 예전 버전에서 영상 썸네일 JPG가 사진 1/2번과
    # 같은 파일명을 사용해 덮어썼을 가능성이 있는 "사진+영상" 게시글만 직접 재조회합니다.
    # 전체 멤버 목록을 다시 스크롤하지 않고 PDF 메타데이터의 post_id로 처리합니다.
    if not state.get("mixed_media_photo_collision_audit_v18_done"):
        mixed_ids = find_mixed_media_audit_post_ids(output_dir)
        if mixed_ids:
            print("\n" + "#" * 70)
            print(f"[v18 혼합 미디어 1회 복구 감사] 사진+영상 게시글 {len(mixed_ids)}개")
            print("예전 영상 썸네일이 사진 JPG를 덮어쓴 흔적을 없애기 위해 사진만 원본 순서로 전부 다시 구성합니다.")
            print("영상 파일은 정상 파일이 있으면 다시 받지 않습니다.")
            print("#" * 70)
            mixed_raws, mixed_fetch_failed = fetch_audit_raws(mixed_ids)
            if mixed_raws:
                mixed_raws = await enrich_truncated_raws_browser(mixed_raws)
                await process_posts(
                    mixed_raws, output_dir, target_author_name=target_author,
                    cookiefile=cookiefile, force_photo_refresh_ids=set(mixed_ids)
                )
            # 직접 조회 자체가 실패한 post_id가 있으면 완료 플래그를 남기지 않아 다음 실행에 다시 시도합니다.
            if not mixed_fetch_failed:
                save_scan_state(
                    state.get("checkpoint_ids", []),
                    {"mixed_media_photo_collision_audit_v18_done": True,
                     "mixed_media_photo_collision_audit_v18_count": len(mixed_ids)}
                )
                state = load_scan_state()
                print("[v18 혼합 미디어 감사 완료] 다음 실행부터는 이 1회 재구성을 반복하지 않습니다.")
            else:
                print(f"[v18 혼합 미디어 감사 미완료] 상세조회 실패 {len(mixed_fetch_failed)}개 - 다음 실행에서 다시 시도합니다.")
        else:
            save_scan_state(
                state.get("checkpoint_ids", []),
                {"mixed_media_photo_collision_audit_v18_done": True,
                 "mixed_media_photo_collision_audit_v18_count": 0}
            )
            state = load_scan_state()

    full_audit_needed = not state.get("full_integrity_audit_v16_done")

    if full_audit_needed:
        print("\n" + "#" * 70)
        print("[v16 전체 무결성 검사] 기존 초기 버전 저장물을 처음부터 끝까지 다시 대조합니다.")
        print("이번 1회는 저장된 글을 만나도 중간 종료하지 않습니다.")
        print("정상 게시글은 다시 저장하지 않고, 누락/불일치 게시글만 복구합니다.")
        print("#" * 70)
        raw_posts = await collect_raw_responses(known_complete_ids=set(), full_integrity_scan=True)
        discovered_ids = {str(x.get("postId") or x.get("id") or x.get("postID") or "") for x in raw_posts if isinstance(x, dict)}
        discovered_ids.discard("")
        if raw_posts:
            raw_posts = await enrich_truncated_raws_browser(raw_posts)
            await process_posts(raw_posts, output_dir, target_author_name=target_author, cookiefile=cookiefile)
            write_integrity_report(output_dir, discovered_ids)
            # 전체 목록을 실제로 하나 이상 확보한 경우에만 1회 검사 완료로 기록
            cp = []
            for x in raw_posts:
                if not isinstance(x, dict):
                    continue
                pid = str(x.get("postId") or x.get("id") or x.get("postID") or "")
                if pid and pid not in cp:
                    cp.append(pid)
                if len(cp) >= 12:
                    break
            save_scan_state(cp, {"full_integrity_audit_v16_done": True, "full_integrity_post_count": len(discovered_ids)})
            print("[v16 전체 검사 완료] 다음 실행부터는 최근 구간 + 실패 글만 빠르게 확인합니다.")
        else:
            print("[전체 검사 실패] 멤버 게시글을 하나도 수집하지 못해 완료 처리하지 않았습니다. 다음 실행에서 다시 시도합니다.")
    else:
        known_complete = load_saved_post_ids(output_dir)
        raw_posts = await collect_raw_responses(known_complete_ids=known_complete, full_integrity_scan=False)
        if raw_posts:
            raw_posts = await enrich_truncated_raws_browser(raw_posts)
            await process_posts(raw_posts, output_dir, target_author_name=target_author, cookiefile=cookiefile)
        else:
            print("새로 수집된 게시글이 없습니다.")

    remaining_failures = load_failed_items()
    print("\n" + "=" * 70)
    print(f"최종 실패 목록: {len(remaining_failures)}개")
    if remaining_failures:
        for i, item in enumerate(remaining_failures, 1):
            print(f"  {i}. {item.get('folder') or item.get('date') or ''} | post_id={item.get('post_id')}")
            for reason in item.get("reasons", []):
                print(f"     - {reason}")
            if item.get("url"):
                print(f"     - {item['url']}")
        print(f"실패 목록 파일: {BASE_DIR / 'failed_posts.json'}")
    else:
        print("실패한 게시글이 없습니다.")
    print("=" * 70)
    print("\n모든 작업이 끝났습니다!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        print("\n[오류 발생] 아래 내용을 그대로 복사해서 문의해주세요:\n")
        traceback.print_exc()
        input("\n엔터를 누르면 창이 닫힙니다...")
