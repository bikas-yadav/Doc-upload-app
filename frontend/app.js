// Backend URL
const BACKEND_URL = "https://doc-upload-app.onrender.com";

// DOM elements
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
const previewModal = document.getElementById("previewModal");
const previewBody = document.getElementById("previewBody");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const toast = document.getElementById("toast");
const folderInput = document.getElementById("folderInput");
const folderFilter = document.getElementById("folderFilter");

// State
let allFiles = [];
let viewMode = "grid"; // "grid" or "list"

// Helpers
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
  return `${mb.toFixed(2)} MB`;
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
    case "pdf": return "PDF";
    case "image": return "IMG";
    case "doc": return "DOC";
    default: return "FILE";
  }
}

function updateStats() {
  const count = allFiles.length;
  const totalBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  if (fileCountSpan) fileCountSpan.textContent = `${count} file${count === 1 ? "" : "s"}`;
  if (totalSizeSpan) totalSizeSpan.textContent = formatSize(totalBytes) || "0 KB";
}

function updateFolderFilterOptions() {
  if (!folderFilter) return;
  const folders = [...new Set(allFiles.map(f => f.folder || "root"))].sort();
  folderFilter.innerHTML =
    '<option value="all">All folders</option>' +
    folders.map(f => `<option value="${f}">${f}</option>`).join("");
}

// Load file list
async function loadFileList() {
  if (!fileListDiv) return;

  fileListDiv.textContent = "Loading files...";

  try {
    const res = await fetch(`${BACKEND_URL}/files`);
    const text = await res.text();
    console.log("Raw /files response:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON from /files");
    }

    if (!res.ok) {
      throw new Error(data.message || "Failed to load files");
    }

    const files = (data.files || []).map(f => ({
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
    fileListDiv.textContent = "Failed to load files.";
  }
}

// Render file list based on filters & view mode
function renderFileList() {
  if (!fileListDiv) return;

  if (!allFiles.length) {
    fileListDiv.textContent = "No files uploaded yet.";
    return;
  }

  const query = (searchInput?.value || "").toLowerCase().trim();
  const type = typeFilter?.value || "all";
  const sort = sortSelect?.value || "newest";
  const folder = folderFilter?.value || "all";

  let files = [...allFiles];

  // Folder filter
  if (folder !== "all") {
    files = files.filter(f => (f.folder || "root") === folder);
  }

  // Filter by type
  if (type !== "all") {
    files = files.filter(f => f.type === type);
  }

  // Search
  if (query) {
    files = files.filter(f => (f.name || "").toLowerCase().includes(query));
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
      case "oldest": return da - db;
      case "az": return na.localeCompare(nb);
      case "za": return nb.localeCompare(na);
      case "sizeAsc": return sa - sb;
      case "sizeDesc": return sb - sa;
      case "newest":
      default: return db - da;
    }
  });

  fileListDiv.className = `file-list ${viewMode}`;

  if (!files.length) {
    fileListDiv.textContent = "No files match your filters.";
    return;
  }

  fileListDiv.innerHTML = files.map(file => {
    const typeClass = file.type || "other";
    const iconText = getIconText(typeClass);
    const sizeText = formatSize(file.size);
    const dateText = formatDate(file.lastModified);
    const folderText = file.folder || "root";

    return `
      <div class="file-item" data-url="${file.url}" data-type="${typeClass}" data-key="${file.key}">
        <div class="file-icon ${typeClass}">${iconText}</div>
        <div class="file-main">
          <p class="file-name" title="${file.name || ""}">${file.name || "Untitled file"}</p>
          <p class="file-meta">
            ${folderText ? "[" + folderText + "] · " : ""}
            ${sizeText || ""}${sizeText && dateText ? " · " : ""}${dateText || ""}
          </p>
        </div>
        <div class="file-actions">
          <button type="button" class="preview-btn">Preview</button>
          <a href="${file.url}" target="_blank" rel="noopener noreferrer">Open</a>
          <button type="button" class="delete-btn">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  // Attach event handlers
  fileListDiv.querySelectorAll(".file-item").forEach(item => {
    const url = item.getAttribute("data-url");
    const type = item.getAttribute("data-type");
    const key = item.getAttribute("data-key");
    const previewBtn = item.querySelector(".preview-btn");
    const deleteBtn = item.querySelector(".delete-btn");

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

    item.addEventListener("click", (e) => {
      if ((e.target).closest(".file-actions")) return;
      openPreview(url, type);
    });
  });
}

// Delete file
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
    console.log("Raw DELETE /files response:", text);

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

    showToast("File deleted ✅");
    await loadFileList();
  } catch (err) {
    console.error("Delete error:", err);
    showToast("Error deleting file");
  }
}

// Upload handler
async function handleUpload(e) {
  e.preventDefault();

  if (!statusDiv) return;

  statusDiv.textContent = "";
  statusDiv.className = "";

  const fileInput = document.getElementById("fileInput");
  if (!fileInput || !fileInput.files.length) {
    statusDiv.textContent = "Please choose a file first.";
    statusDiv.classList.add("error");
    return;
  }

  const formData = new FormData();
  formData.append("document", fileInput.files[0]);

  // 🔹 Folder field
  if (folderInput && folderInput.value.trim()) {
    formData.append("folder", folderInput.value.trim());
  }

  statusDiv.textContent = "Uploading...";
  try {
    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const rawText = await res.text();
    console.log("Raw /upload response:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { message: rawText };
    }

    if (!res.ok) {
      statusDiv.textContent = data.message || "Upload failed.";
      statusDiv.classList.add("error");
      showToast("Upload failed");
      return;
    }

    statusDiv.innerHTML = `
      <p>${data.message || "File uploaded successfully!"}</p>
      ${data.file && data.file.url ? `<p><a href="${data.file.url}" target="_blank" rel="noopener noreferrer">Open uploaded file</a></p>` : ""}
    `;
    statusDiv.classList.add("success");
    fileInput.value = "";
    if (folderInput) folderInput.value = "";
    showToast("File uploaded ✅");

    await loadFileList();
  } catch (err) {
    console.error("Upload error:", err);
    statusDiv.textContent = "Error uploading file. Check console for details.";
    statusDiv.classList.add("error");
    showToast("Upload error");
  }
}

// Preview modal
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

// Init
document.addEventListener("DOMContentLoaded", () => {
  if (form) form.addEventListener("submit", handleUpload);
  if (searchInput) searchInput.addEventListener("input", renderFileList);
  if (typeFilter) typeFilter.addEventListener("change", renderFileList);
  if (sortSelect) sortSelect.addEventListener("change", renderFileList);
  if (folderFilter) folderFilter.addEventListener("change", renderFileList);

  if (gridViewBtn && listViewBtn) {
    gridViewBtn.addEventListener("click", () => {
      viewMode = "grid";
      gridViewBtn.classList.add("active");
      listViewBtn.classList.remove("active");
      renderFileList();
    });

    listViewBtn.addEventListener("click", () => {
      viewMode = "list";
      listViewBtn.classList.add("active");
      gridViewBtn.classList.remove("active");
      renderFileList();
    });
  }

  if (closePreviewBtn) {
    closePreviewBtn.addEventListener("click", closePreview);
  }
  if (previewModal) {
    previewModal.addEventListener("click", (e) => {
      if (e.target === previewModal || e.target.classList.contains("modal-backdrop")) {
        closePreview();
      }
    });
  }

  loadFileList();
});
