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

app.get("/products", async (req, res) => {
  try {
    const includeDeleted = String(req.query.includeDeleted || "false") === "true";

    const products = await prisma.product.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return res.json(products.map(publicProduct));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to fetch products",
      details: error.message,
    });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
    });

    if (!product || product.deletedAt) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json(publicProduct(product));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to fetch product",
      details: error.message,
    });
  }
});

app.post("/products", async (req, res) => {
  try {
    const missing = ["name", "price"].filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const price = Number(req.body.price);
    const stock = req.body.stock === undefined ? 0 : Number(req.body.stock);

    if (Number.isNaN(price)) {
      return res.status(400).json({ error: "price must be a number" });
    }

    if (Number.isNaN(stock)) {
      return res.status(400).json({ error: "stock must be a number" });
    }

    const product = await prisma.product.create({
      data: {
        name: String(req.body.name).trim(),
        description:
          req.body.description === undefined || req.body.description === null
            ? null
            : String(req.body.description).trim(),
        price,
        stock,
      },
    });

    return res.status(201).json(publicProduct(product));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to create product",
      details: error.message,
    });
  }
});

app.patch("/products/:id", async (req, res) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.deletedAt) {
      return res.status(404).json({ error: "Product not found" });
    }

    const nextData = {};

    if (req.body.name !== undefined) {
      nextData.name = String(req.body.name).trim();
    }

    if (req.body.description !== undefined) {
      nextData.description =
        req.body.description === null ? null : String(req.body.description).trim();
    }

    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (Number.isNaN(price)) {
        return res.status(400).json({ error: "price must be a number" });
      }
      nextData.price = price;
    }

    if (req.body.stock !== undefined) {
      const stock = Number(req.body.stock);
      if (Number.isNaN(stock)) {
        return res.status(400).json({ error: "stock must be a number" });
      }
      nextData.stock = stock;
    }

    if (Object.keys(nextData).length === 0) {
      return res.status(400).json({
        error: "At least one field must be provided for update",
      });
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: nextData,
    });

    return res.json(publicProduct(product));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to update product",
      details: error.message,
    });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.deletedAt) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        deletedAt: new Date(),
      },
    });

    return res.json({
      message: "Product soft deleted",
      product: publicProduct(product),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to delete product",
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
