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

    // Store everything under "uploads/" folder
    const key = `uploads/${baseName}-${timestamp}${ext}`;

    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // If you want them NOT public, remove ACL and always use signed URLs.
      ACL: "private",
    };

    // Upload to S3
    const result = await S3.upload(params).promise();

    // Generate a signed URL for preview/open (1 hour)
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
        // Direct S3 URL (may require bucket to be public if you use this)
        location: result.Location,
        // Signed URL used by frontend
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

// List files endpoint: returns array of { name, key, size, lastModified, url }
app.get("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const params = {
      Bucket: S3_BUCKET,
      Prefix: "uploads/", // Only list files in uploads/ folder
      MaxKeys: 1000,
    };

    const data = await S3.listObjectsV2(params).promise();

    const files = (data.Contents || [])
      // skip the folder itself if it appears as "uploads/"
      .filter((obj) => obj.Key !== "uploads/")
      .map((obj) => {
        const key = obj.Key;
        const name = path.basename(key);

        const signedUrl = S3.getSignedUrl("getObject", {
          Bucket: S3_BUCKET,
          Key: key,
          Expires: 60 * 60, // 1 hour
        });

        return {
          name,
          key,
          size: obj.Size,
          lastModified: obj.LastModified,
          url: signedUrl,
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
