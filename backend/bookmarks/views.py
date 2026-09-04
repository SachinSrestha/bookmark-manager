from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.contrib.postgres.search import SearchQuery, SearchRank

from .models import Bookmark, Tag
from .serializers import BookmarkSerializer, TagSerializer
#from .tasks import fetch_bookmark


class BookmarkListCreateView(APIView):
    """GET  /api/bookmarks/      -> list current user's bookmarks (optionally filtered by ?tags=)
       POST /api/bookmarks/      -> create a bookmark, queue async fetch, return 202
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Bookmark.objects.filter(user=request.user)

        tags_param = request.query_params.get("tags")
        if tags_param:
            tag_names = tags_param.split(",")
            queryset = queryset.filter(bookmark_tags__tag__name__in=tag_names).distinct()

        serializer = BookmarkSerializer(queryset, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = BookmarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        bookmark = serializer.save(user=request.user)

        #fetch_bookmark.delay(bookmark.id)

        response_serializer = BookmarkSerializer(bookmark)
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)


class BookmarkDetailView(APIView):
    """GET    /api/bookmarks/<id>/  -> retrieve one bookmark (for polling status)
       PATCH  /api/bookmarks/<id>/  -> edit favorite/manual fields
       DELETE /api/bookmarks/<id>/  -> delete
    """
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk):
        return get_object_or_404(Bookmark, pk=pk, user=request.user)

    def get(self, request, pk):
        bookmark = self.get_object(request, pk)
        serializer = BookmarkSerializer(bookmark)
        return Response(serializer.data)

    def patch(self, request, pk):
        bookmark = self.get_object(request, pk)
        serializer = BookmarkSerializer(bookmark, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        bookmark = self.get_object(request, pk)
        bookmark.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BookmarkSearchView(APIView):
    """GET /api/bookmarks/search/?q=... -> ranked full-text search"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query_text = request.query_params.get("q", "").strip()
        if not query_text:
            return Response({"detail": "q parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        search_query = SearchQuery(query_text)
        results = (
            Bookmark.objects.filter(user=request.user, search_vector=search_query)
            .annotate(rank=SearchRank("search_vector", search_query))
            .order_by("-rank")
        )
        serializer = BookmarkSerializer(results, many=True)
        return Response(serializer.data)


class TagListView(APIView):
    """GET /api/tags/ -> list all tags"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        tags = Tag.objects.all()
        serializer = TagSerializer(tags, many=True)
        return Response(serializer.data)