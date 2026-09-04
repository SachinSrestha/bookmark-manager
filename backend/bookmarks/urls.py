from django.urls import path
from .views import (
    BookmarkListCreateView,
    BookmarkDetailView,
    BookmarkSearchView,
    TagListView,
)

urlpatterns = [
    path("bookmarks/", BookmarkListCreateView.as_view(), name="bookmark-list-create"),
    path("bookmarks/search/", BookmarkSearchView.as_view(), name="bookmark-search"),
    path("bookmarks/<int:pk>/", BookmarkDetailView.as_view(), name="bookmark-detail"),
    path("tags/", TagListView.as_view(), name="tag-list"),
]
