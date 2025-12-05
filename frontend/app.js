// Change this later to your deployed backend URL
const BACKEND_URL = "http://localhost:4000";

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
  formData.append("document", fileInput.files[0]);

  statusDiv.textContent = "Uploading...";

  try {
    const res = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error("Upload failed");
    }

    const data = await res.json();
    statusDiv.textContent = data.message || "File uploaded successfully!";
    statusDiv.classList.add("success");
    form.reset();
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "Error uploading file.";
    statusDiv.classList.add("error");
  }
});
