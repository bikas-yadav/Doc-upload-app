// ===== Config =====
const BACKEND_URL = "https://doc-upload-app.onrender.com"; // same backend

// ===== DOM =====
const form = document.getElementById("uploadForm");
const statusDiv = document.getElementById("status");
const fileListDiv = document.getElementById("fileList");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter"); // optional (we also have chips)
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
const folderInput = document.getElementById("folderInput");
const folderFilter = document.getElementById("folderFilter");
const chips = document.querySelectorAll(".chip");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const uploadQueue = document.getElementById("uploadQueue");
const uploadQueueList = document.getElementById("uploadQueueList");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const navFavorites = document.getElementById("navFavorites");

// ===== State =====
let allFiles = [];
let viewMode = localStorage.getItem("studyDriveViewMode") || "grid";
let activeChip = localStorage.getItem("studyDriveActiveChip") || "all";
let favoriteKeys = loadFavorites();

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
  const storageLimitBytes = 1024 * 1024 * 1024; // 1 GB (fake limit for UI)

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

// ===== API: load/delete =====
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
        <div class="small">Check your backend URL or try again later.</div>
      </div>
    `;
  }
}

async function deleteFile(key) {
  try {
    const res = await fetch(`${BACKEND_URL}/files`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    if (!res.ok) {
      showToast(data.message || "Failed to delete file");
      return;
    }

    // Remove from favorites if present
    favoriteKeys = favoriteKeys.filter((k) => k !== key);
    saveFavorites();

    showToast("File deleted ✅");
    await loadFileList();
  } catch (err) {
    console.error("Delete error:", err);
    showToast("Error deleting file");
  }
}

// ===== Render =====
function getFilteredFiles() {
  const query = (searchInput?.value || "").toLowerCase().trim();
  const folder = folderFilter?.value || "all";
  const sort = sortSelect?.value || "newest";
  const chip = activeChip;

  let files = [...allFiles];

  // Chip filter
  if (chip === "pdf" || chip === "image" || chip === "doc") {
    files = files.filter((f) => f.type === chip);
  } else if (chip === "favorites") {
    files = files.filter((f) => favoriteKeys.includes(f.key));
  }

  // Folder filter
  if (folder !== "all") {
    files = files.filter((f) => (f.folder || "root") === folder);
  }

  // Extra select typeFilter if present & not "all"
  if (typeFilter && typeFilter.value !== "all" && chip === "all") {
    files = files.filter((f) => f.type === typeFilter.value);
  }

  // Search
  if (query) {
    files = files.filter((f) =>
      (f.name || "").toLowerCase().includes(query)
    );
  }

  // Sort
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
        <div>No files uploaded yet.</div>
        <div class="small">Upload your first note from the left panel.</div>
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
              [${folderText}] · ${sizeText || ""}${
                sizeText && dateText ? " · " : ""
              }${dateText || ""}
            </p>
          </div>
          <div class="file-actions">
            <button type="button" class="favorite-btn ${
              isFav ? "is-favorite" : ""
            }" title="Favorite">
              ${isFav ? "★" : "☆"}
            </button>
            <button type="button" class="preview-btn">Preview</button>
            <a href="${file.url}" target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" class="delete-btn">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach handlers
  fileListDiv.querySelectorAll(".file-item").forEach((item) => {
    const url = item.getAttribute("data-url");
    const type = item.getAttribute("data-type");
    const key = item.getAttribute("data-key");
    const previewBtn = item.querySelector(".preview-btn");
    const deleteBtn = item.querySelector(".delete-btn");
    const favoriteBtn = item.querySelector(".favorite-btn");

    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPreview(url, type);
    });

    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Are you sure you want to delete this file?")) {
        await deleteFile(key);
      }
    });

    favoriteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(key, favoriteBtn);
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
  // If we're in "favorites" chip view, rerender
  if (activeChip === "favorites") {
    renderFileList();
  }
}

// ===== Upload =====
function ensureQueueVisible() {
  if (!uploadQueue) return;
  uploadQueue.classList.remove("hidden");
}

function addQueueItem(filename) {
  ensureQueueVisible();
  const el = document.createElement("div");
  el.className = "queue-item";
  el.innerHTML = `
    <span class="queue-name" title="${filename}">${filename}</span>
    <span class="queue-status uploading">Uploading...</span>
  `;
  uploadQueueList.appendChild(el);
  return el;
}

function updateQueueItemStatus(el, status, kind) {
  if (!el) return;
  const statusSpan = el.querySelector(".queue-status");
  statusSpan.textContent = status;
  statusSpan.className = `queue-status ${kind}`;
}

async function uploadSingleFile(file, folder) {
  const queueItemEl = addQueueItem(file.name);

  const formData = new FormData();
  formData.append("document", file);
  if (folder) {
    formData.append("folder", folder);
  }

  try {
    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { message: rawText };
    }

    if (!res.ok) {
      updateQueueItemStatus(
        queueItemEl,
        data.message || "Failed",
        "error"
      );
      showToast(`Upload failed: ${file.name}`);
      return;
    }

    updateQueueItemStatus(queueItemEl, "Done ✅", "success");
  } catch (err) {
    console.error("Upload error:", err);
    updateQueueItemStatus(queueItemEl, "Error", "error");
    showToast(`Upload error: ${file.name}`);
  }
}

async function handleFilesSelected(filesList) {
  const files = Array.from(filesList || []);
  if (!files.length) return;

  if (!statusDiv) return;

  statusDiv.textContent = "";
  statusDiv.className = "status-message";

  const folder = folderInput && folderInput.value.trim()
    ? folderInput.value.trim()
    : "";

  statusDiv.textContent = `Uploading ${files.length} file(s)...`;

  for (const file of files) {
    await uploadSingleFile(file, folder);
  }

  statusDiv.textContent = "Upload(s) finished.";
  statusDiv.classList.add("success");
  showToast("Upload complete ✅");

  // Clear input but keep folder
  if (fileInput) fileInput.value = "";

  await loadFileList();
}

async function handleUpload(e) {
  e.preventDefault();
  if (!fileInput || !fileInput.files.length) {
    statusDiv.textContent = "Please choose at least one file first.";
    statusDiv.className = "status-message error";
    return;
  }
  await handleFilesSelected(fileInput.files);
}

// ===== Drag & drop =====
function setupDragAndDrop() {
  if (!dropZone || !fileInput) return;

  const highlight = () => dropZone.classList.add("dragover");
  const unhighlight = () => dropZone.classList.remove("dragover");

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlight();
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      unhighlight();
    });
  });

  dropZone.addEventListener("drop", async (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    await handleFilesSelected(files);
  });

  // When user clicks zone, open file dialog (input covers it; already clickable)
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

// ===== Sidebar toggle =====
function toggleSidebar() {
  if (!sidebar) return;
  sidebar.classList.toggle("open");
}

// ===== Chips =====
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
  // Upload form
  if (form) form.addEventListener("submit", handleUpload);

  // Filters
  if (searchInput) searchInput.addEventListener("input", renderFileList);
  if (sortSelect) sortSelect.addEventListener("change", renderFileList);
  if (folderFilter) folderFilter.addEventListener("change", renderFileList);
  if (typeFilter) typeFilter.addEventListener("change", renderFileList);

  // View mode
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
    // initial state
    applyView();
  }

  // Chips
  chips.forEach((chip) => {
    chip.classList.toggle("chip-active", chip.dataset.chip === activeChip);
    chip.addEventListener("click", () => {
      setActiveChip(chip.dataset.chip);
    });
  });

  // Upload queue clear
  if (clearQueueBtn && uploadQueue) {
    clearQueueBtn.addEventListener("click", () => {
      uploadQueueList.innerHTML = "";
      uploadQueue.classList.add("hidden");
    });
  }

  // Drag & drop
  setupDragAndDrop();

  // Modal
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

  // Sidebar toggle
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", toggleSidebar);
  }

  // Favorites nav
  if (navFavorites) {
    navFavorites.addEventListener("click", () => {
      setActiveChip("favorites");
      showToast("Showing favorite files ⭐");
    });
  }

  // Initial load
  loadFileList();
});
