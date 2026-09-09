# Bookmark Manager

Content-searchable bookmarking with automatic metadata extraction, auto-tagging, and a browser extension client — built to demonstrate an asynchronous processing pipeline, PostgreSQL full-text/fuzzy search, and a real API client using Django, DRF, and Celery.

---

## What it does

Save any URL via the browser extension or API, and it automatically:
- **Extracts metadata** — Fetches page title, description, and high-res favicon (with Open Graph fallbacks).
- **Full-text & fuzzy search** — Extracts and indexes page content using PostgreSQL `SearchVector`/`SearchRank` and trigram similarity (`pg_trgm`) for typo-tolerant queries.
- **Auto-generates tags** — Automatically extracts meaningful keywords via YAKE without requiring manual input.
- **Supports HTML & PDFs** — Extracts full text from web pages as well as digital PDFs.
- **Non-blocking async pipeline** — Saving returns `202 Accepted` immediately; a Celery background worker processes the scraping, parsing, and tagging in the background.

A modern **Chrome Extension (Manifest V3)** with a sleek dark glassmorphic UI lets you save active pages with one click, search by content, filter by tags or media type, star favorites, retry failed fetches, and copy links.

---

## Why

Native browser bookmarks only search by page title or URL. Bookmark Manager indexes the actual page content so you can rediscover articles and documentation months later simply by searching for terms you remember from the article body.

---

## Tech Stack

- **Backend:** Django 6 & Django REST Framework (`APIView`-based architecture)
- **Database & Search:** PostgreSQL 16 (Full-text search vectors, `GIN` indexes, and trigram fuzzy matching)
- **Background Tasks & Caching:** Celery 5 + Redis 7 (with per-domain rate limiting)
- **Content Extractors:** BeautifulSoup4, lxml, and pypdf
- **Keyword Extraction:** YAKE (lightweight statistical keyword extractor)
- **Containerization:** Docker & Docker Compose (one-command setup)
- **Client:** Chrome Extension (Manifest V3, Vanilla JS & CSS with glassmorphic design)
- **API Documentation:** OpenAPI 3 schema with Swagger UI (`drf-spectacular`)

---

## Architecture

```
Browser Extension (Manifest V3) / curl / Swagger UI
                        │ HTTP (localhost:8000)
                        ▼
            Django REST Framework API  ────────►  PostgreSQL 16
                        │                         • Relational data & tags
                        ▼                         • Full-text search (SearchVector)
              Redis 7 (Broker & Cache)            • Fuzzy search (pg_trgm)
                        │
                        ▼
                  Celery Worker
                        │
      ┌─────────────────┼─────────────────┐
      ▼                 ▼                 ▼
Fetch Page/PDF    Extract Content    Auto-Generate Tags
  & Favicon          (HTML/PDF)           (YAKE)
```

The API never blocks on slow external network I/O: creating a bookmark returns `202 Accepted` immediately with `status: "pending"`, and the Celery worker completes the task asynchronously.

---

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended for one-command startup on Windows, Mac, or Linux)
- Google Chrome, Brave, or Microsoft Edge (to run the browser extension)
- *Optional for non-Docker setup:* Python 3.12+, PostgreSQL 16+, Redis 7+

---

## Quickstart (Docker Compose)

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/bookmark-manager.git
cd bookmark-manager
```

### 2. Prepare environment variables
Copy the example environment file (the defaults work out of the box for local use):

**Linux / macOS:**
```bash
cp .env.example .env
```
**Windows (PowerShell / CMD):**
```cmd
copy .env.example .env
```

### 3. Start the entire stack
```bash
docker compose up -d --build
```
*Note: Database migrations run automatically when the web container boots!*

### 4. Create your account

You can create an account in either of two easy ways:

#### Option A: Directly inside the Browser Extension (Fastest)
1. Load the extension in your browser (see steps below).
2. Click the extension icon in your toolbar.
3. Switch to **Account Login**, click **"Need an account? Register"**.
4. Enter your desired username & password, and click **Create Account & Connect** — you're instantly logged in!

#### Option B: Via Terminal (Django Admin / Superuser)
```bash
docker compose exec web python manage.py createsuperuser
```
Follow the interactive prompts to set your username and password. You can now use these credentials to log in to the extension or the Django Admin at [http://localhost:8000/admin/](http://localhost:8000/admin/).

---

## Installing the Browser Extension

1. Open your Chromium-based browser (Chrome, Brave, Edge).
2. Navigate to `chrome://extensions` in the address bar.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension` folder inside this repository.
6. Pin the **Bookmark Manager** extension to your browser toolbar.
7. Click the extension icon and sign in with your credentials or paste an API token.

---

## Local Development (Without Docker)

If you prefer running services directly on your host machine:

1. Ensure PostgreSQL and Redis are running locally.
2. Create and activate a Python virtual environment:
   ```bash
   cd backend
   python -m venv venv
   # Windows:
   .\venv\Scripts\activate
   # Linux/macOS:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure `.env` with your local database credentials:
   - Copy `.env.example` to `.env` (or `backend/.env` — Django automatically detects both).
   - For local development outside Docker, set `DB_HOST=localhost` and `DB_PORT=5433` (or `5432`), and `REDIS_URL=redis://localhost:6379/0`.
5. Run migrations:
   ```bash
   python manage.py migrate
   ```
6. Start the Celery worker (in a separate terminal):
   ```bash
   # Linux/macOS:
   celery -A config worker -l info
   # Windows:
   celery -A config worker -l info --pool=solo
   ```
7. Start the Django development server:
   ```bash
   python manage.py runserver
   ```

---

## Day-to-Day Docker Commands

```bash
docker compose up -d              # Start all containers in background
docker compose logs -f worker     # Follow live background Celery tasks
docker compose logs -f web        # Follow Django API logs
docker compose restart worker     # Restart worker after code changes
docker compose down               # Stop all services
docker compose down -v            # Stop and wipe volume databases (fresh start)
```

---

## Running Tests

Run the complete automated test suite (**8 passed**):

**Inside Docker:**
```bash
docker compose exec web pytest -v
```
*(Runs inside the container using `backend/pytest.ini`)*

**Locally from Repository Root:**
```bash
pytest -v
```
*(Runs from repo root using root `pytest.ini` with `pythonpath = backend`)*

**Locally from `backend/` directory:**
```bash
cd backend && pytest -v
```

---

## API Documentation

Interactive Swagger documentation is available once the server is running:
- **Swagger UI:** [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/)
- **OpenAPI Schema:** [http://localhost:8000/api/schema/](http://localhost:8000/api/schema/)
- **Django Admin:** [http://localhost:8000/admin/](http://localhost:8000/admin/)

---

## Project Structure

```
bookmark-manager/
├── backend/
│   ├── bookmarks/           # Main application
│   │   ├── models.py        # Bookmark, Tag, and BookmarkTag models
│   │   ├── views.py         # DRF APIView endpoints (bookmarks, search, retry, register)
│   │   ├── serializers.py   # Model serializers
│   │   ├── tasks.py         # Celery background tasks
│   │   ├── services.py      # HTML/PDF parsers, YAKE tagger, OpenGraph extractors
│   │   ├── pagination.py    # Cursor-based pagination
│   │   └── tests/           # Automated test suites
│   ├── config/              # Django settings, URL configuration, Celery app
│   ├── Dockerfile           # Backend container definition
│   ├── pytest.ini           # Pytest config for Docker container (/app) & backend directory
│   ├── requirements.txt     # Python dependencies (UTF-8)
│   └── manage.py
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json        # Extension manifest permissions and configuration
│   ├── popup.html           # Dark-mode UI with dual auth, save view, and browse tab
│   ├── popup.css            # Glassmorphic design system and micro-animations
│   └── popup.js             # Extension controller, pagination, search, & Chrome API wrapper
├── docker-compose.yml       # Root compose file for one-command startup
├── .env.example             # Template environment variables
├── pytest.ini               # Root test configuration (pythonpath = backend)
├── LICENSE                  # MIT License
└── README.md                # Project documentation
```

---

## Known Limitations

- **JavaScript-Rendered SPAs:** Sites that require client-side JavaScript execution to display content or block non-browser User-Agents may fail to fetch readable text. This is an accepted design trade-off to keep the async pipeline fast and lightweight without headless browser overhead.
- **Scanned/Image-Only PDFs:** Text extraction relies on PDF text streams; image-only scanned documents contain no extractable text (OCR is intentionally out of scope).
- **Single-User / Self-Hosted Scope:** Designed as a personal, self-hosted bookmarking service.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
