const express = require("express");
const router = express.Router();
const db = require("../config/db");

/**
 * PUBLIC PRODUCTS FOR WEBSITE
 */
router.get("/products/:userId", (req, res) => {
  const userId = req.params.userId;

  db.query(
    "SELECT id,name,sku,price,grams,stock FROM products WHERE user_id=? AND stock>0 ORDER BY id DESC",
    [userId],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      res.json(result);
    },
  );
});

module.exports = router;
