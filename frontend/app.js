// Use your deployed backend URL on Render
const BACKEND_URL = "https://doc-upload-app.onrender.com";

const form = document.getElementById("uploadForm");
const statusDiv = document.getElementById("status");
const fileListDiv = document.getElementById("fileList");

// -------- Load file list (Drive-style) --------
async function loadFileList() {
  if (!fileListDiv) return;

  fileListDiv.innerHTML = "Loading files...";

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

    const files = data.files || [];

    if (!files.length) {
      fileListDiv.textContent = "No files uploaded yet.";
      return;
    }

    // Build a simple list
    fileListDiv.innerHTML = files
      .map(
        (file) => `
        <div class="file-item">
          <a href="${file.url}" target="_blank" rel="noopener noreferrer">
            ${file.name}
          </a>
          <span class="file-meta">
            ${ (file.size != null ? (file.size / 1024).toFixed(1) + " KB · " : "") }
            ${ file.lastModified ? new Date(file.lastModified).toLocaleString() : "" }
          </span>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("Error loading file list:", err);
    fileListDiv.textContent = "Failed to load files.";
  }
}

// -------- Handle file upload --------
async function handleUpload(e) {
  e.preventDefault();

  statusDiv.textContent = "";
  statusDiv.className = "";

  const fileInput = document.getElementById("fileInput");
  if (!fileInput || !fileInput.files.length) {
    statusDiv.textContent = "Please choose a file first.";
    statusDiv.classList.add("error");
    return;
  }

  const formData = new FormData();
  // "document" must match upload.single("document") in server.js
  formData.append("document", fileInput.files[0]);

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
      return;
    }

    // If backend sends file.url, show a link
    if (data.file && data.file.url) {
      statusDiv.innerHTML = `
        <p>${data.message || "File uploaded successfully!"}</p>
        <p><strong>File:</strong> ${data.file.originalName || data.file.key || ""}</p>
        <p><a href="${data.file.url}" target="_blank" rel="noopener noreferrer">Open uploaded file</a></p>
      `;
    } else {
      statusDiv.textContent = data.message || "File uploaded successfully!";
    }

    statusDiv.classList.add("success");
    form.reset();

    // Reload the file list after successful upload
    await loadFileList();
  } catch (err) {
    console.error("Upload error:", err);
    statusDiv.textContent = "Error uploading file. Check console for details.";
    statusDiv.classList.add("error");
  }
}

// -------- Init --------
document.addEventListener("DOMContentLoaded", () => {
  if (form) {
    form.addEventListener("submit", handleUpload);
  }
  loadFileList();
});
