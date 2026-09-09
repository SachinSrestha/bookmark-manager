from rest_framework.pagination import CursorPagination


class BookmarkCursorPagination(CursorPagination):

    page_size = 20
    page_size_query_param = "page_size"  # allow ?page_size=10 overrides
    max_page_size = 100
    ordering = "-created_at"             # must match Bookmark.Meta.ordering
