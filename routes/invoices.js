// invoices.routes.js — multi-user secure version
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

/* ================= GET ALL INVOICES ================= */

router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [invoices] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE user_id=? ORDER BY id DESC", [
        userId,
      ]);

    res.json(invoices);
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ================= GET INVOICE DETAILS ================= */

router.get("/:id", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const [invoice] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [id, userId]);

    if (!invoice.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [items] = await db.promise().query(
      `SELECT ii.*, p.name
         FROM invoice_items ii
         JOIN products p ON ii.product_id = p.id
         WHERE ii.invoice_id=? AND ii.user_id=?`,
      [id, userId],
    );

    res.json({
      invoice: invoice[0],
      items,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ================= DOWNLOAD INVOICE ================= */

router.get("/:id/download", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const [invoice] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [id, userId]);

    if (!invoice.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Here you can generate PDF safely
    res.json({ message: "Download logic here" });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ================= EXPORT BY DATE ================= */

router.get("/export", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: "Start and End date required" });
    }

    const [invoices] = await db.promise().query(
      `SELECT * FROM invoices
       WHERE user_id=? 
       AND DATE(created_at) BETWEEN ? AND ?
       ORDER BY id DESC`,
      [userId, start, end],
    );

    res.json(invoices);
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ================= CANCEL INVOICE ================= */

router.post("/cancel", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoice_id } = req.body;

    const [invoice] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [
        invoice_id,
        userId,
      ]);

    if (!invoice.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice[0].payment_status === "cancelled") {
      return res.status(400).json({ message: "Invoice already cancelled" });
    }

    // Get invoice items
    const [items] = await db
      .promise()
      .query("SELECT * FROM invoice_items WHERE invoice_id=? AND user_id=?", [
        invoice_id,
        userId,
      ]);

    // Restore stock safely
    for (const item of items) {
      await db
        .promise()
        .query(
          "UPDATE products SET stock = stock + ? WHERE id=? AND user_id=?",
          [item.qty, item.product_id, userId],
        );
    }

    // Update invoice status
    await db
      .promise()
      .query(
        "UPDATE invoices SET payment_status='cancelled' WHERE id=? AND user_id=?",
        [invoice_id, userId],
      );

    res.json({ message: "Invoice cancelled & stock restored" });
  } catch (err) {
    res.status(500).json(err);
  }
});

module.exports = router;
