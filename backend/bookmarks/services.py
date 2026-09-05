import io
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from pypdf import PdfReader

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BookmarkBot/1.0)"}
TIMEOUT = (5,15)
HTML_MAX_BYTES = 15 * 1024 * 1024       # 15 MB cap
PDF_MAX_BYTES =50 * 1024 * 1024
MAX_TEXT_LENGTH = 20000            # cap stored text regardless of source type


def fetch_metadata(url: str) -> dict:
    """Fetch a URL and extract title/description/favicon/content.
    Dispatches by actual Content-Type — supports HTML and PDF. """
    response = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True, stream=True)
    response.raise_for_status()
    
    final_url = response.url
    content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    is_pdf = content_type == "application/pdf" or final_url.lower().endswith(".pdf")
    max_bytes = PDF_MAX_BYTES if is_pdf else HTML_MAX_BYTES

    content_length = response.headers.get("Content-Length")
    if content_length and int(content_length) > max_bytes:
        raise ValueError(f"Content too large ({content_length} bytes)")

    content = response.raw.read(max_bytes + 1, decode_content=True)
    if len(content) > max_bytes:
        raise ValueError("Content exceeded size cap during download")


    if content_type == "application/pdf" or final_url.lower().endswith(".pdf"):
        return _parse_pdf(content, final_url)
    elif "text/html" in content_type:
        return _parse_html(content, final_url)
    else:
        raise ValueError(f"Unsupported content type: {content_type}")


def _parse_html(content: bytes, final_url: str) -> dict:
    soup = BeautifulSoup(content, "lxml")  

    title = _extract_title(soup)
    description = _extract_description(soup)
    favicon_url = _extract_favicon(soup, final_url)

    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript", "iframe"]):
        tag.decompose()
    raw_content = " ".join(soup.get_text(separator=" ").split())[:MAX_TEXT_LENGTH]

    return {
        "title": title,
        "description": description,
        "favicon_url": favicon_url,
        "raw_content": raw_content,
        "resource_type": "html",
    }


def _extract_title(soup) -> str:
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        return og_title["content"].strip()

    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(strip=True)
    return ""


def _extract_description(soup) -> str:
    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        return og_desc["content"].strip()

    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        return meta_desc["content"].strip()
    return ""


def _extract_favicon(soup, final_url: str) -> str | None:
    icon_tag = soup.find("link", rel=lambda r: r and "icon" in r.lower())
    if icon_tag and icon_tag.get("href"):
        return urljoin(final_url, icon_tag["href"])
    return urljoin(final_url, "/favicon.ico")


def _parse_pdf(content: bytes, final_url: str) -> dict:
    reader = PdfReader(io.BytesIO(content))

    title = ""
    if reader.metadata and reader.metadata.title:
        title = reader.metadata.title.strip()

    text_parts = []
    for page in reader.pages[:20]:
        text_parts.append(page.extract_text() or "")
    raw_content = " ".join(" ".join(text_parts).split())[:MAX_TEXT_LENGTH]

    if not title:
        title = raw_content[:120].strip() or final_url  # rough fallback title

    return {
        "title": title,
        "description": raw_content[:300],
        "favicon_url": None,
        "raw_content": raw_content,
        "resource_type": "pdf",
    }