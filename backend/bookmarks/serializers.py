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

    class Meta:
        model = Bookmark
        fields = [
            "id", "url", "title", "description", "favicon_url",
            "status", "is_favorite", "tags", "created_at", "updated_at",
        ]
        read_only_fields = ["title", "description", "favicon_url", "status"]

    def create(self, validated_data):
        validated_data["normalized_url"] = normalize_url(validated_data["url"])
        return super().create(validated_data)