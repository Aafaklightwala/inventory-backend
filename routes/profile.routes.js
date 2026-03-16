// routes/profile.routes.js
// GET  /api/profile        → fetch current user's profile
// PUT  /api/profile        → update name/mobile/company/gst
// POST /api/profile/logo   → upload company logo (base64 stored in DB)
//
// SETUP: No extra npm install needed — uses built-in modules only.
// If you want file-system storage instead of base64, add multer.

const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");
const bcrypt = require("bcrypt");

/* ── GET PROFILE ──────────────────────────────── */
router.get("/", auth, (req, res) => {
  db.query(
    `SELECT id, first_name, last_name, mobile, email,
            gst_number, company_name, role, status,
            created_at, company_logo
     FROM users WHERE id = ?`,
    [req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error", error: err });
      if (!result.length)
        return res.status(404).json({ message: "User not found" });
      res.json(result[0]);
    },
  );
});

/* ── UPDATE PROFILE ───────────────────────────── */
router.put("/", auth, (req, res) => {
  const { first_name, last_name, mobile, company_name, gst_number } = req.body;

  if (!first_name?.trim() || !last_name?.trim() || !mobile?.trim()) {
    return res.status(400).json({ message: "Name and mobile are required" });
  }

  db.query(
    `UPDATE users SET
       first_name   = ?,
       last_name    = ?,
       mobile       = ?,
       company_name = ?,
       gst_number   = ?
     WHERE id = ?`,
    [
      first_name.trim(),
      last_name.trim(),
      mobile.trim(),
      company_name?.trim() || null,
      gst_number?.trim() || null,
      req.user.id,
    ],
    (err) => {
      if (err)
        return res.status(500).json({ message: "Update failed", error: err });
      res.json({ message: "Profile updated successfully" });
    },
  );
});

/* ── CHANGE PASSWORD ──────────────────────────── */
router.put("/change-password", auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ message: "Both passwords required" });
  if (new_password.length < 6)
    return res.status(400).json({ message: "New password min 6 characters" });

  db.query(
    "SELECT password FROM users WHERE id = ?",
    [req.user.id],
    async (err, rows) => {
      if (err || !rows.length)
        return res.status(500).json({ message: "Error" });
      const match = await bcrypt.compare(current_password, rows[0].password);
      if (!match)
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });

      const hashed = await bcrypt.hash(new_password, 10);
      db.query(
        "UPDATE users SET password = ? WHERE id = ?",
        [hashed, req.user.id],
        (err2) => {
          if (err2)
            return res
              .status(500)
              .json({ message: "Failed to update password" });
          res.json({ message: "Password changed successfully" });
        },
      );
    },
  );
});

/* ── UPLOAD COMPANY LOGO (base64) ─────────────── */
// Accepts JSON: { logo: "data:image/png;base64,..." }
// Add company_logo column first:
//   ALTER TABLE users ADD COLUMN company_logo MEDIUMTEXT NULL;
router.post("/logo", auth, (req, res) => {
  const { logo } = req.body;
  if (!logo) return res.status(400).json({ message: "No logo provided" });

  // Basic size guard (~500 KB base64 ≈ 375 KB actual)
  if (logo.length > 700000)
    return res.status(400).json({ message: "Logo too large. Max ~500 KB." });

  db.query(
    "UPDATE users SET company_logo = ? WHERE id = ?",
    [logo, req.user.id],
    (err) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Failed to save logo", error: err });
      res.json({ message: "Logo uploaded successfully", logo });
    },
  );
});

module.exports = router;
