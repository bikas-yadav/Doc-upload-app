// ==========================
//  IMPORTS
// ==========================
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk"); // AWS SDK for S3

// ==========================
//  EXPRESS APP
// ==========================
const app = express();
const PORT = process.env.PORT || 4000;

// ==========================
//  CORS
// ==========================
app.use(
  cors({
    origin: "*", // later you can restrict this to your Netlify URL
    methods: ["GET", "POST"],
  })
);

// ==========================
//  MULTER (store file in memory for S3)
// ==========================
const upload = multer({
  storage: multer.memoryStorage(), // file is available as req.file.buffer
});

// ==========================
//  AWS S3 CONFIG
// ==========================
// Set these in Render -> Environment:
// AWS_ACCESS_KEY_ID
// AWS_SECRET_ACCESS_KEY
// AWS_S3_BUCKET
// AWS_REGION

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,       // DO NOT hardcode keys
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new aws.S3();
const BUCKET = process.env.AWS_S3_BUCKET;

// ==========================
//  HEALTH CHECK
// ==========================
app.get("/", (req, res) => {
  res.send("S3 Document Upload Backend is running ✅");
});

// ==========================
//  UPLOAD ROUTE
// ==========================
app.post("/upload", upload.single("document"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const file = req.file;

  // create a unique key inside the bucket
  const key = `uploads/${Date.now()}-${file.originalname}`;

  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: "public-read", // public URL
  };

  s3.upload(params, (err, data) => {
    if (err) {
      console.error("S3 upload error:", err);
      return res.status(500).json({
        message: "Failed to upload to S3",
        error: err.message,
      });
    }

    // success
    return res.json({
      message: "File uploaded successfully to S3!",
      fileUrl: data.Location, // direct URL to the file
      key: data.Key,
      bucket: data.Bucket,
    });
  });
});

// ==========================
//  ERROR HANDLER
// ==========================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({
    message: "Internal server error",
    error: err.message,
  });
});

// ==========================
//  START SERVER
// ==========================
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
