const API_URL = "/api/data";

const state = {
  coins: [],
  currentPage: 0,
  coinsPerPage: 8,
  autoRotate: null,
  plans: [],
  paymentWallet: "",
  paymentNote: "Pay with USDT ETH",
};

const elements = {
  newsList: document.getElementById("newsList"),
  refreshNewsBtn: document.getElementById("refreshNewsBtn"),
  coinGrid: document.getElementById("coinGrid"),
  pageIndicator: document.getElementById("pageIndicator"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  marketStats: document.getElementById("marketStats"),
  youtubeFeed: document.getElementById("youtubeFeed"),
  promoGrid: document.getElementById("promoGrid"),
  promoModal: document.getElementById("promoModal"),
  promoForm: document.getElementById("promoForm"),
  promoPackageSummary: document.getElementById("promoPackageSummary"),
  packageName: document.getElementById("packageName"),
  packagePrice: document.getElementById("packagePrice"),
  promoMessage: document.getElementById("promoMessage"),
  promoSubmitBtn: document.getElementById("promoSubmitBtn"),
  copyWalletBtn: document.getElementById("copyWalletBtn"),
  walletAddress: document.getElementById("walletAddress"),
  walletPaymentNote: document.getElementById("walletPaymentNote"),
  year: document.getElementById("year"),
};

elements.year.textContent = new Date().getFullYear();

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: num >= 1 ? 2 : 6,
  }).format(num);
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00%";
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function sentimentClass(label = "") {
  const v = label.toLowerCase();
  if (v.includes("bull")) return "bullish";
  if (v.includes("bear")) return "bearish";
  return "mixed";
}

function sentimentLabel(label = "") {
  const v = sentimentClass(label);
  if (v === "bullish") return "Bullish";
  if (v === "bearish") return "Bearish";
  return "Mixed";
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadPlans() {
  try {
    const res = await fetch("/api/plans");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.plans = data.plans || [];
    state.paymentWallet = data.paymentWallet || "";
    state.paymentNote = data.paymentNote || "Pay with USDT ETH";
    renderPromoCards();
    // Update wallet display in any open modal
    if (elements.walletAddress)
      elements.walletAddress.textContent = state.paymentWallet;
    if (elements.walletPaymentNote)
      elements.walletPaymentNote.textContent = state.paymentNote;
  } catch (err) {
    console.error("Failed to load plans:", err);
  }
}

async function loadAllData() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderNews(data.news?.length ? data.news : []);
    if (data.coins?.length) {
      state.coins = data.coins;
      renderCoinPage(0);
      renderMarketStats();
      startAutoRotate();
    }
    if (data.youtube?.length) {
      renderYouTube(data.youtube);
    }
  } catch (err) {
    console.error("Failed to load data from backend:", err);
    elements.newsList.innerHTML =
      '<div class="loading-block">Could not reach backend.</div>';
    elements.coinGrid.innerHTML =
      '<div class="loading-block">Could not reach backend.</div>';
    elements.youtubeFeed.innerHTML =
      '<div class="loading-block">Could not reach backend.</div>';
  }
}

async function refreshNews() {
  elements.newsList.innerHTML = '<div class="loading-block">Refreshing…</div>';
  await loadAllData();
}

// ── Render functions ──────────────────────────────────────────────────────────

function renderNews(items) {
  elements.newsList.innerHTML = items
    .map((item) => {
      const cls = sentimentClass(item.sentiment);
      return `
      <article class="news-item">
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
        <div class="news-meta">
          <span>${item.source || "CryptoRank"}</span>
          <span class="sentiment ${cls}"><span class="dot"></span>${sentimentLabel(item.sentiment)}</span>
        </div>
      </article>`;
    })
    .join("");
}

function renderCoinPage(pageIndex) {
  if (!state.coins.length) return;
  const totalPages = Math.ceil(state.coins.length / state.coinsPerPage);
  state.currentPage = (pageIndex + totalPages) % totalPages;
  const start = state.currentPage * state.coinsPerPage;
  const items = state.coins.slice(start, start + state.coinsPerPage);
  elements.coinGrid.innerHTML = items
    .map((coin) => {
      const change = Number(coin.change || 0);
      return `
      <article class="coin-card">
        <div class="coin-head">
          <div class="coin-brand">
            <img src="${coin.iconUrl}" alt="${coin.name}" onerror="this.style.display='none'" />
            <div><strong>${coin.name}</strong><small>${coin.symbol}</small></div>
          </div>
          <span class="change ${change >= 0 ? "positive" : "negative"}">${formatPercent(change)}</span>
        </div>
        <div class="coin-price">${formatCurrency(coin.price)}</div>
        <div class="sparkline-wrap">
          <canvas data-sparkline='${JSON.stringify(coin.sparkline || [])}' data-change="${change}"></canvas>
        </div>
        <div class="coin-rank">Rank #${coin.rank}</div>
      </article>`;
    })
    .join("");
  elements.pageIndicator.textContent = `${state.currentPage + 1} / ${totalPages}`;
  drawAllSparklines();
}

function drawAllSparklines() {
  document.querySelectorAll("canvas[data-sparkline]").forEach((canvas) => {
    const values = JSON.parse(canvas.dataset.sparkline || "[]")
      .map(Number)
      .filter((v) => Number.isFinite(v));
    if (values.length < 2) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 64;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 6;
    const range = Math.max(max - min, 1);
    const points = values.map((v, i) => ({
      x: pad + (i / (values.length - 1)) * (width - pad * 2),
      y: height - pad - ((v - min) / range) * (height - pad * 2),
    }));
    const positive = Number(canvas.dataset.change || 0) >= 0;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(
      0,
      positive ? "rgba(49,214,138,0.45)" : "rgba(255,95,115,0.45)",
    );
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - pad);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height - pad);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
    );
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = positive ? "#31d68a" : "#ff5f73";
    ctx.stroke();
  });
}

function renderMarketStats() {
  if (!state.coins.length) return;
  const avgChange =
    state.coins.reduce((s, c) => s + Number(c.change || 0), 0) /
    state.coins.length;
  const best = [...state.coins].sort(
    (a, b) => Number(b.change) - Number(a.change),
  )[0];
  const worst = [...state.coins].sort(
    (a, b) => Number(a.change) - Number(b.change),
  )[0];
  elements.marketStats.innerHTML = `
    <div class="stat-box"><span>Top mover</span><strong>${best?.symbol || "—"} ${formatPercent(best?.change || 0)}</strong></div>
    <div class="stat-box"><span>Avg 24h move</span><strong>${formatPercent(avgChange)}</strong></div>
    <div class="stat-box"><span>Weakest mover</span><strong>${worst?.symbol || "—"} ${formatPercent(worst?.change || 0)}</strong></div>`;
}

function startAutoRotate() {
  if (state.autoRotate) clearInterval(state.autoRotate);
  state.autoRotate = setInterval(
    () => renderCoinPage(state.currentPage + 1),
    7000,
  );
}

function renderYouTube(items) {
  elements.youtubeFeed.innerHTML = items
    .map(
      (item) => `
    <article class="youtube-item">
      <img class="video-thumb" src="${item.thumb}" alt="${item.title}" />
      <div class="youtube-body">
        <span class="youtube-label">${item.label}</span>
        <h3>${item.title}</h3>
        <p>${item.meta}</p>
        <a class="btn btn-secondary small" href="${item.link}" target="_blank" rel="noreferrer">Watch now</a>
      </div>
    </article>`,
    )
    .join("");
}

function renderPromoCards() {
  if (!state.plans.length) {
    elements.promoGrid.innerHTML =
      '<div class="loading-block" style="grid-column:1/-1;text-align:center;color:var(--muted);padding:32px">No packages available right now.</div>';
    return;
  }
  elements.promoGrid.innerHTML = state.plans
    .map(
      (pack) => `
    <article class="promo-card">
      <p class="eyebrow">Package</p>
      <h3>${pack.name}</h3>
      <p>${pack.description}</p>
      <div class="promo-price">${pack.price}</div>
      <ul>${(pack.bullets || []).map((b) => `<li>${b}</li>`).join("")}</ul>
      <button class="btn btn-primary open-promo" type="button"
        data-name="${pack.name}" data-price="${pack.price}">Choose Package</button>
    </article>`,
    )
    .join("");
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openPromoModal(name, price) {
  elements.packageName.value = name;
  elements.packagePrice.value = price;
  elements.promoPackageSummary.textContent = `${name} selected • ${price}`;
  elements.promoMessage.textContent = "";
  elements.promoMessage.style.color = "";
  // Apply current wallet from state
  if (elements.walletAddress)
    elements.walletAddress.textContent = state.paymentWallet;
  if (elements.walletPaymentNote)
    elements.walletPaymentNote.textContent = state.paymentNote;
  resetSubmitBtn();
  elements.promoModal.classList.remove("hidden");
  elements.promoModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closePromoModal() {
  elements.promoModal.classList.add("hidden");
  elements.promoModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function resetSubmitBtn() {
  if (!elements.promoSubmitBtn) return;
  elements.promoSubmitBtn.disabled = false;
  elements.promoSubmitBtn.textContent = "Submit Campaign Request";
  elements.promoSubmitBtn.style.display = "";
}

async function handlePromoSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.promoForm);
  const body = Object.fromEntries(formData.entries());

  if (elements.promoSubmitBtn) {
    elements.promoSubmitBtn.disabled = true;
    elements.promoSubmitBtn.textContent = "Validating transaction…";
  }
  elements.promoMessage.textContent = "";
  elements.promoMessage.style.color = "";

  try {
    const res = await fetch("/api/promo-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      elements.promoMessage.textContent = `Error: ${data.error || "Submission failed."}`;
      elements.promoMessage.style.color = "#ff5f73";
      resetSubmitBtn();
      return;
    }

    const { txValidation } = data;

    if (txValidation?.valid) {
      elements.promoMessage.innerHTML = `
        <span style="color:#31d68a;font-weight:700;">✓ Payment verified on-chain</span><br>
        ${txValidation.amount ? `Amount: <strong>${txValidation.amount}</strong><br>` : ""}
        ${txValidation.timestamp ? `Block time: <strong>${new Date(txValidation.timestamp).toLocaleString()}</strong><br>` : ""}
        <br>We'll contact you at <strong>${body.contact}</strong> shortly.
      `;
      elements.promoForm.reset();
      if (elements.promoSubmitBtn)
        elements.promoSubmitBtn.style.display = "none";
    } else {
      elements.promoMessage.innerHTML = `
        <span style="color:#f7c948;font-weight:700;">⚠ Submission saved — payment unverified</span><br>
        ${txValidation?.error ? `Reason: ${txValidation.error}<br>` : ""}
        <br>Check your transaction ID or contact us.
      `;
      resetSubmitBtn();
    }
  } catch {
    elements.promoMessage.textContent = "Network error — please try again.";
    elements.promoMessage.style.color = "#ff5f73";
    resetSubmitBtn();
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

function attachEvents() {
  elements.refreshNewsBtn.addEventListener("click", refreshNews);
  elements.prevPage.addEventListener("click", () =>
    renderCoinPage(state.currentPage - 1),
  );
  elements.nextPage.addEventListener("click", () =>
    renderCoinPage(state.currentPage + 1),
  );
  window.addEventListener("resize", drawAllSparklines);
  elements.promoForm.addEventListener("submit", handlePromoSubmit);

  elements.copyWalletBtn.addEventListener("click", async () => {
    const addr =
      elements.walletAddress?.textContent?.trim() || state.paymentWallet;
    try {
      await navigator.clipboard.writeText(addr);
      elements.copyWalletBtn.textContent = "Copied";
    } catch {
      elements.copyWalletBtn.textContent = "Copy failed";
    }
    setTimeout(() => {
      elements.copyWalletBtn.textContent = "Copy";
    }, 1800);
  });

  document.addEventListener("click", (event) => {
    const openBtn = event.target.closest(".open-promo");
    if (openBtn) {
      openPromoModal(openBtn.dataset.name, openBtn.dataset.price);
      return;
    }
    if (event.target.closest('[data-close-modal="true"]')) closePromoModal();
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !elements.promoModal.classList.contains("hidden")
    )
      closePromoModal();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  attachEvents();
  // Load plans + market data in parallel
  await Promise.all([loadPlans(), loadAllData()]);
  // Re-fetch every 5 min
  setInterval(loadAllData, 5 * 60 * 1000);
  // Re-fetch plans every 2 min so wallet/plan changes reflect quickly
  setInterval(loadPlans, 2 * 60 * 1000);
}

init();
