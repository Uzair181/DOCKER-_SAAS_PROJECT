const crypto = require("crypto");
const express = require("express");

const app = express();
app.use(express.json());

const products = new Map();

const publicProduct = (product) => ({
  id: product.id,
  name: product.name,
  description: product.description,
  price: product.price,
  stock: product.stock,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  deletedAt: product.deletedAt,
});

const requireWriteRole = (req, res, next) => {
  if (req.method === "GET") {
    return next();
  }

  const role = String(req.header("x-user-role") || "user").toLowerCase();
  if (!["admin", "manager"].includes(role)) {
    return res.status(403).json({ error: "Insufficient role for product writes" });
  }

  return next();
};

app.use(requireWriteRole);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "product-service",
    products: products.size,
  });
});

app.get("/products", (req, res) => {
  const includeDeleted = String(req.query.includeDeleted || "false") === "true";
  const result = Array.from(products.values())
    .filter((product) => includeDeleted || !product.deletedAt)
    .map(publicProduct);

  res.json(result);
});

app.get("/products/:id", (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.deletedAt) {
    return res.status(404).json({ error: "Product not found" });
  }

  return res.json(publicProduct(product));
});

app.post("/products", (req, res) => {
  const missing = ["name", "price"].filter((field) => {
    const value = req.body[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(", ")}`,
    });
  }

  const id = crypto.randomUUID();
  const product = {
    id,
    name: String(req.body.name).trim(),
    description: String(req.body.description || "").trim(),
    price: Number(req.body.price),
    stock: Number(req.body.stock || 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };

  if (Number.isNaN(product.price)) {
    return res.status(400).json({ error: "price must be a number" });
  }

  if (Number.isNaN(product.stock)) {
    return res.status(400).json({ error: "stock must be a number" });
  }

  products.set(id, product);
  return res.status(201).json(publicProduct(product));
});

app.patch("/products/:id", (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.deletedAt) {
    return res.status(404).json({ error: "Product not found" });
  }

  if (req.body.name !== undefined) {
    product.name = String(req.body.name).trim();
  }

  if (req.body.description !== undefined) {
    product.description = String(req.body.description).trim();
  }

  if (req.body.price !== undefined) {
    const price = Number(req.body.price);
    if (Number.isNaN(price)) {
      return res.status(400).json({ error: "price must be a number" });
    }
    product.price = price;
  }

  if (req.body.stock !== undefined) {
    const stock = Number(req.body.stock);
    if (Number.isNaN(stock)) {
      return res.status(400).json({ error: "stock must be a number" });
    }
    product.stock = stock;
  }

  product.updatedAt = new Date().toISOString();
  products.set(product.id, product);

  return res.json(publicProduct(product));
});

app.delete("/products/:id", (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.deletedAt) {
    return res.status(404).json({ error: "Product not found" });
  }

  product.deletedAt = new Date().toISOString();
  product.updatedAt = new Date().toISOString();
  products.set(product.id, product);

  return res.json({
    message: "Product soft deleted",
    product: publicProduct(product),
  });
});

app.listen(process.env.PORT || 4003, () => {
  console.log("Product service running on 4003");
});
