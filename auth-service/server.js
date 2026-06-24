require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:4002";
const JWT_SECRET = process.env.JWT_SECRET || "dev-access-secret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

const usersByEmail = new Map();
const usersById = new Map();
const allowedRoles = new Set(["admin", "manager", "user"]);

const requireFields = (body, fields) => {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  return missing;
};

const publicUser = (record) => ({
  id: record.id,
  name: record.name,
  email: record.email,
  role: record.role,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const issueTokens = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    jwtid: crypto.randomUUID(),
  });

  return { accessToken, refreshToken };
};

const persistProfile = async ({ id, name, email, role }) => {
  await axios.post(`${USER_SERVICE_URL}/users`, {
    id,
    name,
    email,
    role,
  });
};

app.post("/register", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["name", "email", "password"]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const name = String(req.body.name).trim();
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const requestedRole = String(req.body.role || "user").toLowerCase();
    const role = allowedRoles.has(requestedRole) ? requestedRole : "user";

    if (usersByEmail.has(email)) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await persistProfile({ id, name, email, role });

    const record = {
      id,
      name,
      email,
      role,
      passwordHash,
      refreshTokenHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    usersByEmail.set(email, record);
    usersById.set(id, record);

    const tokens = issueTokens(record);
    record.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    record.updatedAt = new Date().toISOString();

    return res.status(201).json({
      user: publicUser(record),
      ...tokens,
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({
        error: error.response.data?.error || "Unable to register user",
      });
    }

    return res.status(500).json({
      error: "Registration failed",
      details: error.message,
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["email", "password"]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const user = usersByEmail.get(email);

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const tokens = issueTokens(user);
    user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    user.updatedAt = new Date().toISOString();

    return res.json({
      user: publicUser(user),
      ...tokens,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Login failed",
      details: error.message,
    });
  }
});

app.post("/refresh", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["refreshToken"]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const refreshToken = String(req.body.refreshToken);
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = usersById.get(payload.sub);

    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const refreshTokenValid = await bcrypt.compare(
      refreshToken,
      user.refreshTokenHash
    );

    if (!refreshTokenValid) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const tokens = issueTokens(user);
    user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS);
    user.updatedAt = new Date().toISOString();

    return res.json({
      user: publicUser(user),
      ...tokens,
    });
  } catch (error) {
    return res.status(401).json({
      error: "Refresh token invalid or expired",
      details: error.message,
    });
  }
});

app.post("/logout", async (req, res) => {
  const refreshToken = String(req.body.refreshToken || "");
  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = usersById.get(payload.sub);

    if (user) {
      user.refreshTokenHash = null;
      user.updatedAt = new Date().toISOString();
    }

    return res.json({ message: "Logged out successfully" });
  } catch (error) {
    return res.json({ message: "Logged out successfully" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "auth-service",
    users: usersByEmail.size,
  });
});

app.listen(process.env.PORT || 4001, () => {
  console.log("Auth service running on port 4001");
});
