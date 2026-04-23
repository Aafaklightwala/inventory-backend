// invoices.routes.js — with PDF download, proforma convert, and full CRUD
//
// ── SETUP (run once in your project root) ──────────────────
//    npm install pdfkit
// ──────────────────────────────────────────────────────────
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/auth");
const PDFDocument = require("pdfkit");

const GST = 5;

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */
function fmtMoney(n) {
  return "Rs. " + parseFloat(n || 0).toFixed(2);
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ────────────────────────────────────────────────────────────
   generateInvoicePDF(doc, invoice, items, company)
──────────────────────────────────────────────────────────── */
function generateInvoicePDF(doc, invoice, items, company) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const ml = 40;
  const mr = 40;
  const cw = pageW - ml - mr;

  const isProforma = invoice.invoice_type === "proforma";

  const ORANGE = "#FF6B00";
  const PURPLE = "#7C3AED";
  const DARK = "#111111";
  const MID = "#555555";
  const BORDER = "#E5E7EB";
  const GREEN = "#16A34A";
  const accent = isProforma ? PURPLE : ORANGE;

  /* ── HEADER BAND ──────────────────────────────────────── */
  doc.rect(0, 0, pageW, 110).fill(accent);

  // Company name + details (left)
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(company.name || "Your Business", ml, 26, { width: cw * 0.56 });

  const compLines = [
    company.address,
    [company.city, company.state, company.pincode].filter(Boolean).join(", "),
    company.phone ? "Ph: " + company.phone : null,
    company.gstin ? "GSTIN: " + company.gstin : null,
  ].filter(Boolean);

  doc.font("Helvetica").fontSize(8.5).fillColor("rgba(255,255,255,0.88)");
  let compY = 52;
  compLines.forEach((ln) => {
    doc.text(ln, ml, compY, { width: cw * 0.56 });
    compY += 12;
  });

  // Invoice type + number (right)
  const rx = ml + cw * 0.6;
  const rw = cw * 0.4;
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("white")
    .text(isProforma ? "PROFORMA" : "TAX INVOICE", rx, 24, {
      width: rw,
      align: "right",
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("rgba(255,255,255,0.88)")
    .text(invoice.invoice_number, rx, 54, { width: rw, align: "right" });

  const statusClr =
    invoice.payment_status === "paid"
      ? "#4ADE80"
      : invoice.payment_status === "cancelled"
        ? "#F87171"
        : "#FCD34D";

  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(statusClr)
    .text((invoice.payment_status || "PENDING").toUpperCase(), rx, 70, {
      width: rw,
      align: "right",
    });

  /* ── INFO BOXES ───────────────────────────────────────── */
  let y = 122;
  const boxH = 100;
  const gap = 8;
  const bw = (cw - gap * 2) / 3;

  const drawBox = (title, lines, bx) => {
    doc.save();
    doc.roundedRect(bx, y, bw, boxH, 6).fillAndStroke("#FAFAFA", BORDER);
    doc
      .fillColor(accent)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(title, bx + 10, y + 10, { width: bw - 20 });
    doc
      .fillColor(DARK)
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(lines[0] || "", bx + 10, y + 23, { width: bw - 20 });
    doc.fillColor(MID).font("Helvetica").fontSize(8.5);
    lines.slice(1).forEach((ln, i) => {
      if (ln) doc.text(ln, bx + 10, y + 38 + i * 13, { width: bw - 20 });
    });
    doc.restore();
  };

  drawBox(
    "BILL TO",
    [
      invoice.customer_name || "Walk-in Customer",
      invoice.customer_mobile ? "Ph: " + invoice.customer_mobile : "",
      invoice.customer_address || "",
    ],
    ml,
  );

  drawBox(
    "INVOICE DETAILS",
    [
      invoice.invoice_number,
      "Date: " + fmtDate(invoice.created_at),
      "Payment: " + (invoice.payment_mode || "Cash"),
      "Type: " + (isProforma ? "Proforma Invoice" : "GST Invoice"),
    ],
    ml + bw + gap,
  );

  drawBox(
    "FROM",
    [
      company.name || "Your Business",
      company.email || "",
      company.website || "",
      company.gstin ? "GSTIN: " + company.gstin : "",
    ],
    ml + (bw + gap) * 2,
  );

  y += boxH + 18;

  /* ── ITEMS TABLE ──────────────────────────────────────── */
  const COL = {
    no: 32,
    qty: 44,
    rate: 82,
    disc: 58,
    total: 82,
  };
  COL.name = cw - COL.no - COL.qty - COL.rate - COL.disc - COL.total;

  const colXs = [
    ml,
    ml + COL.no,
    ml + COL.no + COL.name,
    ml + COL.no + COL.name + COL.qty,
    ml + COL.no + COL.name + COL.qty + COL.rate,
    ml + COL.no + COL.name + COL.qty + COL.rate + COL.disc,
  ];
  const colWs = [COL.no, COL.name, COL.qty, COL.rate, COL.disc, COL.total];
  const aligns = ["center", "left", "center", "right", "right", "right"];
  const hdrs = ["#", "PRODUCT / DESCRIPTION", "QTY", "RATE", "DISC.", "AMOUNT"];

  // Header
  const thH = 26;
  doc.rect(ml, y, cw, thH).fill(accent);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
  hdrs.forEach((h, i) => {
    doc.text(h, colXs[i] + 4, y + 9, { width: colWs[i] - 8, align: aligns[i] });
  });
  y += thH;

  // Rows
  let subTotal = 0;
  items.forEach((item, idx) => {
    const qty = parseFloat(item.qty || 0);
    const rate = parseFloat(item.unit_price || item.price || 0);
    const rowTotal = qty * rate;
    subTotal += rowTotal;

    const rowH = 26;
    const rowBg = idx % 2 === 0 ? "#FFFFFF" : "#F9FAFB";

    doc.rect(ml, y, cw, rowH).fill(rowBg);

    const cells = [
      String(idx + 1),
      item.name || "Item",
      String(qty),
      fmtMoney(rate),
      item.discount ? fmtMoney(item.discount) : "—",
      fmtMoney(rowTotal),
    ];
    doc.fillColor(DARK).font("Helvetica").fontSize(9);
    cells.forEach((val, i) => {
      doc.text(val, colXs[i] + 4, y + 8, {
        width: colWs[i] - 8,
        align: aligns[i],
      });
    });

    doc
      .moveTo(ml, y + rowH)
      .lineTo(ml + cw, y + rowH)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    y += rowH;
  });

  // Table bottom border
  doc
    .moveTo(ml, y)
    .lineTo(ml + cw, y)
    .strokeColor(accent)
    .lineWidth(1.5)
    .stroke();

  /* ── TOTALS ───────────────────────────────────────────── */
  y += 14;
  const totX = ml + cw * 0.56;
  const totW = cw * 0.44;

  // Background for totals block
  const gstAmt = isProforma ? 0 : parseFloat(invoice.gst_amount || 0);
  const discAmt = parseFloat(invoice.discount || 0);
  const tRows = 2 + (gstAmt > 0 || isProforma ? 1 : 0) + (discAmt > 0 ? 1 : 0);
  doc
    .roundedRect(totX, y - 6, totW, tRows * 22 + 38, 6)
    .fill("#FAFAFA")
    .stroke(BORDER);

  const totRow = (label, val, bold = false, valClr = DARK) => {
    doc
      .fillColor(bold ? DARK : MID)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .text(label, totX + 12, y + 4, { width: totW * 0.52 });
    doc
      .fillColor(valClr)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .text(val, totX + 12, y + 4, { width: totW - 24, align: "right" });
    y += 22;
  };

  totRow("Subtotal", fmtMoney(subTotal));

  if (!isProforma && gstAmt > 0) {
    totRow(`GST (${invoice.gst_percent || GST}%)`, fmtMoney(gstAmt));
  } else if (isProforma) {
    totRow("GST", "Not Applied", false, PURPLE);
  }

  if (discAmt > 0) {
    totRow("Discount", "- " + fmtMoney(discAmt), false, GREEN);
  }

  // Grand total
  y += 4;
  doc.roundedRect(totX, y, totW, 32, 6).fill(accent);
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("TOTAL PAYABLE", totX + 12, y + 10);
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(fmtMoney(invoice.final_total), totX + 12, y + 10, {
      width: totW - 24,
      align: "right",
    });
  y += 32;

  /* ── NOTES + SIGNATURE ────────────────────────────────── */
  const notesY = Math.max(y + 20, pageH - 120);

  const halfW = (cw - 10) / 2;

  // Notes
  doc.save();
  doc.roundedRect(ml, notesY, halfW, 72, 6).fillAndStroke("#FAFAFA", BORDER);
  doc
    .fillColor(accent)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("NOTES", ml + 12, notesY + 10);
  doc
    .fillColor(MID)
    .font("Helvetica")
    .fontSize(8)
    .text(
      isProforma
        ? "This is a Proforma Invoice. GST has not been charged. Final invoice will be issued upon confirmation."
        : "Thank you for your business!\nPayment is due within 30 days.",
      ml + 12,
      notesY + 24,
      { width: halfW - 24 },
    );
  doc.restore();

  // Authorised signature
  const sigX = ml + halfW + 10;
  doc.save();
  doc.roundedRect(sigX, notesY, halfW, 72, 6).fillAndStroke("#FAFAFA", BORDER);
  doc
    .fillColor(accent)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      "FOR " + (company.name || "YOUR BUSINESS").toUpperCase(),
      sigX + 12,
      notesY + 10,
      { width: halfW - 24 },
    );
  doc
    .moveTo(sigX + 12, notesY + 56)
    .lineTo(sigX + halfW - 12, notesY + 56)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();
  doc
    .fillColor(MID)
    .font("Helvetica")
    .fontSize(8)
    .text("Authorised Signatory", sigX + 12, notesY + 58, {
      width: halfW - 24,
    });
  doc.restore();

  /* ── FOOTER BAND ──────────────────────────────────────── */
  doc.rect(0, pageH - 28, pageW, 28).fill(accent);
  const footerTxt = [company.name, company.email, company.website]
    .filter(Boolean)
    .join("  ·  ");
  doc
    .fillColor("rgba(255,255,255,0.85)")
    .font("Helvetica")
    .fontSize(8)
    .text(footerTxt, ml, pageH - 17, { width: cw, align: "center" });
}

/* ════════════════════════════════════════════════════════════
   ROUTES
════════════════════════════════════════════════════════════ */

/* ── GET ALL ──────────────────────────────────── */
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

/* ── EXPORT BY DATE (must be before /:id) ─────── */
router.get("/export", auth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end)
      return res.status(400).json({ message: "Start and End date required" });
    const [invoices] = await db.promise().query(
      `SELECT * FROM invoices WHERE user_id=?
       AND DATE(created_at) BETWEEN ? AND ? ORDER BY id DESC`,
      [req.user.id, start, end],
    );
    res.json(invoices);
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── DOWNLOAD PDF ─────────────────────────────── */
router.get("/:id/download", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const invoiceId = req.params.id;

    const [invRows] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [
        invoiceId,
        userId,
      ]);
    if (!invRows.length)
      return res.status(404).json({ message: "Invoice not found" });
    const invoice = invRows[0];

    const [items] = await db.promise().query(
      `SELECT ii.*, p.name, ii.price, ii.qty
       FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id=? AND ii.user_id=?`,
      [invoiceId, userId],
    );

    const [userRows] = await db
      .promise()
      .query("SELECT * FROM users WHERE id=?", [userId]);
    const user = userRows[0] || {};
    const company = {
      name:
        user.company_name ||
        user.first_name + " " + user.last_name ||
        "Your Business",
      address: user.address || "",
      city: user.city || "",
      state: user.state || "",
      pincode: user.pincode || "",
      phone: user.mobile || "",
      email: user.email || "",
      gstin: user.gst_number || "",
      website: user.website || "",
    };

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Invoice ${invoice.invoice_number}`,
        Author: company.name,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${invoice.invoice_number}.pdf"`,
    );
    doc.pipe(res);

    generateInvoicePDF(doc, invoice, items, company);
    doc.end();
  } catch (err) {
    console.error("PDF error:", err);
    res
      .status(500)
      .json({ message: "PDF generation failed", error: err.message });
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
    const sub = parseFloat(inv.sub_total);
    const gst = (sub * GST) / 100;
    const disc = parseFloat(inv.discount) || 0;
    const total = sub + gst - disc;
    const newNum = "INV-" + Date.now();

    await db.promise().query(
      `UPDATE invoices SET invoice_number=?, invoice_type='gst',
       gst_percent=?, gst_amount=?, final_total=?, payment_status='pending'
       WHERE id=? AND user_id=?`,
      [newNum, GST, gst, total, invoiceId, userId],
    );
    res.json({
      message: "Converted",
      invoice_id: invoiceId,
      new_invoice_number: newNum,
      gst_amount: gst,
      final_total: total,
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ── CANCEL ───────────────────────────────────── */
router.post("/cancel", auth, async (req, res) => {
  try {
    const { invoice_id } = req.body;
    const userId = req.user.id;
    const [inv] = await db
      .promise()
      .query("SELECT * FROM invoices WHERE id=? AND user_id=?", [
        invoice_id,
        userId,
      ]);
    if (!inv.length) return res.status(404).json({ message: "Not found" });
    if (inv[0].payment_status === "cancelled")
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
    res.json({ message: "Cancelled & stock restored" });
  } catch (err) {
    res.status(500).json(err);
  }
});

router.put("/:id/order-status", auth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "processing", "shipped", "completed"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    // Make sure the invoice belongs to this user
    const [rows] = await db
      .promise()
      .query("SELECT id FROM invoices WHERE id=? AND user_id=?", [
        req.params.id,
        req.user.id,
      ]);

    if (!rows.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    await db
      .promise()
      .query("UPDATE invoices SET order_status=? WHERE id=? AND user_id=?", [
        status,
        req.params.id,
        req.user.id,
      ]);

    // Also update the linked online_order if exists
    await db.promise().query(
      `UPDATE online_orders 
       SET status = ?
       WHERE invoice_id = ? AND user_id = ?`,
      [status, req.params.id, req.user.id],
    );

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (err) {
    console.error("Update order status error:", err);
    res
      .status(500)
      .json({ message: "Error updating status", error: err.message });
  }
});

module.exports = router;
