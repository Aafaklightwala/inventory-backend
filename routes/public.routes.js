const express = require("express");
const router = express.Router();
const db = require("../config/db");

/* ── PUBLIC PRODUCTS WITH INGREDIENTS ────────── */
router.get("/products/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const [products] = await db.promise().query(
      `SELECT p.id, p.name, p.sku, p.price, p.grams, p.stock, p.image,
              IFNULL(
                JSON_ARRAYAGG(
                  CASE WHEN pi.id IS NOT NULL
                  THEN JSON_OBJECT('name', pi.name, 'percentage', pi.percentage)
                  ELSE NULL END
                ),
                JSON_ARRAY()
              ) AS ingredients
       FROM products p
       LEFT JOIN product_ingredients pi ON p.id = pi.product_id
       WHERE p.user_id = ? AND p.stock > 0
       GROUP BY p.id
       ORDER BY p.id DESC`,
      [userId],
    );

    const result = products.map((p) => ({
      ...p,
      ingredients:
        typeof p.ingredients === "string"
          ? JSON.parse(p.ingredients).filter(Boolean)
          : (p.ingredients || []).filter(Boolean),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Database error" });
  }
});

module.exports = router;
