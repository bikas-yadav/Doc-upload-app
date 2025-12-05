const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS (you can restrict origin later)
app.use(cors());

// Make sure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Add timestamp to avoid name conflicts
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

// Limit file size to ~5MB (optional)
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Simple health check
app.get("/", (req, res) => {
  res.send("File upload backend is running ✅");
});

// Upload endpoint
app.post("/upload", upload.single("document"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  console.log("File uploaded:", req.file);

  res.json({
    message: "File uploaded successfully!",
    file: {
      originalName: req.file.originalname,
      savedAs: req.file.filename,
      size: req.file.size,
    },
  });
});

// Global error handler (for multer errors, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ message: "File too large (max 5MB)" });
  }
  res.status(500).json({ message: "Server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
