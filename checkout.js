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
    const customer = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      address: String(form.get("address") || "").trim(),
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
