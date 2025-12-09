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
// You can keep this hard-coded or move to env if you want.
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "my-doc-upload-app-bucket";
const BUCKET_REGION = process.env.S3_BUCKET_REGION || "ap-south-2";

aws.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: BUCKET_REGION,
});

const S3 = new aws.S3();
const S3_BUCKET = BUCKET_NAME;

// ✅ ADMIN TOKEN (set this in Render environment variables)
// used for login form validation
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// SESSION secret (required for signing cookies)
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// ==============================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression()); // compress all responses

// --- sessions: used to protect admin UI ---
app.use(
  session({
    name: "study_admin_sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

// memory storage for uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (adjust if needed)
});

// ---------- HELPERS ----------
function safeFolderName(folderRaw) {
  const trimmed = (folderRaw || "").trim();
  if (!trimmed) return "root";
  return trimmed.replace(/[^\w\-]/g, "_").toLowerCase();
}

// Simple admin auth middleware for API (optional re-use)
function requireAdminHeader(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    (req.headers["authorization"] || "").replace("Bearer ", "");

  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN not set in environment!");
    return res.status(500).json({ message: "Server admin not configured" });
  }

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ message: "Forbidden: admin only" });
  }

  next();
}

// Middleware to protect the admin UI using session
function requireLoggedIn(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/admin/login");
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

// Serve generic public folder (if you have one)
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Admin UI routes ---
// Place your admin files in frontend/ (sibling of backend/)
// Example: frontend/admin.html or frontend/index.html
// We'll mount that folder at /admin and protect it with the session middleware.

// Login page (simple form)
app.get("/admin/login", (req, res) => {
  // If already logged in, redirect to admin index
  if (req.session && req.session.isAdmin) return res.redirect("/admin");
  // Simple login form (you can replace with your static file later)
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Admin Login</title>
        <style>
          body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6}
          .card{background:white;padding:24px;border-radius:8px;box-shadow:0 6px 30px rgba(2,6,23,0.08);width:360px}
          input{width:100%;padding:10px;margin-top:8px;border-radius:6px;border:1px solid #e5e7eb}
          button{margin-top:12px;padding:10px 12px;width:100%;border-radius:6px;border:none;background:#0ea5a0;color:white;font-weight:600}
          .note{font-size:13px;color:#6b7280;margin-top:8px}
        </style>
      </head>
      <body>
        <div class="card">
          <h3>Admin login</h3>
          <form method="POST" action="/admin/login">
            <input name="token" type="password" placeholder="Admin token / password" required />
            <button type="submit">Sign in</button>
          </form>
          <div class="note">This page protects the admin UI. API endpoints remain as configured on the server.</div>
        </div>
      </body>
    </html>
  `);
});

// Login handler
app.post("/admin/login", (req, res) => {
  const token = req.body.token;
  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN not set in environment!");
    return res.status(500).send("Server admin not configured");
  }
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).send(`
      <p>Invalid token. <a href="/admin/login">Try again</a></p>
    `);
  }

  // success: mark session
  req.session.isAdmin = true;
  return res.redirect("/admin");
});

// Logout
app.get("/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("study_admin_sid");
    return res.redirect("/admin/login");
  });
});

// Mount admin static files from ../frontend at the /admin route, but protect them first
app.use(
  "/admin",
  (req, res, next) => {
    // allow the login/logout routes to pass without session checks
    if (req.path === "/login" || req.path === "/logout") return next();
    return requireLoggedIn(req, res, next);
  },
  express.static(path.join(__dirname, "..", "frontend"))
);

// Root / simple check
app.get("/", (req, res) => {
  res.send("Study Drive backend (S3) is running ✅");
});

// Dedicated health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ---------------------------------------------------------------------
// Your existing API endpoints (kept public as in your original code)
// If you want to protect them as well, add `requireLoggedIn` or `requireAdminHeader`
// as middleware to each route below (I'll keep them public for now).
// ---------------------------------------------------------------------

// Upload endpoint
app.post(
  "/upload",
  upload.single("document"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const file = req.file;
      const originalName = file.originalname || "file";
      const ext = path.extname(originalName);
      let baseName = path
        .basename(originalName, ext)
        .replace(/\s+/g, "_")
        .replace(/[^\w\-]/g, "_");

      // Folder from form
      const rawFolder = req.body && req.body.folder ? req.body.folder : "";
      let folderSafe = rawFolder || "root";
      folderSafe = safeFolderName(folderSafe);

      // Start with clean filename
      let finalName = `${baseName}${ext}`;
      let key = `uploads/${folderSafe}/${finalName}`;

      // AUTO-INCREMENT LOGIC
      let counter = 1;
      while (true) {
        try {
          await S3.headObject({ Bucket: S3_BUCKET, Key: key }).promise();
          finalName = `${baseName}(${counter})${ext}`;
          key = `uploads/${folderSafe}/${finalName}`;
          counter++;
        } catch (err) {
          // headObject failed => file does not exist => stop
          break;
        }
      }

      // Upload to S3
      const params = {
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: "private",
      };

      await S3.upload(params).promise();

      const signedUrl = makeSignedUrl(key, 3600);

      res.json({
        message: "File uploaded successfully!",
        file: {
          originalName: finalName,
          key,
          size: file.size,
          folder: folderSafe,
          url: signedUrl,
        },
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({
        message: "Failed to upload file",
        error: err.message,
      });
    }
  }
);

// List files
app.get("/files", async (req, res) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ message: "S3 bucket not configured" });
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(rawLimit) ? 100 : Math.min(rawLimit, 200);
    const continuationToken = req.query.continuationToken || undefined;
    const folderQuery = req.query.folder
      ? safeFolderName(req.query.folder)
      : null;

    const prefix = folderQuery ? `uploads/${folderQuery}/` : "uploads/";

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
    res.status(500).json({
      message: "Failed to list files",
      error: err.message,
    });
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
    res.status(500).json({
      message: "Failed to delete file",
      error: err.message,
    });
  }
});

// Download endpoint (redirect to signed URL)
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
      ResponseContentDisposition: "attachment",
    });

    return res.redirect(url);
  } catch (err) {
    console.error("Download URL error:", err);
    res.status(500).json({
      message: "Failed to generate download URL",
      error: err.message,
    });
  }
});

// Rename file
app.put("/files/rename", async (req, res) => {
  try {
    const { key, newName } = req.body || {};
    if (!key || !newName) {
      return res.status(400).json({ message: "Missing 'key' or 'newName'" });
    }

    const keyParts = key.split("/");
    if (keyParts.length < 3) {
      return res.status(400).json({ message: "Invalid key format" });
    }

    const folder = keyParts[1];
    const ext = path.extname(key);
    const safeNewBase = newName.replace(/\s+/g, "_").toLowerCase();
    const newKey = `uploads/${folder}/${safeNewBase}${ext}`;

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
    res.status(500).json({
      message: "Failed to rename file",
      error: err.message,
    });
  }
});

// Move file
app.put("/files/move", async (req, res) => {
  try {
    const { key, newFolder } = req.body || {};
    if (!key || !newFolder) {
      return res.status(400).json({ message: "Missing 'key' or 'newFolder'" });
    }

    const folderSafe = safeFolderName(newFolder);

    const keyParts = key.split("/");
    if (keyParts.length < 3) {
      return res.status(400).json({ message: "Invalid key format" });
    }

    const filename = keyParts[keyParts.length - 1];
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
    res.status(500).json({
      message: "Failed to move file",
      error: err.message,
    });
  }
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({
    message: "Server error",
    error: err.message || err,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Study Drive backend running on port ${PORT}`);
  console.log(`🔒 Admin UI protected at /admin (login at /admin/login)`);
});
