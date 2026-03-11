(() => {
  const cartToggleButton = document.querySelector("#cart-toggle");
  const cartCountElement = document.querySelector("#cart-count");
  const cartTotalElement = document.querySelector("#cart-total");
  const cartDrawerTotalElement = document.querySelector("#cart-drawer-total");
  const cartDrawer = document.querySelector("#cart-drawer");
  const cartOverlay = document.querySelector("#cart-overlay");
  const cartCloseButton = document.querySelector("#cart-close");
  const cartItemsContainer = document.querySelector("#cart-items");
  const goToOrderButton = document.querySelector("#go-to-order");

  const hasCartDom =
    cartToggleButton &&
    cartCountElement &&
    cartTotalElement &&
    cartDrawerTotalElement &&
    cartDrawer &&
    cartOverlay &&
    cartCloseButton &&
    cartItemsContainer &&
    goToOrderButton;

  if (!hasCartDom) {
    // If layout changes and cart DOM is missing, don't crash the page.
    // eslint-disable-next-line no-console
    console.warn("[cart] Missing required DOM elements; cart is disabled on this page.");
    return;
  }

  const STORAGE_KEY = "mr_tai_cart";
  const currency = new Intl.NumberFormat("ru-RU");
  const cartState = new Map();

  const formatPrice = (value) => `${currency.format(value)} \u20bd`;

  const escapeHtml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const persistCart = () => {
    const items = Array.from(cartState.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  const loadCart = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      for (const item of parsed) {
        const baseId = String(item?.id || "").trim();
        const optionId = String(item?.optionId || "").trim();
        const key = String(item?.key || (optionId ? `${baseId}::${optionId}` : baseId)).trim();
        const optionLabel = String(item?.optionLabel || "").trim();
        if (
          !baseId ||
          !key ||
          !item?.name ||
          !Number.isFinite(item?.price) ||
          !Number.isFinite(item?.quantity) ||
          item.quantity <= 0
        ) {
          continue;
        }

        cartState.set(key, {
          key,
          id: baseId,
          name: String(item.name),
          price: Number(item.price),
          optionId,
          optionLabel,
          quantity: Number(item.quantity),
        });
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const setCartOpenState = (isOpen) => {
    cartDrawer.classList.toggle("open", isOpen);
    cartOverlay.hidden = !isOpen;
    document.body.classList.toggle("cart-open", isOpen);
    cartDrawer.setAttribute("aria-hidden", String(!isOpen));
    cartToggleButton.setAttribute("aria-expanded", String(isOpen));
  };

  const getCardData = (button) => {
    const card = button.closest(".food-card");
    const id = card?.dataset.id || "";
    const name = card?.dataset.name || card?.querySelector("h4")?.textContent?.trim() || "";
    const basePrice = Number(card?.dataset.basePrice || card?.dataset.price || 0);

    const optionSelect = card?.querySelector(".food-option");
    const selectedOption = optionSelect?.selectedOptions?.[0] || null;
    const optionId = optionSelect ? String(optionSelect.value || "").trim() : "";
    const optionLabel = optionSelect ? String(selectedOption?.textContent || "").trim() : "";
    const optionPrice = optionSelect ? Number(selectedOption?.dataset.price || 0) : NaN;
    const price = Number.isFinite(optionPrice) && optionPrice >= 0 ? optionPrice : basePrice;
    const key = optionId ? `${id}::${optionId}` : id;

    return { key, id, name, price, optionId, optionLabel };
  };

  const renderCart = () => {
    const items = Array.from(cartState.values());
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    cartCountElement.textContent = String(itemCount);
    cartTotalElement.textContent = formatPrice(total);
    cartDrawerTotalElement.textContent = formatPrice(total);

    if (items.length === 0) {
      cartItemsContainer.innerHTML = '<p class="cart-empty">Корзина пока пустая. Добавьте блюда из меню.</p>';
      persistCart();
      return;
    }

    cartItemsContainer.innerHTML = items
      .map((item) => {
        const lineTotal = item.price * item.quantity;
        const title = item.optionLabel ? `${item.name} (${item.optionLabel})` : item.name;
        return `
          <article class="cart-item">
            <div class="cart-item__top">
              <h4>${escapeHtml(title)}</h4>
              <span class="cart-item__sum">${formatPrice(lineTotal)}</span>
            </div>
            <div class="qty-controls">
              <button type="button" class="qty-btn" data-action="decrease" data-key="${escapeHtml(item.key)}" aria-label="Уменьшить количество">-</button>
              <span class="qty-value">${item.quantity}</span>
              <button type="button" class="qty-btn" data-action="increase" data-key="${escapeHtml(item.key)}" aria-label="Увеличить количество">+</button>
            </div>
          </article>
        `;
      })
      .join("");

    persistCart();
  };

  const updateItemQuantity = (key, delta) => {
    const item = cartState.get(key);
    if (!item) {
      return;
    }

    item.quantity += delta;
    if (item.quantity <= 0) {
      cartState.delete(id);
    }

    renderCart();
  };

  const addToCart = (button) => {
    const item = getCardData(button);
    if (!item.key || !item.id || !item.name || item.price <= 0) {
      return;
    }

    const existingItem = cartState.get(item.key);
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cartState.set(item.key, { ...item, quantity: 1 });
    }

    renderCart();

    button.classList.add("added");
    button.textContent = "Добавлено";
    setTimeout(() => {
      button.classList.remove("added");
      button.textContent = "В корзину";
    }, 900);
  };

  // Event delegation so menu can be rendered dynamically (site.js).
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest(".order-btn");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    addToCart(button);
  });

  // Keep price label in sync when a user changes variant (e.g. pizza size).
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    if (!target.classList.contains("food-option")) {
      return;
    }

    const card = target.closest(".food-card");
    const priceEl = card?.querySelector(".food-price");
    const opt = target.selectedOptions?.[0] || null;
    const optionPrice = Number(opt?.dataset.price || 0);
    const basePrice = Number(card?.dataset.basePrice || card?.dataset.price || 0);
    const nextPrice = Number.isFinite(optionPrice) && optionPrice >= 0 ? optionPrice : basePrice;

    if (priceEl) {
      priceEl.textContent = formatPrice(nextPrice);
    }
    if (card) {
      card.dataset.price = String(nextPrice);
    }
  });

  cartItemsContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    if (!target.classList.contains("qty-btn")) {
      return;
    }

    const itemKey = target.dataset.key;
    if (!itemKey) {
      return;
    }

    const delta = target.dataset.action === "increase" ? 1 : -1;
    updateItemQuantity(itemKey, delta);
  });

  cartToggleButton.addEventListener("click", () => {
    const isOpen = cartDrawer.classList.contains("open");
    setCartOpenState(!isOpen);
  });

  cartCloseButton.addEventListener("click", () => setCartOpenState(false));
  cartOverlay.addEventListener("click", () => setCartOpenState(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && cartDrawer.classList.contains("open")) {
      setCartOpenState(false);
    }
  });

  goToOrderButton.addEventListener("click", () => {
    if (cartState.size === 0) {
      setCartOpenState(true);
      return;
    }

    persistCart();
    window.location.href = "checkout.html";
  });

  const syncCartFromStorage = () => {
    cartState.clear();
    loadCart();
    renderCart();
  };

  // Keep cart in sync when returning via back/forward cache after checkout.
  window.addEventListener("pageshow", () => syncCartFromStorage());
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      syncCartFromStorage();
    }
  });

  syncCartFromStorage();
})();
