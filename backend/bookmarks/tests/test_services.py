import io
import responses
from pypdf import PdfWriter
from bookmarks.services import fetch_metadata


@responses.activate
def test_fetch_metadata_parses_html_title_and_description():
    responses.add(
        responses.GET, "https://example.com",
        body="<html><head><title>Test</title>"
             "<meta name='description' content='A test page'></head>"
             "<body>Hello world</body></html>",
        status=200, content_type="text/html",
    )
    data = fetch_metadata("https://example.com")
    assert data["title"] == "Test"
    assert data["description"] == "A test page"
    assert data["resource_type"] == "html"


@responses.activate
def test_fetch_metadata_prefers_open_graph_title():
    responses.add(
        responses.GET, "https://example.com",
        body="<html><head><title>Fallback Title</title>"
             "<meta property='og:title' content='OG Title'></head>"
             "<body>content</body></html>",
        status=200, content_type="text/html",
    )
    data = fetch_metadata("https://example.com")
    assert data["title"] == "OG Title"


@responses.activate
def test_fetch_metadata_parses_pdf():
    buf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Title": "A Test PDF"})
    writer.write(buf)

    responses.add(
        responses.GET, "https://example.com/doc.pdf",
        body=buf.getvalue(), status=200, content_type="application/pdf",
    )
    data = fetch_metadata("https://example.com/doc.pdf")
    assert data["title"] == "A Test PDF"
    assert data["resource_type"] == "pdf"


@responses.activate
def test_fetch_metadata_rejects_oversized_html():
    responses.add(
        responses.GET, "https://example.com",
        body="<html></html>", status=200, content_type="text/html",
        headers={"Content-Length": str(20 * 1024 * 1024)},  # 20MB > 15MB HTML cap
    )
    try:
        fetch_metadata("https://example.com")
        assert False, "expected ValueError for oversized content"
    except ValueError:
        pass


@responses.activate
def test_fetch_metadata_allows_larger_pdf_than_html_cap():
    size = 20 * 1024 * 1024  # 20MB — over HTML cap, under PDF cap
    body = b"%PDF-1.4 fake" + b"0" * (size - len(b"%PDF-1.4 fake"))
    responses.add(
        responses.GET, "https://example.com/big.pdf",
        body=body, status=200, content_type="application/pdf",
    )
    # This should NOT raise "too large" (though it may fail to parse as a real PDF,
    # since the body here is fake) — the point is the size check itself passes.
    try:
        fetch_metadata("https://example.com/big.pdf")
    except ValueError as e:
        assert "too large" not in str(e).lower() and "exceeded size cap" not in str(e).lower()