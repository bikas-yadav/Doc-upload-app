// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk");
const path = require("path");
const compression = require("compression"); // ✅

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

// ✅ ADMIN TOKEN (set this in Render env vars)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// ==============================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT"],
  })
);

app.use(express.json());
app.use(compression()); // ✅ compress all responses

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

// ✅ Simple admin auth middleware
function requireAdmin(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    req.headers["authorization"]?.replace("Bearer ", "") ||
    req.query.adminToken;

  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN not set in environment!");
    return res.status(500).json({ message: "Server admin not configured" });
  }

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ message: "Forbidden: admin only" });
  }

  next();
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

// Root / simple check
app.get("/", (req, res) => {
  res.send("Study Drive backend (S3) is running ✅");
});

// ✅ Dedicated health check (for UptimeRobot / Render pings)
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// 🔒 Upload endpoint: only admin can upload
// expects form field name "document"
app.post("/upload", requireAdmin, upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const file = req.file;
    const originalName = file.originalname || "file";
    const ext = path.extname(originalName);
    let baseName = path.basename(originalName, ext)
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]/g, "_");

    // Folder from form
    const rawFolder = (req.body && req.body.folder ? req.body.folder : "").trim();
    let folderSafe = rawFolder || "root";
    folderSafe = folderSafe.replace(/[^\w\-]/g, "_").toLowerCase();

    // Start with clean filename
    let finalName = `${baseName}${ext}`;
    let key = `uploads/${folderSafe}/${finalName}`;

    // 🔥 AUTO-INCREMENT LOGIC
    let counter = 1;
    while (true) {
      try {
        // Check if key exists
        await S3.headObject({ Bucket: S3_BUCKET, Key: key }).promise();

        // If it exists → generate next name
        finalName = `${baseName}(${counter})${ext}`;
        key = `uploads/${folderSafe}/${finalName}`;
        counter++;

      } catch (err) {
        // If headObject throws → file does not exist → break loop
        break;
      }
    }

    // Upload to S3
    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "private"
    };

    await S3.upload(params).promise();

    // Signed URL
    const signedUrl = S3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: 3600
    });

    res.json({
      message: "File uploaded successfully!",
      file: {
        originalName: finalName,
        key,
        size: file.size,
        folder: folderSafe,
        url: signedUrl
      }
    });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({
      message: "Failed to upload file",
      error: err.message
    });
  }
});

// ✅ List files: PUBLIC (read-only)
app.get("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.min(rawLimit, 100); // hard cap at 100
    const continuationToken = req.query.continuationToken || undefined;
    const folderQuery = req.query.folder ? safeFolderName(req.query.folder) : null;

    const prefix = folderQuery
      ? `uploads/${folderQuery}/`
      : "uploads/";

    const params = {
      Bucket: S3_BUCKET,
      Prefix: prefix,
      MaxKeys: limit,
    };

    if (continuationToken) {
      params.ContinuationToken = continuationToken;
    }

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

    res.json({
      files,
      nextContinuationToken: data.IsTruncated ? data.NextContinuationToken : null,
    });
  } catch (err) {
    console.error("Error listing files:", err);
    res
      .status(500)
      .json({ message: "Failed to list files", error: err.message });
  }
});

// 🔒 Delete file: only admin
app.delete("/files", requireAdmin, async (req, res) => {
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

// ✅ Download endpoint: PUBLIC (read-only)
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

// 🔒 Rename file (within same folder): only admin
app.put("/files/rename", requireAdmin, async (req, res) => {
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

// 🔒 Move file to another folder: only admin
app.put("/files/move", requireAdmin, async (req, res) => {
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
