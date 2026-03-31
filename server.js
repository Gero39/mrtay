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

const formatErrorForLog = (err) => ({
  name: err?.name || "Error",
  message: err?.message || String(err),
  code: err?.code || "",
  syscall: err?.syscall || "",
  path: err?.path || "",
  stack: err?.stack || "",
});

// Behind nginx we want correct client IP (x-forwarded-for) for rate-limits.
app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Basic security headers (keep it conservative to avoid breaking the static site).
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

const getClientIp = (req) => {
  const ip = String(req.ip || req.connection?.remoteAddress || "").trim();
  return ip || "unknown";
};

const createRateLimiter = ({ windowMs, max, keyPrefix }) => {
  const buckets = new Map(); // key -> { count, resetAt }

  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const current = buckets.get(key);

    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    next();
  };
};

// Rate-limits: tune as needed.
const adminRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 600, keyPrefix: "admin" });
const adminUploadRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60, keyPrefix: "admin_upload" });
const publicOrdersRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40, keyPrefix: "public_orders" });

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
        delivery: {
          city: "Симферополь",
          origin: { lat: 44.981547, lon: 34.091607 },
          freeRadiusKm: 5,
          freeFromSubtotalRub: 0,
          serviceRadiusKm: 20,
          tiers: [
            { fromKm: 0, feeRub: 0 },
            { fromKm: 15, feeRub: 200 },
            { fromKm: 18, feeRub: 250 },
          ],
          incremental: { enabled: false, fromKm: 20, stepMeters: 1000, stepFeeRub: 50 },
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
  parsed.settings.delivery ||= {};
  parsed.settings.delivery.city = String(parsed.settings.delivery.city || "Симферополь").trim() || "Симферополь";
  parsed.settings.delivery.origin ||= { lat: 44.981547, lon: 34.091607 };
  parsed.settings.delivery.origin.lat = Number(parsed.settings.delivery.origin.lat);
  parsed.settings.delivery.origin.lon = Number(parsed.settings.delivery.origin.lon);
  if (
    !Number.isFinite(parsed.settings.delivery.origin.lat) ||
    parsed.settings.delivery.origin.lat < -90 ||
    parsed.settings.delivery.origin.lat > 90
  ) {
    parsed.settings.delivery.origin.lat = 44.981547;
  }
  if (
    !Number.isFinite(parsed.settings.delivery.origin.lon) ||
    parsed.settings.delivery.origin.lon < -180 ||
    parsed.settings.delivery.origin.lon > 180
  ) {
    parsed.settings.delivery.origin.lon = 34.091607;
  }
  parsed.settings.delivery.freeRadiusKm = Number(parsed.settings.delivery.freeRadiusKm);
  if (!Number.isFinite(parsed.settings.delivery.freeRadiusKm) || parsed.settings.delivery.freeRadiusKm <= 0) {
    parsed.settings.delivery.freeRadiusKm = 5;
  }
  parsed.settings.delivery.freeFromSubtotalRub = Math.round(Number(parsed.settings.delivery.freeFromSubtotalRub));
  if (!Number.isFinite(parsed.settings.delivery.freeFromSubtotalRub) || parsed.settings.delivery.freeFromSubtotalRub < 0) {
    parsed.settings.delivery.freeFromSubtotalRub = 0;
  }
  parsed.settings.delivery.serviceRadiusKm = Number(parsed.settings.delivery.serviceRadiusKm);
  if (
    !Number.isFinite(parsed.settings.delivery.serviceRadiusKm) ||
    parsed.settings.delivery.serviceRadiusKm <= 0 ||
    parsed.settings.delivery.serviceRadiusKm < parsed.settings.delivery.freeRadiusKm
  ) {
    parsed.settings.delivery.serviceRadiusKm = Math.max(20, parsed.settings.delivery.freeRadiusKm);
  }
  parsed.settings.delivery.tiers = Array.isArray(parsed.settings.delivery.tiers) ? parsed.settings.delivery.tiers : [];
  parsed.settings.delivery.tiers = parsed.settings.delivery.tiers
    .map((tier) => ({
      fromKm: Number(tier?.fromKm),
      feeRub: Math.round(Number(tier?.feeRub)),
    }))
    .filter((tier) => Number.isFinite(tier.fromKm) && tier.fromKm >= 0 && Number.isFinite(tier.feeRub) && tier.feeRub >= 0)
    .sort((a, b) => a.fromKm - b.fromKm);
  if (parsed.settings.delivery.tiers.length === 0) {
    parsed.settings.delivery.tiers = [{ fromKm: 0, feeRub: 0 }];
  }
  const inc = parsed.settings.delivery.incremental || {};
  parsed.settings.delivery.incremental = {
    enabled: Boolean(inc.enabled),
    fromKm: Number(inc.fromKm),
    stepMeters: Math.round(Number(inc.stepMeters)),
    stepFeeRub: Math.round(Number(inc.stepFeeRub)),
  };
  if (!Number.isFinite(parsed.settings.delivery.incremental.fromKm) || parsed.settings.delivery.incremental.fromKm < 0) {
    parsed.settings.delivery.incremental.fromKm = 20;
  }
  if (!Number.isFinite(parsed.settings.delivery.incremental.stepMeters) || parsed.settings.delivery.incremental.stepMeters <= 0) {
    parsed.settings.delivery.incremental.stepMeters = 1000;
  }
  if (!Number.isFinite(parsed.settings.delivery.incremental.stepFeeRub) || parsed.settings.delivery.incremental.stepFeeRub < 0) {
    parsed.settings.delivery.incremental.stepFeeRub = 0;
  }
  return parsed;
};

const writeDbAtomic = async (db) => {
  const tmp = `${DB_FILE}.tmp`;
  const serialized = JSON.stringify(db, null, 2);

  await fs.writeFile(tmp, serialized, "utf8");
  try {
    await fs.rename(tmp, DB_FILE);
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "EPERM" || code === "EBUSY" || code === "EXDEV") {
      // Some hosting/storage backends are flaky with atomic rename of temp files.
      await fs.writeFile(DB_FILE, serialized, "utf8");
      await fs.unlink(tmp).catch(() => {});
      return;
    }
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
};

let writeQueue = Promise.resolve();
const updateDb = async (mutator) => {
  const run = async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDbAtomic(db);
    return result;
  };

  // Allow the queue to recover after a previous failed write instead of keeping
  // all subsequent mutations permanently rejected.
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
};

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
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

const calculateDeliveryQuote = (distanceMeters, settings, itemsSubtotalRub = 0) => {
  const distance = Math.round(Number(distanceMeters));
  if (!Number.isFinite(distance) || distance < 0) {
    return { isKnown: false, allowed: true, feeRub: 0, distanceMeters: null, zone: null };
  }

  const freeRadiusMeters = Number(settings?.freeRadiusKm) * 1000;
  const serviceRadiusMeters = Number(settings?.serviceRadiusKm) * 1000;
  const subtotalRub = Math.round(Number(itemsSubtotalRub));
  const freeFromSubtotalRub = Math.round(Number(settings?.freeFromSubtotalRub));
  const hasFreeThreshold =
    Number.isFinite(freeFromSubtotalRub) &&
    freeFromSubtotalRub > 0;
  const thresholdReached =
    !hasFreeThreshold || (Number.isFinite(subtotalRub) && subtotalRub >= freeFromSubtotalRub);

  if (Number.isFinite(freeRadiusMeters) && distance <= freeRadiusMeters && thresholdReached) {
    return {
      isKnown: true,
      allowed: true,
      feeRub: 0,
      distanceMeters: distance,
      zone: "free",
      freeFromSubtotalRub: hasFreeThreshold ? freeFromSubtotalRub : 0,
      freeThresholdReached: true,
      freeThresholdRemainingRub: 0,
    };
  }

  if (Number.isFinite(serviceRadiusMeters) && distance > serviceRadiusMeters) {
    return { isKnown: true, allowed: false, feeRub: 0, distanceMeters: distance, zone: "none" };
  }

  const distanceKm = distance / 1000;
  const tiers = Array.isArray(settings?.tiers) ? settings.tiers : [];
  let feeRub = 0;

  for (const tier of tiers) {
    if (!tier) continue;
    const fromKm = Number(tier.fromKm);
    const tierFee = Math.round(Number(tier.feeRub));
    if (!Number.isFinite(fromKm) || fromKm < 0) continue;
    if (!Number.isFinite(tierFee) || tierFee < 0) continue;
    if (distanceKm >= fromKm) {
      feeRub = tierFee;
      continue;
    }
    break;
  }

  const inc = settings?.incremental || {};
  if (inc.enabled) {
    const fromMeters = Number(inc.fromKm) * 1000;
    const stepMeters = Math.round(Number(inc.stepMeters));
    const stepFeeRub = Math.round(Number(inc.stepFeeRub));
    if (
      Number.isFinite(fromMeters) &&
      Number.isFinite(stepMeters) &&
      stepMeters > 0 &&
      Number.isFinite(stepFeeRub) &&
      stepFeeRub > 0 &&
      distance > fromMeters
    ) {
      const extraDistance = distance - fromMeters;
      const steps = Math.ceil(extraDistance / stepMeters);
      feeRub += steps * stepFeeRub;
    }
  }

  if (!Number.isFinite(feeRub) || feeRub < 0) feeRub = 0;
  const remainingRub =
    hasFreeThreshold && Number.isFinite(subtotalRub) ? Math.max(0, freeFromSubtotalRub - subtotalRub) : 0;
  return {
    isKnown: true,
    allowed: true,
    feeRub,
    distanceMeters: distance,
    zone: "paid",
    freeFromSubtotalRub: hasFreeThreshold ? freeFromSubtotalRub : 0,
    freeThresholdReached: !hasFreeThreshold || remainingRub <= 0,
    freeThresholdRemainingRub: remainingRub,
  };
};

const allowedUploadTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    // Never trust user-provided extensions. Derive from mimetype.
    const safeExt = allowedUploadTypes.get(String(file.mimetype || "").toLowerCase()) || "";
    cb(null, `${Date.now()}_${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const type = String(file.mimetype || "").toLowerCase();
    if (!allowedUploadTypes.has(type)) {
      cb(new Error("invalid_file_type"));
      return;
    }
    cb(null, true);
  },
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
app.get("/api/public/menu", asyncRoute(async (_req, res) => {
  const db = await readDb();
  res.json(db.menu.filter((item) => item.active));
}));

app.get("/api/public/promos", asyncRoute(async (_req, res) => {
  const db = await readDb();
  res.json(db.promos.filter((promo) => promo.active));
}));

app.get("/api/public/categories", asyncRoute(async (_req, res) => {
  const db = await readDb();
  res.json(db.categories);
}));

app.get("/api/public/settings", asyncRoute(async (_req, res) => {
  const db = await readDb();
  res.json({ nav: db.settings.nav, delivery: db.settings.delivery });
}));

app.post("/api/public/orders", publicOrdersRateLimit, asyncRoute(async (req, res) => {
  const payload = req.body || {};
  const customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const delivery = payload.delivery || {};

  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const address = String(customer.address || "").trim();
  const comment = String(customer.comment || "").trim();
  const deliveryDistanceMeters = Number.isFinite(Number(delivery.distanceMeters))
    ? Math.round(Number(delivery.distanceMeters))
    : null;

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

    const itemsTotal = normalizedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const quote =
      deliveryDistanceMeters !== null
        ? calculateDeliveryQuote(deliveryDistanceMeters, db.settings?.delivery, itemsTotal)
        : null;
    if (quote && quote.isKnown && !quote.allowed) {
      return "delivery_out_of_zone";
    }

    const fee = quote && Number.isFinite(quote.feeRub) && quote.feeRub > 0 ? quote.feeRub : 0;
    const total = itemsTotal + fee;
    const createdAt = new Date().toISOString();
    const newOrder = {
      id: crypto.randomUUID(),
      status: "incoming",
      customer: { name, phone, address, comment },
      items: normalizedItems,
      delivery: {
        feeRub: fee,
        distanceMeters: quote?.distanceMeters ?? deliveryDistanceMeters ?? null,
        zone: quote?.zone ?? null,
      },
      total,
      createdAt,
      updatedAt: createdAt,
    };

    db.orders.unshift(newOrder);
    return newOrder;
  });

  if (order === "delivery_out_of_zone") {
    res.status(400).json({ error: "delivery_out_of_zone" });
    return;
  }

  if (!order) {
    res.status(400).json({ error: "invalid_items" });
    return;
  }

  res.json({ id: order.id, status: order.status, total: order.total });
}));

// Admin API (token protected)
app.use("/api/admin", adminRateLimit);

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
  res.json({ nav: db.settings.nav, delivery: db.settings.delivery });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const nav = payload.nav || {};
  const delivery = payload.delivery;

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

    if (delivery && typeof delivery === "object") {
      const currentDelivery = db.settings.delivery || {};
      const city = delivery.city !== undefined ? String(delivery.city || "").trim() : currentDelivery.city;
      const origin = delivery.origin !== undefined ? delivery.origin : currentDelivery.origin;
      const freeRadiusKm =
        delivery.freeRadiusKm !== undefined ? Number(delivery.freeRadiusKm) : Number(currentDelivery.freeRadiusKm);
      const freeFromSubtotalRub =
        delivery.freeFromSubtotalRub !== undefined
          ? Math.round(Number(delivery.freeFromSubtotalRub))
          : Math.round(Number(currentDelivery.freeFromSubtotalRub));
      const serviceRadiusKm =
        delivery.serviceRadiusKm !== undefined ? Number(delivery.serviceRadiusKm) : Number(currentDelivery.serviceRadiusKm);
      const tiers = Array.isArray(delivery.tiers) ? delivery.tiers : currentDelivery.tiers;
      const incremental = delivery.incremental !== undefined ? delivery.incremental : currentDelivery.incremental;

      const originLat = Number(origin?.lat);
      const originLon = Number(origin?.lon);
      if (
        !Number.isFinite(originLat) ||
        originLat < -90 ||
        originLat > 90 ||
        !Number.isFinite(originLon) ||
        originLon < -180 ||
        originLon > 180
      ) {
        return "invalid_origin";
      }
      if (!Number.isFinite(freeRadiusKm) || freeRadiusKm <= 0) {
        return "invalid_free_radius";
      }
      if (!Number.isFinite(freeFromSubtotalRub) || freeFromSubtotalRub < 0) {
        return "invalid_free_from_subtotal";
      }
      if (!Number.isFinite(serviceRadiusKm) || serviceRadiusKm <= 0 || serviceRadiusKm < freeRadiusKm) {
        return "invalid_service_radius";
      }

      const normalizedTiers = (Array.isArray(tiers) ? tiers : [])
        .map((tier) => ({
          fromKm: Number(tier?.fromKm),
          feeRub: Math.round(Number(tier?.feeRub)),
        }))
        .filter(
          (tier) =>
            Number.isFinite(tier.fromKm) &&
            tier.fromKm >= 0 &&
            Number.isFinite(tier.feeRub) &&
            tier.feeRub >= 0,
        )
        .sort((a, b) => a.fromKm - b.fromKm);

      if (normalizedTiers.length === 0) {
        normalizedTiers.push({ fromKm: 0, feeRub: 0 });
      }

      const inc = incremental || {};
      const incEnabled = Boolean(inc.enabled);
      const incFromKm = Number(inc.fromKm);
      const incStepMeters = Math.round(Number(inc.stepMeters));
      const incStepFeeRub = Math.round(Number(inc.stepFeeRub));
      if (!Number.isFinite(incFromKm) || incFromKm < 0) return "invalid_incremental_from";
      if (!Number.isFinite(incStepMeters) || incStepMeters <= 0) return "invalid_incremental_step";
      if (!Number.isFinite(incStepFeeRub) || incStepFeeRub < 0) return "invalid_incremental_fee";

      db.settings.delivery = {
        city: city || "Симферополь",
        origin: { lat: originLat, lon: originLon },
        freeRadiusKm,
        freeFromSubtotalRub,
        serviceRadiusKm,
        tiers: normalizedTiers,
        incremental: {
          enabled: incEnabled,
          fromKm: incFromKm,
          stepMeters: incStepMeters,
          stepFeeRub: incStepFeeRub,
        },
      };
    }

    return { nav: db.settings.nav, delivery: db.settings.delivery };
  });

  if (next === "invalid_position") {
    res.status(400).json({ error: "invalid_position" });
    return;
  }
  if (next === "invalid_origin") {
    res.status(400).json({ error: "invalid_origin" });
    return;
  }
  if (next === "invalid_free_radius") {
    res.status(400).json({ error: "invalid_free_radius" });
    return;
  }
  if (next === "invalid_service_radius") {
    res.status(400).json({ error: "invalid_service_radius" });
    return;
  }
  if (next === "invalid_free_from_subtotal") {
    res.status(400).json({ error: "invalid_free_from_subtotal" });
    return;
  }
  if (next === "invalid_incremental_from") {
    res.status(400).json({ error: "invalid_incremental_from" });
    return;
  }
  if (next === "invalid_incremental_step") {
    res.status(400).json({ error: "invalid_incremental_step" });
    return;
  }
  if (next === "invalid_incremental_fee") {
    res.status(400).json({ error: "invalid_incremental_fee" });
    return;
  }

  res.json(next);
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

app.post("/api/admin/upload", requireAdmin, adminUploadRateLimit, upload.single("file"), (req, res) => {
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

app.use((err, req, res, _next) => {
  if (err?.message === "invalid_file_type") {
    res.status(400).json({ error: "invalid_file_type" });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code || "upload_error" });
    return;
  }

  // eslint-disable-next-line no-console
  console.error("[server] request failed", {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: getClientIp(req),
    error: formatErrorForLog(err),
  });

  if (req.path === "/api/public/orders") {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    // eslint-disable-next-line no-console
    console.error("[orders] failed payload summary", {
      customerName: String(body.customer?.name || "").trim(),
      customerPhone: String(body.customer?.phone || "").trim(),
      addressLength: String(body.customer?.address || "").trim().length,
      itemsCount: items.length,
      itemIds: items.map((item) => String(item?.id || "")).filter(Boolean).slice(0, 20),
      hasDeliveryDistance: Number.isFinite(Number(body.delivery?.distanceMeters)),
    });
  }

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
