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
        if (
          !item?.id ||
          !item?.name ||
          !Number.isFinite(item?.price) ||
          !Number.isFinite(item?.quantity) ||
          item.quantity <= 0
        ) {
          continue;
        }

        cartState.set(item.id, {
          id: String(item.id),
          name: String(item.name),
          price: Number(item.price),
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
    const price = Number(card?.dataset.price || 0);

    return { id, name, price };
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
        return `
          <article class="cart-item">
            <div class="cart-item__top">
              <h4>${escapeHtml(item.name)}</h4>
              <span class="cart-item__sum">${formatPrice(lineTotal)}</span>
            </div>
            <div class="qty-controls">
              <button type="button" class="qty-btn" data-action="decrease" data-id="${escapeHtml(item.id)}" aria-label="Уменьшить количество">-</button>
              <span class="qty-value">${item.quantity}</span>
              <button type="button" class="qty-btn" data-action="increase" data-id="${escapeHtml(item.id)}" aria-label="Увеличить количество">+</button>
            </div>
          </article>
        `;
      })
      .join("");

    persistCart();
  };

  const updateItemQuantity = (id, delta) => {
    const item = cartState.get(id);
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
    if (!item.id || !item.name || item.price <= 0) {
      return;
    }

    const existingItem = cartState.get(item.id);
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cartState.set(item.id, { ...item, quantity: 1 });
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

  cartItemsContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    if (!target.classList.contains("qty-btn")) {
      return;
    }

    const itemId = target.dataset.id;
    if (!itemId) {
      return;
    }

    const delta = target.dataset.action === "increase" ? 1 : -1;
    updateItemQuantity(itemId, delta);
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
