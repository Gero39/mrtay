const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const crypto = require("node:crypto");

const express = require("express");
const multer = require("multer");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "dev");

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ARCHIVES_DIR = path.join(DATA_DIR, "archives");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const ensureDirsAndDb = async () => {
  if (!fssync.existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  if (!fssync.existsSync(UPLOADS_DIR)) {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }
  if (!fssync.existsSync(ARCHIVES_DIR)) {
    await fs.mkdir(ARCHIVES_DIR, { recursive: true });
  }
  if (!fssync.existsSync(DB_FILE)) {
    const initial = {
      menu: [],
      promos: [],
      orders: [],
      categories: [],
      settings: {
        nav: {
          allCategoryEnabled: true,
          allCategoryPosition: "top",
          shuffleAll: true,
        },
      },
    };
    await fs.writeFile(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
};

const readDb = async () => {
  const raw = await fs.readFile(DB_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid db.json");
  }
  parsed.menu ||= [];
  parsed.promos ||= [];
  parsed.orders ||= [];
  parsed.categories ||= [];
  parsed.settings ||= {};
  parsed.settings.nav ||= {};
  parsed.settings.nav.allCategoryEnabled =
    parsed.settings.nav.allCategoryEnabled !== undefined ? Boolean(parsed.settings.nav.allCategoryEnabled) : true;
  parsed.settings.nav.allCategoryPosition =
    parsed.settings.nav.allCategoryPosition === "bottom" ? "bottom" : "top";
  parsed.settings.nav.shuffleAll =
    parsed.settings.nav.shuffleAll !== undefined ? Boolean(parsed.settings.nav.shuffleAll) : true;
  return parsed;
};

const writeDbAtomic = async (db) => {
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_FILE);
};

let writeQueue = Promise.resolve();
const updateDb = async (mutator) => {
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDbAtomic(db);
    return result;
  });
  return writeQueue;
};

const requireAdmin = (req, res, next) => {
  const header = req.get("authorization") || "";
  const tokenFromBearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const tokenFromHeader = req.get("x-admin-token") || "";
  const token = tokenFromBearer || tokenFromHeader;

  if (token && token === ADMIN_TOKEN) {
    next();
    return;
  }

  res.status(401).json({ error: "unauthorized" });
};

const validateStatus = (value) => {
  const allowed = new Set(["incoming", "cancelled", "delivered"]);
  return allowed.has(value);
};

const normalizeCategory = (value) => String(value || "").trim();

const asMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.round(num);
};

const normalizeMenuOptions = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const out = [];
  for (const raw of value) {
    const label = String(raw?.label ?? raw?.name ?? "").trim();
    const price = asMoney(raw?.price);
    if (!label || price === null || price < 0) {
      continue;
    }

    const id = String(raw?.id || "").trim() || crypto.randomUUID();
    out.push({ id, label, price });
  }

  return out;
};

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    const safeExt = ext && /^[a-z0-9.]+$/i.test(ext) ? ext : "";
    cb(null, `${Date.now()}_${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.use("/uploads", express.static(UPLOADS_DIR));
app.use((req, res, next) => {
  const blocked =
    req.path === "/server.js" ||
    req.path === "/package.json" ||
    req.path === "/package-lock.json" ||
    req.path.startsWith("/data/") ||
    req.path === "/data" ||
    req.path.startsWith("/node_modules/") ||
    req.path === "/node_modules" ||
    req.path.startsWith("/.vscode/") ||
    req.path === "/.vscode";

  if (blocked) {
    res.status(404).end();
    return;
  }

  next();
});

app.use(express.static(__dirname));

// Public API
app.get("/api/public/menu", async (_req, res) => {
  const db = await readDb();
  res.json(db.menu.filter((item) => item.active));
});

app.get("/api/public/promos", async (_req, res) => {
  const db = await readDb();
  res.json(db.promos.filter((promo) => promo.active));
});

app.get("/api/public/categories", async (_req, res) => {
  const db = await readDb();
  res.json(db.categories);
});

app.get("/api/public/settings", async (_req, res) => {
  const db = await readDb();
  res.json({ nav: db.settings.nav });
});

app.post("/api/public/orders", async (req, res) => {
  const payload = req.body || {};
  const customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const address = String(customer.address || "").trim();
  const comment = String(customer.comment || "").trim();

  if (!name || !phone || !address) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  if (items.length === 0) {
    res.status(400).json({ error: "empty_items" });
    return;
  }

  const order = await updateDb(async (db) => {
    const menuById = new Map(db.menu.map((m) => [m.id, m]));
    const normalizedItems = [];

    for (const item of items) {
      const id = String(item?.id || "");
      const requestedOptionId = String(item?.optionId || "").trim();
      const quantity = Number(item?.quantity || 0);
      if (!id || !Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }

      const menuItem = menuById.get(id);
      if (!menuItem || !menuItem.active) {
        continue;
      }

      const options = Array.isArray(menuItem.options) ? menuItem.options : [];
      let optionId = "";
      let optionLabel = "";
      let unitPrice = Number(menuItem.price) || 0;

      if (options.length > 0) {
        const picked = requestedOptionId
          ? options.find((o) => String(o?.id || "") === requestedOptionId)
          : options[0];
        if (!picked) {
          continue;
        }

        const optPrice = asMoney(picked.price);
        if (optPrice === null || optPrice < 0) {
          continue;
        }

        optionId = String(picked.id || "").trim();
        optionLabel = String(picked.label || "").trim();
        unitPrice = optPrice;
      }

      normalizedItems.push({
        id: menuItem.id,
        name: menuItem.title,
        optionId,
        optionLabel,
        price: unitPrice,
        quantity: Math.min(99, Math.floor(quantity)),
      });
    }

    if (normalizedItems.length === 0) {
      return null;
    }

    const total = normalizedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const createdAt = new Date().toISOString();
    const newOrder = {
      id: crypto.randomUUID(),
      status: "incoming",
      customer: { name, phone, address, comment },
      items: normalizedItems,
      total,
      createdAt,
      updatedAt: createdAt,
    };

    db.orders.unshift(newOrder);
    return newOrder;
  });

  if (!order) {
    res.status(400).json({ error: "invalid_items" });
    return;
  }

  res.json({ id: order.id, status: order.status, total: order.total });
});

// Admin API (token protected)
app.get("/api/admin/menu", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.menu);
});

app.get("/api/admin/categories", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.categories);
});

app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json({ nav: db.settings.nav });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const nav = payload.nav || {};

  const next = await updateDb(async (db) => {
    const current = db.settings?.nav || {};
    const allCategoryEnabled =
      nav.allCategoryEnabled !== undefined ? Boolean(nav.allCategoryEnabled) : current.allCategoryEnabled;
    const shuffleAll = nav.shuffleAll !== undefined ? Boolean(nav.shuffleAll) : current.shuffleAll;
    const allCategoryPosition =
      nav.allCategoryPosition !== undefined ? String(nav.allCategoryPosition || "").trim() : current.allCategoryPosition;

    if (allCategoryPosition !== "top" && allCategoryPosition !== "bottom") {
      return "invalid_position";
    }

    db.settings ||= {};
    db.settings.nav = {
      allCategoryEnabled,
      allCategoryPosition,
      shuffleAll,
    };
    return db.settings.nav;
  });

  if (next === "invalid_position") {
    res.status(400).json({ error: "invalid_position" });
    return;
  }

  res.json({ nav: next });
});

app.post("/api/admin/categories", requireAdmin, async (req, res) => {
  const name = normalizeCategory(req.body?.name);
  if (!name) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const category = await updateDb(async (db) => {
    const existing = db.categories.find((c) => String(c.name).toLowerCase() === name.toLowerCase());
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    db.categories.push(created);
    return created;
  });

  res.json(category);
});

app.patch("/api/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const move = String(req.body?.move || "").trim();
  const nextName = req.body?.name !== undefined ? normalizeCategory(req.body?.name) : null;

  const updated = await updateDb(async (db) => {
    const idx = db.categories.findIndex((c) => c.id === id);
    if (idx === -1) {
      return null;
    }

    const now = new Date().toISOString();
    const current = db.categories[idx];

    if (move === "up" && idx > 0) {
      const tmp = db.categories[idx - 1];
      db.categories[idx - 1] = current;
      db.categories[idx] = tmp;
      return db.categories[idx - 1];
    }
    if (move === "down" && idx < db.categories.length - 1) {
      const tmp = db.categories[idx + 1];
      db.categories[idx + 1] = current;
      db.categories[idx] = tmp;
      return db.categories[idx + 1];
    }

    if (nextName !== null) {
      if (!nextName) {
        return "invalid_name";
      }
      const nameTaken = db.categories.some(
        (c) => c.id !== id && String(c.name).toLowerCase() === nextName.toLowerCase(),
      );
      if (nameTaken) {
        return "name_taken";
      }

      // Keep existing menu items bound to the renamed category.
      for (const item of db.menu) {
        if (String(item.category || "").trim() === current.name) {
          item.category = nextName;
          item.updatedAt = now;
        }
      }

      db.categories[idx] = { ...current, name: nextName, updatedAt: now };
      return db.categories[idx];
    }

    return { ...current, updatedAt: now };
  });

  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (updated === "invalid_name" || updated === "name_taken") {
    res.status(400).json({ error: updated });
    return;
  }

  res.json(updated);
});

app.delete("/api/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");

  const result = await updateDb(async (db) => {
    const idx = db.categories.findIndex((c) => c.id === id);
    if (idx === -1) {
      return null;
    }

    const removed = db.categories[idx];
    const now = new Date().toISOString();
    db.categories.splice(idx, 1);

    // Unassign category from menu items.
    for (const item of db.menu) {
      if (String(item.category || "").trim() === removed.name) {
        item.category = "";
        item.updatedAt = now;
      }
    }

    return { ok: true };
  });

  if (!result) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json(result);
});

app.post("/api/admin/menu", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const weight = String(payload.weight || "").trim();
  const category = String(payload.category || "").trim();
  const imageUrl = String(payload.imageUrl || "").trim();
  const price = asMoney(payload.price);
  const active = Boolean(payload.active);
  const options = normalizeMenuOptions(payload.options);

  if (!title || price === null || price < 0) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const item = await updateDb(async (db) => {
    const now = new Date().toISOString();
    const newItem = {
      id: crypto.randomUUID(),
      title,
      description,
      weight,
      category,
      imageUrl,
      price,
      options,
      active,
      createdAt: now,
      updatedAt: now,
    };
    db.menu.unshift(newItem);
    return newItem;
  });

  res.json(item);
});

app.put("/api/admin/menu/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const payload = req.body || {};

  const updated = await updateDb(async (db) => {
    const idx = db.menu.findIndex((m) => m.id === id);
    if (idx === -1) {
      return null;
    }

    const current = db.menu[idx];
    const now = new Date().toISOString();
    const price = payload.price !== undefined ? asMoney(payload.price) : current.price;

    if (price === null || price < 0) {
      return "invalid_price";
    }

    const next = {
      ...current,
      title: payload.title !== undefined ? String(payload.title || "").trim() : current.title,
      description:
        payload.description !== undefined ? String(payload.description || "").trim() : current.description,
      weight: payload.weight !== undefined ? String(payload.weight || "").trim() : (current.weight || ""),
      category: payload.category !== undefined ? String(payload.category || "").trim() : current.category,
      imageUrl: payload.imageUrl !== undefined ? String(payload.imageUrl || "").trim() : current.imageUrl,
      price,
      options:
        payload.options !== undefined ? normalizeMenuOptions(payload.options) : (Array.isArray(current.options) ? current.options : []),
      active: payload.active !== undefined ? Boolean(payload.active) : current.active,
      updatedAt: now,
    };

    if (!next.title) {
      return "invalid_title";
    }

    db.menu[idx] = next;
    return next;
  });

  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (updated === "invalid_price" || updated === "invalid_title") {
    res.status(400).json({ error: updated });
    return;
  }

  res.json(updated);
});

app.delete("/api/admin/menu/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const ok = await updateDb(async (db) => {
    const before = db.menu.length;
    db.menu = db.menu.filter((m) => m.id !== id);
    return db.menu.length !== before;
  });

  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/admin/promos", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.promos);
});

app.post("/api/admin/promos", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const title = String(payload.title || "").trim();
  const text = String(payload.text || "").trim();
  const theme = String(payload.theme || "").trim();
  const imageUrl = String(payload.imageUrl || "").trim();
  const active = Boolean(payload.active);

  if (!title || !text) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const promo = await updateDb(async (db) => {
    const now = new Date().toISOString();
    const newPromo = {
      id: crypto.randomUUID(),
      title,
      text,
      theme,
      imageUrl,
      active,
      createdAt: now,
      updatedAt: now,
    };
    db.promos.unshift(newPromo);
    return newPromo;
  });

  res.json(promo);
});

app.put("/api/admin/promos/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const payload = req.body || {};

  const updated = await updateDb(async (db) => {
    const idx = db.promos.findIndex((p) => p.id === id);
    if (idx === -1) {
      return null;
    }

    const current = db.promos[idx];
    const now = new Date().toISOString();
    const next = {
      ...current,
      title: payload.title !== undefined ? String(payload.title || "").trim() : current.title,
      text: payload.text !== undefined ? String(payload.text || "").trim() : current.text,
      theme: payload.theme !== undefined ? String(payload.theme || "").trim() : current.theme,
      imageUrl: payload.imageUrl !== undefined ? String(payload.imageUrl || "").trim() : current.imageUrl,
      active: payload.active !== undefined ? Boolean(payload.active) : current.active,
      updatedAt: now,
    };

    if (!next.title || !next.text) {
      return "invalid";
    }

    db.promos[idx] = next;
    return next;
  });

  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (updated === "invalid") {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  res.json(updated);
});

app.delete("/api/admin/promos/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const ok = await updateDb(async (db) => {
    const before = db.promos.length;
    db.promos = db.promos.filter((p) => p.id !== id);
    return db.promos.length !== before;
  });

  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file?.filename) {
    res.status(400).json({ error: "no_file" });
    return;
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const status = String(req.query.status || "").trim();
  const db = await readDb();
  const orders = status ? db.orders.filter((o) => o.status === status) : db.orders;
  res.json(orders);
});

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const status = String(req.body?.status || "");

  if (!validateStatus(status)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }

  const updated = await updateDb(async (db) => {
    const idx = db.orders.findIndex((o) => o.id === id);
    if (idx === -1) {
      return null;
    }
    const now = new Date().toISOString();
    db.orders[idx] = { ...db.orders[idx], status, updatedAt: now };
    return db.orders[idx];
  });

  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json(updated);
});

const isSafeArchiveName = (value) => /^[a-z0-9._-]+\\.json$/i.test(value) && !value.includes("..");

app.post("/api/admin/orders/archive", requireAdmin, async (req, res) => {
  const confirm = Boolean(req.body?.confirm);
  if (!confirm) {
    res.status(400).json({ error: "confirm_required" });
    return;
  }

  const result = await updateDb(async (db) => {
    const orders = Array.isArray(db.orders) ? db.orders : [];
    if (orders.length === 0) {
      return { archived: false, count: 0 };
    }

    const archivedAt = new Date().toISOString();
    const safeStamp = archivedAt.replaceAll(":", "-").replaceAll(".", "-");
    const file = `orders_${safeStamp}_${crypto.randomUUID().slice(0, 8)}.json`;

    const archivePayload = {
      version: 1,
      archivedAt,
      orders,
    };

    await fs.mkdir(ARCHIVES_DIR, { recursive: true });
    await fs.writeFile(path.join(ARCHIVES_DIR, file), JSON.stringify(archivePayload, null, 2), "utf8");

    db.orders = [];
    return { archived: true, count: orders.length, file, archivedAt };
  });

  res.json(result);
});

app.post("/api/admin/orders/clear", requireAdmin, async (req, res) => {
  const confirm = Boolean(req.body?.confirm);
  if (!confirm) {
    res.status(400).json({ error: "confirm_required" });
    return;
  }

  const result = await updateDb(async (db) => {
    const before = Array.isArray(db.orders) ? db.orders.length : 0;
    db.orders = [];
    return { ok: true, cleared: before };
  });

  res.json(result);
});

app.get("/api/admin/orders/archives", requireAdmin, async (_req, res) => {
  let files = [];
  try {
    files = await fs.readdir(ARCHIVES_DIR);
  } catch {
    files = [];
  }

  const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json") && isSafeArchiveName(f));
  jsonFiles.sort((a, b) => b.localeCompare(a));

  const items = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const full = path.join(ARCHIVES_DIR, file);
        const raw = await fs.readFile(full, "utf8");
        const parsed = JSON.parse(raw);
        const count = Array.isArray(parsed?.orders) ? parsed.orders.length : null;
        const archivedAt = typeof parsed?.archivedAt === "string" ? parsed.archivedAt : null;
        return { file, archivedAt, count };
      } catch {
        return { file, archivedAt: null, count: null };
      }
    }),
  );

  res.json(items);
});

app.get("/api/admin/orders/archives/:file", requireAdmin, async (req, res) => {
  const file = String(req.params.file || "");
  if (!isSafeArchiveName(file)) {
    res.status(400).json({ error: "invalid_archive" });
    return;
  }

  const full = path.join(ARCHIVES_DIR, path.basename(file));
  try {
    const raw = await fs.readFile(full, "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${file}\"`);
    res.send(raw);
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

ensureDirsAndDb()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Mr. Тай server running on http://localhost:${PORT}`);
      // eslint-disable-next-line no-console
      console.log(`Admin: http://localhost:${PORT}/admin.html (ADMIN_TOKEN=${ADMIN_TOKEN})`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
