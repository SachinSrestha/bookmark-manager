from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.contrib.postgres.search import SearchQuery, SearchRank, SearchHeadline, TrigramWordSimilarity
from django.db.models import Count, Value , TextField, Q
from django.db.models.functions import Concat
from django_ratelimit.decorators import ratelimit
from django.utils.decorators import method_decorator

from .models import Bookmark, Tag
from .serializers import BookmarkSerializer, TagSerializer
from .tasks import fetch_bookmark

MAX_MANUAL_RETRIES = 5

class BookmarkListCreateView(APIView):
    """GET  /api/bookmarks/      -> list current user's bookmarks (optionally filtered by ?tags=)
       POST /api/bookmarks/      -> create a bookmark, queue async fetch, return 202
    """

    def get(self, request):
        queryset = Bookmark.objects.filter(user=request.user)

        tags_param = request.query_params.get("tags")
        if tags_param:
            tag_names = tags_param.split(",")
            queryset = queryset.filter(bookmark_tags__tag__name__in=tag_names).distinct()

        serializer = BookmarkSerializer(queryset, many=True)
        return Response(serializer.data)

    @method_decorator(ratelimit(key="user", rate="30/h", block=True))
    def post(self, request):
        serializer = BookmarkSerializer(data=request.data,context={"request": request})
        serializer.is_valid(raise_exception=True)
        bookmark = serializer.save(user=request.user)

        fetch_bookmark.delay(bookmark.id)

        response_serializer = BookmarkSerializer(bookmark)
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)


class BookmarkDetailView(APIView):
    """GET    /api/bookmarks/<id>/  -> retrieve one bookmark (for polling status)
       PATCH  /api/bookmarks/<id>/  -> edit favorite/manual fields
       DELETE /api/bookmarks/<id>/  -> delete
    """

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
        affected_tag_ids = list(bookmark.bookmark_tags.values_list("tag_id", flat=True))
        bookmark.delete()

        Tag.objects.filter(id__in=affected_tag_ids).annotate(
        usage_count=Count("bookmarktag")
        ).filter(usage_count=0).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BookmarkSearchView(APIView):
    """GET /api/bookmarks/search/?q=... -> ranked full-text search"""

    def get(self, request):
        query_text = request.query_params.get("q", "").strip()
        if not query_text:
            return Response({"detail": "q parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        search_query = SearchQuery(query_text, search_type="websearch")
        results = (
            Bookmark.objects.filter(user=request.user, search_vector=search_query)
            .annotate(rank=SearchRank("search_vector", search_query,normalization=32),
                    headline=SearchHeadline(
                        "raw_content", search_query,
                        start_sel="<b>", stop_sel="</b>",
                        max_words=20, min_words=8,
                        ),
                    )
            .filter(rank__gte=0.01)
            .order_by("-rank")
        )
        
        if results.exists():
            serializer = BookmarkSerializer(results, many=True)
            return Response(serializer.data)
        fuzzy_results = (
            Bookmark.objects.filter(user=request.user)
            .annotate(
                combined=Concat("title", Value(" "), "description", output_field=TextField(),),
            )
            .annotate(similarity=TrigramWordSimilarity( query_text, "combined"))
            .filter(Q(similarity__gt=0.15) | Q(title__icontains=query_text)) 
            .order_by("-similarity")[:5]
        )
        serializer = BookmarkSerializer(fuzzy_results, many=True)
        return Response(serializer.data)

class BookmarkRetryView(APIView):
    def post(self, request, pk):
        bookmark = get_object_or_404(Bookmark, pk=pk , user =request.user)
        
        if bookmark.status not in ("failed"):
            return Response({"detail": f"Cannot retry a bookmark with status '{bookmark.status}'"},
            status=status.HTTP_400_BAD_REQUEST,)
        
        if bookmark.fetch_attempts >= MAX_MANUAL_RETRIES:
            return Response(
                {"detail": "Maximum retry attempts reached. Delete and re-add this bookmark instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        bookmark.status = "pending"
        bookmark.fetch_error=""
        bookmark.save(update_fields=["status", "fetch_error"])
        
        fetch_bookmark.delay(bookmark.id)
        
        serializer= BookmarkSerializer(bookmark)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)

class TagListView(APIView):
    """GET /api/tags/ -> list all tags"""

    def get(self, request):
        tags = Tag.objects.all()
        serializer = TagSerializer(tags, many=True)
        return Response(serializer.data)