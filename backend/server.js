// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// ======= HARD-CODE YOUR BUCKET + REGION HERE FOR NOW =======
const BUCKET_NAME = "my-doc-upload-app-bucket";   // e.g. "study-drive-notes"
const BUCKET_REGION = "ap-south-2";      // e.g. "ap-south-1"

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,      // from env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: BUCKET_REGION,
});

const S3 = new aws.S3();
const S3_BUCKET = BUCKET_NAME;
// ==========================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"],
  })
);

app.use(express.json());

// memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// --------- ROUTES ---------

// Health check
app.get("/", (req, res) => {
  res.send("Study Drive backend (S3) is running ✅");
});

// Upload endpoint: expects form field name "document"
app.post("/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const file = req.file;
    const originalName = file.originalname || "file";
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext).replace(/\s+/g, "_");
    const timestamp = Date.now();

    // 🔹 Folder from form (optional)
    const rawFolder = (req.body && req.body.folder ? req.body.folder : "").trim();
    let folderSafe = rawFolder || "root";
    // make folder name safe: only letters, numbers, underscore, dash
    folderSafe = folderSafe.replace(/[^\w\-]/g, "_").toLowerCase();

    // Store under uploads/<folder>/
    const key = `uploads/${folderSafe}/${baseName}-${timestamp}${ext}`;

    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "private", // we use signed URLs
    };

    const result = await S3.upload(params).promise();

    const signedUrl = S3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: 60 * 60, // 1 hour
    });

    res.json({
      message: "File uploaded successfully to S3!",
      file: {
        originalName,
        key,
        size: file.size,
        folder: folderSafe,
        location: result.Location,
        url: signedUrl,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File too large" });
    }
    res.status(500).json({ message: "Failed to upload file", error: err.message });
  }
});

// List files endpoint: returns array of { name, key, size, lastModified, url, folder }
app.get("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const params = {
      Bucket: S3_BUCKET,
      Prefix: "uploads/",
      MaxKeys: 1000,
    };

    const data = await S3.listObjectsV2(params).promise();

    const files = (data.Contents || [])
      .filter((obj) => obj.Key !== "uploads/") // skip the folder itself
      .map((obj) => {
        const key = obj.Key; // e.g. "uploads/os/os-notes-1234.pdf"

        // Remove "uploads/" prefix
        let relative = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;

        const parts = relative.split("/");
        let folder = "root";
        let name = relative;

        if (parts.length > 1) {
          folder = parts[0];             // e.g. "os"
          name = parts.slice(1).join("/"); // e.g. "os-notes-1234.pdf"
        }

        const signedUrl = S3.getSignedUrl("getObject", {
          Bucket: S3_BUCKET,
          Key: key,
          Expires: 60 * 60,
        });

        return {
          name,
          key,
          size: obj.Size,
          lastModified: obj.LastModified,
          url: signedUrl,
          folder,
        };
      });

    res.json({ files });
  } catch (err) {
    console.error("Error listing files:", err);
    res.status(500).json({ message: "Failed to list files", error: err.message });
  }
});

// OPTIONAL: Delete file endpoint (not used yet by frontend, but ready)
app.delete("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const { key } = req.body || {};
    if (!key) {
      return res.status(400).json({ message: "Missing 'key' in request body" });
    }

    await S3.deleteObject({ Bucket: S3_BUCKET, Key: key }).promise();
    res.json({ message: "File deleted", key });
  } catch (err) {
    console.error("Error deleting file:", err);
    res.status(500).json({ message: "Failed to delete file", error: err.message });
  }
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ message: "Server error", error: err.message || err });
});

app.listen(PORT, () => {
  console.log(`✅ Study Drive backend running on port ${PORT}`);
});
