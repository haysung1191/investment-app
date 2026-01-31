import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { AnalysisPayload, Candidate, ChainSection, Market } from "./types";
import krUniverse from "./universe/kr.json";
import usUniverse from "./universe/us.json";
import krNameMap from "./universe/kr_name_map.json";

const MODEL_NAME = (process.env.GEMINI_MODEL || "gemini-3-flash").trim();

const STAGES = [
  "② 1차 효과 (Direct Effect)",
  "③ 2차 효과 (Market Reaction)",
  "④ 3차 효과 (Political Response)",
  "⑤ 4차 효과 (Financial Impact)",
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
    ? `\n[기사 요약]\n${article.trim()}\n`
    : "";

  return `
당신은 한국/미국 주식 시장을 분석하는 리서치 애널리스트입니다.
아래 뉴스 헤드라인(및 기사 요약)을 읽고 인과 체인을 정리한 뒤,
수혜/피해 가능성이 큰 종목 후보를 추출하세요.

[요구사항]
- 출력은 반드시 JSON만 반환
- 응답 언어: 한국어
- 후보 종목은 ${marketScope} 시장만 포함
- score는 0~100 정수, confidence는 0~1 실수
- ticker는 거래소 표준 티커(미국은 AAPL 같은 심볼, 한국은 6자리 숫자)

[출력 JSON 형식]
{
  "trigger": "핵심 사건 요약",
  "stage_summaries": {
    "direct_effect": "1차 효과 요약 1문장",
    "market_reaction": "2차 효과 요약 1문장",
    "political_response": "3차 효과 요약 1문장",
    "financial_impact": "4차 효과 요약 1문장"
  },
  "direct_effects": ["1차 효과", "..."],
  "market_reaction": ["2차 효과", "..."],
  "political_response": ["3차 효과", "..."],
  "financial_impact": ["4차 효과", "..."],
  "candidates": [
    {
      "ticker": "005930",
      "name": "삼성전자",
      "market": "KR",
      "rationale": "인과 체인과의 연결 근거 1~2문장",
      "stage_tag": "Direct Effect | Market Reaction | Political Response | Financial Impact",
      "stage_reason": "어떤 단계 요약과 연결되는지 1문장",
      "score": 78,
      "confidence": 0.72
    }
  ]
}

[입력]
헤드라인: ${headline.trim()}
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
    .replace(/[\s\(\)\[\]\.\-·]/g, "")
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
      rationale: String(candidate.rationale || "").trim() || "연결 근거 없음",
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
    throw new Error("Gemini 응답 스키마 검증 실패");
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
  markets?: Market[];
}): Promise<AnalysisPayload> {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/["']/g, "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = buildPrompt(headline, article, markets);
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
