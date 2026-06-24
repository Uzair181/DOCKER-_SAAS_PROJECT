const express = require("express");
const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  deletedAt: user.deletedAt,
});

const parseRole = (role) => {
  const normalized = String(role || "user").toUpperCase();
  return ["ADMIN", "MANAGER", "USER"].includes(normalized) ? normalized : "USER";
};

const writeAudit = async (action, entityId, actorId, metadata) => {
  await prisma.auditLog.create({
    data: {
      action,
      entityType: "User",
      entityId,
      actorId: actorId || null,
      metadata: metadata || {},
    },
  });
};

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "user-service",
  });
});

app.post("/users", async (req, res) => {
  try {
    const { id, name, email, role } = req.body;
    const missing = ["name", "email"].filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const user = await prisma.user.create({
      data: {
        ...(id ? { id: String(id) } : {}),
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        role: parseRole(role),
      },
    });

    await writeAudit("USER_CREATED", user.id, req.header("x-user-id"), {
      email: user.email,
      role: user.role,
    });

    return res.status(201).json(publicUser(user));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "User email already exists" });
    }

    return res.status(500).json({
      error: "Unable to create user",
      details: error.message,
    });
  }
});

app.get("/users", async (req, res) => {
  try {
    const includeDeleted = String(req.query.includeDeleted || "false") === "true";

    const users = await prisma.user.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return res.json(users.map(publicUser));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to fetch users",
      details: error.message,
    });
  }
});

app.get("/users/:id", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!user || user.deletedAt) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(publicUser(user));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to fetch user",
      details: error.message,
    });
  }
});

app.patch("/users/:id", async (req, res) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.deletedAt) {
      return res.status(404).json({ error: "User not found" });
    }

    const nextData = {};

    if (req.body.name !== undefined) {
      nextData.name = String(req.body.name).trim();
    }

    if (req.body.email !== undefined) {
      nextData.email = String(req.body.email).trim().toLowerCase();
    }

    if (req.body.role !== undefined) {
      nextData.role = parseRole(req.body.role);
    }

    if (Object.keys(nextData).length === 0) {
      return res.status(400).json({
        error: "At least one field must be provided for update",
      });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: nextData,
    });

    await writeAudit("USER_UPDATED", user.id, req.header("x-user-id"), {
      before: publicUser(existing),
      after: publicUser(user),
    });

    return res.json(publicUser(user));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "User email already exists" });
    }

    return res.status(500).json({
      error: "Unable to update user",
      details: error.message,
    });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.deletedAt) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        deletedAt: new Date(),
      },
    });

    await writeAudit("USER_DELETED", user.id, req.header("x-user-id"), {
      deletedAt: user.deletedAt,
    });

    return res.json({
      message: "User soft deleted",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to delete user",
      details: error.message,
    });
  }
});

app.use((error, req, res, next) => {
  console.error("user-service error", error);
  res.status(500).json({
    error: "Unexpected user service error",
  });
});

app.listen(process.env.PORT || 4002, () => {
  console.log("User service running on 4002");
});
