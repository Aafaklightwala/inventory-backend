const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

/**
 * REGISTER USER
 */

router.post("/register", async (req, res) => {
  const {
    first_name,
    last_name,
    mobile,
    email,
    gst_number,
    company_name,
    password,
  } = req.body;

  if (!first_name || !last_name || !mobile || !email || !password) {
    return res.status(400).json({ message: "All required fields missing" });
  }

  try {
    db.query(
      "SELECT * FROM users WHERE email = ? OR mobile = ?",
      [email, mobile],
      async (err, result) => {
        if (err) {
          console.error("DB Error:", err);
          return res.status(500).json({ message: "Database error" });
        }

        if (!result || result.length > 0) {
          return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
          `INSERT INTO users 
          (first_name, last_name, mobile, email, gst_number, company_name, password) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            first_name,
            last_name,
            mobile,
            email,
            gst_number,
            company_name,
            hashedPassword,
          ],
          (err, result) => {
            if (err) return res.status(500).json(err);

            res.json({ message: "User registered successfully" });
          },
        );
      },
    );
  } catch (error) {
    res.status(500).json(error);
  }
});

/**
 * LOGIN USER
 */
router.post("/login", (req, res) => {
  const { identifier, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ? OR mobile = ?",
    [identifier, identifier],
    async (err, result) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ message: "Database error" });
      }

      if (!result || result.length === 0) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const user = result[0];

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1d" },
      );

      res.json({
        token,
        user: {
          id: user.id,
          name: user.first_name + " " + user.last_name,
          email: user.email,
        },
      });
    },
  );
});

module.exports = router;
