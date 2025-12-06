// ===== Config =====
const BACKEND_URL = "https://doc-upload-app.onrender.com"; // same backend

// ===== DOM =====
const form = document.getElementById("uploadForm");
const statusDiv = document.getElementById("status");
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

// NEW: details modal elements
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

// ===== API: load/delete/download/rename/move =====
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

async function handleDownload(key) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/files/download?key=${encodeURIComponent(key)}`
    );
    const data = await res.json();
    if (!res.ok || !data.url) {
      showToast(data.message || "Failed to generate download link");
      return;
    }
    // Trigger download via hidden link
    const a = document.createElement("a");
    a.href = data.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  } catch (err) {
    console.error("Download error:", err);
    showToast("Download failed");
  }
}

async function renameFile(key, newName) {
  const res = await fetch(`${BACKEND_URL}/files/rename`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, newName }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Rename failed");
  }
  return data.file;
}

async function moveFile(key, newFolder) {
  const res = await fetch(`${BACKEND_URL}/files/move`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, newFolder }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Move failed");
  }
  return data.file;
}

// ===== Filtering / View =====
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

  // Extra typeFilter if present and chip is "all"
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
            <button type="button" class="download-btn">Download</button>
            <button type="button" class="details-btn">Details</button>
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
    const downloadBtn = item.querySelector(".download-btn");
    const detailsBtn = item.querySelector(".details-btn");

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

// ===== Upload / Queue =====
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

// ===== Details modal (rename/move) =====
function openDetails(file) {
  currentDetailsFile = file;
  if (!detailsModal || !detailsBody) return;

  const sizeText = formatSize(file.size);
  const dateText = formatDate(file.lastModified);
  const typeText = file.type || detectType(file.name);

  detailsBody.innerHTML = `
    <h3 style="margin:0 0 8px;font-size:15px;">File details</h3>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 10px;">View and manage this file.</p>

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
        <label style="font-size:12px;display:block;margin-bottom:2px;">Rename</label>
        <div style="display:flex;gap:6px;">
          <input id="renameInput" type="text" style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #4b5563;background:#020617;color:#e5e7eb;font-size:13px;" value="${file.name.replace(/\.[^/.]+$/, "")}" />
          <button id="renameBtn" type="button" style="padding:6px 10px;border-radius:999px;border:none;background:#4f46e5;color:#e5e7eb;font-size:12px;cursor:pointer;">Save</button>
        </div>
      </div>

      <div>
        <label style="font-size:12px;display:block;margin-bottom:2px;">Move to folder</label>
        <div style="display:flex;gap:6px;">
          <input id="moveInput" type="text" style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #4b5563;background:#020617;color:#e5e7eb;font-size:13px;" placeholder="e.g. semester-5, os" />
          <button id="moveBtn" type="button" style="padding:6px 10px;border-radius:999px;border:none;background:#10b981;color:#022c22;font-size:12px;cursor:pointer;">Move</button>
        </div>
      </div>

      <div>
        <label style="font-size:12px;display:block;margin-bottom:2px;">Share / open link</label>
        <div style="display:flex;gap:6px;">
          <input id="linkInput" type="text" readonly style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #4b5563;background:#020617;color:#9ca3af;font-size:12px;overflow:hidden;text-overflow:ellipsis;" value="${file.url}" />
          <button id="copyLinkBtn" type="button" style="padding:6px 10px;border-radius:999px;border:none;background:#111827;color:#e5e7eb;font-size:12px;cursor:pointer;">Copy</button>
        </div>
      </div>
    </div>
  `;

  // Wire up buttons
  const renameInput = document.getElementById("renameInput");
  const renameBtn = document.getElementById("renameBtn");
  const moveInput = document.getElementById("moveInput");
  const moveBtn = document.getElementById("moveBtn");
  const copyLinkBtn = document.getElementById("copyLinkBtn");
  const linkInput = document.getElementById("linkInput");

  if (renameBtn && renameInput) {
    renameBtn.addEventListener("click", async () => {
      const base = renameInput.value.trim();
      if (!base) {
        showToast("Name cannot be empty");
        return;
      }
      const extMatch = file.name.match(/\.[^/.]+$/);
      const ext = extMatch ? extMatch[0] : "";
      const newName = base + ext;
      try {
        const updated = await renameFile(file.key, newName);
        showToast("File renamed ✅");
        await loadFileList();
        // update currentDetailsFile to reflect new key/name
        currentDetailsFile = allFiles.find((f) => f.key === updated.key) || null;
        closeDetails();
      } catch (err) {
        console.error("Rename error:", err);
        showToast("Rename failed");
      }
    });
  }

  if (moveBtn && moveInput) {
    moveBtn.addEventListener("click", async () => {
      const newFolder = moveInput.value.trim();
      if (!newFolder) {
        showToast("Folder cannot be empty");
        return;
      }
      try {
        const updated = await moveFile(file.key, newFolder);
        showToast("File moved ✅");
        await loadFileList();
        currentDetailsFile = allFiles.find((f) => f.key === updated.key) || null;
        closeDetails();
      } catch (err) {
        console.error("Move error:", err);
        showToast("Move failed");
      }
    });
  }

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
  if (form) form.addEventListener("submit", handleUpload);

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
    applyView();
  }

  // Chips
  chips.forEach((chip) => {
    chip.classList.toggle("chip-active", chip.dataset.chip === activeChip);
    chip.addEventListener("click", () => {
      setActiveChip(chip.dataset.chip);
    });
  });

  // Queue clear
  if (clearQueueBtn && uploadQueue) {
    clearQueueBtn.addEventListener("click", () => {
      uploadQueueList.innerHTML = "";
      uploadQueue.classList.add("hidden");
    });
  }

  // Drag & drop
  setupDragAndDrop();

  // Preview modal
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

  // Details modal
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

  // Sidebar
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", toggleSidebar);
  }

  // Favorites nav shortcut
  if (navFavorites) {
    navFavorites.addEventListener("click", () => {
      setActiveChip("favorites");
      showToast("Showing favorite files ⭐");
    });
  }

  loadFileList();
});
