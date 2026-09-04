from django.contrib import admin
from .models import Bookmark, Tag, BookmarkTag

class BookmarkTagInline(admin.TabularInline):
    model = BookmarkTag
    extra = 0


@admin.register(Bookmark)
class BookmarkAdmin(admin.ModelAdmin):
    list_display = ["title", "url", "status", "user", "created_at"]
    list_filter = ["status", "is_favorite"]
    search_fields = ["title", "url"]
    inlines = [BookmarkTagInline]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name", "slug"]
    search_fields = ["name"]