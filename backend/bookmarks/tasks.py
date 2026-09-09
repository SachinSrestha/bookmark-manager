import requests
import yake
import time
from celery import shared_task, chain
from django.contrib.postgres.search import SearchVector
from urllib.parse import urlparse
from django.core.cache import cache
from django.db.models import Value
from .models import Bookmark, Tag, BookmarkTag
from .services import fetch_metadata

MIN_SECONDS_BETWEEN_SAME_DOMAIN_FETCHES = 2

@shared_task(bind=True, autoretry_for=(requests.RequestException,), retry_backoff=True, max_retries=3)
def fetch_bookmark(self, bookmark_id):
    try:
        bookmark = Bookmark.objects.get(id=bookmark_id)
    except Bookmark.DoesNotExist:
        return
    
    domain = urlparse(bookmark.url).netloc
    cache_key = f"last_fetch:{domain}"
    last_fetch_time = cache.get(cache_key)
    if last_fetch_time:
        elapsed = time.monotonic() - last_fetch_time
        if elapsed < MIN_SECONDS_BETWEEN_SAME_DOMAIN_FETCHES:
            raise self.retry(countdown=MIN_SECONDS_BETWEEN_SAME_DOMAIN_FETCHES - elapsed)
    cache.set(cache_key, time.monotonic(), timeout=60)

    bookmark.status = "fetching"
    bookmark.fetch_attempts += 1
    bookmark.save(update_fields=["status", "fetch_attempts"])

    try:
        data = fetch_metadata(bookmark.url)
    except Exception as exc:
        bookmark.status = "failed"
        bookmark.fetch_error = str(exc)[:500]
        bookmark.save(update_fields=["status", "fetch_error"])
        return

    bookmark.title = data["title"]
    bookmark.description = data["description"]
    bookmark.favicon_url = data["favicon_url"]
    bookmark.raw_content = data["raw_content"]
    bookmark.resource_type = data["resource_type"]
    bookmark.status = "fetched"
    bookmark.save()

    chain(generate_tags.s(bookmark_id), update_search_vector.s()).delay()


@shared_task
def update_search_vector(bookmark_id):
    try:
        bookmark = Bookmark.objects.get(id=bookmark_id)
    except Bookmark.DoesNotExist:
        return

    tag_names = " ".join(bt.tag.name for bt in bookmark.bookmark_tags.all())
    
    Bookmark.objects.filter(id=bookmark_id).update(
        search_vector=(
            SearchVector("title", weight="A")
            + SearchVector("description", weight="B")
            + SearchVector(Value(tag_names), weight="B")
            + SearchVector("raw_content", weight="C")
        )
    )

@shared_task
def generate_tags(bookmark_id):
    try:
        bookmark = Bookmark.objects.get(id=bookmark_id)
    except Bookmark.DoesNotExist:
        return
    
    text = f"{bookmark.title} {bookmark.raw_content}"[:5000]
    if not text.strip():
        return
    
    kw_extractor = yake.KeywordExtractor(lan="en", n =2, top =8)
    keywords = kw_extractor.extract_keywords(text)
    
    for keyword, score in keywords:
        tag, _ = Tag.objects.get_or_create(name=keyword.lower(),
                                           defaults={"slug": keyword.lower().replace(" ", "-")},
                                           )
        BookmarkTag.objects.get_or_create(bookmark=bookmark, tag=tag,
                                          defaults={"source":"auto","confidence":score},
                                          )
        
    return bookmark_id