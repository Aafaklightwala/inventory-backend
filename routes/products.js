// products.routes.js — updated with category + sku columns
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

/**
 * GET ALL PRODUCTS
 */
router.get("/", auth, (req, res) => {
  const userId = req.user.id;
  db.query(
    "SELECT * FROM products WHERE user_id=? ORDER BY id DESC",
    [userId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});

/**
 * ADD PRODUCT
 */
router.post("/", auth, (req, res) => {
  const { name, sku, category, price, stock, grams } = req.body;

  if (!name || !price) {
    return res.status(400).json({ message: "Name and price are required" });
  }
  const userId = req.user.id;

  db.query(
    "INSERT INTO products (name, sku, category, price, stock, grams,user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      name,
      sku || null,
      category || null,
      price,
      stock || 0,
      grams || 0,
      userId,
    ],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product added successfully" });
    },
  );
});

/**
 * UPDATE PRODUCT
 */
router.put("/:id", auth, (req, res) => {
  const { name, sku, category, price, stock, grams } = req.body;
  const { id } = req.params;
  const userId = req.user.id;
  db.query(
    "UPDATE products SET name=?, sku=?, category=?, price=?, stock=?, grams=? WHERE id=? AND user_id=?",
    [name, sku || null, category || null, price, stock, grams, id, userId],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product updated successfully" });
    },
  );
});

/**
 * DELETE PRODUCT
 */
router.delete("/:id", auth, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  db.query(
    "DELETE FROM products WHERE id=? AND user_id=?",
    [id, userId],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Product deleted successfully" });
    },
  );
});

/**
 * BULK IMPORT (Excel/CSV)
 * Matches on name. Updates stock if exists, inserts if not.
 */
router.post("/bulk-import", auth, async (req, res) => {
  const products = req.body;
  const userId = req.user.id;
  let added = 0,
    updated = 0;

  try {
    for (const item of products) {
      const [existing] = await db
        .promise()
        .query("SELECT * FROM products WHERE name = ? AND user_id = ?", [
          item.name,
          userId,
        ]);

      if (existing.length > 0) {
        await db
          .promise()
          .query(
            "UPDATE products SET stock = stock + ?, sku=COALESCE(?,sku), category=COALESCE(?,category), price=COALESCE(?,price), grams=COALESCE(?,grams) WHERE name = ? AND user_id = ?",
            [
              item.stock || 0,
              item.sku || null,
              item.category || null,
              item.price || null,
              item.grams || null,
              item.name,
              userId,
            ],
          );
        updated++;
      } else {
        await db
          .promise()
          .query(
            "INSERT INTO products (name, sku, category, price, stock, grams, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              item.name,
              item.sku || null,
              item.category || null,
              item.price || 0,
              item.stock || 0,
              item.grams || 0,
              userId,
            ],
          );
        added++;
      }
    }
    res.json({ added, updated });
  } catch (error) {
    res.status(500).json({ message: "Import failed", error });
  }
});

module.exports = router;
