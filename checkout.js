(() => {
  const STORAGE_KEY = "mr_tai_cart";
  const currency = new Intl.NumberFormat("ru-RU");

  const checkoutForm = document.querySelector("#checkout-form");
  const orderSummary = document.querySelector("#order-summary");
  const orderTotalField = document.querySelector("#order-total-field");
  const submitOrderButton = document.querySelector("#submit-order");
  const checkoutNote = document.querySelector("#checkout-note");

  if (!checkoutForm || !orderSummary || !orderTotalField || !submitOrderButton || !checkoutNote) {
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
        return `
          <article class="order-summary__item">
            <p>${escapeHtml(item.name)}</p>
            <span>${item.quantity} x ${formatPrice(item.price)} = ${formatPrice(lineTotal)}</span>
          </article>
        `;
      })
      .join("");
  };

  checkoutForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setNote("");

    const items = loadCartItems();
    if (items.length === 0) {
      setNote("Корзина пуста. Добавьте блюда перед оформлением.", "error");
      return;
    }

    const form = new FormData(checkoutForm);
    const customer = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      address: String(form.get("address") || "").trim(),
      comment: String(form.get("comment") || "").trim(),
    };

    const orderItems = items.map((i) => ({ id: i.id, quantity: i.quantity }));

    submitOrderButton.disabled = true;
    setNote("Отправляем заказ...");

    fetch("/api/public/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, items: orderItems }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        return json;
      })
      .then((result) => {
        localStorage.removeItem(STORAGE_KEY);
        checkoutForm.reset();
        renderOrderSummary();
        setNote(`Заказ принят (№ ${String(result.id).slice(0, 8)}). Менеджер свяжется с вами.`);
      })
      .catch((err) => {
        setNote(`Не удалось отправить заказ: ${err.message}`, "error");
      })
      .finally(() => {
        submitOrderButton.disabled = false;
      });
  });

  renderOrderSummary();
})();
