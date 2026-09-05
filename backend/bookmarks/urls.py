from django.urls import path
from .views import (
    BookmarkListCreateView,
    BookmarkDetailView,
    BookmarkSearchView,
    TagListView,
    BookmarkRetryView
)

urlpatterns = [
    path("bookmarks/", BookmarkListCreateView.as_view(), name="bookmark-list-create"),
    path("bookmarks/search/", BookmarkSearchView.as_view(), name="bookmark-search"),
    path("bookmarks/<int:pk>/", BookmarkDetailView.as_view(), name="bookmark-detail"),
    path("bookmarks/<int:pk>/retry/", BookmarkRetryView.as_view(), name="bookmark-retry"),
    path("tags/", TagListView.as_view(), name="tag-list"),
]
