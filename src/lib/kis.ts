import type { Quote } from "./types";
import usExchangeMap from "./universe/us_exchange_map.json";

const BASE_URL_REAL = "https://openapi.koreainvestment.com:9443";
const BASE_URL_VTS = "https://openapivts.koreainvestment.com:29443";

const APP_KEY = process.env.KIS_APP_KEY || "";
const APP_SECRET = process.env.KIS_APP_SECRET || "";

const BASE_URL =
  process.env.KIS_BASE_URL ||
  (process.env.KIS_USE_VTS === "true" ? BASE_URL_VTS : BASE_URL_REAL);

const isConfigured = () => Boolean(APP_KEY && APP_SECRET);

type TokenCache = {
  token: string;
  expiresAt: number;
};

let cachedToken: TokenCache | null = null;
let tokenInFlight: Promise<string> | null = null;
const quoteCache = new Map<string, { data: Quote; expiresAt: number }>();
const finCache = new Map<string, { data: Quote["fundamentals"]; expiresAt: number }>();

const QUOTE_TTL_MS = 20_000;
const FIN_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const DAILY_LOOKBACK_DAYS = 60;

const now = () => Date.now();

const normalizeTicker = (ticker: string) => {
  const clean = ticker.trim().toUpperCase();
  if (/^\d{1,6}$/.test(clean)) {
    return clean.padStart(6, "0");
  }
  return clean;
};

const isKrTicker = (ticker: string) => /^\d{6}$/.test(ticker);

const parseNumber = (value: any) => {
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : undefined;
};

const formatDate = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > now()) {
    return cachedToken.token;
  }

  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchWithTimeout(
        `${BASE_URL}/oauth2/tokenP`,
        {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            grant_type: "client_credentials",
            appkey: APP_KEY,
            appsecret: APP_SECRET,
          }),
        },
        REQUEST_TIMEOUT_MS
      );

      if (response.ok) {
        const payload = await response.json();
        const token = payload?.access_token as string | undefined;
        if (!token) {
          lastError = new Error("KIS token response missing access_token");
        } else {
          const expiresIn = Number(payload?.expires_in ?? 0);
          const ttlMs =
            Number.isFinite(expiresIn) && expiresIn > 0
              ? expiresIn * 1000
              : 23 * 60 * 60 * 1000;
          cachedToken = {
            token,
            expiresAt: now() + ttlMs - 60_000,
          };
          return token;
        }
      } else {
        lastError = new Error("KIS token request failed");
      }

      await sleep(400 + attempt * 300);
    }
    throw lastError ?? new Error("KIS token request failed");
  })();

  try {
    return await tokenInFlight;
  } finally {
    tokenInFlight = null;
  }
}

async function authorizedFetch(
  url: string,
  init: RequestInit,
  retryOnUnauthorized = true
) {
  const token = await getAccessToken();
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    },
  });

  if (response.status === 401 && retryOnUnauthorized) {
    cachedToken = null;
    return authorizedFetch(url, init, false);
  }

  return response;
}

async function fetchDomesticQuote(ticker: string): Promise<Quote> {
  const cached = quoteCache.get(ticker);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: ticker,
  });

  await sleep(120);
  const response = await authorizedFetch(
    `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        tr_id: "FHKST01010100",
        custtype: "P",
      },
    }
  );

  const payload = await response.json();
  if (payload?.rt_cd !== "0") {
    return { ticker, note: payload?.msg1 || "Domestic quote failed" };
  }

  const output = payload.output || {};
  const quote = {
    ticker,
    price: parseNumber(output.stck_prpr),
    changePercent: parseNumber(output.prdy_ctrt),
    volume: parseNumber(output.acml_vol),
  };
  quoteCache.set(ticker, { data: quote, expiresAt: now() + QUOTE_TTL_MS });
  return quote;
}

async function fetchDomesticFinancials(ticker: string): Promise<Quote["fundamentals"]> {
  const cached = finCache.get(ticker);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  const params = new URLSearchParams({
    FID_DIV_CLS_CODE: "1",
    fid_cond_mrkt_div_code: "J",
    fid_input_iscd: ticker,
  });

  await sleep(120);
  const response = await authorizedFetch(
    `${BASE_URL}/uapi/domestic-stock/v1/finance/financial-ratio?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        tr_id: "FHKST66430300",
        custtype: "P",
      },
    }
  );

  const payload = await response.json();
  if (payload?.rt_cd !== "0") {
    return undefined;
  }

  const first = Array.isArray(payload.output) ? payload.output[0] : undefined;
  if (!first) return undefined;

  const fundamentals = {
    roe: parseNumber(first.roe_val),
    eps: parseNumber(first.eps),
    bps: parseNumber(first.bps),
  };
  finCache.set(ticker, { data: fundamentals, expiresAt: now() + FIN_TTL_MS });
  return fundamentals;
}

type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

async function fetchDomesticDailyBars(ticker: string): Promise<DailyBar[]> {
  const end = new Date();
  const start = addDays(end, -DAILY_LOOKBACK_DAYS);

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: ticker,
    FID_INPUT_DATE_1: formatDate(start),
    FID_INPUT_DATE_2: formatDate(end),
    FID_PERIOD_DIV_CODE: "D",
    FID_ORG_ADJ_PRC: "0",
  });

  await sleep(120);
  const response = await authorizedFetch(
    `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        tr_id: "FHKST03010100",
        custtype: "P",
      },
    }
  );

  const payload = await response.json();
  if (payload?.rt_cd !== "0") {
    return [];
  }

  const output2 = Array.isArray(payload.output2) ? payload.output2 : [];
  const bars = output2
    .map((row: any) => ({
      date: String(row.stck_bsop_date || ""),
      open: parseNumber(row.stck_oprc) ?? 0,
      high: parseNumber(row.stck_hgpr) ?? 0,
      low: parseNumber(row.stck_lwpr) ?? 0,
      close: parseNumber(row.stck_clpr) ?? 0,
      volume: parseNumber(row.acml_vol) ?? 0,
    }))
    .filter((bar: DailyBar) => bar.date && bar.close > 0)
    .sort((a: DailyBar, b: DailyBar) => a.date.localeCompare(b.date));

  return bars;
}

const sma = (values: number[], period: number) => {
  if (values.length < period) return undefined;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / period;
};

const computeRsi14 = (closes: number[]) => {
  if (closes.length < 15) return undefined;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 14; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const computeAtrPct = (bars: DailyBar[]) => {
  if (bars.length < 15) return undefined;
  const recent = bars.slice(-14);
  let sum = 0;
  for (let i = 0; i < recent.length; i += 1) {
    const bar = recent[i];
    const prevClose = i === 0 ? bar.close : recent[i - 1].close;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
    sum += tr;
  }
  const atr = sum / recent.length;
  const lastClose = bars[bars.length - 1].close || 1;
  return atr / lastClose;
};

const computeMarketScore = (bars: DailyBar[]) => {
  if (bars.length < 60) return { marketScore: 50 };
  const closes = bars.map((b) => b.close);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const lastClose = closes[closes.length - 1];
  const rsi = computeRsi14(closes);
  const atrPct = computeAtrPct(bars);

  let scoreTrend = 0;
  if (ma20 !== undefined) scoreTrend += lastClose > ma20 ? 5 : -5;
  if (ma20 !== undefined && ma60 !== undefined) {
    scoreTrend += ma20 > ma60 ? 5 : -5;
  }

  const change10 =
    closes.length >= 11
      ? (lastClose - closes[closes.length - 11]) / closes[closes.length - 11]
      : 0;
  const scoreMomentum = Math.max(-20, Math.min(20, change10 * 50));

  const volumes = bars.map((b) => b.volume);
  const avg3 =
    volumes.length >= 3
      ? volumes.slice(volumes.length - 3).reduce((a, v) => a + v, 0) / 3
      : undefined;
  const avg20 =
    volumes.length >= 20
      ? volumes.slice(volumes.length - 20).reduce((a, v) => a + v, 0) / 20
      : undefined;
  const volRatio = avg3 && avg20 ? avg3 / avg20 : undefined;
  let scoreVolume = 0;
  if (volRatio !== undefined) {
    if (volRatio > 2.0) scoreVolume = 10;
    else if (volRatio > 1.5) scoreVolume = 6;
    else if (volRatio < 0.5) scoreVolume = -6;
  }

  let scoreRsi = 0; // FINAL spec
  if (rsi !== undefined) {
    if (rsi > 75) scoreRsi = -7;
    else if (rsi < 25) scoreRsi = -6;
  }

  let scoreVolatility = 0; // FINAL spec
  if (atrPct !== undefined) {
    if (atrPct > 0.10) scoreVolatility = -7;
    else if (atrPct > 0.07) scoreVolatility = -4;
  }

  const raw = scoreTrend + scoreMomentum + scoreVolume + scoreRsi + scoreVolatility;
  const marketScore = Math.round(((raw + 30) / 60) * 100);

  return {
    marketScore: Math.max(0, Math.min(100, marketScore)),
    rsi,
    ma20,
    ma60,
    volRatio,
    atrPct,
  };
};

async function fetchOverseasQuote(ticker: string): Promise<Quote> {
  const cached = quoteCache.get(ticker);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  const mappedExchange = (usExchangeMap as Record<string, string>)[ticker];
  const exchanges = mappedExchange ? [mappedExchange] : ["NAS", "NYS", "AMS"];

  for (const exchange of exchanges) {
    const params = new URLSearchParams({
      AUTH: "",
      EXCD: exchange,
      SYMB: ticker,
    });

    await sleep(120);
    const response = await authorizedFetch(
      `${BASE_URL}/uapi/overseas-price/v1/quotations/price?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          tr_id: "HHDFS00000300",
          custtype: "P",
        },
      }
    );

    const payload = await response.json();
    if (payload?.rt_cd !== "0") {
      continue;
    }

    const output = payload.output || {};
    const price = parseNumber(output.last);
    const changePercent = parseNumber(output.rate);
    const volume = parseNumber(output.tvol);
    if (!price || price === 0) {
      continue;
    }

    const quote = {
      ticker,
      price,
      changePercent,
      volume,
      note: `EXCD ${exchange}`,
    };
    quoteCache.set(ticker, { data: quote, expiresAt: now() + QUOTE_TTL_MS });
    return quote;
  }

  return { ticker, note: "Overseas quote failed or unavailable" };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number) {
  const results: T[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  });

  await Promise.allSettled(workers);
  return results;
}

export async function fetchQuotes(tickers: string[]): Promise<Quote[]> {
  if (!tickers.length) return [];

  if (!isConfigured()) {
    return tickers.map((ticker) => ({
      ticker,
      note: "KIS API keys not configured",
    }));
  }

  const pairs = tickers.map((ticker) => ({
    original: ticker,
    normalized: normalizeTicker(ticker),
  }));
  const tasks = pairs.map((pair) => async (): Promise<Quote> => {
    try {
      if (isKrTicker(pair.normalized)) {
        const [quote, fundamentals, dailyBars] = await Promise.all([
          fetchDomesticQuote(pair.normalized),
          fetchDomesticFinancials(pair.normalized),
          fetchDomesticDailyBars(pair.normalized),
        ]);
        const technical =
          dailyBars.length >= 20 ? computeMarketScore(dailyBars) : undefined;
        return {
          ...quote,
          fundamentals,
          technical,
          ticker: pair.original,
        };
      }
      const quote = await fetchOverseasQuote(pair.normalized);
      return {
        ...quote,
        ticker: pair.original,
      };
    } catch (error: any) {
      return {
        ticker: pair.original,
        note: error?.message || "KIS request error",
      };
    }
  });

  return runWithConcurrency(tasks, 2);
}
