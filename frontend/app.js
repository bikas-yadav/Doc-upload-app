// Backend URL on Render
const BACKEND_URL = "https://doc-upload-app.onrender.com";

const form = document.getElementById("uploadForm");
const statusDiv = document.getElementById("status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Reset status
  statusDiv.textContent = "";
  statusDiv.className = "";

  const fileInput = document.getElementById("fileInput");
  if (!fileInput.files.length) {
    statusDiv.textContent = "Please choose a file first.";
    statusDiv.classList.add("error");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  // "document" must match upload.single("document") in server.js
  formData.append("document", file);

  statusDiv.textContent = "Uploading...";
  statusDiv.className = "";

  try {
    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    // Read raw text so we can debug if JSON fails
    const rawText = await res.text();
    console.log("Raw response from backend:", rawText);

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

    // ✅ Success – show message + filename + S3 link (if present)
    if (data.fileUrl) {
      statusDiv.innerHTML = `
        <p>${data.message || "File uploaded successfully!"}</p>
        <p><strong>File name:</strong> ${file.name}</p>
        <p>
          <strong>Link:</strong>
          <a href="${data.fileUrl}" target="_blank" rel="noopener noreferrer">
            ${data.fileUrl}
          </a>
        </p>
      `;
    } else {
      statusDiv.textContent = data.message || "File uploaded successfully!";
    }

    statusDiv.classList.add("success");
    form.reset();
  } catch (err) {
    console.error("Upload error:", err);
    statusDiv.textContent = "Error uploading file. Check console for details.";
    statusDiv.classList.add("error");
  }
});
