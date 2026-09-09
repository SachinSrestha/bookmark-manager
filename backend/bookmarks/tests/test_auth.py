import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

@pytest.mark.django_db
def test_register_success():
    client = APIClient()
    response = client.post(
        "/api/register/",
        {"username": "newuser", "password": "securepassword123"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert "token" in response.data
    assert response.data["username"] == "newuser"
    assert User.objects.filter(username="newuser").exists()

@pytest.mark.django_db
def test_register_duplicate_username():
    User.objects.create_user(username="existinguser", password="somepassword")
    client = APIClient()
    response = client.post(
        "/api/register/",
        {"username": "existinguser", "password": "securepassword123"},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "error" in response.data

@pytest.mark.django_db
def test_register_missing_fields():
    client = APIClient()
    response = client.post(
        "/api/register/",
        {"username": "onlyuser"},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
