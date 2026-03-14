const TOKEN_KEY = "mr_tai_admin_token";

const tokenInput = document.querySelector("#admin-token-input");
const tokenSaveButton = document.querySelector("#admin-token-save");
const authStatus = document.querySelector("#admin-auth-status");

const tabButtons = Array.from(document.querySelectorAll(".admin-tab-btn"));
const panels = {
  orders: document.querySelector("#panel-orders"),
  categories: document.querySelector("#panel-categories"),
  menu: document.querySelector("#panel-menu"),
  promos: document.querySelector("#panel-promos"),
};

const ordersList = document.querySelector("#orders-list");
const ordersStatus = document.querySelector("#orders-status");
const ordersRefresh = document.querySelector("#orders-refresh");
const ordersArchive = document.querySelector("#orders-archive");
const ordersClear = document.querySelector("#orders-clear");
const ordersNote = document.querySelector("#orders-note");

const categoriesList = document.querySelector("#categories-list");
const categoriesRefresh = document.querySelector("#categories-refresh");
const categoryForm = document.querySelector("#category-form");
const categoryFormTitle = document.querySelector("#category-form-title");
const categoryNote = document.querySelector("#category-note");
const categoryDelete = document.querySelector("#category-delete");
const categoryReset = document.querySelector("#category-reset");
const categoryId = document.querySelector("#category-id");
const categoryName = document.querySelector("#category-name");

const menuList = document.querySelector("#menu-list");
const menuRefresh = document.querySelector("#menu-refresh");
const menuFilterCategory = document.querySelector("#menu-filter-category");
const menuForm = document.querySelector("#menu-form");
const menuFormTitle = document.querySelector("#menu-form-title");
const menuNote = document.querySelector("#menu-note");
const menuDelete = document.querySelector("#menu-delete");
const menuReset = document.querySelector("#menu-reset");
const menuId = document.querySelector("#menu-id");
const menuTitle = document.querySelector("#menu-title");
const menuDescription = document.querySelector("#menu-description");
const menuWeight = document.querySelector("#menu-weight");
const menuCategory = document.querySelector("#menu-category");
const menuPrice = document.querySelector("#menu-price");
const menuActive = document.querySelector("#menu-active");
const menuImageFile = document.querySelector("#menu-image-file");
const menuImageUrl = document.querySelector("#menu-image-url");
const menuImagePreview = document.querySelector("#menu-image-preview");
const menuOptionsList = document.querySelector("#menu-options-list");
const menuOptionAdd = document.querySelector("#menu-option-add");

const promosList = document.querySelector("#promos-list");
const promosRefresh = document.querySelector("#promos-refresh");
const promoForm = document.querySelector("#promo-form");
const promoFormTitle = document.querySelector("#promo-form-title");
const promoNote = document.querySelector("#promo-note");
const promoDelete = document.querySelector("#promo-delete");
const promoReset = document.querySelector("#promo-reset");
const promoId = document.querySelector("#promo-id");
const promoTitle = document.querySelector("#promo-title");
const promoText = document.querySelector("#promo-text");
const promoTheme = document.querySelector("#promo-theme");
const promoActive = document.querySelector("#promo-active");
const promoImageFile = document.querySelector("#promo-image-file");
const promoImageUrl = document.querySelector("#promo-image-url");
const promoImagePreview = document.querySelector("#promo-image-preview");

const currency = new Intl.NumberFormat("ru-RU");
const formatPrice = (value) => `${currency.format(Number(value) || 0)} \u20bd`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);

const setAuthStatus = (text, isError = false) => {
  authStatus.textContent = text;
  authStatus.style.color = isError ? "#c81d31" : "";
};

const setOrdersNote = (html, isError = false) => {
  if (!ordersNote) return;
  ordersNote.innerHTML = html || "";
  ordersNote.style.color = isError ? "#c81d31" : "";
};

const apiFetch = async (url, options = {}) => {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    setAuthStatus("Не авторизовано (401). Проверь токен.", true);
  }
  return response;
};

const apiJson = async (url, options = {}) => {
  const response = await apiFetch(url, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const msg = json?.error ? String(json.error) : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return json;
};

const setActiveTab = (tab) => {
  currentTab = tab;
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle("active", key === tab);
  }
};

const statusLabel = (status) => {
  switch (status) {
    case "incoming":
      return "Поступившие";
    case "cancelled":
      return "Отменённые";
    case "delivered":
      return "Доставлено";
    default:
      return status || "—";
  }
};

const orderTimeMs = (order) => {
  const iso = order?.createdAt || order?.updatedAt || "";
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const orderStatusPriority = (status) => {
  switch (status) {
    case "incoming":
      return 0;
    case "delivered":
      return 1;
    case "cancelled":
      return 2;
    default:
      return 9;
  }
};

const sortOrders = (orders) =>
  [...(Array.isArray(orders) ? orders : [])].sort((a, b) => {
    const pa = orderStatusPriority(a?.status);
    const pb = orderStatusPriority(b?.status);
    if (pa !== pb) return pa - pb;
    return orderTimeMs(b) - orderTimeMs(a);
  });

const formatTime = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU");
};

const renderOrders = (orders) => {
  if (!orders.length) {
    ordersList.innerHTML = '<div class="admin-item"><p class="admin-item__meta">Заказов нет.</p></div>';
    return;
  }

  ordersList.innerHTML = orders
    .map((order) => {
      const itemsCount = (order.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const itemsHtml = (order.items || [])
        .map((i) => {
          const lineTotal = Number(i.price || 0) * Number(i.quantity || 0);
          const label = String(i.optionLabel || "").trim();
          const title = label ? `${String(i.name || "")} (${label})` : String(i.name || "");
          return `<li>${escapeHtml(title)} x${Number(i.quantity || 0)} = <b>${formatPrice(lineTotal)}</b></li>`;
        })
        .join("");

      return `
        <article class="admin-item">
          <div class="admin-item__top">
            <div>
              <p class="admin-item__title">${order.customer?.name || "—"}</p>
              <p class="admin-item__meta">${formatTime(order.createdAt)} · ${order.customer?.phone || ""}</p>
              <p class="admin-item__meta">${order.customer?.address || ""}</p>
              ${order.customer?.comment ? `<p class="admin-item__meta">Комментарий: ${escapeHtml(order.customer.comment)}</p>` : ""}
              <p class="admin-item__meta">${itemsCount} поз. · <b>${formatPrice(order.total)}</b></p>
            </div>
            <span class="admin-chip ${order.status}">${statusLabel(order.status)}</span>
          </div>
          <details class="admin-details">
            <summary>Состав заказа</summary>
            <ul class="admin-items">${itemsHtml || "<li>—</li>"}</ul>
          </details>
          <div class="admin-item__actions">
            <label>
              Статус
              <select class="admin-status-select" data-id="${order.id}">
                <option value="incoming" ${order.status === "incoming" ? "selected" : ""}>Поступившие</option>
                <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>Отменённые</option>
                <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>Доставлено</option>
              </select>
            </label>
          </div>
        </article>
      `;
    })
    .join("");
};

const filterOrdersByStatus = (orders, status) => {
  if (!status) return orders;
  return orders.filter((o) => o?.status === status);
};

const loadOrders = async (prefetchedAll = null) => {
  const status = ordersStatus.value;
  let orders = null;

  if (prefetchedAll) {
    orders = filterOrdersByStatus(prefetchedAll, status);
  } else {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    orders = await apiJson(`/api/admin/orders${qs}`);
  }

  const sorted = sortOrders(orders);
  renderOrders(sorted);
  return sorted;
};

const ordersSignature = (orders) =>
  JSON.stringify(
    (Array.isArray(orders) ? orders : []).map((o) => [o?.id, o?.status, o?.updatedAt, o?.createdAt]),
  );

let lastAllOrdersSig = "";
let lastAllOrdersIds = new Set();

const fetchAllOrdersSorted = async () => {
  const all = await apiJson("/api/admin/orders");
  return sortOrders(all);
};

const primeOrdersWatch = async (sortedAll = null) => {
  const next = sortedAll || (await fetchAllOrdersSorted());
  lastAllOrdersSig = ordersSignature(next);
  lastAllOrdersIds = new Set(next.map((o) => String(o?.id || "")).filter(Boolean));
};

const pollOrders = async () => {
  const sortedAll = await fetchAllOrdersSorted();
  const sig = ordersSignature(sortedAll);
  if (sig === lastAllOrdersSig) {
    return;
  }

  const newIncoming = sortedAll.filter(
    (o) => o?.status === "incoming" && !lastAllOrdersIds.has(String(o?.id || "")),
  );

  lastAllOrdersSig = sig;
  lastAllOrdersIds = new Set(sortedAll.map((o) => String(o?.id || "")).filter(Boolean));

  if (currentTab === "orders") {
    await loadOrders(sortedAll);
    if (newIncoming.length > 0) {
      setOrdersNote(`Новый заказ: +<b>${newIncoming.length}</b>`);
      setTimeout(() => {
        if (ordersNote && ordersNote.textContent.startsWith("Новый заказ")) {
          setOrdersNote("");
        }
      }, 5000);
    }
  }
};

let menuData = [];
let menuFilterValue = "";

const setCategoryForm = (category) => {
  categoryId.value = category?.id || "";
  categoryName.value = category?.name || "";
  categoryFormTitle.textContent = categoryId.value ? "Редактировать категорию" : "Новая категория";
  categoryDelete.hidden = !categoryId.value;
  categoryNote.textContent = "";
};

const renderCategories = () => {
  if (!categoriesList) {
    return;
  }

  if (!categoriesData.length) {
    categoriesList.innerHTML = '<div class="admin-item"><p class="admin-item__meta">Категорий нет.</p></div>';
    return;
  }

  const counts = new Map();
  for (const item of menuData) {
    const cat = String(item.category || "").trim();
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  categoriesList.innerHTML = categoriesData
    .map((c, idx) => {
      const count = counts.get(String(c.name || "").trim()) || 0;
      return `
        <article class="admin-item">
          <div class="admin-item__top">
            <div>
              <p class="admin-item__title">${escapeHtml(c.name)}</p>
              <p class="admin-item__meta">Блюд в категории: <b>${count}</b></p>
            </div>
            <span class="admin-chip">${idx + 1}</span>
          </div>
          <div class="admin-item__actions">
            <button class="admin-btn" type="button" data-action="cat-up" data-id="${c.id}">Вверх</button>
            <button class="admin-btn" type="button" data-action="cat-down" data-id="${c.id}">Вниз</button>
            <button class="admin-btn" type="button" data-action="cat-edit" data-id="${c.id}">Редактировать</button>
            <button class="admin-btn admin-btn--danger" type="button" data-action="cat-delete" data-id="${c.id}">Удалить</button>
          </div>
        </article>
      `;
    })
    .join("");
};

const loadCategories = async () => {
  const cats = await apiJson("/api/admin/categories");
  categoriesData = Array.isArray(cats) ? cats : [];
  populateCategorySelect();
  populateMenuFilterSelect();
  renderCategories();
};

const setMenuForm = (item) => {
  const prevCategory = menuCategory.value;
  menuId.value = item?.id || "";
  menuTitle.value = item?.title || "";
  menuDescription.value = item?.description || "";
  menuWeight.value = item?.weight || "";
  const cat = String(item?.category || "").trim();
  const options = new Set(Array.from(menuCategory.options).map((o) => o.value));
  if (item) {
    menuCategory.value = options.has(cat) ? cat : "";
  } else {
    menuCategory.value = options.has(prevCategory) ? prevCategory : "";
  }
  menuPrice.value = item?.price ?? "";
  if (!item) {
    menuPrice.value = "";
    menuWeight.value = "";
  }
  menuActive.checked = item ? Boolean(item.active) : true;
  menuImageUrl.value = item?.imageUrl || "";
  menuImageFile.value = "";
  menuImagePreview.style.backgroundImage = menuImageUrl.value ? `url("${menuImageUrl.value}")` : "";
  renderMenuOptions(Array.isArray(item?.options) ? item.options : []);
  menuFormTitle.textContent = menuId.value ? "Редактировать блюдо" : "Новое блюдо";
  menuDelete.hidden = !menuId.value;
  menuNote.textContent = "";
};

function renderMenuOptions(options) {
  if (!menuOptionsList) return;
  const list = Array.isArray(options) ? options : [];

  if (list.length === 0) {
    menuOptionsList.innerHTML = '<p class="admin-option-empty">Вариантов нет.</p>';
    return;
  }

  menuOptionsList.innerHTML = list
    .map((opt) => {
      const id = String(opt?.id || "").trim() || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
      const label = String(opt?.label || "").trim();
      const price = Number(opt?.price ?? "");
      return `
        <div class="admin-option-row" data-id="${escapeHtml(id)}">
          <input type="text" class="admin-option-label" placeholder="Напр. 30 см" value="${escapeHtml(label)}">
          <input type="number" class="admin-option-price" min="0" step="1" value="${Number.isFinite(price) ? price : ""}">
          <button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-action="remove-option">Удалить</button>
        </div>
      `;
    })
    .join("");
}

const appendMenuOptionRow = (opt = null) => {
  if (!menuOptionsList) return;

  const isEmpty = Boolean(menuOptionsList.querySelector(".admin-option-empty"));
  if (isEmpty) {
    menuOptionsList.innerHTML = "";
  }

  const id = String(opt?.id || "").trim() || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
  const label = String(opt?.label || "").trim();
  const price = opt?.price !== undefined ? Number(opt.price) : "";

  const row = document.createElement("div");
  row.className = "admin-option-row";
  row.dataset.id = id;
  row.innerHTML = `
    <input type="text" class="admin-option-label" placeholder="Напр. 30 см" value="${escapeHtml(label)}">
    <input type="number" class="admin-option-price" min="0" step="1" value="${Number.isFinite(price) ? price : ""}">
    <button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-action="remove-option">Удалить</button>
  `;
  menuOptionsList.appendChild(row);
};

const readMenuOptionsFromEditor = () => {
  if (!menuOptionsList) return { options: [], error: null };

  const rows = Array.from(menuOptionsList.querySelectorAll(".admin-option-row"));
  const out = [];

  for (const row of rows) {
    const id = String(row.dataset.id || "").trim() || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
    const labelInput = row.querySelector(".admin-option-label");
    const priceInput = row.querySelector(".admin-option-price");
    const label = String(labelInput?.value || "").trim();
    const rawPrice = String(priceInput?.value || "").trim();

    if (!label && !rawPrice) {
      continue;
    }
    if (!label) {
      return { options: [], error: "У варианта нет названия." };
    }

    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price < 0) {
      return { options: [], error: `Неверная цена у варианта "${label}".` };
    }

    out.push({ id, label, price: Math.round(price) });
  }

  return { options: out, error: null };
};

let categoriesData = [];

const populateCategorySelect = () => {
  const current = menuCategory.value;
  const menuCats = Array.from(new Set(menuData.map((i) => String(i.category || "").trim()).filter(Boolean)));
  const ordered = categoriesData.map((c) => String(c.name || "").trim()).filter(Boolean);
  const known = new Set(ordered.map((c) => c.toLowerCase()));
  const unknown = menuCats.filter((c) => !known.has(c.toLowerCase())).sort((a, b) => a.localeCompare(b, "ru"));
  const options = [...ordered, ...unknown];

  menuCategory.innerHTML = [
    '<option value="">Без категории</option>',
    ...options.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
  ].join("");

  const hasCurrent = Array.from(menuCategory.options).some((o) => o.value === current);
  menuCategory.value = hasCurrent ? current : "";
};

const populateMenuFilterSelect = () => {
  if (!menuFilterCategory) return;

  const menuCats = Array.from(new Set(menuData.map((i) => String(i.category || "").trim()).filter(Boolean)));
  const ordered = categoriesData.map((c) => String(c.name || "").trim()).filter(Boolean);
  const known = new Set(ordered.map((c) => c.toLowerCase()));
  const unknown = menuCats.filter((c) => !known.has(c.toLowerCase())).sort((a, b) => a.localeCompare(b, "ru"));
  const options = [...ordered, ...unknown];

  const current = menuFilterCategory.value || "";
  menuFilterCategory.innerHTML = [
    '<option value="">Все</option>',
    '<option value="__none__">Без категории</option>',
    ...options.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
  ].join("");

  const hasCurrent = Array.from(menuFilterCategory.options).some((o) => o.value === current);
  menuFilterCategory.value = hasCurrent ? current : "";
  menuFilterValue = menuFilterCategory.value;
};

const renderMenu = (items) => {
  const list = Array.isArray(items) ? items : [];
  const filtered =
    menuFilterValue === ""
      ? list
      : menuFilterValue === "__none__"
        ? list.filter((i) => !String(i.category || "").trim())
        : list.filter((i) => String(i.category || "").trim() === menuFilterValue);

  if (!filtered.length) {
    menuList.innerHTML = '<div class="admin-item"><p class="admin-item__meta">Блюд нет.</p></div>';
    return;
  }

  menuList.innerHTML = filtered
    .map((item) => {
      const img = item.imageUrl ? `style="background-image:url('${item.imageUrl}')"` : "";
      return `
        <article class="admin-item" data-id="${item.id}">
          <div class="admin-item__top">
            <div>
              <p class="admin-item__title">${item.title}</p>
               <p class="admin-item__meta">${item.category || "—"} · <b>${formatPrice(item.price)}</b>${item.weight ? ` · <span class="admin-weight">${escapeHtml(item.weight)}</span>` : ""}</p>
               <p class="admin-item__meta">${item.active ? "Показывается на сайте" : "Скрыто"}</p>
             </div>
            <div class="admin-thumb" ${img}></div>
          </div>
          <div class="admin-item__actions">
            <button class="admin-btn" type="button" data-action="edit-menu" data-id="${item.id}">Редактировать</button>
            <button class="admin-btn" type="button" data-action="toggle-menu" data-id="${item.id}">
              ${item.active ? "Снять" : "Показать"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
};

const loadMenu = async () => {
  const items = await apiJson("/api/admin/menu");
  const list = Array.isArray(items) ? items : [];
  menuData = list;
  populateCategorySelect();
  populateMenuFilterSelect();
  renderMenu(list);
  renderCategories();
};

const setPromoForm = (promo) => {
  promoId.value = promo?.id || "";
  promoTitle.value = promo?.title || "";
  promoText.value = promo?.text || "";
  promoTheme.value = promo?.theme || "pink";
  promoActive.checked = Boolean(promo?.active);
  promoImageUrl.value = promo?.imageUrl || "";
  promoImageFile.value = "";
  promoImagePreview.style.backgroundImage = promoImageUrl.value ? `url("${promoImageUrl.value}")` : "";
  promoFormTitle.textContent = promoId.value ? "Редактировать акцию" : "Новая акция";
  promoDelete.hidden = !promoId.value;
  promoNote.textContent = "";
};

const renderPromos = (promos) => {
  if (!promos.length) {
    promosList.innerHTML = '<div class="admin-item"><p class="admin-item__meta">Акций нет.</p></div>';
    return;
  }

  promosList.innerHTML = promos
    .map((promo) => {
      const img = promo.imageUrl ? `style="background-image:url('${promo.imageUrl}')"` : "";
      return `
        <article class="admin-item" data-id="${promo.id}">
          <div class="admin-item__top">
            <div>
              <p class="admin-item__title">${promo.title}</p>
              <p class="admin-item__meta">${promo.text}</p>
              <p class="admin-item__meta">${promo.active ? "Показывается на сайте" : "Скрыто"}</p>
            </div>
            <div class="admin-thumb" ${img}></div>
          </div>
          <div class="admin-item__actions">
            <button class="admin-btn" type="button" data-action="edit-promo" data-id="${promo.id}">Редактировать</button>
            <button class="admin-btn" type="button" data-action="toggle-promo" data-id="${promo.id}">
              ${promo.active ? "Снять" : "Показать"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
};

const loadPromos = async () => {
  const promos = await apiJson("/api/admin/promos");
  renderPromos(Array.isArray(promos) ? promos : []);
};

const uploadImage = async (file) => {
  const data = new FormData();
  data.append("file", file);
  const response = await apiFetch("/api/admin/upload", { method: "POST", body: data });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error || `HTTP ${response.status}`);
  }
  return json.url;
};

tokenSaveButton.addEventListener("click", async () => {
  const token = String(tokenInput.value || "").trim();
  if (!token) {
    setAuthStatus("Введи токен.", true);
    return;
  }

  setToken(token);
  setAuthStatus("Токен сохранён.");

  try {
    const allOrders = await fetchAllOrdersSorted();
    await primeOrdersWatch(allOrders);
    await loadOrders(allOrders);
    await loadCategories();
    await loadMenu();
    await loadPromos();
    setAuthStatus("Авторизовано.");
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

for (const btn of tabButtons) {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
}

ordersRefresh.addEventListener("click", async () => {
  try {
    await loadOrders();
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

if (ordersArchive) {
  ordersArchive.addEventListener("click", async () => {
    if (!confirm("Архивировать все текущие заказы? После этого список заказов будет очищен.")) {
      return;
    }

    ordersArchive.disabled = true;
    if (ordersClear) ordersClear.disabled = true;
    ordersRefresh.disabled = true;
    setOrdersNote("Архивируем...");

    try {
      const result = await apiJson("/api/admin/orders/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      if (!result?.archived) {
        setOrdersNote("Заказов нет.");
      } else {
        const file = String(result.file || "");
        const count = Number(result.count || 0);
        setOrdersNote(
          `Архив создан: <b>${escapeHtml(file)}</b> (${count}) <button class="admin-btn admin-btn--sm" type="button" data-archive-download="${escapeHtml(file)}">Скачать</button>`,
        );
      }

      await loadOrders();
    } catch (err) {
      setOrdersNote(`Ошибка: ${escapeHtml(err.message)}`, true);
    } finally {
      ordersArchive.disabled = false;
      if (ordersClear) ordersClear.disabled = false;
      ordersRefresh.disabled = false;
    }
  });
}

if (ordersNote) {
  ordersNote.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const btn = target.closest("[data-archive-download]");
    if (!(btn instanceof HTMLButtonElement)) {
      return;
    }

    const file = String(btn.dataset.archiveDownload || "").trim();
    if (!file) return;

    btn.disabled = true;
    setOrdersNote(`Скачиваем архив: <b>${escapeHtml(file)}</b> ...`);

    try {
      const response = await apiFetch(`/api/admin/orders/archives/${encodeURIComponent(file)}`);
      if (!response.ok) {
        const text = await response.text();
        let msg = `HTTP ${response.status}`;
        try {
          const json = text ? JSON.parse(text) : null;
          if (json?.error) msg = String(json.error);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setOrdersNote(`Архив скачан: <b>${escapeHtml(file)}</b>.`);
    } catch (err) {
      setOrdersNote(`Ошибка: ${escapeHtml(err.message)}`, true);
    } finally {
      btn.disabled = false;
    }
  });
}

if (ordersClear) {
  ordersClear.addEventListener("click", async () => {
    if (!confirm("Очистить все заказы без архива? Это действие нельзя отменить.")) {
      return;
    }

    if (!confirm("Точно удалить все заказы?")) {
      return;
    }

    ordersClear.disabled = true;
    if (ordersArchive) ordersArchive.disabled = true;
    ordersRefresh.disabled = true;
    setOrdersNote("Очищаем...");

    try {
      const result = await apiJson("/api/admin/orders/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      setOrdersNote(`Удалено заказов: <b>${Number(result?.cleared || 0)}</b>.`);
      await loadOrders();
    } catch (err) {
      setOrdersNote(`Ошибка: ${escapeHtml(err.message)}`, true);
    } finally {
      ordersClear.disabled = false;
      if (ordersArchive) ordersArchive.disabled = false;
      ordersRefresh.disabled = false;
    }
  });
}

ordersStatus.addEventListener("change", async () => {
  try {
    await loadOrders();
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

ordersList.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (!target.classList.contains("admin-status-select")) {
    return;
  }
  const id = target.dataset.id;
  const status = target.value;
  if (!id || !status) {
    return;
  }

  try {
    await apiJson(`/api/admin/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadOrders();
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

if (categoriesRefresh) {
  categoriesRefresh.addEventListener("click", async () => {
    try {
      await loadCategories();
    } catch (err) {
      setAuthStatus(`Ошибка: ${err.message}`, true);
    }
  });
}

if (categoryReset) {
  categoryReset.addEventListener("click", () => setCategoryForm(null));
}

if (categoryForm) {
  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    categoryNote.textContent = "";

    const name = String(categoryName.value || "").trim();
    if (!name) {
      categoryNote.textContent = "Введите название.";
      return;
    }

    try {
      if (categoryId.value) {
        await apiJson(`/api/admin/categories/${encodeURIComponent(categoryId.value)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        categoryNote.textContent = "Сохранено.";
      } else {
        await apiJson("/api/admin/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        categoryNote.textContent = "Создано.";
        await loadCategories();
        setCategoryForm(null);
        categoryNote.textContent = "Создано.";
      }

      await loadMenu();
      await loadCategories();
    } catch (err) {
      categoryNote.textContent = `Ошибка: ${err.message}`;
    }
  });
}

if (categoryDelete) {
  categoryDelete.addEventListener("click", async () => {
    if (!categoryId.value) return;
    categoryNote.textContent = "";
    try {
      await apiJson(`/api/admin/categories/${encodeURIComponent(categoryId.value)}`, { method: "DELETE" });
      setCategoryForm(null);
      await loadMenu();
      await loadCategories();
    } catch (err) {
      categoryNote.textContent = `Ошибка: ${err.message}`;
    }
  });
}

if (categoriesList) {
  categoriesList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    if (!action || !id) {
      return;
    }

    try {
      if (action === "cat-edit") {
        const cat = categoriesData.find((c) => c.id === id);
        if (cat) setCategoryForm(cat);
        return;
      }

      if (action === "cat-delete") {
        await apiJson(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadMenu();
        await loadCategories();
        if (categoryId.value === id) {
          setCategoryForm(null);
        }
        return;
      }

      if (action === "cat-up" || action === "cat-down") {
        const move = action === "cat-up" ? "up" : "down";
        await apiJson(`/api/admin/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ move }),
        });
        await loadCategories();
      }
    } catch (err) {
      setAuthStatus(`Ошибка: ${err.message}`, true);
    }
  });
}

menuRefresh.addEventListener("click", async () => {
  try {
    await loadMenu();
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

menuReset.addEventListener("click", () => setMenuForm(null));

if (menuOptionAdd) {
  menuOptionAdd.addEventListener("click", () => appendMenuOptionRow());
}

if (menuOptionsList) {
  menuOptionsList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('[data-action="remove-option"]');
    if (!(btn instanceof HTMLButtonElement)) return;
    const row = btn.closest(".admin-option-row");
    if (row) {
      row.remove();
    }
    if (menuOptionsList.querySelectorAll(".admin-option-row").length === 0) {
      menuOptionsList.innerHTML = '<p class="admin-option-empty">Вариантов нет.</p>';
    }
  });
}

if (menuFilterCategory) {
  menuFilterCategory.addEventListener("change", () => {
    menuFilterValue = menuFilterCategory.value;
    renderMenu(menuData);
  });
}

menuImageFile.addEventListener("change", async () => {
  const file = menuImageFile.files?.[0];
  if (!file) return;
  menuNote.textContent = "Загрузка картинки...";
  try {
    const url = await uploadImage(file);
    menuImageUrl.value = url;
    menuImagePreview.style.backgroundImage = `url("${url}")`;
    menuNote.textContent = "Картинка загружена.";
  } catch (err) {
    menuNote.textContent = `Ошибка загрузки: ${err.message}`;
  }
});

menuList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");
  if (!action || !id) {
    return;
  }

  try {
    const items = await apiJson("/api/admin/menu");
    const item = items.find((i) => i.id === id);
    if (!item) {
      throw new Error("not_found");
    }

    if (action === "edit-menu") {
      setMenuForm(item);
      return;
    }

    if (action === "toggle-menu") {
      await apiJson(`/api/admin/menu/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      await loadMenu();
    }
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

menuForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  menuNote.textContent = "";

  const selectedCategory = menuCategory.value.trim();
  const optionsResult = readMenuOptionsFromEditor();
  if (optionsResult.error) {
    menuNote.textContent = optionsResult.error;
    return;
  }

  const payload = {
    title: menuTitle.value.trim(),
    description: menuDescription.value.trim(),
    weight: String(menuWeight.value || "").trim(),
    category: selectedCategory,
    price: Number(menuPrice.value),
    options: optionsResult.options,
    active: Boolean(menuActive.checked),
    imageUrl: menuImageUrl.value.trim(),
  };

  try {
    if (menuId.value) {
      await apiJson(`/api/admin/menu/${encodeURIComponent(menuId.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      menuNote.textContent = "Сохранено.";
    } else {
      await apiJson("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      menuNote.textContent = "Создано.";
      await loadMenu();
      setMenuForm(null);
      menuCategory.value = selectedCategory;
      menuNote.textContent = "Создано.";
    }
    if (menuId.value) {
      await loadMenu();
    }
  } catch (err) {
    menuNote.textContent = `Ошибка: ${err.message}`;
  }
});

menuDelete.addEventListener("click", async () => {
  if (!menuId.value) return;
  menuNote.textContent = "";
  try {
    await apiJson(`/api/admin/menu/${encodeURIComponent(menuId.value)}`, { method: "DELETE" });
    setMenuForm(null);
    await loadMenu();
  } catch (err) {
    menuNote.textContent = `Ошибка: ${err.message}`;
  }
});

promosRefresh.addEventListener("click", async () => {
  try {
    await loadPromos();
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

promoReset.addEventListener("click", () => setPromoForm(null));

promoImageFile.addEventListener("change", async () => {
  const file = promoImageFile.files?.[0];
  if (!file) return;
  promoNote.textContent = "Загрузка картинки...";
  try {
    const url = await uploadImage(file);
    promoImageUrl.value = url;
    promoImagePreview.style.backgroundImage = `url("${url}")`;
    promoNote.textContent = "Картинка загружена.";
  } catch (err) {
    promoNote.textContent = `Ошибка загрузки: ${err.message}`;
  }
});

promosList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");
  if (!action || !id) {
    return;
  }

  try {
    const promos = await apiJson("/api/admin/promos");
    const promo = promos.find((p) => p.id === id);
    if (!promo) {
      throw new Error("not_found");
    }

    if (action === "edit-promo") {
      setPromoForm(promo);
      return;
    }

    if (action === "toggle-promo") {
      await apiJson(`/api/admin/promos/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !promo.active }),
      });
      await loadPromos();
    }
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
});

promoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  promoNote.textContent = "";

  const payload = {
    title: promoTitle.value.trim(),
    text: promoText.value.trim(),
    theme: promoTheme.value,
    active: Boolean(promoActive.checked),
    imageUrl: promoImageUrl.value.trim(),
  };

  try {
    if (promoId.value) {
      await apiJson(`/api/admin/promos/${encodeURIComponent(promoId.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      promoNote.textContent = "Сохранено.";
    } else {
      const created = await apiJson("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPromoForm(created);
      promoNote.textContent = "Создано.";
    }
    await loadPromos();
  } catch (err) {
    promoNote.textContent = `Ошибка: ${err.message}`;
  }
});

promoDelete.addEventListener("click", async () => {
  if (!promoId.value) return;
  promoNote.textContent = "";
  try {
    await apiJson(`/api/admin/promos/${encodeURIComponent(promoId.value)}`, { method: "DELETE" });
    setPromoForm(null);
    await loadPromos();
  } catch (err) {
    promoNote.textContent = `Ошибка: ${err.message}`;
  }
});

const init = async () => {
  tokenInput.value = getToken();
  if (!tokenInput.value) {
    setAuthStatus("Введи ADMIN_TOKEN и нажми Сохранить.");
    return;
  }

  try {
    const allOrders = await fetchAllOrdersSorted();
    await primeOrdersWatch(allOrders);
    await loadOrders(allOrders);
    await loadCategories();
    await loadMenu();
    await loadPromos();
    setAuthStatus("Авторизовано.");
  } catch (err) {
    setAuthStatus(`Ошибка: ${err.message}`, true);
  }
};

let currentTab = "orders";

setActiveTab("orders");
populateCategorySelect();
setCategoryForm(null);
setMenuForm(null);
setPromoForm(null);
init();

setInterval(() => {
  if (currentTab !== "orders") {
    return;
  }
  if (!getToken()) {
    return;
  }
  pollOrders().catch(() => {});
}, 5000);
