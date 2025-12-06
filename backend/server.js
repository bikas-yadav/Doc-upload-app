// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// ======= BUCKET CONFIG =======
const BUCKET_NAME = "my-doc-upload-app-bucket";   // your bucket
const BUCKET_REGION = "ap-south-2";              // your region

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: BUCKET_REGION,
});

const S3 = new aws.S3();
const S3_BUCKET = BUCKET_NAME;
// ==============================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT"],
  })
);

app.use(express.json());

// memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ---------- HELPERS ----------
function safeFolderName(folderRaw) {
  const trimmed = (folderRaw || "").trim();
  if (!trimmed) return "root";
  return trimmed.replace(/[^\w\-]/g, "_").toLowerCase();
}

// Copy object helper (for rename/move)
async function copyObjectInBucket(oldKey, newKey) {
  await S3.copyObject({
    Bucket: S3_BUCKET,
    CopySource: `${S3_BUCKET}/${oldKey}`,
    Key: newKey,
    ACL: "private",
  }).promise();
}

async function deleteObjectInBucket(key) {
  await S3.deleteObject({
    Bucket: S3_BUCKET,
    Key: key,
  }).promise();
}

function makeSignedUrl(key, expiresSeconds = 60 * 60) {
  return S3.getSignedUrl("getObject", {
    Bucket: S3_BUCKET,
    Key: key,
    Expires: expiresSeconds,
  });
}
// ------------------------------

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
    const baseName = path
      .basename(originalName, ext)
      .replace(/\s+/g, "_")
      .toLowerCase();
    const timestamp = Date.now();

    const rawFolder = (req.body && req.body.folder) || "";
    const folderSafe = safeFolderName(rawFolder);

    // Store under uploads/<folder>/
    const key = `uploads/${folderSafe}/${baseName}-${timestamp}${ext}`;

    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "private",
    };

    const result = await S3.upload(params).promise();

    const signedUrl = makeSignedUrl(key);

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
    res
      .status(500)
      .json({ message: "Failed to upload file", error: err.message });
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
      .filter((obj) => obj.Key !== "uploads/")
      .map((obj) => {
        const key = obj.Key;

        // Remove "uploads/" prefix
        let relative = key.startsWith("uploads/")
          ? key.slice("uploads/".length)
          : key;

        const parts = relative.split("/");
        let folder = "root";
        let name = relative;

        if (parts.length > 1) {
          folder = parts[0];
          name = parts.slice(1).join("/");
        }

        const signedUrl = makeSignedUrl(key);

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
    res
      .status(500)
      .json({ message: "Failed to list files", error: err.message });
  }
});

// Delete file
app.delete("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const { key } = req.body || {};
    if (!key) {
      return res.status(400).json({ message: "Missing 'key' in request body" });
    }

    await deleteObjectInBucket(key);
    res.json({ message: "File deleted", key });
  } catch (err) {
    console.error("Error deleting file:", err);
    res
      .status(500)
      .json({ message: "Failed to delete file", error: err.message });
  }
});

// NEW: Download endpoint (returns a signed URL optimized for download)
app.get("/files/download", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ message: "Missing 'key' query param" });
    }

    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const url = S3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: 60 * 60,
      ResponseContentDisposition: "attachment", // force download
    });

    res.json({ url });
  } catch (err) {
    console.error("Download URL error:", err);
    res
      .status(500)
      .json({ message: "Failed to generate download URL", error: err.message });
  }
});

// NEW: Rename file (within same folder)
app.put("/files/rename", async (req, res) => {
  try {
    const { key, newName } = req.body || {};
    if (!key || !newName) {
      return res.status(400).json({ message: "Missing 'key' or 'newName'" });
    }

    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    // key: uploads/<folder>/<name.ext>
    const keyParts = key.split("/");
    if (keyParts.length < 3) {
      return res.status(400).json({ message: "Invalid key format" });
    }

    const folder = keyParts[1]; // uploads/<folder>/...
    const ext = path.extname(key);
    const safeNewBase = newName.replace(/\s+/g, "_").toLowerCase();
    const newKey = `uploads/${folder}/${safeNewBase}${ext}`;

    // Copy then delete old
    await copyObjectInBucket(key, newKey);
    await deleteObjectInBucket(key);

    const signedUrl = makeSignedUrl(newKey);

    res.json({
      message: "File renamed",
      file: {
        key: newKey,
        name: `${safeNewBase}${ext}`,
        folder,
        url: signedUrl,
      },
    });
  } catch (err) {
    console.error("Rename error:", err);
    res
      .status(500)
      .json({ message: "Failed to rename file", error: err.message });
  }
});

// NEW: Move file to another folder
app.put("/files/move", async (req, res) => {
  try {
    const { key, newFolder } = req.body || {};
    if (!key || !newFolder) {
      return res.status(400).json({ message: "Missing 'key' or 'newFolder'" });
    }

    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const folderSafe = safeFolderName(newFolder);

    const keyParts = key.split("/");
    if (keyParts.length < 3) {
      return res.status(400).json({ message: "Invalid key format" });
    }

    const filename = keyParts[keyParts.length - 1]; // last part
    const newKey = `uploads/${folderSafe}/${filename}`;

    await copyObjectInBucket(key, newKey);
    await deleteObjectInBucket(key);

    const signedUrl = makeSignedUrl(newKey);

    res.json({
      message: "File moved",
      file: {
        key: newKey,
        name: filename,
        folder: folderSafe,
        url: signedUrl,
      },
    });
  } catch (err) {
    console.error("Move error:", err);
    res
      .status(500)
      .json({ message: "Failed to move file", error: err.message });
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
