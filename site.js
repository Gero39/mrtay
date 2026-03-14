(() => {
  const promoRow = document.querySelector("#promo-row");
  const menuGrid = document.querySelector("#menu-grid");
  const categoryNav = document.querySelector("#category-nav");

  let menuData = [];
  let promosData = [];
  let categoriesData = [];
  let currentCategory = "";

  let lastMenuSig = "";
  let lastPromoSig = "";
  let lastCatSig = "";

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const themeClass = (theme, index) => {
    const normalized = String(theme || "").toLowerCase();
    if (normalized === "pink") return "promo-card--pink";
    if (normalized === "blue") return "promo-card--blue";
    if (normalized === "sand") return "promo-card--sand";
    return ["promo-card--pink", "promo-card--blue", "promo-card--sand"][index % 3];
  };

  const renderPromos = (promos) => {
    if (!promoRow) return;
    if (!Array.isArray(promos) || promos.length === 0) {
      promoRow.innerHTML = "";
      return;
    }

    promoRow.innerHTML = promos
      .map((promo, idx) => {
        const bg = promo.imageUrl
          ? `style="background-image: linear-gradient(140deg, rgba(255,255,255,0.0) 0%, rgba(255,255,255,0.55) 100%), url('${escapeHtml(
              promo.imageUrl,
            )}'); background-size: cover; background-position: center; border-color: rgba(255, 79, 95, 0.18);"`
          : "";
        return `
          <article class="promo-card ${themeClass(promo.theme, idx)}" ${bg}>
            <h3>${escapeHtml(promo.title)}</h3>
            <p>${escapeHtml(promo.text)}</p>
          </article>
        `;
      })
      .join("");
  };

  const renderMenu = (menu) => {
    if (!menuGrid) return;
    if (!Array.isArray(menu) || menu.length === 0) {
      menuGrid.innerHTML = '<p class="menu-empty">Нет блюд в этой категории.</p>';
      return;
    }

    const splitWeightFromDescription = (description) => {
      const raw = String(description || "");
      const lines = raw.replaceAll("\r\n", "\n").split("\n");
      if (lines.length < 2) {
        return { desc: raw.trim(), weight: "" };
      }

      const last = String(lines[lines.length - 1] || "").trim();
      const maybeWeight = last.length <= 24 && /\d/.test(last) && /(г|гр|грамм)/i.test(last);
      if (!maybeWeight) {
        return { desc: raw.trim(), weight: "" };
      }

      const desc = lines.slice(0, -1).join("\n").trim();
      return { desc, weight: last };
    };

    menuGrid.innerHTML = menu
      .map((item, idx) => {
        const fallbackClass = `food-image--${(idx % 6) + 1}`;
        const imageStyle = item.imageUrl ? `style="background-image:url('${escapeHtml(item.imageUrl)}')"` : "";
        const options = Array.isArray(item.options)
          ? item.options
              .map((o) => ({
                id: String(o?.id || "").trim(),
                label: String(o?.label || "").trim(),
                price: Number(o?.price || 0),
              }))
              .filter((o) => o.id && o.label && Number.isFinite(o.price) && o.price >= 0)
          : [];

        const basePrice = Number(item.price) || 0;
        const initialPrice = options.length ? Number(options[0].price) : basePrice;
        const optionsHtml = options.length
          ? `
            <select class="food-option" aria-label="Вариант блюда">
              ${options
                .map(
                  (o) =>
                    `<option value="${escapeHtml(o.id)}" data-price="${Number(o.price) || 0}">${escapeHtml(o.label)}</option>`,
                )
                .join("")}
            </select>
          `
          : "";

        const cardClass = options.length ? "food-card has-options" : "food-card";

        const explicitWeight = String(item.weight || "").trim();
        const { desc: descFromSplit, weight: weightFromSplit } = splitWeightFromDescription(
          item.description || "",
        );
        const description = explicitWeight ? String(item.description || "").trim() : descFromSplit;
        const weight = explicitWeight || weightFromSplit;
        const weightHtml = weight ? `<p class="food-weight">${escapeHtml(weight)}</p>` : "";

        return `
          <article class="${cardClass}" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(
            item.title,
          )}" data-price="${initialPrice}" data-base-price="${basePrice}">
            <div class="food-image ${fallbackClass}" ${imageStyle}></div>
            <h4>${escapeHtml(item.title)}</h4>
            <div class="food-body">
              <p class="food-desc">${escapeHtml(description)}</p>
              ${weightHtml}
            </div>
            <div class="food-footer">
              <b class="food-price">${initialPrice} &#8381;</b>
              <div class="food-actions">
                ${optionsHtml}
                <button class="order-btn" type="button">В корзину</button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const getNavCategories = () => {
    const menuCats = Array.from(
      new Set(menuData.map((i) => String(i.category || "").trim()).filter(Boolean)),
    );

    const ordered = Array.isArray(categoriesData) && categoriesData.length
      ? categoriesData.map((c) => String(c.name || "").trim()).filter(Boolean)
      : [];

    const known = new Set(ordered.map((c) => c.toLowerCase()));
    const unknown = menuCats
      .filter((c) => !known.has(c.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, "ru"));

    return [...ordered, ...unknown];
  };

  const renderCategories = () => {
    if (!categoryNav) return;

    const cats = getNavCategories();
    if (currentCategory && !cats.some((c) => c === currentCategory)) {
      currentCategory = "";
    }

    const link = (name, value, isActive) =>
      `<a href="#" data-category="${escapeHtml(value)}" class="${isActive ? "active" : ""}">${escapeHtml(name)}</a>`;

    categoryNav.innerHTML = [
      link("Все блюда", "", currentCategory === ""),
      ...cats.map((c) => link(c, c, currentCategory === c)),
    ].join("");
  };

  const applyMenuFilter = () => {
    const filtered = currentCategory
      ? menuData.filter((i) => String(i.category || "").trim() === currentCategory)
      : menuData;
    renderMenu(filtered);
  };

  const tryLoad = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  };

  const refreshAll = async () => {
    try {
      const [promos, menu, categories] = await Promise.all([
        tryLoad("/api/public/promos"),
        tryLoad("/api/public/menu"),
        tryLoad("/api/public/categories"),
      ]);

      if (Array.isArray(categories)) {
        const sig = JSON.stringify(categories);
        if (sig !== lastCatSig) {
          lastCatSig = sig;
          categoriesData = categories;
          renderCategories();
        }
      }

      if (Array.isArray(menu)) {
        const sig = JSON.stringify(menu);
        if (sig !== lastMenuSig) {
          lastMenuSig = sig;
          menuData = menu;
          renderCategories();
          applyMenuFilter();
        }
      }

      if (Array.isArray(promos)) {
        const sig = JSON.stringify(promos);
        if (sig !== lastPromoSig) {
          lastPromoSig = sig;
          promosData = promos;
          renderPromos(promos);
        }
      }
    } catch {
      // Static fallback is already present in HTML.
    }
  };

  if (categoryNav) {
    categoryNav.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const link = target.closest("a[data-category]");
      if (!(link instanceof HTMLAnchorElement)) return;
      event.preventDefault();

      const next = String(link.dataset.category || "");
      if (next === currentCategory) {
        return;
      }
      currentCategory = next;
      renderCategories();
      applyMenuFilter();
    });
  }

  refreshAll();
  setInterval(refreshAll, 15000);
})();
