const crypto = require("crypto");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { RedisClient } = require("./redis-client");

const app = express();
app.use(express.json());

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:4001";
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:4002";
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || "http://localhost:4003";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const JWT_SECRET = process.env.JWT_SECRET || "dev-access-secret";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);

const rateLimits = new Map();
const redis = new RedisClient(REDIS_URL);
let redisAvailable = false;

const base64UrlDecode = (value) => Buffer.from(value, "base64url").toString("utf8");

const verifyJwt = (token, secret) => {
  const parts = String(token).split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signaturePart, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart));
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
};

const sendJsonError = (res, statusCode, message) =>
  res.status(statusCode).json({ error: message });

const getClientId = (req) => {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
};

const rateLimit = (req, res, next) => {
  if (req.path === "/health") {
    return next();
  }

  return (async () => {
    const clientId = getClientId(req);

    if (redisAvailable) {
      const key = `rate-limit:${clientId}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
      }

      if (current > RATE_LIMIT_MAX) {
        return sendJsonError(res, 429, "Too many requests");
      }

      return next();
    }

    const now = Date.now();
    const current = rateLimits.get(clientId);

    if (!current || current.resetAt <= now) {
      rateLimits.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (current.count >= RATE_LIMIT_MAX) {
      return sendJsonError(res, 429, "Too many requests");
    }

    current.count += 1;
    return next();
  })().catch((error) => {
    console.error("Redis rate-limit fallback", error.message);
    redisAvailable = false;
    return rateLimit(req, res, next);
  });
};

const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(
      JSON.stringify({
        service: "gateway",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
        userId: req.user?.sub || null,
        role: req.user?.role || null,
      })
    );
  });

  next();
};

const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return sendJsonError(res, 401, "Missing bearer token");
    }

    req.user = verifyJwt(token, JWT_SECRET);
    req.headers["x-user-id"] = req.user.sub;
    req.headers["x-user-email"] = req.user.email || "";
    req.headers["x-user-role"] = req.user.role || "user";

    return next();
  } catch (error) {
    return sendJsonError(res, 401, error.message || "Unauthorized");
  }
};

const requireProductWriteAccess = (req, res, next) => {
  if (req.method === "GET") {
    return next();
  }

  const role = String(req.headers["x-user-role"] || "user").toLowerCase();
  if (!["admin", "manager"].includes(role)) {
    return sendJsonError(res, 403, "Insufficient role for product changes");
  }

  return next();
};

const validateAuthBody = (req, res, next) => {
  if (req.method === "POST" && req.path === "/register") {
    const required = ["name", "email", "password"];
    const missing = required.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missing.length > 0) {
      return sendJsonError(
        res,
        400,
        `Missing required fields: ${missing.join(", ")}`
      );
    }
  }

  if (req.method === "POST" && req.path === "/login") {
    const required = ["email", "password"];
    const missing = required.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missing.length > 0) {
      return sendJsonError(
        res,
        400,
        `Missing required fields: ${missing.join(", ")}`
      );
    }
  }

  return next();
};

const validateProductBody = (req, res, next) => {
  if (req.method === "POST" && req.path === "/") {
    const required = ["name", "price"];
    const missing = required.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missing.length > 0) {
      return sendJsonError(
        res,
        400,
        `Missing required fields: ${missing.join(", ")}`
      );
    }
  }

  if (req.method === "PATCH" && req.path.match(/^\/[^/]+$/)) {
    const hasAny =
      req.body.name !== undefined ||
      req.body.description !== undefined ||
      req.body.price !== undefined ||
      req.body.stock !== undefined;

    if (!hasAny) {
      return sendJsonError(
        res,
        400,
        "At least one field must be provided for product update"
      );
    }
  }

  return next();
};

app.use(rateLimit);
app.use(requestLogger);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "gateway",
    routes: ["/api/auth", "/api/users", "/api/products"],
  });
});

app.use(
  "/api/auth",
  validateAuthBody,
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/auth": "" },
  })
);

app.use(
  "/api/users",
  requireAuth,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/users": "/users" },
  })
);

app.use(
  "/api/products",
  requireAuth,
  requireProductWriteAccess,
  validateProductBody,
  createProxyMiddleware({
    target: PRODUCT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/products": "/products" },
  })
);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

app.listen(process.env.PORT || 4000, () => {
  console.log("API Gateway running on port 4000");
});

redis
  .ping()
  .then(() => {
    redisAvailable = true;
    console.log("Redis-backed rate limiting enabled");
  })
  .catch((error) => {
    redisAvailable = false;
    console.log(`Redis unavailable, falling back to memory: ${error.message}`);
  });
