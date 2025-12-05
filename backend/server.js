// backend/server.js

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk");

const app = express();
const PORT = process.env.PORT || 4000;

/*
  ========= AWS CONFIG =========
  Make sure these are set in Render (Environment Variables):

  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION          (e.g. "ap-south-1")
  S3_BUCKET_NAME      (your bucket name)
*/

const S3_BUCKET = process.env.S3_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION || "ap-south-1"; // change if needed

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
});

const s3 = new aws.S3();

// CORS – allow everything for now (you can restrict to your Netlify URL later)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

// Parse JSON just in case (not required for file upload, but safe)
app.use(express.json());

// Multer – store file in memory, then upload to S3
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit, change if you want
});

// Simple health check
app.get("/", (req, res) => {
  res.send("File upload backend with S3 is running ✅");
});

// ========= UPLOAD ENDPOINT =========
// Frontend must send field name "document"
app.post("/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const file = req.file;

    // Key = path/name inside S3 bucket
    const fileKey = `uploads/${Date.now()}-${file.originalname}`;

    const params = {
      Bucket: S3_BUCKET,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read", // makes the file publicly accessible
    };

    const data = await s3.upload(params).promise();

    console.log("Uploaded to S3:", data.Location);

    return res.json({
      message: "File uploaded successfully!",
      file: {
        originalName: file.originalname,
        key: fileKey,
        url: data.Location, // public URL
        size: file.size,
        mimeType: file.mimetype,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({
      message: "Failed to upload file",
      error: err.message,
    });
  }
});

// ========= LIST FILES ENDPOINT =========
// Returns list of all files in the bucket (simple drive view)
app.get("/files", async (req, res) => {
  try {
    const params = {
      Bucket: S3_BUCKET,
      Prefix: "uploads/", // only list files under uploads/ folder
    };

    const data = await s3.listObjectsV2(params).promise();

    const files = (data.Contents || [])
      // filter out the "folder" itself if present
      .filter((obj) => obj.Key !== "uploads/")
      .map((obj) => {
        const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${obj.Key}`;
        return {
          name: obj.Key.replace("uploads/", ""), // show just file name
          key: obj.Key,
          url,
          size: obj.Size,
          lastModified: obj.LastModified,
        };
      });

    return res.json({ files });
  } catch (err) {
    console.error("Error listing files:", err);
    return res.status(500).json({
      message: "Failed to list files",
      error: err.message,
    });
  }
});

// ========= GLOBAL ERROR HANDLER =========
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ message: "File too large (max 10MB)" });
  }
  return res.status(500).json({ message: "Server error", error: err.message });
});

// ========= START SERVER =========
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
