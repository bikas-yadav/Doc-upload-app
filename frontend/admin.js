// admin.js - updated (use with the updated admin.html & admin.css)
// Set your backend URL here:
const BACKEND_URL = "https://doc-upload-app.onrender.com";

// ---------- DOM ----------
const loginPage = document.getElementById("loginPage");
const loginForm = document.getElementById("loginForm");
const loginToken = document.getElementById("loginToken");
const loginMsg = document.getElementById("loginMsg");

const appRoot = document.getElementById("app");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");

const uploadForm = document.getElementById("uploadForm");
const uploadFile = document.getElementById("uploadFile");
const uploadFolder = document.getElementById("uploadFolder");
const clearUploadBtn = document.getElementById("clearUpload");

const deleteSelectedBtn = document.getElementById("deleteSelected");
const downloadSelectedBtn = document.getElementById("downloadSelected");

const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");

const filesTableBody = document.querySelector("#filesTable tbody");
const fileCountSpan = document.getElementById("fileCount");
const currentFolderLabel = document.getElementById("currentFolder");
const selectAllCheckbox = document.getElementById("selectAll");

const folderFilter = document.getElementById("folderFilter");
const searchInput = document.getElementById("searchInput");

// toast
const toastEl = document.getElementById("toast");

// ---------- State ----------
let files = [];
let nextContinuationToken = null;
let prevTokens = []; // stack of previous continuation tokens
let currentContinuationToken = undefined; // current continuation token context
let currentPrefix = "uploads/"; // not heavily used, but can be updated via folderFilter
let currentFolder = "root";

// ---------- Helpers ----------
function showToast(message, ms = 2500) {
  if (!toastEl) {
    alert(message);
    return;
  }
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
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
  if (lower.match(/\.(docx?|pptx?|xlsx?|ppt)$/)) return "doc";
  return "other";
}

function makeDownloadUrlForKey(key) {
  return `${BACKEND_URL}/files/download?key=${encodeURIComponent(key)}`;
}

// ---------- Simple admin viewer (modal) ----------
// Provides window.adminViewer.open(html) and .close() to preview files in a modal.
// This ensures preview close works reliably without depending on page HTML.
(function createAdminViewer() {
  if (window.adminViewer) return;
  const modal = document.createElement("div");
  modal.id = "adminViewerModal";
  modal.style.cssText = `
    position:fixed;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.6);z-index:99999;padding:20px;
  `;
  const panel = document.createElement("div");
  panel.style.cssText = `
    background:#0b1220;color:#e5e7eb;border-radius:8px;max-width:96%;max-height:90%;
    width:1000px;overflow:auto;position:relative;padding:12px;
  `;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = `
    position:absolute;right:10px;top:10px;padding:6px 10px;border-radius:6px;background:#111827;color:#fff;border:none;cursor:pointer;z-index:100000;
  `;
  const content = document.createElement("div");
  content.style.cssText = `padding-top:28px;min-height:320px;`;
  panel.appendChild(closeBtn);
  panel.appendChild(content);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  function open(html) {
    content.innerHTML = html || "<div style='padding:20px'>No preview</div>";
    modal.style.display = "flex";
    // ensure close button has focus for quick keyboard close
    closeBtn.focus();
  }
  function close() {
    modal.style.display = "none";
    content.innerHTML = "";
  }

  // close when clicking backdrop (not panel)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  closeBtn.addEventListener("click", close);

  window.adminViewer = { open, close };
})();

// ---------- Auth ----------
async function checkSession() {
  try {
    const res = await fetch(`${BACKEND_URL}/admin/session`, {
      method: "GET",
      credentials: "include",
    });
    if (res.ok) {
      showApp();
      await loadFiles(); // initial load
    } else {
      showLogin();
    }
  } catch (err) {
    console.error("Session check failed", err);
    showLogin();
  }
}

function showLogin() {
  if (loginPage) loginPage.classList.remove("hidden");
  if (appRoot) appRoot.classList.add("hidden");
  if (loginMsg) loginMsg.textContent = "";
}

function showApp() {
  if (loginPage) loginPage.classList.add("hidden");
  if (appRoot) appRoot.classList.remove("hidden");
}

// login form submit
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = (loginToken && loginToken.value) || "";
    if (!token.trim()) {
      if (loginMsg) loginMsg.textContent = "Please enter token";
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        if (loginMsg) loginMsg.textContent = "";
        if (loginToken) loginToken.value = "";
        showApp();
        await loadFiles();
        showToast("Logged in ✅");
      } else {
        if (loginMsg) loginMsg.textContent = data.message || "Invalid token";
      }
    } catch (err) {
      console.error("Login error", err);
      if (loginMsg) loginMsg.textContent = "Login failed (network)";
    }
  });
}

// logout
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch(`${BACKEND_URL}/admin/logout`, {
        method: "GET",
        credentials: "include",
      });
    } catch (e) {
      // ignore
    }
    showLogin();
    showToast("Logged out");
  });
}

// ---------- Files: load / render / pagination ----------
async function loadFiles(opts = {}) {
  // opts: { continuationToken, folder, limit }
  const limit = opts.limit || 50;
  const continuationToken = typeof opts.continuationToken !== "undefined" ? opts.continuationToken : undefined;
  const folder = opts.folder || (folderFilter && folderFilter.value) || undefined;

  // update currentContinuationToken context (used for paging stack)
  // if undefined (first load) keep it as undefined
  // otherwise set to passed continuationToken
  currentContinuationToken = continuationToken;

  // show loading state
  if (filesTableBody) filesTableBody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
  try {
    let url = `${BACKEND_URL}/files?limit=${limit}`;
    if (typeof folder === "string" && folder !== "all" && folder !== "") {
      url += `&folder=${encodeURIComponent(folder)}`;
      currentFolder = folder;
    } else {
      currentFolder = "root";
    }
    if (continuationToken) url += `&continuationToken=${encodeURIComponent(continuationToken)}`;

    const res = await fetch(url, { credentials: "include" });
    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.message || "Failed to list files");

    files = (data.files || []).map((f) => ({
      ...f,
      type: detectType(f.name),
    }));
    nextContinuationToken = data.nextContinuationToken || null;

    // update prev tokens/buttons
    prevPageBtn.disabled = prevTokens.length === 0;
    nextPageBtn.disabled = !nextContinuationToken;

    renderFilesTable();
  } catch (err) {
    console.error("Load files error", err);
    if (filesTableBody) filesTableBody.innerHTML = `<tr><td colspan="7">Failed to load files</td></tr>`;
    showToast("Failed to load files");
  }
}

function renderFilesTable() {
  // update counts/folder
  if (fileCountSpan) fileCountSpan.textContent = `${files.length}`;
  if (currentFolderLabel) currentFolderLabel.textContent = currentFolder;

  if (!files.length) {
    if (filesTableBody) filesTableBody.innerHTML = `<tr><td colspan="7">No files found</td></tr>`;
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    return;
  }

  if (!filesTableBody) return;

  filesTableBody.innerHTML = files
    .map((file) => {
      const previewHtml =
        file.type === "image"
          ? `<img src="${makeDownloadUrlForKey(file.key)}" alt="thumb" style="max-width:80px;max-height:60px;object-fit:cover" />`
          : file.type === "pdf"
          ? "PDF"
          : "";
      return `
        <tr data-key="${file.key}">
          <td><input class="row-select" type="checkbox" data-key="${file.key}"></td>
          <td class="previewCell">${previewHtml}</td>
          <td class="nameCell">${escapeHtml(file.name)}</td>
          <td>${escapeHtml(file.folder || "root")}</td>
          <td>${formatSize(file.size)}</td>
          <td>${formatDate(file.lastModified)}</td>
          <td class="actionsCell">
            <button class="previewBtn" data-key="${file.key}">Preview</button>
            <button class="downloadBtn" data-key="${file.key}">Download</button>
            <button class="deleteBtn" data-key="${file.key}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  // attach listeners
  filesTableBody.querySelectorAll(".previewBtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const key = btn.dataset.key;
      openPreview(key);
    });
  });
  filesTableBody.querySelectorAll(".downloadBtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const key = btn.dataset.key;
      window.open(makeDownloadUrlForKey(key), "_blank");
    });
  });
  filesTableBody.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const key = btn.dataset.key;
      if (!confirm("Delete this file?")) return;
      await deleteFile(key);
      // after deletion, reload current page (preserve token)
      await loadFiles({ continuationToken: currentContinuationToken });
    });
  });

  // row checkbox behavior
  const rowChecks = filesTableBody.querySelectorAll(".row-select");
  rowChecks.forEach((ch) => {
    ch.addEventListener("change", () => {
      const all = filesTableBody.querySelectorAll(".row-select");
      const checked = filesTableBody.querySelectorAll(".row-select:checked");
      if (selectAllCheckbox) selectAllCheckbox.checked = all.length === checked.length && all.length > 0;
    });
  });

  // ensure selectAll reflects current state
  if (selectAllCheckbox) {
    const all = filesTableBody.querySelectorAll(".row-select");
    const checked = filesTableBody.querySelectorAll(".row-select:checked");
    selectAllCheckbox.checked = all.length > 0 && all.length === checked.length;
  }
}

// escape HTML for safety
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- Preview ----------
function openPreview(key) {
  const url = makeDownloadUrlForKey(key);
  const type = (files.find((f) => f.key === key) || {}).type || "other";
  let html = "";
  if (type === "pdf") {
    html = `<iframe src="${url}" title="PDF preview" style="width:100%;height:70vh;border:0"></iframe>`;
  } else if (type === "image") {
    html = `<img src="${url}" alt="image preview" style="max-width:100%;max-height:70vh;display:block;margin:0 auto" />`;
  } else {
    html = `<div style="padding:20px;color:#9ca3af">Cannot preview this file type. <a href="${url}" target="_blank" rel="noopener noreferrer">Open file</a></div>`;
  }

  if (window && window.adminViewer && typeof window.adminViewer.open === "function") {
    window.adminViewer.open(html);
  } else {
    window.open(url, "_blank");
  }
}

// ---------- Delete ----------
async function deleteFile(key) {
  try {
    const res = await fetch(`${BACKEND_URL}/files`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Delete failed");
    showToast("Deleted");
  } catch (err) {
    console.error("Delete error", err);
    showToast("Delete failed");
  }
}

// ---------- Upload ----------
if (uploadForm) {
  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = uploadFile.files && uploadFile.files[0];
    if (!file) {
      showToast("Choose a file first");
      return;
    }
    const folder = (uploadFolder && uploadFolder.value) || "";
    await uploadSingleFile(file, folder);
    uploadFile.value = "";
    uploadFolder.value = "";
    await loadFiles({ continuationToken: currentContinuationToken });
  });
}

if (clearUploadBtn) {
  clearUploadBtn.addEventListener("click", () => {
    if (uploadFile) uploadFile.value = "";
    if (uploadFolder) uploadFolder.value = "";
  });
}

async function uploadSingleFile(file, folder) {
  const fd = new FormData();
  fd.append("document", file);
  if (folder) fd.append("folder", folder);
  try {
    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const text = await res.text();
    const data = JSON.parse(text || "{}");
    if (!res.ok) throw new Error(data.message || "Upload failed");
    showToast("Uploaded");
  } catch (err) {
    console.error("Upload error", err);
    showToast("Upload failed");
  }
}

// ---------- Select all / selections ----------
if (selectAllCheckbox) {
  selectAllCheckbox.addEventListener("change", () => {
    const checked = selectAllCheckbox.checked;
    filesTableBody.querySelectorAll(".row-select").forEach((ch) => {
      ch.checked = checked;
    });
  });
}

function getSelectedKeys() {
  return Array.from(filesTableBody.querySelectorAll(".row-select:checked")).map((el) => el.dataset.key);
}

// ---------- Delete / Download selected ----------
if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener("click", async () => {
    const keys = getSelectedKeys();
    if (!keys.length) {
      showToast("No files selected");
      return;
    }
    if (!confirm(`Delete ${keys.length} file(s)?`)) return;
    for (const k of keys) {
      // sequential deletes to keep it simple
      // eslint-disable-next-line no-await-in-loop
      await deleteFile(k);
    }
    await loadFiles({ continuationToken: currentContinuationToken });
  });
}

if (downloadSelectedBtn) {
  downloadSelectedBtn.addEventListener("click", () => {
    const keys = getSelectedKeys();
    if (!keys.length) {
      showToast("No files selected");
      return;
    }
    keys.forEach((k) => {
      const url = makeDownloadUrlForKey(k);
      window.open(url, "_blank");
    });
  });
}

// ---------- Pagination ----------
// Next: push currentContinuationToken to prevTokens, then load using nextContinuationToken
if (nextPageBtn) {
  nextPageBtn.addEventListener("click", async () => {
    if (!nextContinuationToken) return;
    // push current token (could be undefined for first page)
    prevTokens.push(currentContinuationToken);
    await loadFiles({ continuationToken: nextContinuationToken });
  });
}

// Prev: pop last token to restore previous context
if (prevPageBtn) {
  prevPageBtn.addEventListener("click", async () => {
    if (prevTokens.length === 0) return;
    // pop the last stored token (this is the token for the previous page)
    const prevToken = prevTokens.pop();
    await loadFiles({ continuationToken: prevToken });
  });
}

// folder filter / search refresh
if (folderFilter) {
  folderFilter.addEventListener("change", () => {
    prevTokens = [];
    nextContinuationToken = null;
    currentContinuationToken = undefined;
    loadFiles({ folder: folderFilter.value });
  });
}
if (searchInput) {
  searchInput.addEventListener("input", () => {
    const q = (searchInput.value || "").toLowerCase().trim();
    if (!q) {
      renderFilesTable();
      return;
    }
    const filtered = files.filter((f) => (f.name || "").toLowerCase().includes(q));
    const oldFiles = files;
    files = filtered;
    renderFilesTable();
    files = oldFiles;
  });
}

// refresh button
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    prevTokens = [];
    nextContinuationToken = null;
    currentContinuationToken = undefined;
    await loadFiles();
  });
}

// ---------- Utilities ----------
window.addEventListener("error", (e) => {
  // optionally show errors, currently silent
  // console.error("Global error", e);
});

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  checkSession();
});
