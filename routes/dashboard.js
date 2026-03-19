// dashboard.routes.js — multi-user secure version
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { filter, start, end } = req.query;

    let dateQuery = "";
    let dateParams = [];

    if (filter === "7days") {
      dateQuery = "AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    } else if (filter === "month") {
      dateQuery =
        "AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())";
    } else if (start && end) {
      dateQuery = "AND DATE(created_at) BETWEEN ? AND ?";
      dateParams = [start, end];
    }

    /* ===== TOP CARDS ===== */

    const [[revenue]] = await db.promise().query(
      `
      SELECT IFNULL(SUM(final_total),0) as totalRevenue,
             COUNT(*) as totalOrders
      FROM invoices
      WHERE user_id=? ${dateQuery}
      `,
      [userId, ...dateParams],
    );

    const [[stock]] = await db.promise().query(
      `
      SELECT IFNULL(SUM(stock),0) as totalStock,
             SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as outOfStock
      FROM products
      WHERE user_id=?
      `,
      [userId],
    );

    const [[customers]] = await db.promise().query(
      `
      SELECT COUNT(DISTINCT customer_mobile) as totalCustomers
      FROM invoices
      WHERE user_id=? AND customer_mobile IS NOT NULL
      `,
      [userId],
    );

    const [[avgOrder]] = await db.promise().query(
      `
      SELECT IFNULL(AVG(final_total),0) as avgOrderValue
      FROM invoices
      WHERE user_id=? ${dateQuery}
      `,
      [userId, ...dateParams],
    );

    /* ===== DAILY SALES ===== */

    const [dailySales] = await db.promise().query(
      `
      SELECT DATE(created_at) as date,
             SUM(final_total) as final_total
      FROM invoices
      WHERE user_id=? ${dateQuery}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
      `,
      [userId, ...dateParams],
    );

    /* ===== STOCK DISTRIBUTION ===== */

    const [[stockDist]] = await db.promise().query(
      `
      SELECT 
        SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as outOfStock,
        SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END) as inStock
      FROM products
      WHERE user_id=?
      `,
      [userId],
    );

    /* ===== TOP PRODUCTS ===== */

    const [topProducts] = await db.promise().query(
      `
      SELECT p.name, SUM(ii.qty) as totalSold
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      WHERE ii.user_id=?
      GROUP BY ii.product_id
      ORDER BY totalSold DESC
      LIMIT 5
      `,
      [userId],
    );

    /* ===== PAYMENT MODE ===== */

    const [[paymentMode]] = await db.promise().query(
      `
  SELECT 
    IFNULL(SUM(CASE WHEN payment_mode='cash' THEN final_total ELSE 0 END),0) as cash,
    IFNULL(SUM(CASE WHEN payment_mode='razorpay' THEN final_total ELSE 0 END),0) as razorpay
  FROM invoices
  WHERE user_id=? ${dateQuery}
  `,
      [userId, ...dateParams],
    );

    /* ===== INVENTORY VALUE ===== */

    const [[inventory]] = await db.promise().query(
      `
      SELECT IFNULL(SUM(stock * price),0) as inventoryValue
      FROM products
      WHERE user_id=?
      `,
      [userId],
    );

    res.json({
      totalRevenue: revenue.totalRevenue,
      totalOrders: revenue.totalOrders,
      totalStock: stock.totalStock,
      outOfStock: stock.outOfStock,
      totalCustomers: customers.totalCustomers,
      avgOrderValue: avgOrder.avgOrderValue,
      inventoryValue: inventory.inventoryValue,
      dailySales,
      stockDistribution: stockDist,
      topProducts,
      paymentMode,
    });
  } catch (error) {
    res.status(500).json({ message: "Dashboard error", error });
  }
});

module.exports = router;
