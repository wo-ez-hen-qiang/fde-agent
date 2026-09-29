#!/usr/bin/env python3
"""Pull Tencent Cloud ADP docs (product 1759) into a markdown tree.

Each page becomes <catalogue path>/<title>.md. Images are saved in a sibling
folder with the same title. The document replaces each image with that
relative path (the filename is the original image id). That path string is
what a later bge-small-zh ingest should embed; a retrieval hit on the string
locates the file for a multimodal model.

Corpus output is local only (gitignored under /knowledge).
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

PRODUCT = "1759"
SEED = f"https://cloud.tencent.com/document/product/{PRODUCT}/104193"
OUT = Path(__file__).resolve().parents[1] / "knowledge" / "tencent-adp"
UA = "fde-agent-doc-mirror/0.1 (local knowledge base)"
IMG_HOSTS = ("qcloudimg.tencent-cloud.cn", "cloudcache.tencent-cloud.com")


def fetch(url: str, timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read()
        if res.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
            import gzip

            data = gzip.decompress(data)
        return data


def load_tree() -> list[dict]:
    html = fetch(SEED).decode("utf-8", "replace")
    match = re.search(r'window\.__staticRouterHydrationData = JSON\.parse\("(.*)"\);', html)
    if not match:
        raise SystemExit("catalogue JSON not found on seed page")
    data = json.loads(json.loads('"' + match.group(1) + '"'))
    return data["loaderData"]["product"]["data"]["sidebar"]["catalogue"]["list"]


def pages_of(nodes: list[dict], trail: list[str] | None = None) -> list[dict]:
    trail = trail or []
    found: list[dict] = []
    for node in nodes:
        title = (node.get("title") or "").strip()
        children = node.get("children") or []
        if node.get("type") == "page":
            found.append(
                {
                    "id": str(node["id"]),
                    "title": title or str(node["id"]),
                    "trail": trail,
                }
            )
        if children:
            found.extend(pages_of(children, trail + ([title] if title else [])))
    return found


def safe_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', " ", name).strip()
    cleaned = cleaned.replace(" ", "-")
    return cleaned[:80] or "untitled"


class ToMarkdown(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignore: list[bool] = []
        self.in_link = False
        self.link_href = ""
        self.link_text: list[str] = []
        self.images: list[str] = []
        self.seen_src: set[str] = set()

    def _ignored(self) -> bool:
        return bool(self.ignore and self.ignore[-1])

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        cls = ad.get("class", "")
        hide = bool(ad.get("data-slate-zero-width")) or "tse-ul-symbol" in cls
        self.ignore.append(self._ignored() or hide)
        if self._ignored():
            return
        if tag in {"h1", "h2", "h3", "h4"}:
            self.parts.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "li" or "tse-ul-content" in cls:
            self.parts.append("\n- ")
        elif tag == "a":
            self.in_link = True
            self.link_href = ad.get("href", "")
            self.link_text = []
        elif tag == "img":
            src = ad.get("src", "")
            style = ad.get("style", "").replace(" ", "")
            if not src or "display:none" in style or src in self.seen_src:
                return
            self.seen_src.add(src)
            self.images.append(src)
            self.parts.append(f"\n\n{{{{IMG:{len(self.images) - 1}}}}}\n\n")
        elif tag == "pre":
            self.parts.append("\n\n```\n")

    def handle_endtag(self, tag: str) -> None:
        ignored = self.ignore.pop() if self.ignore else False
        if ignored:
            return
        if tag in {"h1", "h2", "h3", "h4", "p"}:
            self.parts.append("\n\n")
        elif tag == "div":
            self.parts.append("\n")
        elif tag == "a" and self.in_link:
            text = "".join(self.link_text).strip()
            href = self.link_href
            self.parts.append(f"[{text}]({href})" if text and href else text)
            self.in_link = False
            self.link_text = []
        elif tag == "pre":
            self.parts.append("\n```\n\n")

    def handle_data(self, data: str) -> None:
        if self._ignored():
            return
        if self.in_link:
            self.link_text.append(data)
            return
        text = data.replace("\u200b", "").replace("\ufeff", "")
        if text:
            self.parts.append(text)


def to_markdown(html: str) -> tuple[str, list[str]]:
    parser = ToMarkdown()
    parser.feed(html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    return text, parser.images


def article_body(doc_id: str) -> tuple[str, str]:
    url = f"https://cloud.tencent.com/document/product/{PRODUCT}/{doc_id}"
    html = fetch(url).decode("utf-8", "replace")
    match = re.search(r'window\.__staticRouterHydrationData = JSON\.parse\("(.*)"\);', html)
    if not match:
        raise RuntimeError(f"no article payload for {doc_id}")
    data = json.loads(json.loads('"' + match.group(1) + '"'))
    content = data["loaderData"]["product-article"]["data"]["article"]["content"]
    title = content.get("title") or doc_id
    body = content.get("body") or ""
    return title, body


def image_name(src: str, ordinal: int) -> str:
    leaf = src.split("?", 1)[0].rstrip("/").split("/")[-1]
    if not re.search(r"\.(png|jpe?g|gif|webp|svg)$", leaf, re.I):
        leaf = f"{leaf}.png"
    leaf = safe_name(leaf)
    return leaf or f"{ordinal:03d}.png"


def save_images(srcs: list[str], folder: Path, md_path: Path) -> dict[int, str]:
    folder.mkdir(parents=True, exist_ok=True)
    rels: dict[int, str] = {}
    for i, src in enumerate(srcs):
        name = image_name(src, i)
        dest = folder / name
        if not dest.exists():
            dest.write_bytes(fetch(src))
        rels[i] = dest.relative_to(md_path.parent).as_posix()
    return rels


def write_page(page: dict) -> dict:
    title, body = article_body(page["id"])
    md, srcs = to_markdown(body)
    trail = [safe_name(p) for p in page["trail"]]
    stem = safe_name(title)
    directory = OUT.joinpath(*trail)
    directory.mkdir(parents=True, exist_ok=True)
    md_path = directory / f"{stem}.md"
    if md_path.exists() and page["id"] not in md_path.read_text(encoding="utf-8", errors="replace")[:200]:
        stem = f"{stem}-{page['id']}"
        md_path = directory / f"{stem}.md"
    if srcs:
        rels = save_images(srcs, directory / stem, md_path)
        for i, rel in rels.items():
            md = md.replace(f"{{{{IMG:{i}}}}}", rel)
    header = f"<!-- source: https://cloud.tencent.com/document/product/{PRODUCT}/{page['id']} -->\n\n# {title}\n\n"
    md_path.write_text(header + md, encoding="utf-8")
    return {
        "id": page["id"],
        "title": title,
        "path": md_path.relative_to(OUT).as_posix(),
        "images": len(srcs),
    }


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    OUT.mkdir(parents=True, exist_ok=True)
    tree = load_tree()
    pages = pages_of(tree)
    if limit:
        pages = pages[:limit]
    (OUT / "_tree.json").write_text(json.dumps(tree, ensure_ascii=False, indent=2), encoding="utf-8")
    done_path = OUT / "_done.json"
    done: dict[str, dict] = {}
    if done_path.exists():
        done = json.loads(done_path.read_text(encoding="utf-8"))
    print(f"pages {len(pages)} already {len(done)}", flush=True)
    failed = 0
    for index, page in enumerate(pages, 1):
        if page["id"] in done:
            continue
        try:
            info = write_page(page)
            done[page["id"]] = info
            done_path.write_text(json.dumps(done, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[{index}/{len(pages)}] {info['path']} images={info['images']}", flush=True)
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            failed += 1
            print(f"[{index}/{len(pages)}] FAIL {page['id']} {page['title']}: {exc}", flush=True)
        time.sleep(0.15)
    print(f"finished ok={len(done)} failed={failed}", flush=True)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
