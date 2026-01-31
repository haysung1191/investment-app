import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { AnalysisPayload, Candidate, ChainSection, Market } from "./types";
import krUniverse from "./universe/kr.json";
import usUniverse from "./universe/us.json";
import krNameMap from "./universe/kr_name_map.json";

const MODEL_NAME = (process.env.GEMINI_MODEL || "gemini-3-flash").trim();

const STAGES = [
  "??1李??④낵 (Direct Effect)",
  "??2李??④낵 (Market Reaction)",
  "??3李??④낵 (Political Response)",
  "??4李??④낵 (Financial Impact)",
];

const MAX_CANDIDATES = 12;

const numberField = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().finite());

const AnalysisSchema = z.object({
  trigger: z.string().min(1),
  stage_summaries: z
    .object({
      direct_effect: z.string().optional(),
      market_reaction: z.string().optional(),
      political_response: z.string().optional(),
      financial_impact: z.string().optional(),
    })
    .optional(),
  direct_effects: z.array(z.string()).default([]),
  market_reaction: z.array(z.string()).default([]),
  political_response: z.array(z.string()).default([]),
  financial_impact: z.array(z.string()).default([]),
  candidates: z.array(
    z.object({
      ticker: z.string().min(1),
      name: z.string().min(1),
      market: z.enum(["KR", "US", "UNKNOWN"]).optional().default("UNKNOWN"),
      rationale: z.string().min(1),
      stage_tag: z.string().optional(),
      stage_reason: z.string().optional(),
      score: numberField,
      confidence: numberField,
    })
  ),
});

const buildPrompt = (headline: string, article?: string, markets?: Market[]) => {
  const marketScope = markets?.length ? markets.join(", ") : "KR, US";
  const articleBlock = article
    ? `\n[湲곗궗 ?붿빟]\n${article.trim()}\n`
    : "";

  return `
?뱀떊? ?쒓뎅/誘멸뎅 二쇱떇 ?쒖옣??遺꾩꽍?섎뒗 由ъ꽌移??좊꼸由ъ뒪?몄엯?덈떎.
?꾨옒 ?댁뒪 ?ㅻ뱶?쇱씤(諛?湲곗궗 ?붿빟)???쎄퀬 ?멸낵 泥댁씤???뺣━????
?섑삙/?쇳빐 媛?μ꽦????醫낅ぉ ?꾨낫瑜?異붿텧?섏꽭??

[?붽뎄?ы빆]
- 異쒕젰? 諛섎뱶??JSON留?諛섑솚
- ?묐떟 ?몄뼱: ?쒓뎅??- ?꾨낫 醫낅ぉ? ${marketScope} ?쒖옣留??ы븿
- score??0~100 ?뺤닔, confidence??0~1 ?ㅼ닔
- ticker??嫄곕옒???쒖? ?곗빱(誘멸뎅? AAPL 媛숈? ?щ낵, ?쒓뎅? 6?먮━ ?レ옄)

[異쒕젰 JSON ?뺤떇]
{
  "trigger": "?듭떖 ?ш굔 ?붿빟",
  "stage_summaries": {
    "direct_effect": "1李??④낵 ?붿빟 1臾몄옣",
    "market_reaction": "2李??④낵 ?붿빟 1臾몄옣",
    "political_response": "3李??④낵 ?붿빟 1臾몄옣",
    "financial_impact": "4李??④낵 ?붿빟 1臾몄옣"
  },
  "direct_effects": ["1李??④낵", "..."],
  "market_reaction": ["2李??④낵", "..."],
  "political_response": ["3李??④낵", "..."],
  "financial_impact": ["4李??④낵", "..."],
  "candidates": [
    {
      "ticker": "005930",
      "name": "?쇱꽦?꾩옄",
      "market": "KR",
      "rationale": "?멸낵 泥댁씤怨쇱쓽 ?곌껐 洹쇨굅 1~2臾몄옣",
      "stage_tag": "Direct Effect | Market Reaction | Political Response | Financial Impact",
      "stage_reason": "?대뼡 ?④퀎 ?붿빟怨??곌껐?섎뒗吏 1臾몄옣",
      "score": 78,
      "confidence": 0.72
    }
  ]
}

[?낅젰]
?ㅻ뱶?쇱씤: ${headline.trim()}
${articleBlock}
`;
};

const normalizeMarket = (value: string): Market => {
  if (value === "KR" || value === "US") return value;
  return "UNKNOWN";
};

const safeArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
};

const toChain = (raw: any): ChainSection[] => {
  const direct = safeArray(raw.direct_effects);
  const reaction = safeArray(raw.market_reaction);
  const political = safeArray(raw.political_response);
  const financial = safeArray(raw.financial_impact);
  const summaries = raw.stage_summaries || {};

  const chain: ChainSection[] = [
    { stage: STAGES[0], summary: summaries.direct_effect, items: direct },
    { stage: STAGES[1], summary: summaries.market_reaction, items: reaction },
    { stage: STAGES[2], summary: summaries.political_response, items: political },
    { stage: STAGES[3], summary: summaries.financial_impact, items: financial },
  ];

  return chain.filter((section) => section.items.length > 0);
};

const krSet = new Set(krUniverse.map((ticker) => ticker.toUpperCase()));
const usSet = new Set(usUniverse.map((ticker) => ticker.toUpperCase()));
const krNameMapRecord = krNameMap as Record<string, string>;

const normalizeName = (value: string) =>
  value
    .toUpperCase()
    .replace(/[\s\(\)\[\]\.\-쨌]/g, "")
    .trim();

const validateCandidateTicker = (ticker: string, market: Market) => {
  const clean = ticker.toUpperCase();
  if (market === "KR") return krSet.has(clean);
  if (market === "US") return usSet.has(clean);
  return false;
};

const resolveKrTickerByName = (name: string) => {
  const key = normalizeName(name);
  return key ? krNameMapRecord[key] : undefined;
};

const toCandidates = (raw: z.infer<typeof AnalysisSchema>): Candidate[] => {
  if (!Array.isArray(raw.candidates)) return [];

  return raw.candidates.map((candidate: any) => {
    const ticker = String(candidate.ticker || "").trim();
    const providedMarket = normalizeMarket(
      String(candidate.market || "UNKNOWN").toUpperCase()
    );
    const inferredMarket: Market = /^\d{6}$/.test(ticker)
      ? "KR"
      : ticker
      ? "US"
      : "UNKNOWN";
    const market = providedMarket === "UNKNOWN" ? inferredMarket : providedMarket;

    return {
      ticker,
      name: String(candidate.name || "").trim() || "Unknown",
      market,
      rationale: String(candidate.rationale || "").trim() || "?곌껐 洹쇨굅 ?놁쓬",
      stageTag: String(candidate.stage_tag || "").trim() || undefined,
      stageReason: String(candidate.stage_reason || "").trim() || undefined,
      score: Number.isFinite(candidate.score)
        ? Math.max(0, Math.min(100, Math.round(candidate.score)))
        : 0,
      confidence: Number.isFinite(candidate.confidence)
        ? Math.max(0, Math.min(1, Number(candidate.confidence)))
        : 0.5,
      verified: false,
    };
  });
};

const applyVerification = (candidates: Candidate[]) =>
  candidates.map((candidate) => {
    const verified = validateCandidateTicker(candidate.ticker, candidate.market);
    if (verified || candidate.market !== "KR") {
      return { ...candidate, verified };
    }

    const corrected = resolveKrTickerByName(candidate.name);
    if (corrected) {
      return {
        ...candidate,
        ticker: corrected,
        market: "KR",
        verified: true,
      };
    }

    return { ...candidate, verified: false };
  });

const clampCandidates = (candidates: Candidate[]) =>
  candidates.slice(0, MAX_CANDIDATES);

const parseJson = (rawText: string) => {
  const parsed = JSON.parse(rawText);
  const result = AnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Gemini ?묐떟 ?ㅽ궎留?寃利??ㅽ뙣");
  }
  return result.data;
};

const buildRepairPrompt = (rawText: string) => `
You are a JSON repair assistant.
Return ONLY valid JSON that matches this schema:
{
  "trigger": string,
  "direct_effects": string[],
  "market_reaction": string[],
  "political_response": string[],
  "financial_impact": string[],
  "candidates": [
    {
      "ticker": string,
      "name": string,
      "market": "KR" | "US" | "UNKNOWN",
      "rationale": string,
      "score": number,
      "confidence": number
    }
  ]
}

If any field is missing, infer reasonable defaults from the input.
Input:
${rawText}
`;

export async function runAnalysis({
  headline,
  article,
  markets,
}: {
  headline: string;
  article?: string;
  markets?: Market[] | string[];
}): Promise<AnalysisPayload> {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/["']/g, "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY媛 ?ㅼ젙?섏? ?딆븯?듬땲??");
  }

  const normalizedMarkets =
    markets && markets.length
      ? (markets as string[])
          .map((value) => value.toUpperCase())
          .filter((value): value is Market => value === "KR" || value === "US")
      : undefined;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = buildPrompt(headline, article, normalizedMarkets);
  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  let parsed: z.infer<typeof AnalysisSchema>;
  try {
    parsed = parseJson(response.response.text());
  } catch (error) {
    const repair = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: buildRepairPrompt(response.response.text()) }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
    parsed = parseJson(repair.response.text());
  }

  const verifiedCandidates = clampCandidates(applyVerification(toCandidates(parsed)));

  return {
    trigger: String(parsed.trigger || headline).trim(),
    chain: toChain(parsed),
    candidates: verifiedCandidates,
  };
}

