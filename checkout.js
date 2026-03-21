(() => {
  const STORAGE_KEY = "mr_tai_cart";
  const currency = new Intl.NumberFormat("ru-RU");

  const checkoutForm = document.querySelector("#checkout-form");
  const orderSummary = document.querySelector("#order-summary");
  const orderTotalField = document.querySelector("#order-total-field");
  const submitOrderButton = document.querySelector("#submit-order");
  const checkoutNote = document.querySelector("#checkout-note");
  const successOverlay = document.querySelector("#success-overlay");
  const successText = document.querySelector("#success-text");
  const successCountdown = document.querySelector("#success-countdown");
  const successGo = document.querySelector("#success-go");

  if (
    !checkoutForm ||
    !orderSummary ||
    !orderTotalField ||
    !submitOrderButton ||
    !checkoutNote ||
    !successOverlay ||
    !successText ||
    !successCountdown ||
    !successGo
  ) {
    return;
  }

  const formatPrice = (value) => `${currency.format(Number(value) || 0)} \u20bd`;

  const setNote = (text, kind = "info") => {
    checkoutNote.textContent = text;
    checkoutNote.style.color = kind === "error" ? "#c81d31" : "#2f9e6b";
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const formatAddress = ({ street, house, apartment }) => {
    const base = [street, house].filter(Boolean).join(", ");
    if (!base) return "";
    if (!apartment) return base;
    return `${base}, кв ${apartment}`;
  };

  const loadCartItems = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : []).filter(
        (item) =>
          item?.id &&
          item?.name &&
          Number.isFinite(item?.price) &&
          Number.isFinite(item?.quantity) &&
          item.quantity > 0,
      );
    } catch {
      return [];
    }
  };

  const renderOrderSummary = () => {
    const items = loadCartItems();
    if (items.length === 0) {
      orderSummary.innerHTML =
        '<p class="order-summary__empty">Корзина пуста. Вернитесь в меню и добавьте блюда.</p>';
      orderTotalField.textContent = `0 \u20bd`;
      submitOrderButton.disabled = true;
      submitOrderButton.title = "Добавьте блюда в корзину";
      return;
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    orderTotalField.textContent = formatPrice(total);
    submitOrderButton.disabled = false;
    submitOrderButton.removeAttribute("title");

    orderSummary.innerHTML = items
      .map((item) => {
        const lineTotal = item.price * item.quantity;
        const title = item.optionLabel ? `${item.name} (${item.optionLabel})` : item.name;
        return `
          <article class="order-summary__item">
            <p>${escapeHtml(title)}</p>
            <span>${item.quantity} x ${formatPrice(item.price)} = ${formatPrice(lineTotal)}</span>
          </article>
        `;
      })
      .join("");
  };

  let successTimer = null;
  let countdownTimer = null;

  const showSuccessModal = (orderId) => {
    const shortId = String(orderId || "").slice(0, 8) || "—";

    successText.textContent = `Заказ принят (№ ${shortId}). Менеджер свяжется с вами.`;
    let seconds = 5;
    successCountdown.textContent = String(seconds);

    successOverlay.hidden = false;
    document.body.classList.add("modal-open");

    const goHome = () => {
      if (countdownTimer) clearInterval(countdownTimer);
      if (successTimer) clearTimeout(successTimer);
      window.location.href = "index.html";
    };

    successGo.onclick = goHome;

    countdownTimer = setInterval(() => {
      seconds -= 1;
      successCountdown.textContent = String(Math.max(0, seconds));
      if (seconds <= 0) {
        goHome();
      }
    }, 1000);

    successTimer = setTimeout(goHome, 5000);
  };

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setNote("");

    const items = loadCartItems();
    if (items.length === 0) {
      setNote("Корзина пуста. Добавьте блюда перед оформлением.", "error");
      return;
    }

    const form = new FormData(checkoutForm);
    const addressLegacy = String(form.get("address") || "").trim();
    const addressStreet = String(form.get("addressStreet") || "").trim();
    const addressHouse = String(form.get("addressHouse") || "").trim();
    const addressApartment = String(form.get("addressApartment") || "").trim();
    const formattedAddress =
      addressLegacy ||
      formatAddress({
        street: addressStreet,
        house: addressHouse,
        apartment: addressApartment,
      });
    const customer = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      address: formattedAddress,
      comment: String(form.get("comment") || "").trim(),
    };

    const orderItems = items.map((i) => ({
      id: i.id,
      optionId: String(i.optionId || "").trim(),
      quantity: i.quantity,
    }));

    submitOrderButton.disabled = true;
    setNote("Отправляем заказ...");

    let didSucceed = false;
    try {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer, items: orderItems }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      localStorage.removeItem(STORAGE_KEY);
      checkoutForm.reset();
      renderOrderSummary();
      setNote("");
      didSucceed = true;
      showSuccessModal(json.id);
    } catch (err) {
      setNote(`Не удалось отправить заказ: ${err.message}`, "error");
    } finally {
      if (!didSucceed) {
        submitOrderButton.disabled = false;
      }
    }
  });

  renderOrderSummary();
})();


var ymaps2LoadPromise = null;

async function initMap() {
  const container = document.getElementById("delivery-map");
  if (!container) return;

  const apiKey = String(container.dataset.ymapsApikey || "").trim();
  if (!apiKey) {
    renderMapFallback(container, "Не задан API-ключ Яндекс.Карт (data-ymaps-apikey).");
    return;
  }

  const zones = parseDeliveryZones(
    container.dataset.freeCenter,
    container.dataset.freeRadiusKm,
    container.dataset.paidRadiusKm,
  );
  if (!zones) {
    renderMapFallback(
      container,
      "Некорректные параметры зон доставки (data-free-center / data-free-radius-km / data-paid-radius-km).",
    );
    return;
  }

  try {
    const ymaps = await loadYmaps2({ apiKey, lang: "ru_RU" });

    await new Promise((resolve) => {
      ymaps.ready(resolve);
    });

    const { center, freeRadiusMeters, paidRadiusMeters } = zones;
    const configuredZoom = parseFlexibleNumber(container.dataset.mapZoom);
    const zoom =
      Number.isFinite(configuredZoom) && configuredZoom > 0
        ? configuredZoom
        : suggestZoomForRadius(paidRadiusMeters);

    const map = new ymaps.Map(
      container,
      {
        center,
        zoom,
        type: "yandex#map",
        controls: [],
      },
      { suppressMapOpenBlock: true },
    );

    map.controls.add("zoomControl");
    map.behaviors.disable('ruler');

    const outsideMask = new ymaps.Polygon(
      [buildOuterContour(center, paidRadiusMeters), buildCircleContour(center, paidRadiusMeters).reverse()],
      {},
      {
        fillColor: "#6b7280",
        fillOpacity: 0.2,
        opacity: 0.2,
        strokeWidth: 0,
        interactivityModel: "default#transparent",
        zIndex: 5,
      },
    );

    const paidFillCircle = new ymaps.Circle(
      [center, paidRadiusMeters],
      { hintContent: "Зона платной доставки" },
      {
        fillColor: "#d20000",
        fillOpacity: 0.14,
        opacity: 0.14,
        strokeWidth: 0,
        interactivityModel: "default#transparent",
        zIndex: 10,
      },
    );

    const freeCircle = new ymaps.Circle(
      [center, freeRadiusMeters],
      { hintContent: "Зона бесплатной доставки" },
      {
        fillColor: "#00a05a",
        fillOpacity: 0.32,
        opacity: 0.95,
        strokeColor: "#00a05a",
        strokeOpacity: 0.95,
        strokeWidth: 2,
        interactivityModel: "default#transparent",
        zIndex: 30,
      },
    );

    const paidCircle = new ymaps.Circle(
      [center, paidRadiusMeters],
      { hintContent: "Зона платной доставки" },
      {
        fillOpacity: 0,
        strokeColor: "#d20000",
        strokeOpacity: 0.9,
        strokeWidth: 2,
        interactivityModel: "default#transparent",
        zIndex: 20,
      },
    );

    map.geoObjects.add(outsideMask);
    map.geoObjects.add(paidFillCircle);
    map.geoObjects.add(paidCircle);
    map.geoObjects.add(freeCircle);
    map.geoObjects.add(
      new ymaps.Placemark(
        center,
        {},
        { preset: "islands#greenDotIcon" },
      ),
    );

    setupAddressSearch({
      ymaps,
      map,
      origin: center,
      freeRadiusMeters,
      paidRadiusMeters,
      city: String(container.dataset.addressCity || "").trim(),
    });

  } catch (error) {
    console.error("[checkout] Yandex Maps init failed:", error);
    renderMapFallback(
      container,
      "Карта не загрузилась.",
    );
  }
}

function renderMapFallback(container, message) {
  container.classList.add("checkout-map--fallback");
  container.textContent = message;
}

function setupAddressSearch({ ymaps, map, origin, freeRadiusMeters, paidRadiusMeters, city }) {
  const streetInput = document.getElementById("address-street");
  const houseInput = document.getElementById("address-house");
  const apartmentInput = document.getElementById("address-apartment");
  const searchButton = document.getElementById("address-search");
  const statusEl = document.getElementById("address-status");
  const suggestEl = document.getElementById("address-suggest");

  if (!streetInput || !houseInput || !searchButton || !statusEl) return;
  if (!suggestEl) return;

  const setStatus = (text, kind = "") => {
    statusEl.textContent = text;
    statusEl.classList.remove("address-status--ok", "address-status--warn", "address-status--bad");
    if (kind) statusEl.classList.add(`address-status--${kind}`);
  };

  const buildQuery = () => {
    const street = streetInput.value.trim();
    const house = houseInput.value.trim();
    const apartment = apartmentInput?.value.trim() || "";

    const parts = [];
    if (city) parts.push(city);
    if (street) parts.push(street);
    if (house) parts.push(house);

    const base = parts.join(", ");
    if (!base) return "";
    if (!apartment) return base;
    return `${base}, кв ${apartment}`;
  };

  let addressPlacemark = null;
  let suggestAnchor = streetInput;

  const positionSuggest = () => {
    if (suggestEl.hidden) return;
    if (!suggestAnchor) return;

    const rect = suggestAnchor.getBoundingClientRect();
    const margin = 6;

    suggestEl.style.left = `${Math.round(rect.left)}px`;
    suggestEl.style.width = `${Math.round(rect.width)}px`;

    let top = rect.bottom + margin;
    suggestEl.style.top = `${Math.round(top)}px`;

    // If it doesn't fit below, show above the input.
    const height = suggestEl.offsetHeight || 0;
    if (height && top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - margin - height);
      suggestEl.style.top = `${Math.round(top)}px`;
    }
  };

  const applyGeoObject = (geoObject) => {
    autofillAddressFields({ geoObject, streetInput, houseInput });

    const coords = geoObject.geometry.getCoordinates();
    const distance = distanceMeters(origin, coords);
    const distanceKm = Math.round(distance / 10) / 100;

    let kind = "ok";
    let preset = "islands#greenIcon";
    let label = `Бесплатная доставка • ${distanceKm} км`;

    if (distance > freeRadiusMeters && distance <= paidRadiusMeters) {
      kind = "warn";
      preset = "islands#orangeIcon";
      label = `Платная доставка • ${distanceKm} км`;
    } else if (distance > paidRadiusMeters) {
      kind = "bad";
      preset = "islands#redIcon";
      label = `Вне зоны доставки • ${distanceKm} км`;
    }

    setStatus(label, kind);

    if (addressPlacemark) {
      map.geoObjects.remove(addressPlacemark);
    }

    addressPlacemark = new ymaps.Placemark(coords, {}, { preset, zIndex: 40 });
    map.geoObjects.add(addressPlacemark);
    map.setCenter(coords, map.getZoom(), { duration: 250 });
  };

  const hideSuggest = () => {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    suggestEl.style.left = "";
    suggestEl.style.top = "";
    suggestEl.style.width = "";
  };

  const showSuggest = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      hideSuggest();
      return;
    }

    suggestEl.innerHTML = items
      .map((item, index) => {
        const title = escapeHtmlInline(item.title);
        const meta = escapeHtmlInline(item.meta);
        return `<button class="address-suggest__item" type="button" data-index="${index}">${title}<span class="address-suggest__meta">${meta}</span></button>`;
      })
      .join("");

    suggestEl.hidden = false;
    // Reposition after it's rendered so height is known.
    requestAnimationFrame(positionSuggest);
  };

  const geocodeAndUpdate = async () => {
    const query = buildQuery();
    if (!query) {
      setStatus("Введите улицу и дом.", "bad");
      return;
    }

    setStatus("Ищем адрес…", "warn");

    try {
      const result = await ymaps.geocode(query, { results: 1, kind: "house" });
      const geoObject = result.geoObjects.get(0);
      if (!geoObject) {
        setStatus("Адрес не найден. Уточните улицу/дом.", "bad");
        return;
      }

      applyGeoObject(geoObject);
    } catch (error) {
      console.error("[checkout] address geocode failed:", error);
      setStatus("Не удалось найти адрес. Проверьте интернет и попробуйте снова.", "bad");
    }
  };

  searchButton.addEventListener("click", () => {
    void geocodeAndUpdate();
  });

  const onKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void geocodeAndUpdate();
  };

  streetInput.addEventListener("keydown", onKeyDown);
  houseInput.addEventListener("keydown", onKeyDown);
  apartmentInput?.addEventListener("keydown", onKeyDown);

  let suggestSeq = 0;
  let suggestTimer = null;

  const scheduleSuggest = () => {
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => {
      void updateSuggest();
    }, 250);
  };

  const updateSuggest = async () => {
    const street = streetInput.value.trim();
    const house = houseInput.value.trim();

    if (street.length < 2) {
      hideSuggest();
      return;
    }

    const queryParts = [];
    if (city) queryParts.push(city);
    queryParts.push(street);
    if (house) queryParts.push(house);
    const query = queryParts.join(", ");

    const mySeq = (suggestSeq += 1);
    try {
      const kind = house ? "house" : "street";
      const result = await ymaps.geocode(query, { results: 5, kind });
      if (mySeq !== suggestSeq) return;

      const items = [];
      result.geoObjects.each((geoObject) => {
        const addressLine =
          typeof geoObject.getAddressLine === "function"
            ? geoObject.getAddressLine()
            : geoObject.properties?.get?.("text") || "";
        const parts = extractAddressPartsFromGeoObject(geoObject);
        const title = parts?.street || addressLine || "Адрес";
        const meta = parts?.house ? `дом ${parts.house}` : addressLine;
        items.push({ title, meta, geoObject });
      });

      showSuggest(items);

      suggestEl.onclick = (event) => {
        const target = event.target.closest(".address-suggest__item");
        if (!target) return;
        const index = Number(target.dataset.index);
        const selected = items[index];
        if (!selected?.geoObject) return;
        hideSuggest();
        applyGeoObject(selected.geoObject);
      };
    } catch {
      if (mySeq !== suggestSeq) return;
      hideSuggest();
    }
  };

  streetInput.addEventListener("input", scheduleSuggest);
  houseInput.addEventListener("input", scheduleSuggest);

  streetInput.addEventListener("focus", () => {
    suggestAnchor = streetInput;
    positionSuggest();
  });
  houseInput.addEventListener("focus", () => {
    suggestAnchor = houseInput;
    positionSuggest();
  });

  window.addEventListener("resize", positionSuggest);
  window.addEventListener("scroll", positionSuggest, true);

  document.addEventListener("click", (event) => {
    if (event.target === streetInput || event.target === houseInput || suggestEl.contains(event.target)) return;
    hideSuggest();
  });
}

function escapeHtmlInline(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function autofillAddressFields({ geoObject, streetInput, houseInput }) {
  const parts = extractAddressPartsFromGeoObject(geoObject);
  if (!parts) return;

  if (parts.street) {
    streetInput.value = parts.street;
  }

  if (parts.house && !houseInput.value.trim()) {
    houseInput.value = parts.house;
  }
}

function extractAddressPartsFromGeoObject(geoObject) {
  try {
    const meta = geoObject?.properties?.get?.("metaDataProperty.GeocoderMetaData");
    const components = meta?.Address?.Components;
    if (!Array.isArray(components)) return null;

    const findByKind = (...kinds) =>
      components.find((c) => c && kinds.includes(c.kind) && typeof c.name === "string" && c.name.trim());

    const street =
      findByKind("street")?.name ||
      findByKind("route")?.name ||
      findByKind("thoroughfare")?.name ||
      "";

    const house =
      findByKind("house")?.name ||
      findByKind("premise")?.name ||
      findByKind("entrance")?.name ||
      "";

    if (!street && !house) return null;
    return { street, house };
  } catch {
    return parseAddressLineFallback(geoObject);
  }
}

function parseAddressLineFallback(geoObject) {
  try {
    const addressLine =
      typeof geoObject?.getAddressLine === "function"
        ? geoObject.getAddressLine()
        : geoObject?.properties?.get?.("text") || "";
    const parts = String(addressLine)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const streetPart = parts.find((p) => /ул\.|улица|проспект|пр-т|шоссе|пер\.|переулок|бульвар|пл\.|площадь/i.test(p));
    const housePart = parts.find((p) => /^\d+[а-яА-Яa-zA-Z0-9\\/-]*$/.test(p));
    if (!streetPart && !housePart) return null;
    return { street: streetPart || "", house: housePart || "" };
  } catch {
    return null;
  }
}

function parseDeliveryZones(rawCenter, rawFreeRadiusKm, rawPaidRadiusKm) {
  const center = parseLatLon(rawCenter);
  const freeRadiusKm = parseFlexibleNumber(rawFreeRadiusKm);
  const paidRadiusKm = parseFlexibleNumber(rawPaidRadiusKm);
  if (!center) return null;
  if (!Number.isFinite(freeRadiusKm) || freeRadiusKm <= 0) return null;
  if (!Number.isFinite(paidRadiusKm) || paidRadiusKm <= 0) return null;

  const safePaidKm = Math.max(paidRadiusKm, freeRadiusKm);
  return {
    center,
    freeRadiusMeters: freeRadiusKm * 1000,
    paidRadiusMeters: safePaidKm * 1000,
  };
}

function parseFlexibleNumber(raw) {
  const normalized = String(raw ?? "").trim().replace(",", ".");
  return Number(normalized);
}

function parseLatLon(raw) {
  const parts = String(raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length !== 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}

function suggestZoomForRadius(radiusMeters) {
  const radiusKm = radiusMeters / 1000;
  if (radiusKm <= 0.5) return 15;
  if (radiusKm <= 1) return 14;
  if (radiusKm <= 2) return 13;
  if (radiusKm <= 5) return 12;
  if (radiusKm <= 10) return 11;
  if (radiusKm <= 20) return 10;
  return 9;
}

function buildOuterContour(center, radiusMeters) {
  const outerDistance = Math.max(radiusMeters * 8, 20000);
  const north = destinationPoint(center, outerDistance, 0);
  const south = destinationPoint(center, outerDistance, 180);
  const east = destinationPoint(center, outerDistance, 90);
  const west = destinationPoint(center, outerDistance, 270);

  const northLat = north[0];
  const southLat = south[0];
  const eastLon = east[1];
  const westLon = west[1];

  return [
    [northLat, westLon],
    [northLat, eastLon],
    [southLat, eastLon],
    [southLat, westLon],
    [northLat, westLon],
  ];
}

function buildCircleContour(center, radiusMeters, points = 72) {
  const [lat, lon] = center;
  const earthRadius = 6378137;
  const angularDistance = radiusMeters / earthRadius;
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);

  const result = [];
  for (let i = 0; i <= points; i += 1) {
    const bearing = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
      );
    result.push([toDegrees(lat2), normalizeLongitude(toDegrees(lon2))]);
  }

  if (result.length > 1) {
    result[result.length - 1] = result[0];
  }

  return result;
}

function destinationPoint(center, distanceMeters, bearingDegrees) {
  const [lat, lon] = center;
  const earthRadius = 6378137;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [toDegrees(lat2), normalizeLongitude(toDegrees(lon2))];
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(lon) {
  let result = lon;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function distanceMeters(a, b) {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;

  const earthRadius = 6378137;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLon * sinLon;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function loadYmaps2({ apiKey, lang = "ru_RU", timeoutMs = 15000 } = {}) {
  if (window.ymaps) return Promise.resolve(window.ymaps);
  if (ymaps2LoadPromise) return ymaps2LoadPromise;

  const src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=${encodeURIComponent(lang)}&load=package.full`;

  ymaps2LoadPromise = new Promise((resolve, reject) => {
    const script =
      document.querySelector('script[data-ymaps2-api="true"]') || document.createElement("script");

    let timeoutId = null;
    let pollId = null;

    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (timeoutId) clearTimeout(timeoutId);
      if (pollId) clearInterval(pollId);
    };

    const onLoad = () => {
      cleanup();
      if (window.ymaps) {
        resolve(window.ymaps);
        return;
      }
      reject(new Error("Yandex Maps API 2.1 script loaded, but ymaps is still unavailable"));
    };

    const onError = () => {
      cleanup();
      reject(new Error("Failed to load Yandex Maps API 2.1 script"));
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    timeoutId = setTimeout(() => {
      onError();
    }, timeoutMs);

    pollId = setInterval(() => {
      if (!window.ymaps) return;
      cleanup();
      resolve(window.ymaps);
    }, 50);

    if (!script.parentNode) {
      script.dataset.ymaps2Api = "true";
      script.async = true;
      script.src = src;
      document.head.appendChild(script);
      return;
    }

    if (script.src !== src) {
      script.src = src;
    }
  }).catch((error) => {
    ymaps2LoadPromise = null;
    throw error;
  });

  return ymaps2LoadPromise;
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void initMap();
    },
    { once: true },
  );
} else {
  void initMap();
}
