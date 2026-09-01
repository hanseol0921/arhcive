# -*- coding: utf-8 -*-
"""Weverse post PDF builder (v32).

v32 makes PDF copy/extraction independent from the browser's emoji font support.
Chromium is used only for the visible page. All visible post text is painted to canvas,
so Chromium's own PDF font/ToUnicode tables cannot corrupt or drop emoji. After printing,
a deterministic invisible Unicode text layer is injected directly into the PDF with a
custom Type0 font + ToUnicode CMap. The text layer contains the exact date/link/body
Unicode, including astral emoji, ZWJ, variation selectors, skin tones and blank lines.
No font files or emoji image substitutions are embedded for the canonical text layer.
"""
from __future__ import annotations

from pathlib import Path
import html
import json
import os
import shutil


def _extract_pdf_text(pdf_path: Path) -> str:
    from pypdf import PdfReader
    r = PdfReader(str(pdf_path))
    return "".join((p.extract_text() or "") for p in r.pages)


def _canonical_pdf_text(post_date_str: str, post_url: str, body: str) -> str:
    # Keep the same human-readable header while preserving body byte-for-byte as Python Unicode.
    return f"{post_date_str or ''}\n원본 링크: {post_url or ''}\n{body or ''}"


def _verify_pdf_unicode_text(
    pdf_path: Path,
    source_text: str,
    *,
    post_date_str: str = "",
    post_url: str = "",
) -> tuple[bool, str]:
    """Require exact extracted text, not merely emoji presence.

    This is intentionally stricter than v31: if any code point, ZWJ, VS16, blank line,
    or surrounding character changes, the post is incomplete and will be retried.
    """
    expected = _canonical_pdf_text(post_date_str, post_url, source_text)
    try:
        extracted = _extract_pdf_text(pdf_path)
    except Exception as e:
        return False, f"PDF 텍스트 추출 검사 실패: {type(e).__name__}: {e}"
    if extracted != expected:
        # Pinpoint a useful first difference without dumping the whole post.
        lim = min(len(extracted), len(expected))
        pos = next((i for i in range(lim) if extracted[i] != expected[i]), lim)
        if pos < lim:
            got = extracted[pos]
            want = expected[pos]
            return False, (
                f"PDF 정확 텍스트 불일치: 위치 {pos}, "
                f"기대 U+{ord(want):04X}({want!r}) / 추출 U+{ord(got):04X}({got!r})"
            )
        return False, f"PDF 정확 텍스트 길이 불일치: 기대 {len(expected)} / 추출 {len(extracted)}"

    # Metadata is an independent exact-source copy used by archive validation/recovery.
    try:
        from pypdf import PdfReader
        md = PdfReader(str(pdf_path)).metadata or {}
        canonical = str(md.get("/WeverseBodyText") or "")
    except Exception as e:
        return False, f"PDF 원문 메타데이터 검사 실패: {type(e).__name__}: {e}"
    if canonical != (source_text or ""):
        return False, "WeverseBodyText 원문 불일치"
    return True, ""


def _utf16be_hex(text: str) -> str:
    return text.encode("utf-16-be").hex().upper()


def _inject_exact_unicode_text_layer(pdf_path: Path, exact_text: str) -> None:
    """Inject a font-independent invisible copy/extraction layer.

    The font has no embedded glyph program because it is never painted (Tr 3). Each CID
    is mapped through /ToUnicode to the actual Unicode scalar/sequence. This makes copy
    and text extraction independent of whether Windows/Chromium can display that emoji.
    """
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (
        ArrayObject,
        DictionaryObject,
        NameObject,
        NumberObject,
        StreamObject,
        TextStringObject,
    )

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    if not writer.pages:
        raise ValueError("PDF 페이지가 없습니다")

    # One CID per unique Unicode code point. Newline is deliberately included as a mapped
    # character; this preserves repeated blank lines exactly, which text-position-only
    # extraction often collapses.
    unique: list[str] = []
    seen: set[str] = set()
    for ch in exact_text:
        if ch not in seen:
            seen.add(ch)
            unique.append(ch)
    if len(unique) > 65534:
        raise ValueError("PDF Unicode 문자 종류가 너무 많습니다")
    cid_for = {ch: i + 1 for i, ch in enumerate(unique)}

    mappings = [f"<{cid:04X}> <{_utf16be_hex(ch)}>" for ch, cid in cid_for.items()]
    cmap = (
        "/CIDInit /ProcSet findresource begin\n"
        "12 dict begin\n"
        "begincmap\n"
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        "/CMapName /WeverseArchiveUnicode def\n"
        "/CMapType 2 def\n"
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        f"{len(mappings)} beginbfchar\n" + "\n".join(mappings) +
        "\nendbfchar\n"
        "endcmap\n"
        "CMapName currentdict /CMap defineresource pop\n"
        "end\nend\n"
    ).encode("ascii")
    tu = StreamObject()
    tu.set_data(cmap)
    tu_ref = writer._add_object(tu)

    cidfont = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/CIDFontType2"),
        NameObject("/BaseFont"): NameObject("/WeverseArchiveInvisible"),
        NameObject("/CIDSystemInfo"): DictionaryObject({
            NameObject("/Registry"): TextStringObject("Adobe"),
            NameObject("/Ordering"): TextStringObject("Identity"),
            NameObject("/Supplement"): NumberObject(0),
        }),
        NameObject("/CIDToGIDMap"): NameObject("/Identity"),
        # Give selection/copy engines a sane advance width even though glyphs are invisible.
        NameObject("/DW"): NumberObject(500),
    })
    cid_ref = writer._add_object(cidfont)
    type0 = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type0"),
        NameObject("/BaseFont"): NameObject("/WeverseArchiveInvisible"),
        NameObject("/Encoding"): NameObject("/Identity-H"),
        NameObject("/DescendantFonts"): ArrayObject([cid_ref]),
        NameObject("/ToUnicode"): tu_ref,
    })
    font_ref = writer._add_object(type0)

    page = writer.pages[0]
    resources = page.get("/Resources")
    if resources is None:
        resources = DictionaryObject()
        page[NameObject("/Resources")] = resources
    else:
        resources = resources.get_object()
    fonts = resources.get("/Font")
    if fonts is None:
        fonts = DictionaryObject()
        resources[NameObject("/Font")] = fonts
    else:
        fonts = fonts.get_object()
    # Collision-proof resource name.
    resource_name = "/WVA32"
    n = 32
    while NameObject(resource_name) in fonts:
        n += 1
        resource_name = f"/WVA{n}"
    fonts[NameObject(resource_name)] = font_ref

    encoded = "".join(f"{cid_for[ch]:04X}" for ch in exact_text)
    # Tr=3 = invisible text. Unicode comes solely from /ToUnicode, not from a system font.
    content = (
        f"BT {resource_name} 10 Tf 3 Tr 54 740 Td <{encoded}> Tj ET\n"
    ).encode("ascii")
    layer = StreamObject()
    layer.set_data(content)
    layer_ref = writer._add_object(layer)

    old = page.get("/Contents")
    if old is None:
        page[NameObject("/Contents")] = layer_ref
    elif isinstance(old, ArrayObject):
        old.append(layer_ref)
    else:
        page[NameObject("/Contents")] = ArrayObject([old, layer_ref])

    tmp = pdf_path.with_suffix(".unicode-layer.tmp.pdf")
    with open(tmp, "wb") as f:
        writer.write(f)
    tmp.replace(pdf_path)


def repair_pdf_unicode_file(
    pdf_path: Path,
    *,
    source_text: str = "",
    post_date_str: str = "",
    post_url: str = "",
    verify: bool = True,
) -> tuple[bool, str, int]:
    """v32 validation hook.

    Old Chromium/ReportLab PDFs are not guessed/repaired in place because their original
    character order may already be lost. They are deliberately reported bad so the main
    archive can fetch that post_id and rebuild deterministically with v32.
    """
    if not verify:
        return True, "", 0
    # Historical/local audits often know only /WeverseBodyText, not the date/link.
    # In that mode, preserve v31-style targeted detection so we do NOT rebuild every
    # good legacy PDF. Any missing astral/ZWJ/VS/skin-tone code point marks only that
    # post for a v32 rebuild.
    if not post_date_str and not post_url:
        try:
            extracted = _extract_pdf_text(Path(pdf_path))
            from pypdf import PdfReader
            md = PdfReader(str(pdf_path)).metadata or {}
            if str(md.get("/WeverseBodyText") or "") != (source_text or ""):
                return False, "WeverseBodyText 원문 불일치", 0
            specials = [ch for ch in (source_text or "") if (
                ord(ch) > 0xFFFF or ord(ch) in (0x200D, 0xFE0E, 0xFE0F, 0x20E3)
                or 0x1F3FB <= ord(ch) <= 0x1F3FF
                or 0xE0020 <= ord(ch) <= 0xE007F
            )]
            missing = []
            for ch in dict.fromkeys(specials):
                need = specials.count(ch); got = extracted.count(ch)
                if got < need:
                    missing.append(f"{ch}(U+{ord(ch):X}, {got}/{need})")
            if missing:
                return False, "원문 Unicode 추출 누락: " + ", ".join(missing[:10]), 0
            return True, "", 0
        except Exception as e:
            return False, f"PDF 텍스트 추출 검사 실패: {type(e).__name__}: {e}", 0
    ok, reason = _verify_pdf_unicode_text(
        Path(pdf_path), source_text, post_date_str=post_date_str, post_url=post_url
    )
    return ok, reason, 0


def _file_uri(path: Path) -> str:
    return path.resolve().as_uri()


def _image_html(path: Path, max_class: str = "media") -> str:
    if not path or not path.exists():
        return ""
    src = html.escape(_file_uri(path), quote=True)
    return f'<div class="media-block"><img class="{max_class}" src="{src}"></div>'


async def build_post_pdf(
    pdf_path: Path,
    post_date_str: str,
    text: str,
    post_url: str,
    photo_paths: list[Path],
    video_entries: list[tuple[Path, Path | None]],
    emoticon_paths: list[Path] | None = None,
    validation_meta: dict | None = None,
):
    """Build one post PDF using Chromium for visuals + deterministic PDF Unicode layer."""
    from playwright.async_api import async_playwright

    pdf_path = Path(pdf_path)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    body = text or ""
    exact_text = _canonical_pdf_text(post_date_str or "", post_url or "", body)

    # All visible text is drawn to canvases. This intentionally prevents Chromium from
    # creating a second, font-dependent text layer that could duplicate/corrupt copy text.
    js_date = json.dumps(post_date_str or "", ensure_ascii=False)
    js_url = json.dumps("원본 링크: " + (post_url or ""), ensure_ascii=False)
    js_body = json.dumps(body, ensure_ascii=False)

    media_parts: list[str] = []
    # Schema-proven image stickers only; current parser normally supplies none.
    for ep in emoticon_paths or []:
        if ep and Path(ep).exists():
            media_parts.append(_image_html(Path(ep), "emoticon"))
    for p in photo_paths or []:
        media_parts.append(_image_html(Path(p)))
    for _video_path, thumb_path in video_entries or []:
        if thumb_path and Path(thumb_path).exists():
            media_parts.append(_image_html(Path(thumb_path)))

    doc_html = f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<style>
@page {{ size: A4; margin: 16mm 18mm; }}
html, body {{ margin:0; padding:0; }}
body {{ color:#111; }}
#text-root {{ width:100%; margin:0 0 8mm 0; }}
.text-canvas {{ display:block; width:100%; height:auto; margin:0; break-inside:avoid; }}
.media-block {{ break-inside:avoid; margin:0 0 6mm 0; }}
img.media {{ max-width:170mm; max-height:200mm; width:auto; height:auto; object-fit:contain; }}
img.emoticon {{ max-width:30mm; max-height:30mm; width:auto; height:auto; object-fit:contain; }}
</style></head><body>
<div id="text-root"></div>
{''.join(media_parts)}
<script>
(() => {{
  const dateText = {js_date};
  const urlText = {js_url};
  const bodyText = {js_body};
  const root = document.getElementById('text-root');
  const cssWidth = 680;
  const scale = 2;
  const fontStack = '"Malgun Gothic", "맑은 고딕", "Segoe UI Emoji", sans-serif';

  function wrapChars(ctx, text, maxWidth) {{
    const out = [];
    for (const para of String(text).split('\\n')) {{
      if (para === '') {{ out.push(''); continue; }}
      let line = '';
      for (const ch of para) {{
        const trial = line + ch;
        if (line && ctx.measureText(trial).width > maxWidth) {{
          out.push(line); line = ch;
        }} else {{ line = trial; }}
      }}
      out.push(line);
    }}
    return out;
  }}

  function makeCanvas(lines, fontPx, linePx, opts={{}}) {{
    const padX = opts.padX ?? 0, padY = opts.padY ?? 0;
    const c = document.createElement('canvas');
    c.className = 'text-canvas';
    const cssH = Math.max(1, padY*2 + lines.length*linePx);
    c.width = cssWidth*scale; c.height = cssH*scale;
    c.style.width = cssWidth + 'px'; c.style.height = cssH + 'px';
    const x = c.getContext('2d');
    x.scale(scale, scale); x.fillStyle = '#111'; x.textBaseline='top';
    x.font = `${{opts.bold ? '700 ' : ''}}${{fontPx}}px ${{fontStack}}`;
    lines.forEach((line,i) => x.fillText(line, padX, padY+i*linePx));
    root.appendChild(c);
  }}

  // Header canvases.
  makeCanvas([dateText], 24, 32, {{bold:true}});
  makeCanvas([urlText], 13, 20, {{}});

  // Body is chunked so printing can paginate normally instead of clipping one giant canvas.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `16px ${{fontStack}}`;
  const lines = wrapChars(measure, bodyText, cssWidth);
  const perChunk = 28;
  if (lines.length === 0) lines.push('');
  for (let i=0; i<lines.length; i+=perChunk) {{
    makeCanvas(lines.slice(i, i+perChunk), 16, 23, {{padY:2}});
  }}
}})();
</script>
</body></html>'''

    tmp_pdf = pdf_path.with_suffix(".chromium.tmp.pdf")
    tmp_html = pdf_path.with_suffix(".chromium.tmp.html")
    browser = None
    try:
        # file:// 문서에서 열면 같은 로컬 파일의 사진/썸네일/이모티콘을
        # Chromium이 정상 로드합니다. 대용량 이미지를 data URI로 HTML에
        # 합치지 않으므로 사진이 많은 게시글에서도 브라우저가 닫히지 않습니다.
        tmp_html.write_text(doc_html, encoding="utf-8")
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(headless=True)
            except Exception as first_error:
                candidates = [
                    shutil.which("chromium"), shutil.which("chromium-browser"),
                    shutil.which("google-chrome"), shutil.which("chrome"), shutil.which("msedge"),
                ]
                if os.name == "nt":
                    pf = os.environ.get("PROGRAMFILES", r"C:\\Program Files")
                    pfx = os.environ.get("PROGRAMFILES(X86)", r"C:\\Program Files (x86)")
                    local = os.environ.get("LOCALAPPDATA", "")
                    candidates += [
                        str(Path(pf) / "Google/Chrome/Application/chrome.exe"),
                        str(Path(pfx) / "Google/Chrome/Application/chrome.exe"),
                        str(Path(pf) / "Microsoft/Edge/Application/msedge.exe"),
                        str(Path(pfx) / "Microsoft/Edge/Application/msedge.exe"),
                        str(Path(local) / "Google/Chrome/Application/chrome.exe") if local else None,
                        str(Path(local) / "Microsoft/Edge/Application/msedge.exe") if local else None,
                    ]
                exe = next((x for x in candidates if x and Path(x).exists()), None)
                if exe:
                    try:
                        browser = await p.chromium.launch(headless=True, executable_path=exe)
                    except Exception:
                        browser = None
                if browser is None:
                    raise RuntimeError(
                        "Playwright Chromium을 실행하지 못했습니다. "
                        "`python -m playwright install chromium`을 한 번 실행한 뒤 다시 시도하세요. "
                        f"({type(first_error).__name__}: {first_error})"
                    )
            page = await browser.new_page()
            await page.goto(_file_uri(tmp_html), wait_until="load")
            await page.wait_for_function("Array.from(document.images).every(i => i.complete)", timeout=15000)
            # Wait for all canvases to exist before printing.
            await page.wait_for_function("document.querySelectorAll('.text-canvas').length >= 3", timeout=5000)
            await page.emulate_media(media="screen")
            await page.pdf(
                path=str(tmp_pdf), format="A4", print_background=True,
                display_header_footer=False, prefer_css_page_size=True,
            )
            await browser.close(); browser = None
        tmp_pdf.replace(pdf_path)
    finally:
        if browser is not None:
            try: await browser.close()
            except Exception: pass
        if tmp_pdf.exists():
            try: tmp_pdf.unlink()
            except Exception: pass
        if tmp_html.exists():
            try: tmp_html.unlink()
            except Exception: pass

    # Add exact metadata first.
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(str(pdf_path))
    writer = PdfWriter(); writer.clone_document_from_reader(reader)
    metadata = dict(reader.metadata or {})
    for key, value in (validation_meta or {}).items():
        k = str(key)
        if not k.startswith("/"): k = "/" + k
        if isinstance(value, (dict, list, tuple)):
            value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        metadata[k] = str(value)
    metadata["/WeverseBodyText"] = body
    # Importers can read these fields without reconstructing the header from the
    # invisible PDF text layer. BodyText retains the source newlines verbatim.
    metadata["/WeversePostDate"] = post_date_str or ""
    metadata["/WeversePostURL"] = post_url or ""
    metadata["/WeversePDFEngine"] = "Chromium-Canvas+Deterministic-ToUnicode-v32"
    writer.add_metadata(metadata)
    meta_tmp = pdf_path.with_suffix(".metadata.tmp.pdf")
    with open(meta_tmp, "wb") as f: writer.write(f)
    meta_tmp.replace(pdf_path)

    # Then add the canonical copyable Unicode layer, independent of system fonts.
    _inject_exact_unicode_text_layer(pdf_path, exact_text)

    ok, reason = _verify_pdf_unicode_text(
        pdf_path, body, post_date_str=post_date_str or "", post_url=post_url or ""
    )
    if not ok:
        raise ValueError(f"PDF Unicode 검증 실패: {reason}")
