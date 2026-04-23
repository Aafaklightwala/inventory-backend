// routes/onlineOrders.js
// ─────────────────────────────────────────────────────────────
// Receives orders POSTed from the Gamtu website (PHP)
// and stores them in TotalKaro's database under user_id = 6.
// No auth middleware here — PHP calls this as a server-to-server
// request with a shared secret header for security.
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const db = require("../config/db");

// ── Shared secret (set this in your .env file) ───────────────
// In .env: WEBSITE_SYNC_SECRET=your_random_secret_here
// The PHP place_order.php must send the same value in the
// X-Sync-Secret header.
const TOTALKARO_USER_ID = 6; // ← Fixed mapping: all website orders → user 6

/* ═══════════════════════════════════════════════════════════
   POST /api/online-orders
   Called by Gamtu website after each successful order.
═══════════════════════════════════════════════════════════ */
router.post("/", async (req, res) => {
  try {
    // ── Optional secret check (recommended for production) ──
    // const secret = req.headers["x-sync-secret"];
    // if (secret !== process.env.WEBSITE_SYNC_SECRET) {
    //   return res.status(403).json({ message: "Unauthorized sync" });
    // }

    const {
      website_order_id,
      customer_name,
      customer_phone,
      customer_email,
      address,
      payment_mode,
      total,
      items,
    } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ message: "No items provided" });
    }

    // ── 1. Insert into online_orders table ───────────────────
    const [orderResult] = await db.promise().query(
      `INSERT INTO online_orders
         (user_id, website_order_id, customer_name, customer_phone,
          customer_email, address, payment_mode, total,
          source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'website', 'new', NOW())`,
      [
        TOTALKARO_USER_ID,
        website_order_id || null,
        customer_name || "Website Customer",
        customer_phone || null,
        customer_email || null,
        address || "",
        payment_mode || "cod",
        parseFloat(total) || 0,
      ],
    );

    const orderId = orderResult.insertId;

    // ── 2. Insert order items ─────────────────────────────────
    for (const item of items) {
      await db.promise().query(
        `INSERT INTO online_order_items
           (order_id, product_name, quantity, price)
         VALUES (?, ?, ?, ?)`,
        [
          orderId,
          item.product_name || "Unknown Product",
          parseInt(item.qty) || 1,
          parseFloat(item.price) || 0,
        ],
      );
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error("❌ Online order sync error:", err);
    res
      .status(500)
      .json({ message: "Error saving online order", error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/online-orders
   Returns all website orders for user_id = 6 (auth required).
   Used by the Angular dashboard.
═══════════════════════════════════════════════════════════ */
const auth = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    // Security: only return orders that belong to the logged-in user
    const userId = req.user.id;

    const [orders] = await db.promise().query(
      `SELECT o.*,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'product_name', oi.product_name,
                  'quantity',     oi.quantity,
                  'price',        oi.price
                )
              ) AS items
       FROM online_orders o
       LEFT JOIN online_order_items oi ON oi.order_id = o.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.id DESC`,
      [userId],
    );

    // Parse items JSON
    const result = orders.map((o) => ({
      ...o,
      items:
        typeof o.items === "string"
          ? JSON.parse(o.items).filter(Boolean)
          : (o.items || []).filter(Boolean),
    }));

    res.json(result);
  } catch (err) {
    console.error("❌ Get online orders error:", err);
    res
      .status(500)
      .json({ message: "Error fetching orders", error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/online-orders/new-count
   Returns count of 'new' (unseen) orders — used for login popup.
═══════════════════════════════════════════════════════════ */
router.get("/new-count", auth, async (req, res) => {
  try {
    const [[result]] = await db.promise().query(
      `SELECT COUNT(*) as count
       FROM online_orders
       WHERE user_id = ? AND status = 'new'`,
      [req.user.id],
    );
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ message: "Error", error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   PUT /api/online-orders/:id/status
   Update order status: new → processing → shipped → completed
═══════════════════════════════════════════════════════════ */
router.put("/:id/status", auth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = [
      "new",
      "processing",
      "shipped",
      "completed",
      "cancelled",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await db.promise().query(
      `UPDATE online_orders
       SET status = ?
       WHERE id = ? AND user_id = ?`,
      [status, req.params.id, req.user.id],
    );

    res.json({ success: true, message: `Order marked as ${status}` });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating status", error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/online-orders/:id/make-bill
   Creates a TotalKaro invoice from an online order.
   Matches products by name from TotalKaro's products table.
═══════════════════════════════════════════════════════════ */
router.post("/:id/make-bill", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.id;

    // 1. Get the online order
    const [[order]] = await db
      .promise()
      .query(`SELECT * FROM online_orders WHERE id = ? AND user_id = ?`, [
        orderId,
        userId,
      ]);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.invoice_id) {
      return res
        .status(400)
        .json({ message: "Bill already created for this order" });
    }

    // 2. Get order items
    const [orderItems] = await db
      .promise()
      .query(`SELECT * FROM online_order_items WHERE order_id = ?`, [orderId]);

    // 3. Match products from TotalKaro's products table by name
    const invoiceItems = [];
    const unmatchedItems = [];

    for (const item of orderItems) {
      const [products] = await db
        .promise()
        .query(
          `SELECT * FROM products WHERE name LIKE ? AND user_id = ? LIMIT 1`,
          [`%${item.product_name}%`, userId],
        );

      if (products.length > 0) {
        const product = products[0];
        invoiceItems.push({
          product_id: product.id,
          qty: item.quantity,
          custom_price: item.price,
          grams: product.grams || 0,
        });
      } else {
        unmatchedItems.push(item.product_name);
      }
    }

    if (invoiceItems.length === 0) {
      return res.status(400).json({
        message:
          "No matching products found in TotalKaro. Please add products first.",
        unmatched: unmatchedItems,
      });
    }

    // 4. Create invoice using existing billing logic
    const GST = 5;
    const ids = invoiceItems.map((i) => i.product_id);
    const [products] = await db
      .promise()
      .query(`SELECT * FROM products WHERE id IN (?) AND user_id = ?`, [
        ids,
        userId,
      ]);

    let subTotal = 0;
    for (const item of invoiceItems) {
      const p = products.find((x) => x.id === item.product_id);
      if (!p) continue;
      const price = item.custom_price || p.price;
      subTotal += price * item.qty;
    }

    const gstAmount = (subTotal * GST) / 100;
    const finalTotal = subTotal + gstAmount;
    const invoiceNumber = "INV-WEB-" + Date.now();

    const [invoiceResult] = await db.promise().query(
      `INSERT INTO invoices
         (invoice_number, invoice_type, customer_name, customer_mobile,
          sub_total, gst_percent, gst_amount, discount,
          final_total, payment_mode, payment_status,
          source, reward_applied, user_id)
       VALUES (?, 'gst', ?, ?, ?, ?, ?, 0, ?, ?, 'pending', 'website', 0, ?)`,
      [
        invoiceNumber,
        order.customer_name,
        order.customer_phone || null,
        subTotal,
        GST,
        gstAmount,
        finalTotal,
        order.payment_mode || "cod",
        userId,
      ],
    );

    const invoiceId = invoiceResult.insertId;

    // 5. Insert invoice items & deduct stock
    for (const item of invoiceItems) {
      const p = products.find((x) => x.id === item.product_id);
      if (!p) continue;
      const price = item.custom_price || p.price;

      await db.promise().query(
        `INSERT INTO invoice_items (invoice_id, product_id, qty, price, grams, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, p.id, item.qty, price, item.grams || p.grams, userId],
      );

      await db
        .promise()
        .query(
          `UPDATE products SET stock = stock - ? WHERE id = ? AND user_id = ?`,
          [item.qty, p.id, userId],
        );
    }

    // 6. Link invoice back to online order
    await db.promise().query(
      `UPDATE online_orders SET invoice_id = ?, status = 'processing'
       WHERE id = ? AND user_id = ?`,
      [invoiceId, orderId, userId],
    );

    res.json({
      success: true,
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      final_total: finalTotal,
      unmatched: unmatchedItems,
      message:
        unmatchedItems.length > 0
          ? `Bill created. Note: ${unmatchedItems.join(", ")} not found in products.`
          : "Bill created successfully!",
    });
  } catch (err) {
    console.error("❌ Make bill error:", err);
    res
      .status(500)
      .json({ message: "Error creating bill", error: err.message });
  }
});

module.exports = router;
