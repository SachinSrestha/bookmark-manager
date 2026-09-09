const DEFAULT_SERVER_URL = "http://localhost:8000";
let serverUrl = DEFAULT_SERVER_URL;
let API_BASE = `${serverUrl}/api`;

function updateServerUrl(newUrl) {
  if (!newUrl) newUrl = DEFAULT_SERVER_URL;
  serverUrl = newUrl.replace(/\/+$/, "");
  API_BASE = `${serverUrl}/api`;

  const statusLabel = document.getElementById("server-status-label");
  if (statusLabel) {
    statusLabel.textContent = `Server: ${serverUrl}`;
  }
  const inputEl = document.getElementById("server-url-input");
  if (inputEl) {
    inputEl.value = serverUrl;
  }
}

// Current filter state
let currentFilter = "all";
let currentTagFilter = null;
let currentSearchQuery = "";
let cachedBookmarks = [];
let searchDebounceTimer = null;

// Pagination state (cursor-based)
let nextPageUrl = null;    // full URL returned by the backend's "next" field
let totalLoaded = 0;       // how many cards are rendered in the current list view

// Chrome API Fallback Wrapper (seamless in extension, graceful in preview/dev)
const storage = {
  get: (keys, cb) => {
    if (window.chrome?.storage?.local) {
      window.chrome.storage.local.get(keys, cb);
    } else {
      const res = {};
      keys.forEach((k) => { res[k] = localStorage.getItem(k); });
      cb(res);
    }
  },
  set: (obj, cb) => {
    if (window.chrome?.storage?.local) {
      window.chrome.storage.local.set(obj, cb);
    } else {
      Object.keys(obj).forEach((k) => localStorage.setItem(k, obj[k]));
      if (cb) cb();
    }
  },
  remove: (keys, cb) => {
    if (window.chrome?.storage?.local) {
      window.chrome.storage.local.remove(keys, cb);
    } else {
      keys.forEach((k) => localStorage.removeItem(k));
      if (cb) cb();
    }
  },
};

const tabsHelper = {
  query: (opts, cb) => {
    if (window.chrome?.tabs?.query) {
      window.chrome.tabs.query(opts, cb);
    } else {
      cb([{
        title: "Django REST Framework - Intelligent Web Architecture",
        url: "https://www.django-rest-framework.org/api-guide/authentication/",
        favIconUrl: "https://www.django-rest-framework.org/img/favicon.ico"
      }]);
    }
  },
  create: (opts) => {
    if (window.chrome?.tabs?.create) {
      window.chrome.tabs.create(opts);
    } else {
      window.open(opts.url, "_blank");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initServerConfig();
  initAuthEvents();
  initTabs();

  storage.get(["apiToken", "serverUrl"], (result) => {
    if (result.serverUrl) {
      updateServerUrl(result.serverUrl);
    }
    if (result.apiToken) {
      showApp();
    } else {
      showLogin();
    }
  });
});

function initServerConfig() {
  const badgeToggle = document.getElementById("server-badge-toggle");
  const configPanel = document.getElementById("server-config-panel");
  const saveBtn = document.getElementById("save-server-url-btn");
  const inputEl = document.getElementById("server-url-input");

  if (badgeToggle && configPanel) {
    badgeToggle.addEventListener("click", () => {
      const isHidden = configPanel.style.display === "none";
      configPanel.style.display = isHidden ? "block" : "none";
      if (isHidden && inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    });
  }

  if (saveBtn && inputEl) {
    saveBtn.addEventListener("click", () => {
      let val = inputEl.value.trim();
      if (!val) val = DEFAULT_SERVER_URL;
      if (!val.startsWith("http://") && !val.startsWith("https://")) {
        val = `http://${val}`;
      }
      updateServerUrl(val);
      storage.set({ serverUrl: val }, () => {
        if (configPanel) configPanel.style.display = "none";
      });
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
    });
  }
}

function initAuthEvents() {
  // Method Switcher (Token vs Account)
  const tabToken = document.getElementById("auth-tab-token");
  const tabAccount = document.getElementById("auth-tab-account");
  const panelToken = document.getElementById("token-form-panel");
  const panelAccount = document.getElementById("account-form-panel");
  const loginError = document.getElementById("login-error");

  if (tabToken && tabAccount) {
    tabToken.addEventListener("click", () => {
      tabToken.classList.add("active");
      tabAccount.classList.remove("active");
      panelToken.classList.add("active");
      panelAccount.classList.remove("active");
      hideLoginError();
    });

    tabAccount.addEventListener("click", () => {
      tabAccount.classList.add("active");
      tabToken.classList.remove("active");
      panelAccount.classList.add("active");
      panelToken.classList.remove("active");
      hideLoginError();
    });
  }

  // Token Show/Hide toggle
  const toggleVisibility = document.getElementById("toggle-token-visibility");
  const tokenInput = document.getElementById("token");
  if (toggleVisibility && tokenInput) {
    toggleVisibility.addEventListener("click", () => {
      tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });
  }

  // Preserve original Token Connect flow
  const saveTokenBtn = document.getElementById("save-token");
  if (saveTokenBtn && tokenInput) {
    saveTokenBtn.addEventListener("click", () => {
      const token = tokenInput.value.trim();
      if (!token) {
        showLoginError("Please paste an API token.");
        return;
      }
      storage.set({ apiToken: token }, () => {
        showApp();
      });
    });

    tokenInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveTokenBtn.click();
    });
  }

  // Direct Account Login / Register flow
  const loginAccountBtn = document.getElementById("login-account-btn");
  const loginAccountBtnText = document.getElementById("login-account-btn-text");
  const toggleAuthModeBtn = document.getElementById("toggle-auth-mode-btn");
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  let isRegisterMode = false;

  if (toggleAuthModeBtn && loginAccountBtnText) {
    toggleAuthModeBtn.addEventListener("click", () => {
      isRegisterMode = !isRegisterMode;
      if (isRegisterMode) {
        loginAccountBtnText.textContent = "Create Account & Connect";
        toggleAuthModeBtn.textContent = "Already have an account? Sign In";
      } else {
        loginAccountBtnText.textContent = "Sign In & Connect";
        toggleAuthModeBtn.textContent = "Need an account? Register";
      }
      hideLoginError();
    });
  }

  if (loginAccountBtn) {
    loginAccountBtn.addEventListener("click", () => {
      const username = usernameInput ? usernameInput.value.trim() : "";
      const password = passwordInput ? passwordInput.value.trim() : "";

      if (!username || !password) {
        showLoginError("Please enter both username and password.");
        return;
      }

      loginAccountBtn.disabled = true;
      hideLoginError();

      const endpoint = isRegisterMode
        ? `${API_BASE}/register/`
        : `${API_BASE}/token/`;

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = data.error || data.detail || data.non_field_errors?.[0] || (isRegisterMode ? "Registration failed." : "Invalid credentials.");
            throw new Error(msg);
          }
          return data;
        })
        .then((data) => {
          if (data.token) {
            storage.set({ apiToken: data.token }, () => {
              showApp();
            });
          } else {
            throw new Error("No token returned by server.");
          }
        })
        .catch((err) => {
          showLoginError(err.message || (isRegisterMode ? "Failed to register." : "Failed to log in."));
        })
        .finally(() => {
          loginAccountBtn.disabled = false;
        });
    });

    passwordInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loginAccountBtn.click();
    });
  }

  // Logout / Disconnect Button
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      storage.remove(["apiToken"], () => {
        showLogin();
      });
    });
  }

  // Refresh Button
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshBtn.style.transform = "rotate(360deg)";
      setTimeout(() => { refreshBtn.style.transform = ""; }, 350);
      loadBookmarks(currentSearchQuery);
      loadTags();
    });
  }
}

function showLogin() {
  document.getElementById("login-view").style.display = "flex";
  document.getElementById("app-view").style.display = "none";
}

function showApp() {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("app-view").style.display = "block";
  initSaveTab();
  initBrowseTab();
  loadTags();
}

function showLoginError(msg) {
  const el = document.getElementById("login-error");
  if (el) {
    el.textContent = msg;
    el.style.display = "block";
  }
}

function hideLoginError() {
  const el = document.getElementById("login-error");
  if (el) {
    el.style.display = "none";
    el.textContent = "";
  }
}


// Tabs


function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPanel = document.getElementById(btn.dataset.tab);
      if (targetPanel) targetPanel.classList.add("active");

      if (btn.dataset.tab === "browse-tab") {
        loadBookmarks(currentSearchQuery);
      }
    });
  });
}


// Shared Fetch Helper


function apiFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    storage.get(["apiToken"], ({ apiToken }) => {
      if (!apiToken) {
        showLogin();
        reject(new Error("No API token found. Please connect."));
        return;
      }

      fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Token ${apiToken}`,
          ...(options.headers || {}),
        },
      })
        .then(async (res) => {
          if (res.status === 401) {
            // Token expired or invalid
            storage.remove(["apiToken"], () => {
              showLogin();
              showLoginError("Session expired. Please reconnect.");
            });
            throw new Error("Unauthorized (401)");
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || body.error || `Server responded ${res.status}`);
          }
          if (res.status === 204) return null;
          return res.json();
        })
        .then(resolve)
        .catch(reject);
    });
  });
}


// Save Tab


function initSaveTab() {
  tabsHelper.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    const titleEl = document.getElementById("page-title");
    const urlEl = document.getElementById("page-url");
    const domainEl = document.getElementById("page-domain");
    const faviconEl = document.getElementById("page-favicon");
    const fallbackEl = document.getElementById("page-favicon-fallback");
    const saveBtn = document.getElementById("save-btn");

    if (titleEl) titleEl.textContent = tab.title || "Untitled page";
    if (urlEl) urlEl.textContent = tab.url || "";

    try {
      const urlObj = new URL(tab.url);
      if (domainEl) domainEl.textContent = urlObj.hostname.replace(/^www\./, "");
    } catch {
      if (domainEl) domainEl.textContent = "webpage";
    }

    // Favicon preview
    if (tab.favIconUrl && faviconEl && fallbackEl) {
      faviconEl.src = tab.favIconUrl;
      faviconEl.style.display = "block";
      fallbackEl.style.display = "none";
      faviconEl.onerror = () => {
        faviconEl.style.display = "none";
        fallbackEl.style.display = "flex";
      };
    }

    // Bind save button (replace listeners to avoid duplicate bindings)
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener("click", () => saveBookmark(tab.url));
  });
}

function saveBookmark(url) {
  const statusEl = document.getElementById("save-status");
  const btn = document.getElementById("save-btn");
  const btnText = document.getElementById("save-btn-text");
  const spinner = document.getElementById("save-spinner");

  btn.disabled = true;
  if (btnText) btnText.textContent = "Saving to library…";
  if (spinner) spinner.style.display = "block";
  setStatus(statusEl, "");

  apiFetch("/bookmarks/", { method: "POST", body: JSON.stringify({ url }) })
    .then((data) => {
      setStatus(
        statusEl,
        `✓ Saved successfully! Processing metadata (Status: ${data.status})`,
        "success"
      );
      if (btnText) btnText.textContent = "Saved to Bookmarks!";
      setTimeout(() => {
        if (btnText) btnText.textContent = "Save this page";
      }, 2500);
    })
    .catch((err) => {
      setStatus(statusEl, `Failed: ${err.message}`, "error");
      if (btnText) btnText.textContent = "Save this page";
    })
    .finally(() => {
      btn.disabled = false;
      if (spinner) spinner.style.display = "none";
    });
}


// Browse Tab


function initBrowseTab() {
  loadBookmarks();

  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search-btn");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      currentSearchQuery = q;

      if (clearBtn) {
        clearBtn.style.display = q ? "flex" : "none";
      }

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        loadBookmarks(q);
      }, 300);
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      currentSearchQuery = "";
      clearBtn.style.display = "none";
      loadBookmarks();
    });
  }

  // Filter chips (All, Favorites, Web, PDF)
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.dataset.filter;
      applyClientFiltersAndRender();
    });
  });

  // Load more button — wired once; shown/hidden by setPaginationFooter
  const loadMoreBtn = document.getElementById("load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", loadMoreBookmarks);
  }
}

function loadTags() {
  apiFetch("/tags/")
    .then((tags) => {
      const container = document.getElementById("tag-filter-chips");
      if (!container) return;
      container.innerHTML = "";

      if (!tags || tags.length === 0) return;

      tags.forEach((tag) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-filter-chip";
        chip.textContent = `#${tag.name}`;
        chip.addEventListener("click", () => {
          if (currentTagFilter === tag.name) {
            currentTagFilter = null;
            chip.classList.remove("active");
            loadBookmarks(currentSearchQuery);
          } else {
            document.querySelectorAll(".tag-filter-chip").forEach((c) => c.classList.remove("active"));
            currentTagFilter = tag.name;
            chip.classList.add("active");
            loadBookmarks(currentSearchQuery, tag.name);
          }
        });
        container.appendChild(chip);
      });
    })
    .catch(() => {});
}

function loadBookmarks(query = "", tagFilter = currentTagFilter) {
  // Reset pagination state whenever a fresh load is triggered.
  resetPaginationState();

  const listEl = document.getElementById("bookmark-list");
  const statusEl = document.getElementById("browse-status");

  renderSkeletons(listEl);
  setStatus(statusEl, "");

  let path;
  if (query) {
    // Search results come back as a flat array (not paginated) — preserve that contract.
    path = `/bookmarks/search/?q=${encodeURIComponent(query)}`;
  } else if (tagFilter) {
    path = `/bookmarks/?tags=${encodeURIComponent(tagFilter)}`;
  } else {
    path = "/bookmarks/";
  }

  apiFetch(path)
    .then((data) => {
      // Handle both paginated envelope { next, results } and flat array (search).
      const isEnvelope = data && typeof data === "object" && !Array.isArray(data) && "results" in data;
      const bookmarks = isEnvelope ? data.results : (Array.isArray(data) ? data : []);
      nextPageUrl = isEnvelope ? data.next : null;

      cachedBookmarks = bookmarks;
      totalLoaded = bookmarks.length;
      updateCountPill(totalLoaded);
      applyClientFiltersAndRender();
      setPaginationFooter(isEnvelope, nextPageUrl);
    })
    .catch((err) => {
      listEl.innerHTML = "";
      hidePaginationFooter();
      setStatus(statusEl, err.message || "Failed to load bookmarks.", "error");
    });
}

/**
 * Fetches the next cursor page and APPENDS cards to the existing list.
 * Called by the "Load more" button.
 */
function loadMoreBookmarks() {
  if (!nextPageUrl) return;

  const btn = document.getElementById("load-more-btn");
  const spinner = document.getElementById("load-more-spinner");
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = "block";

  // apiFetch only accepts a path, so strip the base origin from the full URL.
  const url = new URL(nextPageUrl);
  const path = url.pathname.replace("/api", "") + url.search;

  apiFetch(path)
    .then((data) => {
      const isEnvelope = data && typeof data === "object" && !Array.isArray(data) && "results" in data;
      const newBookmarks = isEnvelope ? data.results : [];
      nextPageUrl = isEnvelope ? data.next : null;

      // Merge into cache and append to DOM.
      cachedBookmarks = [...cachedBookmarks, ...newBookmarks];
      totalLoaded = cachedBookmarks.length;
      updateCountPill(totalLoaded);

      const listEl = document.getElementById("bookmark-list");
      appendBookmarks(newBookmarks, listEl);
      setPaginationFooter(true, nextPageUrl);
    })
    .catch((err) => {
      setStatus(document.getElementById("browse-status"), err.message, "error");
    })
    .finally(() => {
      if (btn) btn.disabled = false;
      if (spinner) spinner.style.display = "none";
    });
}

function resetPaginationState() {
  nextPageUrl = null;
  totalLoaded = 0;
  hidePaginationFooter();
}

function setPaginationFooter(isPaginated, nextUrl) {
  const footer = document.getElementById("pagination-footer");
  const label = document.getElementById("pagination-label");
  const btn = document.getElementById("load-more-btn");

  if (!isPaginated || (!nextUrl && totalLoaded === 0)) {
    if (footer) footer.style.display = "none";
    return;
  }

  if (footer) footer.style.display = "flex";
  if (label) label.textContent = `Showing ${totalLoaded} bookmark${totalLoaded !== 1 ? "s" : ""}`;

  if (btn) {
    if (nextUrl) {
      btn.style.display = "flex";
      btn.disabled = false;
    } else {
      // All pages loaded — hide the button, label stays.
      btn.style.display = "none";
    }
  }
}

function hidePaginationFooter() {
  const footer = document.getElementById("pagination-footer");
  if (footer) footer.style.display = "none";
}

function applyClientFiltersAndRender() {
  let filtered = [...cachedBookmarks];

  if (currentFilter === "favorites") {
    filtered = filtered.filter((b) => b.is_favorite);
  } else if (currentFilter === "html") {
    filtered = filtered.filter((b) => (b.resource_type || "html") === "html");
  } else if (currentFilter === "pdf") {
    filtered = filtered.filter((b) => b.resource_type === "pdf");
  }

  renderBookmarks(filtered);
}

function updateCountPill(count) {
  const pill = document.getElementById("browse-count-pill");
  if (pill) pill.textContent = count;
}

function renderSkeletons(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="skeleton-card">
      <div class="skeleton-bar short"></div>
      <div class="skeleton-bar medium"></div>
      <div class="skeleton-bar full"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton-bar short"></div>
      <div class="skeleton-bar medium"></div>
      <div class="skeleton-bar full"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton-bar short"></div>
      <div class="skeleton-bar medium"></div>
      <div class="skeleton-bar full"></div>
    </div>
  `;
}

function renderBookmarks(bookmarks) {
  const listEl = document.getElementById("bookmark-list");
  const statusEl = document.getElementById("browse-status");
  listEl.innerHTML = "";

  if (!bookmarks || bookmarks.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div class="empty-title">${currentSearchQuery ? "No matching bookmarks" : "No bookmarks found"}</div>
        <div class="empty-desc">${
          currentSearchQuery
            ? "Try another keyword or clear search filter."
            : "Save your favorite webpages and PDFs to build your collection."
        }</div>
      </div>
    `;
    setStatus(statusEl, "");
    return;
  }

  setStatus(statusEl, "");
  bookmarks.forEach((b) => listEl.appendChild(buildBookmarkCard(b)));
}

/**
 * Appends new cards to an existing list without clearing it.
 * Used by the "Load more" button to add the next cursor page.
 */
function appendBookmarks(bookmarks, listEl) {
  if (!listEl || !bookmarks || bookmarks.length === 0) return;
  bookmarks.forEach((b) => listEl.appendChild(buildBookmarkCard(b)));
}

/**
 * Builds and returns a fully wired bookmark card DOM element.
 * Shared by renderBookmarks (full render) and appendBookmarks (incremental).
 */
function buildBookmarkCard(b) {
    const item = document.createElement("div");
    item.className = "bookmark-item";
    item.dataset.id = b.id;

    // Domain & Favicon handling
    let domain = "";
    try {
      domain = new URL(b.url).hostname.replace(/^www\./, "");
    } catch {
      domain = b.url;
    }
    const initial = (domain.charAt(0) || "B").toUpperCase();

    // Tags
    const tagsHtml = (b.tags || [])
      .map((t) => `<span class="tag-chip">#${escapeHtml(t.tag?.name || "")}</span>`)
      .join("");

    // Resource Type Badge
    const resType = (b.resource_type || "html").toLowerCase();
    const typeBadgeHtml = `<span class="type-badge ${resType}">${resType}</span>`;

    // Highlighted Snippet or Description
    let snippetHtml = "";
    if (b.headline) {
      snippetHtml = `<div class="headline-snippet">${sanitizeHeadline(b.headline)}</div>`;
    } else if (b.description) {
      snippetHtml = `<div class="headline-snippet">${escapeHtml(b.description)}</div>`;
    }

    // Favicon / Avatar
    const faviconHtml = b.favicon_url
      ? `<img class="site-icon" src="${escapeHtml(b.favicon_url)}" onerror="this.outerHTML='<div class=\\'site-avatar-fallback\\'>${initial}</div>'"/>`
      : `<div class="site-avatar-fallback">${initial}</div>`;

    // Retry Button (shown only if status === 'failed')
    const retryBtnHtml =
      b.status === "failed"
        ? `<button class="icon-btn retry-btn" title="Retry async fetch">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="23 4 23 10 17 10"></polyline>
               <polyline points="1 20 1 14 7 14"></polyline>
               <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
             </svg>
           </button>`
        : "";

    item.innerHTML = `
      <div class="bookmark-meta-row">
        <div class="meta-left">
          ${faviconHtml}
          <span class="domain-label">${escapeHtml(domain)}</span>
        </div>
        <div class="meta-right">
          ${typeBadgeHtml}
          <span class="status-badge ${escapeHtml(b.status)}">${escapeHtml(b.status)}</span>
        </div>
      </div>

      <div class="title" title="Open ${escapeHtml(b.url)}">${escapeHtml(b.title || b.url)}</div>
      ${snippetHtml}
      <div class="url">${escapeHtml(b.url)}</div>
      ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ""}

      <div class="row">
        <div class="actions-left" id="toast-${b.id}"></div>
        <div class="actions">
          ${retryBtnHtml}
          <button class="icon-btn favorite-btn ${b.is_favorite ? "favorited" : ""}" title="${
            b.is_favorite ? "Remove favorite" : "Star favorite"
          }">
            <svg viewBox="0 0 24 24" fill="${b.is_favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="icon-btn copy-btn" title="Copy URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="icon-btn open-btn" title="Open in new tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
          <button class="icon-btn delete-btn" title="Delete bookmark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Event Bindings
    item.querySelector(".title").addEventListener("click", () => tabsHelper.create({ url: b.url }));
    item.querySelector(".favorite-btn").addEventListener("click", () => toggleFavorite(b, item));
    item.querySelector(".copy-btn").addEventListener("click", () => copyBookmarkUrl(b.url, item, b.id));
    item.querySelector(".open-btn").addEventListener("click", () => tabsHelper.create({ url: b.url }));
    item.querySelector(".delete-btn").addEventListener("click", () => deleteBookmark(b.id, item));

    const retryBtn = item.querySelector(".retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => retryBookmark(b.id, item));
    }

    return item;
}

function toggleFavorite(bookmark, itemEl) {
  const favBtn = itemEl.querySelector(".favorite-btn");
  const nextState = !bookmark.is_favorite;

  apiFetch(`/bookmarks/${bookmark.id}/`, {
    method: "PATCH",
    body: JSON.stringify({ is_favorite: nextState }),
  })
    .then((updated) => {
      bookmark.is_favorite = updated.is_favorite;
      favBtn.classList.toggle("favorited", updated.is_favorite);
      const svg = favBtn.querySelector("svg");
      if (svg) svg.setAttribute("fill", updated.is_favorite ? "currentColor" : "none");

      // If viewing favorites filter, re-evaluate visibility
      if (currentFilter === "favorites" && !updated.is_favorite) {
        itemEl.style.opacity = "0.5";
        setTimeout(() => itemEl.remove(), 250);
      }
    })
    .catch((err) => {
      setStatus(document.getElementById("browse-status"), err.message, "error");
    });
}

function copyBookmarkUrl(url, itemEl, bookmarkId) {
  const toastContainer = itemEl.querySelector(`#toast-${bookmarkId}`);

  const copyAction = () => {
    if (toastContainer) {
      toastContainer.innerHTML = `<span class="copied-badge">Copied!</span>`;
      setTimeout(() => {
        if (toastContainer) toastContainer.innerHTML = "";
      }, 1600);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(copyAction).catch(() => fallbackCopy(url, copyAction));
  } else {
    fallbackCopy(url, copyAction);
  }
}

function fallbackCopy(text, callback) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    if (callback) callback();
  } catch {}
  document.body.removeChild(ta);
}

function retryBookmark(id, itemEl) {
  const retryBtn = itemEl.querySelector(".retry-btn");
  if (retryBtn) retryBtn.disabled = true;

  apiFetch(`/bookmarks/${id}/retry/`, { method: "POST" })
    .then(() => {
      const badge = itemEl.querySelector(".status-badge");
      if (badge) {
        badge.className = "status-badge pending";
        badge.textContent = "pending";
      }
      if (retryBtn) retryBtn.remove();
    })
    .catch((err) => {
      setStatus(document.getElementById("browse-status"), `Retry failed: ${err.message}`, "error");
      if (retryBtn) retryBtn.disabled = false;
    });
}

function deleteBookmark(id, itemEl) {
  itemEl.style.transform = "scale(0.95)";
  itemEl.style.opacity = "0";
  itemEl.style.transition = "all 0.2s ease";

  apiFetch(`/bookmarks/${id}/`, { method: "DELETE" })
    .then(() => {
      setTimeout(() => {
        itemEl.remove();
        cachedBookmarks = cachedBookmarks.filter((b) => b.id !== id);
        updateCountPill(cachedBookmarks.length);
        if (cachedBookmarks.length === 0) {
          applyClientFiltersAndRender();
        }
      }, 200);
    })
    .catch((err) => {
      itemEl.style.transform = "none";
      itemEl.style.opacity = "1";
      setStatus(document.getElementById("browse-status"), err.message, "error");
    });
}


// Helpers & Sanitization


function setStatus(el, message, kind = "") {
  if (!el) return;
  el.textContent = message;
  el.className = `status ${kind}`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// Safely allows only <b> and </b> tags produced by Django SearchHeadline
function sanitizeHeadline(headline) {
  if (!headline) return "";
  const escaped = escapeHtml(headline);
  return escaped.replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}