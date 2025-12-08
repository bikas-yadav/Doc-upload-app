// ===== Config =====
const BACKEND_URL = "https://doc-upload-app.onrender.com"; // change if needed

// ===== DOM =====
const fileListDiv = document.getElementById("fileList");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const folderFilter = document.getElementById("folderFilter");
const sortFilter = document.getElementById("sortFilter");

const previewModal = document.getElementById("previewModal");
const previewBody = document.getElementById("previewBody");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const toast = document.getElementById("toast");

// New UI elements
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");

const newFolderBtn = document.getElementById("newFolderBtn");
const folderModal = document.getElementById("folderModal");
const folderNameInput = document.getElementById("folderNameInput");
const closeFolderModalBtn = document.getElementById("closeFolderModalBtn");
const createFolderConfirmBtn = document.getElementById("createFolderConfirmBtn");

// ===== State =====
let allFiles = [];

// ===== Helpers =====
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function detectType(name) {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "image";
  if (lower.match(/\.(docx?|pptx?|xlsx?)$/)) return "doc";
  return "other";
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

function getIconEmoji(type) {
  switch (type) {
    case "pdf":
      return "📄";
    case "image":
      return "🖼️";
    case "doc":
      return "📝";
    default:
      return "📁";
  }
}

// ===== Folder filter options =====
function updateFolderFilterOptions() {
  if (!folderFilter) return;
  const folders = [...new Set(allFiles.map((f) => f.folder || "root"))].sort();
  folderFilter.innerHTML =
    '<option value="all">All Folders</option>' +
    folders.map((f) => `<option value="${f}">${f}</option>`).join("");
}

// ===== Fetch files from backend (public, GET /files) =====
async function loadFiles() {
  if (!fileListDiv) return;

  fileListDiv.innerHTML = `<p class="loading">Loading files...</p>`;

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
    updateFolderFilterOptions();
    renderFileList();
  } catch (err) {
    console.error("Error loading files:", err);
    fileListDiv.innerHTML = `
      <div class="public-message error">
        ⚠️ Failed to load files. Please try again later.
      </div>
    `;
  }
}

// ===== Filtering & sorting =====
function getFilteredFiles() {
  const query = (searchInput?.value || "").toLowerCase().trim();
  const typeVal = typeFilter?.value || "all";
  const folderVal = folderFilter?.value || "all";
  const sortVal = sortFilter?.value || "newest";

  let files = [...allFiles];

  if (typeVal !== "all") {
    files = files.filter((f) => f.type === typeVal);
  }

  if (folderVal !== "all") {
    files = files.filter((f) => (f.folder || "root") === folderVal);
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

    switch (sortVal) {
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

// ===== Render list =====
function renderFileList() {
  if (!fileListDiv) return;

  if (!allFiles.length) {
    fileListDiv.innerHTML = `
      <div class="public-message empty">
        📂 No files have been uploaded yet.
      </div>
    `;
    return;
  }

  const files = getFilteredFiles();

  if (!files.length) {
    fileListDiv.innerHTML = `
      <div class="public-message empty">
        🔍 No files match your search/filters.
      </div>
    `;
    return;
  }

  fileListDiv.innerHTML = files
    .map((file) => {
      const type = file.type || "other";
      const icon = getIconEmoji(type);
      const sizeText = formatSize(file.size);
      const dateText = formatDate(file.lastModified);
      const folderText = file.folder || "root";

      return `
        <div class="public-file-card" data-key="${file.key}" data-url="${file.url}" data-type="${type}">
          <div class="public-file-main">
            <div class="public-file-icon">${icon}</div>
            <div>
              <div class="public-file-name" title="${file.name || ""}">
                ${file.name || "Untitled file"}
              </div>
              <div class="public-file-meta">
                <span class="tag">${folderText}</span>
                ${sizeText ? `<span>• ${sizeText}</span>` : ""}
                ${dateText ? `<span>• ${dateText}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="public-file-actions">
            <button class="btn-small preview-btn" type="button">Preview</button>
            <button class="btn-small secondary download-btn" type="button">Download</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach events
  fileListDiv.querySelectorAll(".public-file-card").forEach((card) => {
    const key = card.getAttribute("data-key");
    const url = card.getAttribute("data-url");
    const type = card.getAttribute("data-type");
    const previewBtn = card.querySelector(".preview-btn");
    const downloadBtn = card.querySelector(".download-btn");

    if (previewBtn) {
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openPreview(url, type);
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDownload(key);
      });
    }

    // Clicking the whole card also opens preview
    card.addEventListener("click", () => {
      openPreview(url, type);
    });
  });
}

// ===== Download (public, GET /files/download) =====
async function handleDownload(key) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/files/download?key=${encodeURIComponent(key)}`
    );
    const data = await res.json();
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      showToast("Download link not available");
    }
  } catch (err) {
    console.error("Download error:", err);
    showToast("Download failed");
  }
}

// ===== Upload files =====
// NOTE: adjust endpoint/path if your backend uses something different.
async function uploadFiles(files) {
  if (!files || !files.length) return;

  const formData = new FormData();
  Array.from(files).forEach((file) => {
    formData.append("files", file);
  });

  try {
    showToast("Uploading...");
    const res = await fetch(`${BACKEND_URL}/files`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || "Upload failed");
    }

    showToast("Upload complete");
    await loadFiles();
  } catch (err) {
    console.error("Upload error:", err);
    showToast("Upload failed");
  }
}

// ===== New Folder =====
// NOTE: adjust endpoint/body as per your API.
async function createFolder(folderName) {
  const trimmed = (folderName || "").trim();
  if (!trimmed) {
    showToast("Folder name cannot be empty");
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/folders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: trimmed }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || "Failed to create folder");
    }

    showToast("Folder created");
    closeFolderModal();
    await loadFiles();
  } catch (err) {
    console.error("Folder create error:", err);
    showToast("Failed to create folder");
  }
}

// ===== Preview modal =====
function openPreview(url, type) {
  if (!previewModal || !previewBody) {
    if (url) window.open(url, "_blank");
    return;
  }

  previewBody.innerHTML = "";

  if (!url) {
    previewBody.innerHTML = `<p>No preview available.</p>`;
  } else if (type === "pdf") {
    previewBody.innerHTML = `
      <iframe src="${url}" title="PDF preview"></iframe>
    `;
  } else if (type === "image") {
    previewBody.innerHTML = `
      <img src="${url}" alt="Image preview" />
    `;
  } else {
    previewBody.innerHTML = `
      <p>This file type cannot be previewed here.</p>
      <p><a href="${url}" target="_blank" rel="noopener noreferrer">Open in new tab</a></p>
    `;
  }

  previewModal.classList.remove("hidden");
}

function closePreview() {
  if (!previewModal || !previewBody) return;
  previewModal.classList.add("hidden");
  previewBody.innerHTML = "";
}

// ===== Folder modal helpers =====
function openFolderModal() {
  if (!folderModal || !folderNameInput) return;
  folderNameInput.value = "";
  folderModal.classList.remove("hidden");
  folderNameInput.focus();
}

function closeFolderModal() {
  if (!folderModal) return;
  folderModal.classList.add("hidden");
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  if (searchInput) searchInput.addEventListener("input", renderFileList);
  if (typeFilter) typeFilter.addEventListener("change", renderFileList);
  if (folderFilter) folderFilter.addEventListener("change", renderFileList);
  if (sortFilter) sortFilter.addEventListener("change", renderFileList);

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

  // Upload button -> trigger hidden file input
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => fileInput.click());
  }
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      uploadFiles(e.target.files);
      e.target.value = ""; // reset input
    });
  }

  // New folder button & modal
  if (newFolderBtn) {
    newFolderBtn.addEventListener("click", openFolderModal);
  }
  if (closeFolderModalBtn) {
    closeFolderModalBtn.addEventListener("click", closeFolderModal);
  }
  if (folderModal) {
    folderModal.addEventListener("click", (e) => {
      if (
        e.target === folderModal ||
        e.target.classList.contains("modal-backdrop")
      ) {
        closeFolderModal();
      }
    });
  }
  if (createFolderConfirmBtn) {
    createFolderConfirmBtn.addEventListener("click", () => {
      createFolder(folderNameInput.value);
    });
  }
  if (folderNameInput) {
    folderNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createFolder(folderNameInput.value);
      }
    });
  }

  loadFiles();
});
