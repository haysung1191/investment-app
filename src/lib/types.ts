export type Market = "KR" | "US" | "UNKNOWN";

export type ChainSection = {
  stage: string;
  summary?: string;
  items: string[];
};

export type Candidate = {
  ticker: string;
  name: string;
  market: Market | string;
  rationale: string;
  score: number;
  confidence: number;
  verified?: boolean;
  stageTag?: string;
  stageReason?: string;
  scoreBreakdown?: {
    narrative: number;
    market: number;
    quality: number;
  };
};

export type AnalysisPayload = {
  trigger: string;
  chain: ChainSection[];
  candidates: Candidate[];
};

export type Quote = {
  ticker: string;
  price?: number;
  changePercent?: number;
  volume?: number;
  fundamentals?: {
    roe?: number;
    eps?: number;
    bps?: number;
  };
  technical?: {
    marketScore: number;
    rsi?: number;
    ma20?: number;
    ma60?: number;
    volRatio?: number;
    atrPct?: number;
  };
  note?: string;
};
