// billing.routes.js — multi-user secure version
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

const GST = 5;

/* ── PREVIEW BILL ─────────────────────────────────────── */
router.post("/preview", auth, async (req, res) => {
  try {
    const { items, discount = 0 } = req.body;
    const userId = req.user.id;

    if (!items || !items.length) {
      return res.status(400).json({ message: "No items provided" });
    }

    const ids = items.map((i) => i.product_id);

    const [products] = await db
      .promise()
      .query("SELECT * FROM products WHERE id IN (?) AND user_id=?", [
        ids,
        userId,
      ]);

    let subTotal = 0;
    const previewItems = [];

    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      if (!p) {
        return res.status(400).json({ message: "Invalid product" });
      }

      const price = item.custom_price || p.price;
      const lineTotal = price * item.qty;
      subTotal += lineTotal;

      previewItems.push({
        product_id: p.id,
        name: p.name,
        qty: item.qty,
        grams: item.grams || p.grams,
        price,
        line_total: lineTotal,
      });
    }

    const gstAmount = (subTotal * GST) / 100;
    const finalTotal = subTotal + gstAmount - Number(discount);

    res.json({
      items: previewItems,
      sub_total: subTotal,
      gst_percent: GST,
      gst_amount: gstAmount,
      discount: Number(discount),
      final_total: finalTotal,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CREATE INVOICE ───────────────────────────────────── */
router.post("/create", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      items,
      payment_mode = "cash",
      customer_name = "Walk-in Customer",
      customer_mobile,
      discount = 0,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ message: "No items provided" });
    }

    const ids = items.map((i) => i.product_id);

    const [products] = await db
      .promise()
      .query("SELECT * FROM products WHERE id IN (?) AND user_id=?", [
        ids,
        userId,
      ]);

    // Stock validation
    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      if (!p) {
        return res.status(400).json({ message: "Product not found" });
      }
      if (p.stock < item.qty) {
        return res.status(400).json({
          message: `Low stock for "${p.name}". Only ${p.stock} left.`,
        });
      }
    }

    let subTotal = 0;

    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      const price = item.custom_price || p.price;
      subTotal += price * item.qty;
    }

    const gstAmount = (subTotal * GST) / 100;
    const discountAmt = Number(discount) || 0;
    const finalTotal = subTotal + gstAmount - discountAmt;
    const invoiceNumber = "INV-" + Date.now();

    // Insert invoice
    const [invoiceResult] = await db.promise().query(
      `INSERT INTO invoices
      (invoice_number, customer_name, customer_mobile,
       sub_total, gst_percent, gst_amount, discount,
       final_total, payment_mode, payment_status, user_id)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`,
      [
        invoiceNumber,
        customer_name,
        customer_mobile || null,
        subTotal,
        GST,
        gstAmount,
        discountAmt,
        finalTotal,
        payment_mode,
        userId,
      ],
    );

    const invoiceId = invoiceResult.insertId;

    // Insert items & update stock
    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      const price = item.custom_price || p.price;

      await db.promise().query(
        `INSERT INTO invoice_items
        (invoice_id, product_id, qty, price, grams, user_id)
        VALUES (?,?,?,?,?,?)`,
        [invoiceId, p.id, item.qty, price, item.grams || p.grams, userId],
      );

      await db
        .promise()
        .query(
          "UPDATE products SET stock = stock - ? WHERE id=? AND user_id=?",
          [item.qty, p.id, userId],
        );
    }

    // Auto mark cash as paid
    if (payment_mode === "cash") {
      await db
        .promise()
        .query(
          "UPDATE invoices SET payment_status='paid' WHERE id=? AND user_id=?",
          [invoiceId, userId],
        );
    }

    res.json({
      message: "Invoice created",
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      final_total: finalTotal,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── COMPLETE PAYMENT ─────────────────────────────────── */
router.post("/complete", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoice_id } = req.body;

    await db
      .promise()
      .query(
        "UPDATE invoices SET payment_status='paid' WHERE id=? AND user_id=?",
        [invoice_id, userId],
      );

    res.json({ message: "Payment completed" });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CANCEL INVOICE ───────────────────────────────────── */
router.post("/cancel", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { invoice_id } = req.body;

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

module.exports = router;
