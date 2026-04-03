// products.routes.js — with image support
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

/* ── GET ALL ──────────────────────────────────── */
router.get("/", auth, (req, res) => {
  db.query(
    "SELECT * FROM products WHERE user_id=? ORDER BY id DESC",
    [req.user.id],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});

/* ── ADD PRODUCT ──────────────────────────────── */
router.post("/", auth, (req, res) => {
  const { name, sku, hotkey, category, price, stock, grams, image } = req.body;
  if (!name || !price)
    return res.status(400).json({ message: "Name and price are required" });

  db.query(
    `INSERT INTO products (name, sku, hotkey, category, price, stock, grams, image, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      sku || null,
      hotkey || null,
      category || null,
      price,
      stock || 0,
      grams || 0,
      image || null,
      req.user.id,
    ],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product added successfully" });
    },
  );
});

/* ── UPDATE PRODUCT ───────────────────────────── */
router.put("/:id", auth, (req, res) => {
  const { name, sku, hotkey, category, price, stock, grams, image } = req.body;
  db.query(
    `UPDATE products SET name=?, sku=?, hotkey=?, category=?, price=?, stock=?, grams=?, image=?
     WHERE id=? AND user_id=?`,
    [
      name,
      sku || null,
      hotkey || null,
      category || null,
      price,
      stock,
      grams,
      image || null,
      req.params.id,
      req.user.id,
    ],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product updated successfully" });
    },
  );
});

/* ── DELETE PRODUCT ───────────────────────────── */
router.delete("/:id", auth, (req, res) => {
  db.query(
    "DELETE FROM products WHERE id=? AND user_id=?",
    [req.params.id, req.user.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product deleted successfully" });
    },
  );
});

/* ── BULK IMPORT ──────────────────────────────── */
router.post("/bulk-import", auth, async (req, res) => {
  const products = req.body;
  const userId = req.user.id;
  let added = 0,
    updated = 0;

  try {
    for (const item of products) {
      const [existing] = await db
        .promise()
        .query("SELECT * FROM products WHERE name=? AND user_id=?", [
          item.name,
          userId,
        ]);
      if (existing.length > 0) {
        await db.promise().query(
          `UPDATE products SET stock=stock+?,
             sku=COALESCE(?,sku), hotkey=COALESCE(?,hotkey),
             category=COALESCE(?,category), price=COALESCE(?,price),
             grams=COALESCE(?,grams)
           WHERE name=? AND user_id=?`,
          [
            item.stock || 0,
            item.sku || null,
            item.hotkey || null,
            item.category || null,
            item.price || null,
            item.grams || null,
            item.name,
            userId,
          ],
        );
        updated++;
      } else {
        await db.promise().query(
          `INSERT INTO products (name,sku,hotkey,category,price,stock,grams,image,user_id)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            item.name,
            item.sku || null,
            item.hotkey || null,
            item.category || null,
            item.price || 0,
            item.stock || 0,
            item.grams || 0,
            item.image || null,
            userId,
          ],
        );
        added++;
      }
    }
    res.json({ added, updated });
  } catch (err) {
    res.status(500).json({ message: "Import failed", err });
  }
});

module.exports = router;
