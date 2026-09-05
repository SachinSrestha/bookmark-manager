import requests
from celery import shared_task
from django.contrib.postgres.search import SearchVector

from .models import Bookmark
from .services import fetch_metadata


@shared_task(bind=True, autoretry_for=(requests.RequestException,), retry_backoff=True, max_retries=3)
def fetch_bookmark(self, bookmark_id):
    try:
        bookmark = Bookmark.objects.get(id=bookmark_id)
    except Bookmark.DoesNotExist:
        return

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

    update_search_vector.delay(bookmark_id)
    generate_tags.delay(bookmark_id)


@shared_task
def update_search_vector(bookmark_id):
    Bookmark.objects.filter(id=bookmark_id).update(
        search_vector=(
            SearchVector("title", weight="A")
            + SearchVector("description", weight="B")
            + SearchVector("raw_content", weight="C")
        )
    )

@shared_task
def generate_tags(bookmark_id):
    # Implemented in Phase 5
    pass