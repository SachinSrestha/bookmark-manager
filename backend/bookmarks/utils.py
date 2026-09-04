from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}

def normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    query = [(k, v) for k, v in parse_qsl(parsed.query) if k not in TRACKING_PARAMS]
    cleaned = parsed._replace(
        query=urlencode(query),
        fragment="",
        path=parsed.path.rstrip("/") or "/",
    )
    return urlunparse(cleaned).lower()