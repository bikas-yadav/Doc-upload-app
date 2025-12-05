// Use your deployed backend URL on Render
const BACKEND_URL = "https://doc-upload-app.onrender.com";

const form = document.getElementById("uploadForm");
const statusDiv = document.getElementById("status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  statusDiv.textContent = "";
  statusDiv.className = "";

  const fileInput = document.getElementById("fileInput");
  if (!fileInput.files.length) {
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

    // Read response as text first (in case it's not valid JSON)
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

    // Success
    statusDiv.textContent = data.message || "File uploaded successfully!";
    statusDiv.classList.add("success");
    form.reset();
  } catch (err) {
    console.error("Upload error:", err);
    statusDiv.textContent = "Error uploading file. Check console for details.";
    statusDiv.classList.add("error");
  }
});
