import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BookmarkBot/1.0)"}
TIMEOUT = 10


def fetch_metadata(url: str) -> dict:
    response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "")
    if "text/html" not in content_type:
        raise ValueError(f"Unsupported content type: {content_type}")

    soup = BeautifulSoup(response.text, "html.parser")

    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    desc_tag = soup.find("meta", attrs={"name": "description"})
    description = desc_tag["content"].strip() if desc_tag and desc_tag.get("content") else ""

    favicon_url = None
    icon_tag = soup.find("link", rel=lambda r: r and "icon" in r.lower())
    if icon_tag and icon_tag.get("href"):
        favicon_url = urljoin(url, icon_tag["href"])

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    raw_content = " ".join(soup.get_text(separator=" ").split())[:20000]  # cap length

    return {
        "title": title,
        "description": description,
        "favicon_url": favicon_url,
        "raw_content": raw_content,
    }