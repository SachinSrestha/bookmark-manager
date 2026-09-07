from rest_framework import serializers
from .models import Bookmark, Tag, BookmarkTag
from .utils import normalize_url

class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "slug"]


class BookmarkTagSerializer(serializers.ModelSerializer):
    tag = TagSerializer(read_only=True)

    class Meta:
        model = BookmarkTag
        fields = ["tag", "source", "confidence"]


class BookmarkSerializer(serializers.ModelSerializer):
    tags = BookmarkTagSerializer(source="bookmark_tags", many=True, read_only=True)
    headline = serializers.SerializerMethodField()

    class Meta:
        model = Bookmark
        fields = [
            "id", "url", "title", "description", "favicon_url",
            "status","resource_type", "is_favorite", "tags", "headline", "created_at", "updated_at",
        ]
        read_only_fields = ["title", "description", "favicon_url", "status","resource_type"]

    
    def get_headline(self, obj):
        return getattr(obj, "headline", None)
    
    def validate_url(self, value):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            candidate_normalized = normalize_url(value)
            if Bookmark.objects.filter(
                user=request.user, normalized_url=candidate_normalized
            ).exists():
                raise serializers.ValidationError(
                    "You've already saved this URL."
                )
        return value
    
    def create(self, validated_data):
            validated_data["normalized_url"] = normalize_url(validated_data["url"])
            return super().create(validated_data)