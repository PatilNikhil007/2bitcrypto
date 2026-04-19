import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Config ────────────────────────────────────────────────────────────────────

const COINRANKING_API_KEY = process.env.COINRANKING_API_KEY || "";
const COINRANKING_URL =
  "https://api.coinranking.com/v2/coins?limit=24&orderBy=marketCap&orderDirection=desc&timePeriod=24h";
const YOUTUBE_CHANNEL_ID = "UCKZychZHsAMTFilBlFyrAGA";
const CRYPTORANK_NEWS_URL = "https://cryptorank.io/news";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

if (!COINRANKING_API_KEY) {
  console.warn("Warning: COINRANKING_API_KEY is not set — live coin data will fail.");
}
if (!ADMIN_TOKEN) {
  console.warn("Warning: ADMIN_TOKEN is not set — admin endpoints are effectively locked.");
}

const SUBMISSIONS_FILE = path.join(__dirname, "submissions.json");
const PLANS_FILE = path.join(__dirname, "plans.json");
const USED_TXIDS_FILE = path.join(__dirname, "used_txids.json");

// How much tolerance to allow on price matching (e.g. 0.02 = 2%)
const PRICE_TOLERANCE = 0.02;

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsItem {
  title: string;
  link: string;
  sentiment: string;
  source: string;
}

interface CoinItem {
  uuid: string;
  rank: number;
  name: string;
  symbol: string;
  iconUrl: string;
  price: string;
  change: string;
  sparkline: string[];
}

interface YoutubeItem {
  label: string;
  title: string;
  link: string;
  thumb: string;
  meta: string;
}

interface CachedData {
  news: NewsItem[];
  coins: CoinItem[];
  youtube: YoutubeItem[];
  lastUpdated: string | null;
}

type SubmissionStatus = "pending" | "approved" | "rejected";

interface TxValidation {
  checked: boolean;
  valid: boolean;
  amount?: string;
  amountRaw?: number;
  from?: string;
  to?: string;
  timestamp?: string;
  error?: string;
}

interface PromoSubmission {
  id: string;
  submittedAt: string;
  packageName: string;
  packagePrice: string;
  contact: string;
  transactionId: string;
  startDate: string;
  projectLink: string;
  notes: string;
  status: SubmissionStatus;
  txValidation: TxValidation;
  adminNote?: string;
}

interface PromoPlan {
  id: string;
  name: string;
  price: string; // display string e.g. "$675"
  priceUsd: number; // numeric for reference/tolerance checks
  description: string;
  bullets: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SiteConfig {
  paymentWallet: string;
  paymentNote: string;
  updatedAt: string;
}

// ── Used TxIDs persistence ────────────────────────────────────────────────────

function loadUsedTxIds(): Set<string> {
  try {
    if (fs.existsSync(USED_TXIDS_FILE)) {
      const arr: string[] = JSON.parse(fs.readFileSync(USED_TXIDS_FILE, "utf-8"));
      return new Set(arr.map((h) => h.toLowerCase()));
    }
  } catch (e) {
    console.error("Failed to load used txids:", e);
  }
  return new Set();
}

function saveUsedTxId(hash: string): void {
  const ids = loadUsedTxIds();
  ids.add(hash.toLowerCase());
  fs.writeFileSync(USED_TXIDS_FILE, JSON.stringify([...ids], null, 2));
}

function isTxIdUsed(hash: string): boolean {
  return loadUsedTxIds().has(hash.toLowerCase());
}

// ── Plans & config persistence ────────────────────────────────────────────────

const DEFAULT_PLANS: PromoPlan[] = [
  {
    id: "plan_video",
    name: "Video",
    price: "$675",
    priceUsd: 675,
    description:
      "Get your project out to investors fast with this one hit option.",
    bullets: [
      "Single focused video",
      "Fast audience exposure",
      "Simple entry package",
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "plan_monthly",
    name: "Monthly Coverage",
    price: "$2500",
    priceUsd: 2500,
    description:
      "More coverage over a month with multiple videos, X posts and live stream mentions.",
    bullets: [
      "Multiple videos",
      "X posts included",
      "Livestream mentions over the month",
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "plan_livestream",
    name: "Live Stream Coverage",
    price: "$1250",
    priceUsd: 1250,
    description:
      "Get your links on every live stream, a nightly mention and your logo on screen throughout.",
    bullets: [
      "Nightly mention",
      "On-screen logo placement",
      "Stream audience visibility",
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "plan_full",
    name: "Full Package",
    price: "$5000",
    priceUsd: 5000,
    description:
      "Maximum exposure with multiple videos, livestreams, TikTok shorts and X posts over 30 days.",
    bullets: [
      "Multi-format push",
      "30-day campaign window",
      "Maximum brand exposure",
    ],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const DEFAULT_CONFIG: SiteConfig = {
  paymentWallet: "0x214b3b2c89315A735bfF4838983ee0a0A881232E",
  paymentNote: "Pay with USDT ETH",
  updatedAt: new Date().toISOString(),
};

function readPlansFile(): { plans: PromoPlan[]; config: SiteConfig } {
  try {
    if (fs.existsSync(PLANS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
      return {
        plans: raw.plans ?? DEFAULT_PLANS,
        config: raw.config ?? { ...DEFAULT_CONFIG },
      };
    }
  } catch (e) {
    console.error("Failed to read plans file:", e);
  }
  return { plans: [...DEFAULT_PLANS], config: { ...DEFAULT_CONFIG } };
}

function loadPlans(): PromoPlan[] {
  return readPlansFile().plans;
}

function loadConfig(): SiteConfig {
  return readPlansFile().config;
}

function savePlansAndConfig(plans: PromoPlan[], config: SiteConfig): void {
  fs.writeFileSync(PLANS_FILE, JSON.stringify({ plans, config }, null, 2));
}

// ── Submissions persistence ───────────────────────────────────────────────────

function loadSubmissions(): PromoSubmission[] {
  try {
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load submissions:", e);
  }
  return [];
}

function saveSubmissions(submissions: PromoSubmission[]): void {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
}

// ── Input sanitization ────────────────────────────────────────────────────────

function sanitizeString(val: unknown, maxLen = 512): string {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, maxLen);
}

function isValidUrl(val: string): boolean {
  try {
    const u = new URL(val);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDate(val: string): boolean {
  // Accepts YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val));
}

// ── ETH tx validation ─────────────────────────────────────────────────────────

const USE_SEPOLIA = false;

const RPC_URL = USE_SEPOLIA
  ? "https://ethereum-sepolia-rpc.publicnode.com"
  : "https://cloudflare-eth.com";

const USDT_CONTRACT = USE_SEPOLIA
  ? "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"
  : "0xdac17f958d2ee523a2206206994597c13d831ec7";

async function rpcCall(method: string, params: any[]) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * Validates a USDT transfer tx and optionally checks the amount matches
 * the expected plan price (within PRICE_TOLERANCE).
 */
async function validateEthTx(
  txHash: string,
  expectedUsd?: number,
): Promise<TxValidation> {
  const hash = txHash.trim().startsWith("0x")
    ? txHash.trim()
    : `0x${txHash.trim()}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return {
      checked: true,
      valid: false,
      error: "Invalid transaction hash format",
    };
  }

  // Reject already-used tx hashes
  if (isTxIdUsed(hash)) {
    return {
      checked: true,
      valid: false,
      error: "This transaction has already been used for a previous submission",
    };
  }

  const paymentWallet = loadConfig().paymentWallet.toLowerCase();

  try {
    // 1. Fetch transaction
    const tx = await rpcCall("eth_getTransactionByHash", [hash]);

    if (!tx) {
      return {
        checked: true,
        valid: false,
        error: "Transaction not found on-chain",
      };
    }

    const toContract = (tx.to || "").toLowerCase();
    let amountRaw: number | undefined;
    let amount: string | undefined;
    let resolvedTo: string | undefined;

    // 2. Validate USDT transfer (ERC-20 transfer method: 0xa9059cbb)
    if (toContract === USDT_CONTRACT.toLowerCase()) {
      const input: string = tx.input || "";
      if (input.startsWith("0xa9059cbb") && input.length >= 138) {
        const recipientHex = "0x" + input.slice(34, 74).replace(/^0+/, "");
        const amountBig = BigInt("0x" + input.slice(74, 138));

        // USDT has 6 decimals
        amountRaw = Number(amountBig) / 1e6;
        amount = amountRaw.toFixed(2) + " USDT";
        resolvedTo = recipientHex.toLowerCase();

        if (resolvedTo !== paymentWallet) {
          return {
            checked: true,
            valid: false,
            error: `USDT sent to wrong address: ${recipientHex}. Expected: ${paymentWallet}`,
            from: tx.from,
            to: recipientHex,
            amount,
            amountRaw,
          };
        }
      } else {
        return {
          checked: true,
          valid: false,
          error: "Not a standard USDT transfer (method ID mismatch or short calldata)",
        };
      }
    } else {
      return {
        checked: true,
        valid: false,
        error: `Transaction was sent to ${tx.to}, not the USDT contract`,
        from: tx.from,
        to: tx.to,
      };
    }

    // 3. Check receipt (success)
    const receipt = await rpcCall("eth_getTransactionReceipt", [hash]);
    if (!receipt) {
      return {
        checked: true,
        valid: false,
        error: "Transaction is still pending",
        from: tx.from,
        to: resolvedTo,
        amount,
        amountRaw,
      };
    }

    if (receipt.status !== "0x1") {
      return {
        checked: true,
        valid: false,
        error: "Transaction failed (reverted on-chain)",
        from: tx.from,
        to: resolvedTo,
        amount,
        amountRaw,
      };
    }

    // 4. Validate amount matches the selected plan price (server-side, not trusting client)
    if (expectedUsd !== undefined && amountRaw !== undefined) {
      const min = expectedUsd * (1 - PRICE_TOLERANCE);
      const max = expectedUsd * (1 + PRICE_TOLERANCE);
      if (amountRaw < min || amountRaw > max) {
        return {
          checked: true,
          valid: false,
          error: `Payment amount ${amountRaw.toFixed(2)} USDT does not match expected ${expectedUsd.toFixed(2)} USDT (±${(PRICE_TOLERANCE * 100).toFixed(0)}%)`,
          from: tx.from,
          to: resolvedTo,
          amount,
          amountRaw,
        };
      }
    }

    // 5. Block timestamp
    const block = await rpcCall("eth_getBlockByNumber", [tx.blockNumber, false]);
    const timestamp = block?.timestamp
      ? new Date(parseInt(block.timestamp, 16) * 1000).toISOString()
      : undefined;

    return {
      checked: true,
      valid: true,
      from: tx.from,
      to: resolvedTo,
      amount,
      amountRaw,
      timestamp,
    };
  } catch (e: any) {
    console.error("Validation Logic Error:", e);
    return {
      checked: true,
      valid: false,
      error: `Network/RPC error: ${e.message}`,
    };
  }
}

// ── Market data cache ─────────────────────────────────────────────────────────

const cache: CachedData = {
  news: [],
  coins: [],
  youtube: [],
  lastUpdated: null,
};

const NEWS_FALLBACK: NewsItem[] = [
  {
    title: "XRP holds steady at key support as investors weigh mixed signals",
    link: "https://cryptorank.io/news",
    sentiment: "mixed",
    source: "CryptoRank",
  },
  {
    title: "Bitcoin price prediction as signals turn mixed",
    link: "https://cryptorank.io/news/feed/dab61-bitcoin-price-prediction-as-signals-turn-mixed",
    sentiment: "bearish",
    source: "CryptoRank",
  },
  {
    title: "Analyst says six red monthly candles could set up a bullish turn",
    link: "https://cryptorank.io/news/feed/31963-analyst-says-bitcoin-6-red",
    sentiment: "bullish",
    source: "CryptoRank",
  },
  {
    title: "Oil price risk and macro pressure keep crypto sentiment cautious",
    link: "https://cryptorank.io/news/feed/59013-oil-impact-on-bitcoin-price",
    sentiment: "bearish",
    source: "CryptoRank",
  },
];

const YOUTUBE_FALLBACK: YoutubeItem[] = [
  {
    label: "Latest upload",
    title: "Open the latest 2Bit Crypto videos",
    link: "https://www.youtube.com/channel/UCKZychZHsAMTFilBlFyrAGA/videos",
    thumb: "https://i.ytimg.com/vi/TiwltAw9mJw/hqdefault.jpg",
    meta: "Channel videos",
  },
  {
    label: "Livestream watch",
    title: "Check the most recent livestreams and replays",
    link: "https://www.youtube.com/channel/UCKZychZHsAMTFilBlFyrAGA/streams",
    thumb: "https://i.ytimg.com/vi/NSmdHV4aC-o/hqdefault.jpg",
    meta: "Channel streams",
  },
];

async function fetchText(url: string, timeout = 120000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function refreshNews(): Promise<NewsItem[]> {
  try {
    const html = await fetchText(CRYPTORANK_NEWS_URL);
    const linkRegex = /href="(\/news\/feed\/[^"]+)"[^>]*>([^<]{18,})</g;
    const unique: NewsItem[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null && unique.length < 4) {
      const href = `https://cryptorank.io${match[1]}`;
      const title = match[2].trim().replace(/\s+/g, " ");
      if (seen.has(href) || title.length < 18) continue;
      seen.add(href);
      unique.push({
        title,
        link: href,
        sentiment: "mixed",
        source: "CryptoRank",
      });
    }
    const enriched = await Promise.all(
      unique.map(async (item) => {
        try {
          const body = await fetchText(item.link, 8000);
          let sentiment = "mixed";
          if (/\bBullish\b/i.test(body)) sentiment = "bullish";
          else if (/\bBearish\b/i.test(body)) sentiment = "bearish";
          return { ...item, sentiment };
        } catch {
          return item;
        }
      }),
    );
    return enriched.length ? enriched : NEWS_FALLBACK;
  } catch (e) {
    console.error(e);
    return NEWS_FALLBACK;
  }
}

async function refreshCoins(): Promise<CoinItem[]> {
  try {
    const res = await fetch(COINRANKING_URL, {
      headers: {
        "Content-Type": "application/json",
        "x-access-token": COINRANKING_API_KEY,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    return (json.data?.coins || []).slice(0, 24) as CoinItem[];
  } catch {
    return [];
  }
}

async function refreshYouTube(): Promise<YoutubeItem[]> {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
    const xml = await fetchText(rssUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const entries = Array.from(doc.getElementsByTagName("entry"))
      .map((entry) => {
        const id = entry
          .getElementsByTagNameNS(
            "http://www.youtube.com/xml/schemas/2015",
            "videoId",
          )[0]
          ?.textContent?.trim();
        const title =
          entry.getElementsByTagName("title")[0]?.textContent?.trim() ||
          "2BitCrypto update";
        const published =
          entry.getElementsByTagName("published")[0]?.textContent?.trim() || "";
        return { id, title, published };
      })
      .filter((e) => e.id);

    const latestUpload = entries[0];
    const liveLike =
      entries.find((e) => /live|stream/i.test(e.title)) ||
      entries[1] ||
      entries[0];

    const makeItem = (
      entry: (typeof entries)[0] | undefined,
      label: string,
      fallback: YoutubeItem,
    ): YoutubeItem => {
      if (!entry) return fallback;
      return {
        label,
        title: entry.title,
        link: `https://www.youtube.com/watch?v=${entry.id}`,
        thumb: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
        meta: entry.published ? new Date(entry.published).toLocaleString() : "",
      };
    };

    return [
      makeItem(latestUpload, "Latest upload", YOUTUBE_FALLBACK[0]),
      makeItem(liveLike, "Latest stream", YOUTUBE_FALLBACK[1]),
    ];
  } catch (e) {
    console.error(e);
    return YOUTUBE_FALLBACK;
  }
}

async function refreshAll() {
  console.log(`[${new Date().toISOString()}] Refreshing data...`);
  const [news, coins, youtube] = await Promise.all([
    refreshNews(),
    refreshCoins(),
    refreshYouTube(),
  ]);
  cache.news = news;
  cache.coins = coins;
  cache.youtube = youtube;
  cache.lastUpdated = new Date().toISOString();
  console.log(
    `[${cache.lastUpdated}] Done — ${coins.length} coins, ${news.length} news, ${youtube.length} videos`,
  );
}

// ── Admin auth middleware ──────────────────────────────────────────────────────

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── Public routes ─────────────────────────────────────────────────────────────

app.get("/api/data", (_req, res) => {
  res.json(cache);
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, lastUpdated: cache.lastUpdated });
});

app.get("/api/plans", (_req, res) => {
  const { plans, config } = readPlansFile();
  res.json({
    plans: plans.filter((p) => p.active),
    paymentWallet: config.paymentWallet,
    paymentNote: config.paymentNote,
  });
});

// Public promo submission
app.post("/api/promo-request", async (req, res) => {
  // ── Sanitize & validate all fields server-side ──────────────────────────────
  const packageName  = sanitizeString(req.body?.packageName, 128);
  const contact      = sanitizeString(req.body?.contact, 256);
  const transactionId = sanitizeString(req.body?.transactionId, 128);
  const startDate    = sanitizeString(req.body?.startDate, 32);
  const projectLink  = sanitizeString(req.body?.projectLink, 512);
  const notes        = sanitizeString(req.body?.notes, 1024);

  if (!packageName || !contact || !transactionId || !startDate || !projectLink) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  if (!isValidUrl(projectLink)) {
    res.status(400).json({ error: "projectLink must be a valid http/https URL" });
    return;
  }

  if (!isValidDate(startDate)) {
    res.status(400).json({ error: "startDate must be a valid date in YYYY-MM-DD format" });
    return;
  }

  // Reject future start dates more than 1 year out
  const startMs = Date.parse(startDate);
  const nowMs = Date.now();
  if (startMs > nowMs + 365 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: "startDate is too far in the future" });
    return;
  }

  // ── Resolve the plan server-side (never trust packagePrice from client) ──────
  const { plans } = readPlansFile();
  const plan = plans.find(
    (p) => p.active && p.name.toLowerCase() === packageName.toLowerCase(),
  );
  if (!plan) {
    res.status(400).json({ error: `Unknown or inactive plan: ${packageName}` });
    return;
  }

  // ── Validate the tx, including amount check against server-side plan price ───
  const txValidation = await validateEthTx(transactionId, plan.priceUsd);

  const submission: PromoSubmission = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: new Date().toISOString(),
    packageName: plan.name,           // use server-resolved name
    packagePrice: plan.price,         // use server-resolved price
    contact,
    transactionId: transactionId.trim(),
    startDate,
    projectLink,
    notes,
    status: "pending",
    txValidation,
  };

  const submissions = loadSubmissions();

  // Prevent duplicate submission for the same tx hash
  const duplicate = submissions.find(
    (s) => s.transactionId.toLowerCase() === transactionId.toLowerCase(),
  );
  if (duplicate) {
    res.status(400).json({
      error: "A submission with this transaction ID already exists",
    });
    return;
  }

  submissions.push(submission);
  saveSubmissions(submissions);

  // Mark this tx as used only once it's stored
  if (txValidation.valid) {
    saveUsedTxId(transactionId);
  }

  console.log(
    `[PROMO] New submission ${submission.id} — plan: ${plan.name} (${plan.price}) — tx valid: ${txValidation.valid}`,
  );

  res.json({
    ok: true,
    id: submission.id,
    txValidation,
    message: txValidation.valid
      ? "Submission received and payment verified. We'll be in touch soon."
      : `Submission received but payment could not be verified: ${txValidation.error}`,
  });
});

// ── Admin: submissions ────────────────────────────────────────────────────────

app.get("/api/admin/submissions", requireAdmin, (_req, res) => {
  res.json({ submissions: loadSubmissions() });
});

app.patch("/api/admin/submissions/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, adminNote } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const submissions = loadSubmissions();
  const idx = submissions.findIndex((s) => s.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  submissions[idx].status = status;
  if (adminNote !== undefined)
    submissions[idx].adminNote = sanitizeString(adminNote, 1024);
  saveSubmissions(submissions);
  res.json({ ok: true, submission: submissions[idx] });
});

app.post(
  "/api/admin/submissions/:id/revalidate",
  requireAdmin,
  async (req, res) => {
    const submissions = loadSubmissions();
    const idx = submissions.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Resolve plan price for revalidation
    const { plans } = readPlansFile();
    const plan = plans.find(
      (p) => p.name.toLowerCase() === submissions[idx].packageName.toLowerCase(),
    );

    const txValidation = await validateEthTx(
      submissions[idx].transactionId,
      plan?.priceUsd,
    );
    submissions[idx].txValidation = txValidation;

    // If now valid, mark txid as used
    if (txValidation.valid) {
      saveUsedTxId(submissions[idx].transactionId);
    }

    saveSubmissions(submissions);
    res.json({ ok: true, txValidation });
  },
);

app.delete("/api/admin/submissions/:id", requireAdmin, (req, res) => {
  const submissions = loadSubmissions();
  const idx = submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  submissions.splice(idx, 1);
  saveSubmissions(submissions);
  res.json({ ok: true });
});

// ── Admin: plans ──────────────────────────────────────────────────────────────

app.get("/api/admin/plans", requireAdmin, (_req, res) => {
  const { plans, config } = readPlansFile();
  res.json({ plans, config });
});

app.post("/api/admin/plans", requireAdmin, (req, res) => {
  const { name, price, priceUsd, description, bullets, active } =
    req.body || {};
  if (!name || !price || !description) {
    res.status(400).json({ error: "name, price and description are required" });
    return;
  }

  const { plans, config } = readPlansFile();
  const now = new Date().toISOString();
  const plan: PromoPlan = {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    price,
    priceUsd: Number(priceUsd) || 0,
    description,
    bullets: Array.isArray(bullets) ? bullets.filter(Boolean) : [],
    active: active !== false,
    createdAt: now,
    updatedAt: now,
  };
  plans.push(plan);
  savePlansAndConfig(plans, config);
  res.json({ ok: true, plan });
});

app.put("/api/admin/plans/:id", requireAdmin, (req, res) => {
  const { plans, config } = readPlansFile();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { name, price, priceUsd, description, bullets, active } =
    req.body || {};
  plans[idx] = {
    ...plans[idx],
    ...(name !== undefined && { name }),
    ...(price !== undefined && { price }),
    ...(priceUsd !== undefined && { priceUsd: Number(priceUsd) }),
    ...(description !== undefined && { description }),
    ...(bullets !== undefined && {
      bullets: Array.isArray(bullets) ? bullets.filter(Boolean) : [],
    }),
    ...(active !== undefined && { active }),
    updatedAt: new Date().toISOString(),
  };
  savePlansAndConfig(plans, config);
  res.json({ ok: true, plan: plans[idx] });
});

app.delete("/api/admin/plans/:id", requireAdmin, (req, res) => {
  const { plans, config } = readPlansFile();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  plans.splice(idx, 1);
  savePlansAndConfig(plans, config);
  res.json({ ok: true });
});

// ── Admin: site config ────────────────────────────────────────────────────────

app.put("/api/admin/config", requireAdmin, (req, res) => {
  const { paymentWallet, paymentNote } = req.body || {};
  const { plans, config } = readPlansFile();

  if (paymentWallet !== undefined) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(paymentWallet.trim())) {
      res.status(400).json({
        error: "Invalid Ethereum wallet address (must be 0x + 40 hex chars)",
      });
      return;
    }
    config.paymentWallet = paymentWallet.trim();
  }
  if (paymentNote !== undefined) config.paymentNote = String(paymentNote);
  config.updatedAt = new Date().toISOString();

  savePlansAndConfig(plans, config);
  res.json({ ok: true, config });
});

// ── Static fallback ───────────────────────────────────────────────────────────

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/{*path}", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Admin token: ${ADMIN_TOKEN ? "[set via env]" : "[NOT SET]"}`);
  await refreshAll();
  setInterval(refreshAll, REFRESH_INTERVAL_MS);
});