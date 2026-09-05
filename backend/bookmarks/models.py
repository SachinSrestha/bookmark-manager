from django.conf import settings
from django.db import models
from django.contrib.postgres.search import SearchVectorField
from django.contrib.postgres.indexes import GinIndex


class Bookmark(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("fetching", "Fetching"),
        ("fetched", "Fetched"),
        ("failed", "Failed"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks")
    url = models.URLField(max_length=2000)
    normalized_url = models.CharField(max_length=2000, db_index=True)
    title = models.CharField(max_length=500, blank=True)
    description = models.TextField(blank=True)
    favicon_url = models.URLField(max_length=2000, blank=True, null=True)
    raw_content = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    fetch_error = models.CharField(max_length=500, blank=True)
    fetch_attempts = models.PositiveSmallIntegerField(default=0)
    search_vector = SearchVectorField(null=True, blank=True)
    resource_type = models.CharField(max_length=20, blank=True)
    is_favorite = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [GinIndex(fields=["search_vector"]),
                   GinIndex(fields=["title"], name="title_trgm_idx", opclasses=["gin_trgm_ops"]),
                ]
        unique_together = ("user", "normalized_url")
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or self.url


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)
    slug = models.SlugField(unique=True)

    def __str__(self):
        return self.name


class BookmarkTag(models.Model):
    SOURCE_CHOICES = [("user", "User"), ("auto", "Auto")]

    bookmark = models.ForeignKey(Bookmark, on_delete=models.CASCADE, related_name="bookmark_tags")
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    confidence = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ("bookmark", "tag")