// invoices.routes.js — with proforma convert support
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

const GST = 5;

/* ── GET ALL (shows invoice_type) ─────────────── */
router.get("/", auth, async (req, res) => {
  try {
    const [invoices] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE user_id=? ORDER BY id DESC", [
        req.user.id,
      ]);
    res.json(invoices);
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── GET SINGLE ───────────────────────────────── */
router.get("/:id", auth, async (req, res) => {
  try {
    const [invoice] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [
        req.params.id,
        req.user.id,
      ]);
    if (!invoice.length) return res.status(404).json({ message: "Not found" });

    const [items] = await db.promise().query(
      `SELECT ii.*, p.name FROM invoice_items ii
       JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id=? AND ii.user_id=?`,
      [req.params.id, req.user.id],
    );
    res.json({ invoice: invoice[0], items });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CONVERT PROFORMA → GST ───────────────────── */
router.post("/convert-to-gst/:id", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const invoiceId = req.params.id;

    const [rows] = await db
      .promise()
      .query(
        "SELECT * FROM invoices WHERE id=? AND user_id=? AND invoice_type='proforma'",
        [invoiceId, userId],
      );

    if (!rows.length)
      return res.status(404).json({ message: "Proforma invoice not found" });

    if (rows[0].payment_status === "cancelled")
      return res
        .status(400)
        .json({ message: "Cannot convert a cancelled invoice" });

    const inv = rows[0];
    const subTotal = parseFloat(inv.sub_total);
    const gstAmount = (subTotal * GST) / 100;
    const discountAmt = parseFloat(inv.discount) || 0;
    const finalTotal = subTotal + gstAmount - discountAmt;
    const newNumber = "INV-" + Date.now();

    await db.promise().query(
      `UPDATE invoices SET
         invoice_number = ?, invoice_type = 'gst',
         gst_percent = ?, gst_amount = ?,
         final_total = ?, payment_status = 'pending'
       WHERE id=? AND user_id=?`,
      [newNumber, GST, gstAmount, finalTotal, invoiceId, userId],
    );

    res.json({
      message: "Converted to GST invoice",
      invoice_id: invoiceId,
      new_invoice_number: newNumber,
      gst_amount: gstAmount,
      final_total: finalTotal,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CANCEL ───────────────────────────────────── */
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
    if (!invoice.length) return res.status(404).json({ message: "Not found" });
    if (invoice[0].payment_status === "cancelled")
      return res.status(400).json({ message: "Already cancelled" });

    const [items] = await db
      .promise()
      .query("SELECT * FROM invoice_items WHERE invoice_id=? AND user_id=?", [
        invoice_id,
        userId,
      ]);
    for (const item of items) {
      await db
        .promise()
        .query(
          "UPDATE products SET stock = stock + ? WHERE id=? AND user_id=?",
          [item.qty, item.product_id, userId],
        );
    }
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

/* ── EXPORT BY DATE ───────────────────────────── */
router.get("/export", auth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end)
      return res.status(400).json({ message: "Start and End date required" });

    const [invoices] = await db
      .promise()
      .query(
        `SELECT * FROM invoices WHERE user_id=? AND DATE(created_at) BETWEEN ? AND ? ORDER BY id DESC`,
        [req.user.id, start, end],
      );
    res.json(invoices);
  } catch (err) {
    res.status(500).json(err);
  }
});

module.exports = router;
