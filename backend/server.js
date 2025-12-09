// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const aws = require("aws-sdk");
const path = require("path");
const compression = require("compression");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 4000;

// ======= BUCKET CONFIG =======
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "my-doc-upload-app-bucket";
const BUCKET_REGION = process.env.S3_BUCKET_REGION || "ap-south-2";

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: BUCKET_REGION,
});

const S3 = new aws.S3();
const S3_BUCKET = BUCKET_NAME;

// ADMIN TOKEN and SESSION SECRET (set in env)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Optional: protect API endpoints (set PROTECT_API=true in env to require login for upload/delete/rename/move)
const PROTECT_API = String(process.env.PROTECT_API || "").toLowerCase() === "true";

// Frontend origin used for CORS when you host frontend separately
// Example: FRONTEND_URL=https://your-frontend-domain.com
const FRONTEND_URL = process.env.FRONTEND_URL || null;

// ==============================

// CORS configuration: if FRONTEND_URL provided, use it (required to support credentials/cookies).
const corsOptions = FRONTEND_URL
  ? {
      origin: FRONTEND_URL,
      methods: ["GET", "POST", "DELETE", "PUT"],
      credentials: true,
    }
  : {
      origin: true,
      methods: ["GET", "POST", "DELETE", "PUT"],
      credentials: true,
    };

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// sessions
app.use(
  session({
    name: "study_admin_sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // secure must be true in production (HTTPS). sameSite none required for cross-site cookies.
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

// memory storage for uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ---------- HELPERS ----------
function safeFolderName(folderRaw) {
  const trimmed = (folderRaw || "").trim();
  if (!trimmed) return "root";
  return trimmed.replace(/[^\w\-]/g, "_").toLowerCase();
}

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

function extractTokenFromReq(req) {
  // Accept token from JSON body, x-admin-token header, or Authorization: Bearer ...
  let token = null;
  if (req.body && typeof req.body.token === "string") token = req.body.token;
  if (!token && req.headers["x-admin-token"]) token = req.headers["x-admin-token"];
  if (!token && req.headers["authorization"]) {
    const auth = String(req.headers["authorization"]);
    if (auth.toLowerCase().startsWith("bearer ")) token = auth.slice(7);
  }
  if (typeof token === "string") return token.trim();
  return null;
}

function requireLoggedInSession(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ ok: false, message: "Not authenticated" });
}

// If PROTECT_API is enabled, require session for write API endpoints
function apiAuthMiddleware(req, res, next) {
  if (!PROTECT_API) return next();
  return requireLoggedInSession(req, res, next);
}

// ------------------------------

// Serve generic public folder (if any)
app.use(express.static(path.join(__dirname, "..", "public")));

// Serve admin static files from frontend/ at /admin (optional)
app.use("/admin", express.static(path.join(__dirname, "..", "frontend")));

// Auth endpoint used by admin.js (returns JSON)
// Accepts token in body/header; uses trimmed compare
app.post("/admin/auth", (req, res) => {
  const token = extractTokenFromReq(req);

  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN not set in environment!");
    return res.status(500).json({ ok: false, message: "Server admin not configured" });
  }

  if (!token) {
    return res.status(400).json({ ok: false, message: "Missing token" });
  }

  if (token !== ADMIN_TOKEN) {
    // do not print the token itself; only log length for debugging if not prod
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Failed admin login attempt — token length: ${token.length}`);
    }
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }

  // success -> set session
  req.session.isAdmin = true;
  return res.json({ ok: true, message: "Authenticated" });
});

// Session check endpoint
app.get("/admin/session", (req, res) => {
  if (req.session && req.session.isAdmin) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

// Debug endpoint (only in non-production). Shows presence and length of ADMIN_TOKEN (not value).
app.get("/admin/debug", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).send("Not found");
  const present = !!ADMIN_TOKEN;
  const len = ADMIN_TOKEN ? String(ADMIN_TOKEN).length : 0;
  return res.json({ ok: true, adminTokenPresent: present, adminTokenLength: len, protectApi: PROTECT_API, frontendUrl: FRONTEND_URL || null });
});

// Logout (clears session)
app.get("/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("study_admin_sid");
    return res.json({ ok: true });
  });
});

// Root / health
app.get("/", (req, res) => {
  res.send("Study Drive backend (S3) is running ✅");
});
app.get("/health", (req, res) => res.status(200).send("OK"));

// -----------------
// Simple in-memory TTL cache (no external deps) used for listing
const listCache = new Map(); // key -> {expires: timestamp, value}

function makeCacheKey(prefix, limit, continuationToken, includeUrl) {
  return `${prefix}|limit:${limit}|cont:${continuationToken || ""}|url:${includeUrl ? "1" : "0"}`;
}

function setCache(key, value, ttlSeconds = 10) {
  const expires = Date.now() + ttlSeconds * 1000;
  listCache.set(key, { expires, value });
  // lazy cleanup: schedule removal slightly after expiry
  setTimeout(() => {
    const entry = listCache.get(key);
    if (entry && entry.expires <= Date.now()) listCache.delete(key);
  }, ttlSeconds * 1000 + 500);
}

function getCache(key) {
  const entry = listCache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    listCache.delete(key);
    return null;
  }
  return entry.value;
}

// ---------- UPLOAD / FILES / DOWNLOAD / DELETE / RENAME / MOVE ----------

app.post("/upload", apiAuthMiddleware, upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const file = req.file;
    const originalName = file.originalname || "file";
    const ext = path.extname(originalName);
    let baseName = path
      .basename(originalName, ext)
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]/g, "_");

    const rawFolder = req.body && req.body.folder ? req.body.folder : "";
    let folderSafe = rawFolder || "root";
    folderSafe = safeFolderName(folderSafe);

    let finalName = `${baseName}${ext}`;
    let key = `uploads/${folderSafe}/${finalName}`;

    let counter = 1;
    while (true) {
      try {
        await S3.headObject({ Bucket: S3_BUCKET, Key: key }).promise();
        finalName = `${baseName}(${counter})${ext}`;
        key = `uploads/${folderSafe}/${finalName}`;
        counter++;
      } catch (err) {
        break;
      }
    }

    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "private",
    };

    await S3.upload(params).promise();
    const signedUrl = makeSignedUrl(key, 3600);

    // invalidate small related caches (simple approach: clear entire list cache)
    listCache.clear();

    res.json({
      message: "File uploaded successfully!",
      file: { originalName: finalName, key, size: file.size, folder: folderSafe, url: signedUrl },
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Failed to upload file", error: err.message });
  }
});

// Public (fast, cached) /files endpoint - lists metadata only (no per-file signed urls unless includeUrl=true)
app.get("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) return res.status(500).json({ message: "S3 bucket not configured" });

    const rawLimit = parseInt(req.query.limit, 10);
    const DEFAULT_LIMIT = 50;
    const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(Math.max(rawLimit, 1), 200);

    const continuationToken = req.query.continuationToken || undefined;
    const folderQuery = req.query.folder ? safeFolderName(req.query.folder) : null;
    const prefix = folderQuery ? `uploads/${folderQuery}/` : "uploads/";

    const includeUrl = String(req.query.includeUrl || "false").toLowerCase() === "true";

    const cacheKey = makeCacheKey(prefix, limit, continuationToken, includeUrl);
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const params = { Bucket: S3_BUCKET, Prefix: prefix, MaxKeys: limit };
    if (continuationToken) params.ContinuationToken = continuationToken;

    const data = await S3.listObjectsV2(params).promise();

    const files = (data.Contents || [])
      .filter((obj) => obj.Key !== prefix)
      .map((obj) => {
        const key = obj.Key;
        let relative = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
        const parts = relative.split("/");
        let folder = "root";
        let name = relative;
        if (parts.length > 1) {
          folder = parts[0];
          name = parts.slice(1).join("/");
        }
        return {
          name,
          key,
          size: obj.Size,
          lastModified: obj.LastModified,
          folder,
          hasUrl: includeUrl ? true : false,
        };
      });

    if (includeUrl && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        try {
          files[i].url = makeSignedUrl(files[i].key);
        } catch (e) {
          files[i].url = null;
        }
      }
    }

    const response = { files, nextContinuationToken: data.IsTruncated ? data.NextContinuationToken : null };
    setCache(cacheKey, response, 10);
    res.json(response);
  } catch (err) {
    console.error("Error listing files:", err);
    res.status(500).json({ message: "Failed to list files", error: err.message });
  }
});

// Delete (admin only when PROTECT_API=true)
app.delete("/files", apiAuthMiddleware, async (req, res) => {
  try {
    if (!S3_BUCKET) return res.status(500).json({ message: "S3 bucket not configured" });
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ message: "Missing 'key' in request body" });
    await deleteObjectInBucket(key);
    listCache.clear();
    res.json({ message: "File deleted", key });
  } catch (err) {
    console.error("Error deleting file:", err);
    res.status(500).json({ message: "Failed to delete file", error: err.message });
  }
});

// Download (public by default — change to apiAuthMiddleware if you want to protect)
app.get("/files/download", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ message: "Missing 'key' query param" });
    if (!S3_BUCKET) return res.status(500).json({ message: "S3 bucket not configured" });

    const url = S3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: 60 * 60,
      ResponseContentDisposition: "attachment",
    });
    return res.redirect(url);
  } catch (err) {
    console.error("Download URL error:", err);
    res.status(500).json({ message: "Failed to generate download URL", error: err.message });
  }
});

// Rename (admin only when PROTECT_API=true)
app.put("/files/rename", apiAuthMiddleware, async (req, res) => {
  try {
    const { key, newName } = req.body || {};
    if (!key || !newName) return res.status(400).json({ message: "Missing 'key' or 'newName'" });

    const keyParts = key.split("/");
    if (keyParts.length < 3) return res.status(400).json({ message: "Invalid key format" });

    const folder = keyParts[1];
    const ext = path.extname(key);
    const safeNewBase = newName.replace(/\s+/g, "_").toLowerCase();
    const newKey = `uploads/${folder}/${safeNewBase}${ext}`;

    await copyObjectInBucket(key, newKey);
    await deleteObjectInBucket(key);
    listCache.clear();

    const signedUrl = makeSignedUrl(newKey);

    res.json({ message: "File renamed", file: { key: newKey, name: `${safeNewBase}${ext}`, folder, url: signedUrl } });
  } catch (err) {
    console.error("Rename error:", err);
    res.status(500).json({ message: "Failed to rename file", error: err.message });
  }
});

// Move (admin only when PROTECT_API=true)
app.put("/files/move", apiAuthMiddleware, async (req, res) => {
  try {
    const { key, newFolder } = req.body || {};
    if (!key || !newFolder) return res.status(400).json({ message: "Missing 'key' or 'newFolder'" });

    const folderSafe = safeFolderName(newFolder);
    const keyParts = key.split("/");
    if (keyParts.length < 3) return res.status(400).json({ message: "Invalid key format" });

    const filename = keyParts[keyParts.length - 1];
    const newKey = `uploads/${folderSafe}/${filename}`;

    await copyObjectInBucket(key, newKey);
    await deleteObjectInBucket(key);
    listCache.clear();

    const signedUrl = makeSignedUrl(newKey);

    res.json({ message: "File moved", file: { key: newKey, name: filename, folder: folderSafe, url: signedUrl } });
  } catch (err) {
    console.error("Move error:", err);
    res.status(500).json({ message: "Failed to move file", error: err.message });
  }
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ message: "Server error", error: err.message || err });
});

app.listen(PORT, () => {
  console.log(`✅ Study Drive backend running on port ${PORT}`);
  console.log(`🔒 Admin UI available at /admin (frontend/admin.html handles login)`);
  console.log(`🔐 PROTECT_API=${PROTECT_API ? "true" : "false"} (write endpoints protected when true)`);
  if (process.env.NODE_ENV !== "production") {
    console.log("Debug: /admin/debug available (non-production only)");
  }
});
