require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./config/db");
const dashboardRoutes = require("./routes/dashboard");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/products", require("./routes/products"));
app.use("/api/billing", require("./routes/billing"));
app.use("/api/invoices", require("./routes/invoices"));
app.use("/api/dashboard", dashboardRoutes);

app.get("/", (req, res) => {
  res.send("Inventory Backend Running");
});

app.listen(process.env.PORT, () => {
  console.log("Server running on port", process.env.PORT);
});
