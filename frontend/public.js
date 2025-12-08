// ===== Config =====
const BACKEND_URL = "https://doc-upload-app.onrender.com"; // your backend (read-only)

// ===== DOM =====
const fileListDiv = document.getElementById("fileList");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const sortSelect = document.getElementById("sortSelect");
const gridViewBtn = document.getElementById("gridViewBtn");
const listViewBtn = document.getElementById("listViewBtn");
const fileCountSpan = document.getElementById("fileCount");
const totalSizeSpan = document.getElementById("totalSize");
const totalSizeSidebarSpan = document.getElementById("totalSizeSidebar");
const storageBarFill = document.getElementById("storageBarFill");
const storagePercentLabel = document.getElementById("storagePercentLabel");
const previewModal = document.getElementById("previewModal");
const previewBody = document.getElementById("previewBody");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const toast = document.getElementById("toast");
const folderFilter = document.getElementById("folderFilter");
const chips = document.querySelectorAll(".chip");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const navFavorites = document.getElementById("navFavorites");
const detailsModal = document.getElementById("detailsModal");
const detailsBody = document.getElementById("detailsBody");
const closeDetailsBtn = document.getElementById("closeDetailsBtn");

// ===== State =====
let allFiles = [];
let viewMode = localStorage.getItem("studyDriveViewMode") || "grid";
let activeChip = localStorage.getItem("studyDriveActiveChip") || "all";
let favoriteKeys = loadFavorites();
let currentDetailsFile = null;

// ===== Helpers =====
function loadFavorites() {
  try {
    const raw = localStorage.getItem("studyDriveFavorites");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  localStorage.setItem("studyDriveFavorites", JSON.stringify(favoriteKeys));
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2500);
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function detectType(name) {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "image";
  if (lower.match(/\.(docx?|pptx?|xlsx?)$/)) return "doc";
  return "other";
}

function getIconText(type) {
  switch (type) {
    case "pdf":
      return "PDF";
    case "image":
      return "IMG";
    case "doc":
      return "DOC";
    default:
      return "FILE";
  }
}

function updateStats() {
  const count = allFiles.length;
  const totalBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const storageLimitBytes = 1024 * 1024 * 1024; // fake 1 GB limit

  if (fileCountSpan) fileCountSpan.textContent = `${count}`;
  if (totalSizeSpan) totalSizeSpan.textContent = formatSize(totalBytes) || "0 KB";
  if (totalSizeSidebarSpan)
    totalSizeSidebarSpan.textContent = formatSize(totalBytes) || "0 KB";

  const percentage = Math.min(
    100,
    Math.round((totalBytes / storageLimitBytes) * 100)
  );
  if (storageBarFill) {
    storageBarFill.style.width = `${percentage}%`;
  }
  if (storagePercentLabel) {
    storagePercentLabel.textContent = `${percentage}%`;
  }
}

function updateFolderFilterOptions() {
  if (!folderFilter) return;
  const folders = [...new Set(allFiles.map((f) => f.folder || "root"))].sort();
  folderFilter.innerHTML =
    '<option value="all">All folders</option>' +
    folders.map((f) => `<option value="${f}">${f}</option>`).join("");
}

// ===== API: load/download (read-only) =====
async function loadFileList() {
  if (!fileListDiv) return;

  fileListDiv.classList.add("file-list--loading");
  fileListDiv.innerHTML = `
    <div class="skeleton-list">
      <div class="skeleton-item"></div>
      <div class="skeleton-item"></div>
      <div class="skeleton-item"></div>
    </div>
  `;

  try {
    const res = await fetch(`${BACKEND_URL}/files`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON from /files");
    }

    if (!res.ok) {
      throw new Error(data.message || "Failed to load files");
    }

    const files = (data.files || []).map((f) => ({
      ...f,
      type: detectType(f.name),
      folder: f.folder || "root",
    }));

    allFiles = files;
    updateStats();
    updateFolderFilterOptions();
    renderFileList();
  } catch (err) {
    console.error("Error loading file list:", err);
    fileListDiv.classList.remove("file-list--loading");
    fileListDiv.innerHTML = `
      <div class="file-list-error">
        <span class="file-list-empty-icon">⚠️</span>
        <div>Failed to load files from server.</div>
        <div class="small">Check connection or try again later.</div>
      </div>
    `;
  }
}

async function handleDownload(key) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/files/download?key=${encodeURIComponent(key)}`
    );

    const data = await res.json();

    if (!res.ok || !data.url) {
      console.error("Download error response:", data);
      showToast(data.message || "Download failed");
      return;
    }

    // Go directly to the signed S3 URL
    window.location.href = data.url;
  } catch (err) {
    console.error("Download error:", err);
    showToast("Download failed");
  }
}


// ===== Filtering / View =====
function getFilteredFiles() {
  const query = (searchInput?.value || "").toLowerCase().trim();
  const folder = folderFilter?.value || "all";
  const sort = sortSelect?.value || "newest";
  const chip = activeChip;

  let files = [...allFiles];

  if (chip === "pdf" || chip === "image" || chip === "doc") {
    files = files.filter((f) => f.type === chip);
  } else if (chip === "favorites") {
    files = files.filter((f) => favoriteKeys.includes(f.key));
  }

  if (folder !== "all") {
    files = files.filter((f) => (f.folder || "root") === folder);
  }

  if (typeFilter && typeFilter.value !== "all" && chip === "all") {
    files = files.filter((f) => f.type === typeFilter.value);
  }

  if (query) {
    files = files.filter((f) =>
      (f.name || "").toLowerCase().includes(query)
    );
  }

  files.sort((a, b) => {
    const da = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const db = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    const sa = a.size || 0;
    const sb = b.size || 0;
    const na = (a.name || "").toLowerCase();
    const nb = (b.name || "").toLowerCase();

    switch (sort) {
      case "oldest":
        return da - db;
      case "az":
        return na.localeCompare(nb);
      case "za":
        return nb.localeCompare(na);
      case "sizeAsc":
        return sa - sb;
      case "sizeDesc":
        return sb - sa;
      case "newest":
      default:
        return db - da;
    }
  });

  return files;
}

function renderFileList() {
  if (!fileListDiv) return;

  fileListDiv.classList.remove("file-list--loading");

  if (!allFiles.length) {
    fileListDiv.innerHTML = `
      <div class="file-list-empty">
        <span class="file-list-empty-icon">📂</span>
        <div>No files available.</div>
        <div class="small">Files will appear here when uploaded by admin.</div>
      </div>
    `;
    return;
  }

  const files = getFilteredFiles();
  fileListDiv.className = `file-list ${viewMode}`;

  if (!files.length) {
    fileListDiv.innerHTML = `
      <div class="file-list-empty">
        <span class="file-list-empty-icon">🔍</span>
        <div>No files match your filters.</div>
        <div class="small">Try clearing search or changing folder/type.</div>
      </div>
    `;
    return;
  }

  fileListDiv.innerHTML = files
    .map((file) => {
      const typeClass = file.type || "other";
      const iconText = getIconText(typeClass);
      const sizeText = formatSize(file.size);
      const dateText = formatDate(file.lastModified);
      const folderText = file.folder || "root";
      const isFav = favoriteKeys.includes(file.key);

      return `
        <div class="file-item" data-url="${file.url}" data-type="${typeClass}" data-key="${file.key}">
          <div class="file-icon ${typeClass}">${iconText}</div>
          <div class="file-main">
            <p class="file-name" title="${file.name || ""}">
              ${file.name || "Untitled file"}
            </p>
            <p class="file-meta">
              [${folderText}] · ${sizeText || ""}${sizeText && dateText ? " · " : ""}${dateText || ""}
            </p>
          </div>
          <div class="file-actions">
            <button type="button" class="favorite-btn ${isFav ? "is-favorite" : ""}" title="Favorite">
              ${isFav ? "★" : "☆"}
            </button>
            <button type="button" class="preview-btn">Preview</button>
            <a href="${file.url}" target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" class="download-btn">Download</button>
            <button type="button" class="details-btn">Details</button>
          </div>
        </div>
      `;
    })
    .join("");

  fileListDiv.querySelectorAll(".file-item").forEach((item) => {
    const url = item.getAttribute("data-url");
    const type = item.getAttribute("data-type");
    const key = item.getAttribute("data-key");
    const previewBtn = item.querySelector(".preview-btn");
    const favoriteBtn = item.querySelector(".favorite-btn");
    const downloadBtn = item.querySelector(".download-btn");
    const detailsBtn = item.querySelector(".details-btn");

    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPreview(url, type);
    });

    favoriteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(key, favoriteBtn);
    });

    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDownload(key);
    });

    detailsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const file = allFiles.find((f) => f.key === key);
      if (file) openDetails(file);
    });

    item.addEventListener("click", (e) => {
      if (e.target.closest(".file-actions")) return;
      openPreview(url, type);
    });
  });
}

function toggleFavorite(key, btn) {
  if (favoriteKeys.includes(key)) {
    favoriteKeys = favoriteKeys.filter((k) => k !== key);
  } else {
    favoriteKeys.push(key);
  }
  saveFavorites();
  if (btn) {
    const isFav = favoriteKeys.includes(key);
    btn.classList.toggle("is-favorite", isFav);
    btn.textContent = isFav ? "★" : "☆";
  }
  if (activeChip === "favorites") {
    renderFileList();
  }
}

// ===== Preview modal =====
function openPreview(url, type) {
  if (!previewModal || !previewBody) {
    window.open(url, "_blank");
    return;
  }

  previewBody.innerHTML = "";

  if (type === "pdf") {
    previewBody.innerHTML = `<iframe src="${url}" title="PDF preview"></iframe>`;
  } else if (type === "image") {
    previewBody.innerHTML = `<img src="${url}" alt="Image preview" />`;
  } else {
    previewBody.innerHTML = `
      <p>This file type cannot be previewed here. You can open it in a new tab:</p>
      <p><a href="${url}" target="_blank" rel="noopener noreferrer">Open file</a></p>
    `;
  }

  previewModal.classList.remove("hidden");
}

function closePreview() {
  if (!previewModal || !previewBody) return;
  previewModal.classList.add("hidden");
  previewBody.innerHTML = "";
}

// ===== Details modal (read-only) =====
function openDetails(file) {
  currentDetailsFile = file;
  if (!detailsModal || !detailsBody) return;

  const sizeText = formatSize(file.size);
  const dateText = formatDate(file.lastModified);
  const typeText = file.type || detectType(file.name);

  detailsBody.innerHTML = `
    <h3 style="margin:0 0 8px;font-size:15px;">File details</h3>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 10px;">View this file's information.</p>

    <div style="font-size:13px;line-height:1.5;">
      <div><strong>Name:</strong> ${file.name}</div>
      <div><strong>Folder:</strong> ${file.folder || "root"}</div>
      <div><strong>Type:</strong> ${typeText}</div>
      <div><strong>Size:</strong> ${sizeText}</div>
      <div><strong>Last modified:</strong> ${dateText}</div>
      <div style="word-break:break-all;"><strong>Key:</strong> ${file.key}</div>
    </div>

    <hr style="margin:10px 0;border-color:#1f2937;" />

    <div style="font-size:13px;display:flex;flex-direction:column;gap:8px;">
      <div>
        <label style="font-size:12px;display:block;margin-bottom:2px;">Share / open link</label>
        <div style="display:flex;gap:6px;">
          <input id="linkInput" type="text" readonly style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #4b5563;background:#020617;color:#9ca3af;font-size:12px;overflow:hidden;text-overflow:ellipsis;" value="${file.url}" />
          <button id="copyLinkBtn" type="button" style="padding:6px 10px;border-radius:999px;border:none;background:#111827;color:#e5e7eb;font-size:12px;cursor:pointer;">Copy</button>
        </div>
      </div>
    </div>
  `;

  const copyLinkBtn = document.getElementById("copyLinkBtn");
  const linkInput = document.getElementById("linkInput");

  if (copyLinkBtn && linkInput) {
    copyLinkBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(linkInput.value);
        showToast("Link copied 📋");
      } catch {
        linkInput.select();
        showToast("Link ready to copy");
      }
    });
  }

  detailsModal.classList.remove("hidden");
}

function closeDetails() {
  if (!detailsModal || !detailsBody) return;
  detailsModal.classList.add("hidden");
  detailsBody.innerHTML = "";
  currentDetailsFile = null;
}

// ===== Sidebar & chips =====
function toggleSidebar() {
  if (!sidebar) return;
  sidebar.classList.toggle("open");
}

function setActiveChip(name) {
  activeChip = name;
  localStorage.setItem("studyDriveActiveChip", activeChip);
  chips.forEach((chip) => {
    chip.classList.toggle("chip-active", chip.dataset.chip === activeChip);
  });
  renderFileList();
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  if (searchInput) searchInput.addEventListener("input", renderFileList);
  if (sortSelect) sortSelect.addEventListener("change", renderFileList);
  if (folderFilter) folderFilter.addEventListener("change", renderFileList);
  if (typeFilter) typeFilter.addEventListener("change", renderFileList);

  if (gridViewBtn && listViewBtn) {
    const applyView = () => {
      gridViewBtn.classList.toggle("active", viewMode === "grid");
      listViewBtn.classList.toggle("active", viewMode === "list");
      renderFileList();
    };
    gridViewBtn.addEventListener("click", () => {
      viewMode = "grid";
      localStorage.setItem("studyDriveViewMode", viewMode);
      applyView();
    });
    listViewBtn.addEventListener("click", () => {
      viewMode = "list";
      localStorage.setItem("studyDriveViewMode", viewMode);
      applyView();
    });
    applyView();
  }

  chips.forEach((chip) => {
    chip.classList.toggle("chip-active", chip.dataset.chip === activeChip);
    chip.addEventListener("click", () => {
      setActiveChip(chip.dataset.chip);
    });
  });

  if (closePreviewBtn) {
    closePreviewBtn.addEventListener("click", closePreview);
  }
  if (previewModal) {
    previewModal.addEventListener("click", (e) => {
      if (
        e.target === previewModal ||
        e.target.classList.contains("modal-backdrop")
      ) {
        closePreview();
      }
    });
  }

  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener("click", closeDetails);
  }
  if (detailsModal) {
    detailsModal.addEventListener("click", (e) => {
      if (
        e.target === detailsModal ||
        e.target.classList.contains("modal-backdrop")
      ) {
        closeDetails();
      }
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", toggleSidebar);
  }

  if (navFavorites) {
    navFavorites.addEventListener("click", () => {
      setActiveChip("favorites");
      showToast("Showing favorite files ⭐");
    });
  }

  loadFileList();
});
