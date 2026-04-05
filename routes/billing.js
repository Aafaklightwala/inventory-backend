// billing.routes.js — with Proforma Invoice + Reward Points System
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

const GST = 5;
const REWARD_EVERY = 5; // Every 5th visit = free item reward

/* ── CREATE INVOICE (supports proforma + rewards) ─────── */
router.post("/create", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      items,
      payment_mode = "cash",
      customer_name = "Walk-in Customer",
      customer_mobile,
      discount = 0,
      is_proforma = false,
      mark_as_paid = false,
      reward_applied = false,
    } = req.body;

    if (!items || !items.length)
      return res.status(400).json({ message: "No items provided" });

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
      if (!p) return res.status(400).json({ message: "Product not found" });
      if (p.stock < item.qty)
        return res.status(400).json({
          message: `Low stock for "${p.name}". Only ${p.stock} left.`,
        });
    }

    let subTotal = 0;
    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      const price = item.custom_price || p.price;
      subTotal += price * item.qty;
    }

    // Proforma = NO GST
    const gstPercent = is_proforma ? 0 : GST;
    const gstAmount = is_proforma ? 0 : (subTotal * GST) / 100;
    const discountAmt = Number(discount) || 0;
    const finalTotal = subTotal + gstAmount - discountAmt;

    const invoiceType = is_proforma ? "proforma" : "gst";
    const invoicePrefix = is_proforma ? "PRO-" : "INV-";
    const invoiceNumber = invoicePrefix + Date.now();

    // Insert invoice (with reward_applied column)
    const [invoiceResult] = await db.promise().query(
      `INSERT INTO invoices
        (invoice_number, invoice_type, customer_name, customer_mobile,
         sub_total, gst_percent, gst_amount, discount,
         final_total, payment_mode, payment_status, reward_applied, user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      [
        invoiceNumber,
        invoiceType,
        customer_name,
        customer_mobile || null,
        subTotal,
        gstPercent,
        gstAmount,
        discountAmt,
        finalTotal,
        payment_mode,
        reward_applied ? 1 : 0,
        userId,
      ],
    );

    const invoiceId = invoiceResult.insertId;

    // Insert items & deduct stock
    for (const item of items) {
      const p = products.find((x) => x.id === item.product_id);
      const price = item.custom_price || p.price;

      await db.promise().query(
        `INSERT INTO invoice_items (invoice_id, product_id, qty, price, grams, user_id)
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

    // Auto-mark paid: cash GST always; proforma only if user chose mark_as_paid
    const shouldMarkPaid =
      (!is_proforma && payment_mode === "cash") ||
      (is_proforma && mark_as_paid);
    if (shouldMarkPaid) {
      await db
        .promise()
        .query(
          "UPDATE invoices SET payment_status='paid' WHERE id=? AND user_id=?",
          [invoiceId, userId],
        );
    }

    /* ══════════════════════════════════════════════════════
       REWARD POINTS LOGIC
       Only runs if customer provided a 10-digit mobile number.
       Walk-in customers without mobile skip reward tracking.
    ══════════════════════════════════════════════════════ */
    let rewardEligible = false;
    let currentVisits = 0;
    let visitsUntilReward = REWARD_EVERY;

    if (customer_mobile && customer_mobile.trim().length >= 10) {
      const mobile = customer_mobile.trim();

      // Check if this customer already exists for this user/business
      const [existing] = await db
        .promise()
        .query("SELECT * FROM customer_rewards WHERE mobile=? AND user_id=?", [
          mobile,
          userId,
        ]);

      if (existing.length === 0) {
        // First ever visit — create reward record
        await db.promise().query(
          `INSERT INTO customer_rewards
             (user_id, mobile, customer_name, visits, reward_points, total_visits)
           VALUES (?, ?, ?, 1, 1, 1)`,
          [
            userId,
            mobile,
            customer_name !== "Walk-in Customer" ? customer_name : null,
          ],
        );
        currentVisits = 1;
      } else {
        // Returning customer — increment counters
        const rec = existing[0];
        const newVisits = rec.visits + 1;
        const newPoints = rec.reward_points + 1;
        const newTotalVisits = rec.total_visits + 1;

        // Every REWARD_EVERY visits → trigger reward
        if (newVisits % REWARD_EVERY === 0) {
          rewardEligible = true;
          // Reset visit counter to 0 after reward is triggered
          await db.promise().query(
            `UPDATE customer_rewards
             SET visits          = 0,
                 reward_points   = ?,
                 total_visits    = ?,
                 customer_name   = COALESCE(
                                     NULLIF(?, ''),
                                     customer_name
                                   ),
                 last_visit      = NOW()
             WHERE mobile=? AND user_id=?`,
            [
              newPoints,
              newTotalVisits,
              customer_name !== "Walk-in Customer" ? customer_name : "",
              mobile,
              userId,
            ],
          );
          currentVisits = newVisits;
        } else {
          await db.promise().query(
            `UPDATE customer_rewards
             SET visits          = ?,
                 reward_points   = ?,
                 total_visits    = ?,
                 customer_name   = COALESCE(
                                     NULLIF(?, ''),
                                     customer_name
                                   ),
                 last_visit      = NOW()
             WHERE mobile=? AND user_id=?`,
            [
              newVisits,
              newPoints,
              newTotalVisits,
              customer_name !== "Walk-in Customer" ? customer_name : "",
              mobile,
              userId,
            ],
          );
          currentVisits = newVisits;
        }
      }

      // Calculate how many more visits until next reward
      const visitsInCycle = currentVisits % REWARD_EVERY;
      visitsUntilReward =
        visitsInCycle === 0
          ? 0 // just earned reward this visit
          : REWARD_EVERY - visitsInCycle;
    }

    res.json({
      message: is_proforma ? "Proforma invoice created" : "Invoice created",
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      invoice_type: invoiceType,
      final_total: finalTotal,
      // Reward info sent back to frontend
      reward_eligible: rewardEligible,
      current_visits: currentVisits,
      visits_until_reward: visitsUntilReward,
    });
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json(err);
  }
});

/* ── CHECK REWARD STATUS (called live when mobile is typed) */
router.get("/reward-status/:mobile", auth, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM customer_rewards WHERE mobile=? AND user_id=?", [
        req.params.mobile,
        req.user.id,
      ]);

    if (!rows.length) {
      // Never visited before
      return res.json({
        found: false,
        visits: 0,
        total_visits: 0,
        reward_points: 0,
        visits_until_reward: REWARD_EVERY,
        customer_name: null,
      });
    }

    const r = rows[0];
    const visitsInCycle = r.visits % REWARD_EVERY;
    const visitsUntilReward =
      visitsInCycle === 0 && r.visits > 0
        ? 0 // reward available right now
        : REWARD_EVERY - visitsInCycle;

    res.json({
      found: true,
      visits: r.visits,
      total_visits: r.total_visits,
      reward_points: r.reward_points,
      visits_until_reward: visitsUntilReward,
      customer_name: r.customer_name,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── GET ALL REWARD CUSTOMERS (for reports / dashboard) ── */
router.get("/rewards", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM customer_rewards
         WHERE user_id=?
         ORDER BY total_visits DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CONVERT PROFORMA → GST INVOICE ──────────────────── */
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

    const inv = rows[0];

    if (inv.payment_status === "cancelled")
      return res
        .status(400)
        .json({ message: "Cannot convert a cancelled invoice" });

    const subTotal = parseFloat(inv.sub_total);
    const gstAmount = (subTotal * GST) / 100;
    const discountAmt = parseFloat(inv.discount) || 0;
    const finalTotal = subTotal + gstAmount - discountAmt;
    const newNumber = "INV-" + Date.now();

    await db.promise().query(
      `UPDATE invoices SET
         invoice_number  = ?,
         invoice_type    = 'gst',
         gst_percent     = ?,
         gst_amount      = ?,
         final_total     = ?,
         payment_status  = 'pending'
       WHERE id=? AND user_id=?`,
      [newNumber, GST, gstAmount, finalTotal, invoiceId, userId],
    );

    res.json({
      message: "Proforma converted to GST invoice",
      invoice_id: invoiceId,
      new_invoice_number: newNumber,
      gst_amount: gstAmount,
      final_total: finalTotal,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── PREVIEW ──────────────────────────────────────────── */
router.post("/preview", auth, async (req, res) => {
  try {
    const { items, discount = 0, is_proforma = false } = req.body;
    const userId = req.user.id;

    if (!items || !items.length)
      return res.status(400).json({ message: "No items provided" });

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
      if (!p) return res.status(400).json({ message: "Invalid product" });
      const price = item.custom_price || p.price;
      const lineTotal = price * item.qty;
      subTotal += lineTotal;
      previewItems.push({
        product_id: p.id,
        name: p.name,
        qty: item.qty,
        price,
        line_total: lineTotal,
      });
    }

    const gstAmount = is_proforma ? 0 : (subTotal * GST) / 100;
    const finalTotal = subTotal + gstAmount - Number(discount);

    res.json({
      items: previewItems,
      sub_total: subTotal,
      gst_percent: is_proforma ? 0 : GST,
      gst_amount: gstAmount,
      discount: Number(discount),
      final_total: finalTotal,
      is_proforma,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── COMPLETE PAYMENT ─────────────────────────────────── */
router.post("/complete", auth, async (req, res) => {
  try {
    const { invoice_id } = req.body;
    await db
      .promise()
      .query(
        "UPDATE invoices SET payment_status='paid' WHERE id=? AND user_id=?",
        [invoice_id, req.user.id],
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
