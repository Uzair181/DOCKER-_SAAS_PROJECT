const express = require("express");

const app = express();
app.use(express.json());

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:4002";

const forwardToUserService = async (req, res, next) => {
  try {
    const url = new URL(req.originalUrl.replace(/^\/products/, "/products"), USER_SERVICE_URL);
    const response = await fetch(url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(req.headers["x-user-id"] ? { "x-user-id": req.headers["x-user-id"] } : {}),
        ...(req.headers["x-user-role"] ? { "x-user-role": req.headers["x-user-role"] } : {}),
      },
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    res.status(response.status);

    if (text) {
      res.type("application/json").send(text);
    } else {
      res.end();
    }
  } catch (error) {
    next(error);
  }
};

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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "product-service",
    mode: "proxy",
  });
});

app.use(requireWriteRole);
app.use("/products", forwardToUserService);

app.use((error, req, res, next) => {
  console.error("product-service error", error);
  res.status(500).json({
    error: "Unexpected product service error",
  });
});

app.listen(process.env.PORT || 4003, () => {
  console.log("Product service running on 4003");
});
