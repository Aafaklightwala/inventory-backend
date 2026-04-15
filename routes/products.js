// products.routes.js — with image + ingredients support
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

/* ── GET ALL (with ingredients) ───────────────── */
router.get("/", auth, async (req, res) => {
  try {
    const [products] = await db.promise().query(
      `SELECT p.*,
              IFNULL(
                JSON_ARRAYAGG(
                  CASE WHEN pi.id IS NOT NULL
                  THEN JSON_OBJECT('id', pi.id, 'name', pi.name, 'percentage', pi.percentage)
                  ELSE NULL END
                ),
                JSON_ARRAY()
              ) AS ingredients
       FROM products p
       LEFT JOIN product_ingredients pi ON pi.product_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.id DESC`,
      [req.user.id],
    );

    const result = products.map((p) => ({
      ...p,
      ingredients: (() => {
        const raw =
          typeof p.ingredients === "string"
            ? JSON.parse(p.ingredients)
            : p.ingredients || [];
        return Array.isArray(raw) ? raw.filter((i) => i && i.name) : [];
      })(),
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /products error:", err);
    res.status(500).json(err);
  }
});
/* ── ADD PRODUCT (with ingredients) ──────────── */
router.post("/", auth, async (req, res) => {
  const {
    name,
    sku,
    hotkey,
    category,
    price,
    stock,
    grams,
    image,
    ingredients,
  } = req.body;

  if (!name || !price)
    return res.status(400).json({ message: "Name and price are required" });

  // Validate total percentage if ingredients provided
  if (ingredients && ingredients.length > 0) {
    const total = ingredients.reduce(
      (sum, i) => sum + Number(i.percentage || 0),
      0,
    );
    if (Math.round(total) !== 100) {
      return res.status(400).json({
        message: `Ingredient percentages must add up to 100%. Current total: ${total}%`,
      });
    }
  }

  try {
    const [result] = await db.promise().query(
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
    );

    const productId = result.insertId;

    // Insert ingredients if provided
    if (ingredients && ingredients.length > 0) {
      const values = ingredients
        .filter((i) => i.name && i.name.trim())
        .map((i) => [productId, i.name.trim(), Number(i.percentage)]);

      if (values.length > 0) {
        await db
          .promise()
          .query(
            "INSERT INTO product_ingredients (product_id, user_id, name, percentage) VALUES ?",
            [values],
          );
      }
    }

    res.json({ message: "Product added successfully" });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── UPDATE PRODUCT (with ingredients) ───────── */
router.put("/:id", auth, async (req, res) => {
  const {
    name,
    sku,
    hotkey,
    category,
    price,
    stock,
    grams,
    image,
    ingredients,
  } = req.body;
  const productId = req.params.id;
  const userId = req.user.id;

  // Validate total percentage if ingredients provided
  if (ingredients && ingredients.length > 0) {
    const total = ingredients.reduce(
      (sum, i) => sum + Number(i.percentage || 0),
      0,
    );
    if (Math.round(total) !== 100) {
      return res.status(400).json({
        message: `Ingredient percentages must add up to 100%. Current total: ${total}%`,
      });
    }
  }

  try {
    await db.promise().query(
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
        productId,
        userId,
      ],
    );

    // Delete old ingredients and re-insert (simplest correct approach)
    await db
      .promise()
      .query("DELETE FROM product_ingredients WHERE product_id=?", [productId]);

    if (ingredients && ingredients.length > 0) {
      const values = ingredients
        .filter((i) => i.name && i.name.trim())
        .map((i) => [productId, userId, i.name.trim(), Number(i.percentage)]);

      if (values.length > 0) {
        await db
          .promise()
          .query(
            "INSERT INTO product_ingredients (product_id, user_id, name, percentage) VALUES ?",
            [values],
          );
      }
    }

    res.json({ message: "Product updated successfully" });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── DELETE PRODUCT ───────────────────────────── */
router.delete("/:id", auth, (req, res) => {
  // Ingredients auto-deleted via ON DELETE CASCADE
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
        const [result] = await db.promise().query(
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

        // Import ingredients if present in excel
        if (
          item.ingredients &&
          Array.isArray(item.ingredients) &&
          item.ingredients.length > 0
        ) {
          const values = item.ingredients
            .filter((i) => i.name)
            .map((i) => [result.insertId, userId, i.name, i.percentage || 0]);
          if (values.length > 0) {
            await db
              .promise()
              .query(
                "INSERT INTO product_ingredients (product_id, user_id, name, percentage) VALUES ?",
                [values],
              );
          }
        }
        added++;
      }
    }
    res.json({ added, updated });
  } catch (err) {
    res.status(500).json({ message: "Import failed", err });
  }
});

module.exports = router;
