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
let prevTokens = []; // stack of previous continuation tokens for Prev button
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
  loginPage.classList.remove("hidden");
  appRoot.classList.add("hidden");
  loginMsg.textContent = "";
}

function showApp() {
  loginPage.classList.add("hidden");
  appRoot.classList.remove("hidden");
}

// login form submit
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = (loginToken && loginToken.value || "").trim();
    if (!token) {
      loginMsg.textContent = "Please enter token";
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        loginMsg.textContent = "";
        loginToken.value = "";
        showApp();
        await loadFiles();
        showToast("Logged in ✅");
      } else {
        loginMsg.textContent = data.message || "Invalid token";
      }
    } catch (err) {
      console.error("Login error", err);
      loginMsg.textContent = "Login failed (network)";
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
  const continuationToken = opts.continuationToken || undefined;
  const folder = opts.folder || (folderFilter && folderFilter.value) || undefined;

  // show loading state
  filesTableBody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
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

    // update prev tokens stack & buttons
    prevPageBtn.disabled = prevTokens.length === 0;
    nextPageBtn.disabled = !nextContinuationToken;

    // render
    renderFilesTable();
  } catch (err) {
    console.error("Load files error", err);
    filesTableBody.innerHTML = `<tr><td colspan="7">Failed to load files</td></tr>`;
    showToast("Failed to load files");
  }
}

function renderFilesTable() {
  // update counts/folder
  fileCountSpan.textContent = `${files.length}`;
  if (currentFolderLabel) currentFolderLabel.textContent = currentFolder;

  if (!files.length) {
    filesTableBody.innerHTML = `<tr><td colspan="7">No files found</td></tr>`;
    return;
  }

  filesTableBody.innerHTML = files
    .map((file) => {
      const previewHtml = file.type === "image" ? `<img src="${makeDownloadUrlForKey(file.key)}" alt="thumb" />` : (file.type === "pdf" ? "PDF" : "");
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
      await loadFiles();
    });
  });

  // row checkbox behavior
  const rowChecks = filesTableBody.querySelectorAll(".row-select");
  rowChecks.forEach((ch) => {
    ch.addEventListener("change", () => {
      // update selectAll state
      const all = filesTableBody.querySelectorAll(".row-select");
      const checked = filesTableBody.querySelectorAll(".row-select:checked");
      selectAllCheckbox.checked = all.length === checked.length && all.length > 0;
    });
  });
}

// escape HTML for safety
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Preview ----------
function openPreview(key) {
  // Use backend download redirect URL inside an iframe. The backend will redirect to signed S3 URL.
  const url = makeDownloadUrlForKey(key);

  // For PDFs we embed an <iframe> directly; for images we also embed the file in an <img>.
  const type = (files.find((f) => f.key === key) || {}).type || "other";
  let html = "";
  if (type === "pdf") {
    html = `<iframe src="${url}" title="PDF preview" style="width:100%;height:100%;border:0"></iframe>`;
  } else if (type === "image") {
    html = `<img src="${url}" alt="image preview" style="max-width:100%;max-height:100%;display:block;margin:0 auto" />`;
  } else {
    html = `<div style="padding:20px;color:var(--muted)">Cannot preview this file type. <a href="${url}" target="_blank" rel="noopener noreferrer">Open file</a></div>`;
  }

  // Use the small viewer API exposed in the HTML
  if (window && window.adminViewer && typeof window.adminViewer.open === "function") {
    window.adminViewer.open(html);
  } else {
    // fallback: open in new tab
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
    const folder = (uploadFolder && uploadFolder.value || "").trim();
    await uploadSingleFile(file, folder);
    // clear inputs
    uploadFile.value = "";
    uploadFolder.value = "";
    // refresh list
    await loadFiles();
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
  return Array.from(filesTableBody.querySelectorAll(".row-select:checked")).map(
    (el) => el.dataset.key
  );
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
      // you can parallelize if you prefer
      // eslint-disable-next-line no-await-in-loop
      await deleteFile(k);
    }
    await loadFiles();
  });
}

if (downloadSelectedBtn) {
  downloadSelectedBtn.addEventListener("click", () => {
    const keys = getSelectedKeys();
    if (!keys.length) {
      showToast("No files selected");
      return;
    }
    // open each selected file in a new tab (backend redirects to signed S3 url)
    keys.forEach((k) => {
      const url = makeDownloadUrlForKey(k);
      window.open(url, "_blank");
    });
  });
}

// ---------- Pagination ----------
if (nextPageBtn) {
  nextPageBtn.addEventListener("click", async () => {
    if (!nextContinuationToken) return;
    // push current token to prev stack so Prev works
    prevTokens.push(nextContinuationToken === null ? null : nextContinuationToken);
    await loadFiles({ continuationToken: nextContinuationToken });
  });
}

if (prevPageBtn) {
  prevPageBtn.addEventListener("click", async () => {
    if (prevTokens.length === 0) return;
    // pop to get token for previous page context (we stored tokens on Next)
    // simple approach: reload without token to go to start if stack becomes empty
    prevTokens.pop(); // remove current
    const prevToken = prevTokens.length ? prevTokens[prevTokens.length - 1] : undefined;
    await loadFiles({ continuationToken: prevToken });
  });
}

// folder filter / search refresh
if (folderFilter) {
  folderFilter.addEventListener("change", () => {
    // reset pagination
    prevTokens = [];
    nextContinuationToken = null;
    loadFiles({ folder: folderFilter.value });
  });
}
if (searchInput) {
  searchInput.addEventListener("input", () => {
    // client-side search on the currently loaded page
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
    await loadFiles();
  });
}

// ---------- Utilities ----------
window.addEventListener("error", (e) => {
  // show less noisy message
  // console.error("Global error", e);
});

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  checkSession();
});
