(() => {
  const promoRow = document.querySelector("#promo-row");
  const menuGrid = document.querySelector("#menu-grid");
  const categoryNav = document.querySelector("#category-nav");
  const searchInput = document.querySelector("#menu-search");
  const foodModal = document.querySelector("#food-modal");
  const foodModalClose = document.querySelector("#food-modal-close");
  const foodModalBody = document.querySelector("#food-modal-body");

  let menuData = [];
  let promosData = [];
  let promosById = new Map();
  let categoriesData = [];
  let currentCategory = "";
  let menuById = new Map();
  let navSettings = { allCategoryEnabled: true, allCategoryPosition: "top", shuffleAll: true };
  let searchQuery = "";

  let lastMenuSig = "";
  let lastPromoSig = "";
  let lastCatSig = "";
  let lastSettingsSig = "";

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

  const normalizeOptions = (options) =>
    Array.isArray(options)
      ? options
          .map((o) => ({
            id: String(o?.id || "").trim(),
            label: String(o?.label || "").trim(),
            price: Number(o?.price || 0),
          }))
          .filter((o) => o.id && o.label && Number.isFinite(o.price) && o.price >= 0)
      : [];

  const hashToImageVariant = (value) => {
    const str = String(value || "");
    let h = 0;
    for (let i = 0; i < str.length; i += 1) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return (h % 6) + 1;
  };

  const shuffleArray = (items) => {
    const out = Array.isArray(items) ? [...items] : [];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  };

  const normalizeSearch = (value) => String(value || "").trim().toLowerCase();

  const splitSearchTokens = (value) => {
    const q = normalizeSearch(value);
    if (!q) return [];
    return q.split(/\s+/).filter(Boolean);
  };

  const itemMatchesTokens = (item, tokens) => {
    if (!tokens.length) return true;
    const hay = [
      String(item?.title || ""),
      String(item?.description || ""),
      String(item?.category || ""),
      String(item?.weight || ""),
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((t) => hay.includes(t));
  };

  const renderPromos = (promos) => {
    if (!promoRow) return;
    if (!Array.isArray(promos) || promos.length === 0) {
      promoRow.innerHTML = "";
      return;
    }

    promoRow.innerHTML = promos
      .map((promo, idx) => {
        const fullText = String(promo.text || "").trim();
        const oneLine = fullText.replaceAll("\r\n", "\n").replaceAll("\n", " ");
        const preview = oneLine.length > 70 ? `${oneLine.slice(0, 70).trimEnd()}…` : oneLine;
        const bg = promo.imageUrl
          ? `style="background-image: linear-gradient(140deg, rgba(255,255,255,0.0) 0%, rgba(255,255,255,0.55) 100%), url('${escapeHtml(
              promo.imageUrl,
            )}'); background-size: cover; background-position: center; border-color: rgba(255, 79, 95, 0.18);"`
          : "";
        return `
          <article class="promo-card ${themeClass(promo.theme, idx)}" data-id="${escapeHtml(promo.id)}" ${bg}>
            <h3>${escapeHtml(promo.title)}</h3>
            <p>${escapeHtml(preview)}</p>
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

    menuGrid.innerHTML = menu
      .map((item, idx) => {
        const fallbackClass = `food-image--${(idx % 6) + 1}`;
        const imageStyle = item.imageUrl ? `style="background-image:url('${escapeHtml(item.imageUrl)}')"` : "";
        const options = normalizeOptions(item.options);

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

    const allEnabled = navSettings.allCategoryEnabled !== false;
    if (!allEnabled && currentCategory === "" && cats.length > 0) {
      currentCategory = cats[0];
    }
    if (currentCategory && currentCategory !== "" && !cats.some((c) => c === currentCategory)) {
      currentCategory = allEnabled ? "" : cats[0] || "";
    }

    const link = (name, value, isActive) =>
      `<a href="#" data-category="${escapeHtml(value)}" class="${isActive ? "active" : ""}">${escapeHtml(name)}</a>`;

    const allLink = allEnabled ? link("Все блюда", "", currentCategory === "") : "";
    const catLinks = cats.map((c) => link(c, c, currentCategory === c));

    const links = allEnabled
      ? navSettings.allCategoryPosition === "bottom"
        ? [...catLinks, allLink]
        : [allLink, ...catLinks]
      : catLinks;

    categoryNav.innerHTML = links.join("");
  };

  const applyMenuFilter = () => {
    const tokens = splitSearchTokens(searchQuery);
    const filtered = tokens.length
      ? menuData.filter((i) => itemMatchesTokens(i, tokens))
      : currentCategory
        ? menuData.filter((i) => String(i.category || "").trim() === currentCategory)
        : navSettings.shuffleAll
          ? shuffleArray(menuData)
          : menuData;
    renderMenu(filtered);
  };

  const setFoodModalOpen = (isOpen) => {
    if (!foodModal) return;
    foodModal.hidden = !isOpen;
    document.body.classList.toggle("modal-open", isOpen);
    if (isOpen) {
      foodModalClose?.focus?.();
    }
  };

  const renderPromoModal = (promo) => {
    if (!foodModalBody || !promo) return;

    const title = String(promo.title || "").trim();
    const text = String(promo.text || "").trim();
    const theme = String(promo.theme || "").trim();
    const heroClass = themeClass(theme, 0);
    const hasImage = Boolean(String(promo.imageUrl || "").trim());
    const imageStyle = hasImage
      ? `style="background-image: linear-gradient(140deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.72) 100%), url('${escapeHtml(
          promo.imageUrl,
        )}'); background-size: cover; background-position: center;"`
      : "";

    const textHtml = escapeHtml(text).replaceAll("\n", "<br>");

    foodModalBody.innerHTML = `
      <div class="promo-modal ${hasImage ? "" : "promo-modal--noimage"}">
        <div class="promo-modal__hero ${heroClass}" ${imageStyle}></div>
        <div class="promo-modal__body">
          <h3 class="promo-modal__title" id="food-modal-title">${escapeHtml(title)}</h3>
          <p class="promo-modal__text">${textHtml}</p>
        </div>
      </div>
    `;
  };

  const renderFoodModal = (item) => {
    if (!foodModalBody || !item) return;

    const id = String(item.id || "").trim();
    const title = String(item.title || "").trim();
    const category = String(item.category || "").trim();

    const options = normalizeOptions(item.options);
    const basePrice = Number(item.price) || 0;
    const initialPrice = options.length ? Number(options[0].price) : basePrice;
    const optionsHtml = options.length
      ? `
        <select class="food-option" aria-label="Вариант блюда">
          ${options
            .map(
              (o) =>
                `<option value="${escapeHtml(o.id)}" data-price="${Number(o.price) || 0}">${escapeHtml(
                  o.label,
                )}</option>`,
            )
            .join("")}
        </select>
      `
      : "";

    const explicitWeight = String(item.weight || "").trim();
    const { desc: descFromSplit, weight: weightFromSplit } = splitWeightFromDescription(item.description || "");
    const description = explicitWeight ? String(item.description || "").trim() : descFromSplit;
    const weight = explicitWeight || weightFromSplit;

    const fallbackClass = `food-image--${hashToImageVariant(id)}`;
    const imageStyle = item.imageUrl ? `style="background-image:url('${escapeHtml(item.imageUrl)}')"` : "";

    const descriptionHtml = escapeHtml(description).replaceAll("\n", "<br>");
    const chipHtml = category ? `<span class="food-modal-chip">${escapeHtml(category)}</span>` : "";
    const weightHtml = weight ? `<p class="food-weight">${escapeHtml(weight)}</p>` : "";
    const cardClass = options.length ? "food-card food-modal-card has-options" : "food-card food-modal-card";

    foodModalBody.innerHTML = `
      <article class="${cardClass}" data-id="${escapeHtml(id)}" data-name="${escapeHtml(
        title,
      )}" data-price="${initialPrice}" data-base-price="${basePrice}">
        <div class="food-image ${fallbackClass}" ${imageStyle}></div>
        <div class="food-modal-meta">
          ${chipHtml}
          <h3 class="food-modal-title" id="food-modal-title">${escapeHtml(title)}</h3>
          <p class="food-modal-desc">${descriptionHtml}</p>
          ${weightHtml}
          <div class="food-footer">
            <b class="food-price">${initialPrice} &#8381;</b>
            <div class="food-actions">
              ${optionsHtml}
              <button class="order-btn" type="button">В корзину</button>
            </div>
          </div>
        </div>
      </article>
    `;
  };

  if (foodModal && foodModalClose) {
    foodModalClose.addEventListener("click", () => setFoodModalOpen(false));

    foodModal.addEventListener("click", (event) => {
      if (event.target === foodModal) {
        setFoodModalOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !foodModal.hidden) {
        setFoodModalOpen(false);
      }
    });
  }

  if (promoRow) {
    promoRow.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const card = target.closest(".promo-card");
      if (!(card instanceof HTMLElement)) return;
      const id = String(card.dataset.id || "").trim();

      let promo = (id && promosById.get(id)) || null;
      if (!promo) {
        // Fallback for static HTML promos (before API data arrives).
        const title = String(card.querySelector("h3")?.textContent || "").trim();
        const text = String(card.querySelector("p")?.textContent || "").trim();
        const theme = card.classList.contains("promo-card--blue")
          ? "blue"
          : card.classList.contains("promo-card--sand")
            ? "sand"
            : "pink";
        promo = { title, text, theme, imageUrl: "" };
      }

      renderPromoModal(promo);
      setFoodModalOpen(true);
    });
  }

  if (menuGrid) {
    menuGrid.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      // Don't open modal when user clicks controls inside a card.
      if (target.closest(".order-btn") || target.closest(".food-option")) {
        return;
      }

      const card = target.closest(".food-card");
      if (!(card instanceof HTMLElement)) return;

      const id = String(card.dataset.id || "").trim();
      if (!id) return;

      let item = menuById.get(id) || null;
      if (!item) {
        // Fallback for the static HTML menu (before API data arrives).
        const title = String(card.dataset.name || card.querySelector("h4")?.textContent || "").trim();
        const descEl = card.querySelector(".food-desc") || card.querySelector("p");
        const description = String(descEl?.textContent || "").trim();
        const weight = String(card.querySelector(".food-weight")?.textContent || "").trim();
        const basePrice = Number(card.dataset.basePrice || card.dataset.price || 0);
        const opt = card.querySelector(".food-option");
        const options = opt
          ? Array.from(opt.options).map((o) => ({
              id: String(o.value || "").trim(),
              label: String(o.textContent || "").trim(),
              price: Number(o.dataset.price || 0),
            }))
          : [];

        item = { id, title, description, weight, category: "", price: basePrice, options, imageUrl: "" };
      }

      renderFoodModal(item);
      setFoodModalOpen(true);
    });
  }

  const tryLoad = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  };

  const refreshAll = async () => {
    try {
      const [promos, menu, categories, settings] = await Promise.all([
        tryLoad("/api/public/promos"),
        tryLoad("/api/public/menu"),
        tryLoad("/api/public/categories"),
        tryLoad("/api/public/settings"),
      ]);

      if (Array.isArray(categories)) {
        const sig = JSON.stringify(categories);
        if (sig !== lastCatSig) {
          lastCatSig = sig;
          categoriesData = categories;
          renderCategories();
        }
      }

      if (settings && typeof settings === "object") {
        const sig = JSON.stringify(settings);
        if (sig !== lastSettingsSig) {
          lastSettingsSig = sig;
          const nav = settings.nav || {};
          navSettings = {
            allCategoryEnabled: nav.allCategoryEnabled !== undefined ? Boolean(nav.allCategoryEnabled) : true,
            allCategoryPosition: nav.allCategoryPosition === "bottom" ? "bottom" : "top",
            shuffleAll: nav.shuffleAll !== undefined ? Boolean(nav.shuffleAll) : true,
          };
          renderCategories();
          applyMenuFilter();
        }
      }

      if (Array.isArray(menu)) {
        const sig = JSON.stringify(menu);
        if (sig !== lastMenuSig) {
          lastMenuSig = sig;
          menuData = menu;
          menuById = new Map(
            menuData.map((item) => [String(item?.id || "").trim(), item]).filter(([key]) => key),
          );
          renderCategories();
          applyMenuFilter();
        }
      }

      if (Array.isArray(promos)) {
        const sig = JSON.stringify(promos);
        if (sig !== lastPromoSig) {
          lastPromoSig = sig;
          promosData = promos;
          promosById = new Map(
            promosData.map((p) => [String(p?.id || "").trim(), p]).filter(([key]) => key),
          );
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

  if (searchInput) {
    let timer = 0;
    const DEBOUNCE_MS = 320;
    const suppressRevealOnce = () => {
      if (!menuGrid) return;
      menuGrid.classList.add("no-reveal");
      window.requestAnimationFrame(() => {
        menuGrid.classList.remove("no-reveal");
      });
    };
    const run = () => {
      searchQuery = searchInput.value || "";
      suppressRevealOnce();
      applyMenuFilter();
    };

    searchInput.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, DEBOUNCE_MS);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      searchInput.value = "";
      searchQuery = "";
      suppressRevealOnce();
      applyMenuFilter();
      searchInput.blur();
    });
  }

  refreshAll();
  setInterval(refreshAll, 15000);
})();
