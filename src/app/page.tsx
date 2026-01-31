"use client";

import { useMemo, useState } from "react";

type ChainSection = {
  stage: string;
  summary?: string;
  items: string[];
};

type Candidate = {
  ticker: string;
  name: string;
  market: "KR" | "US" | "UNKNOWN";
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

type Quote = {
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

type AnalysisResult = {
  trigger: string;
  chain: ChainSection[];
  candidates: Candidate[];
};

const EXAMPLES = [
  "오바마케어(ACA) 폐지·축소 정책 추진 (트럼프)",
  "미국, 중국향 첨단 반도체 장비 수출 규제 강화",
  "한국 정부, 전기차 보조금 개편안 발표",
];

const getBridgeText = (section: ChainSection) => {
  if (section.summary) return section.summary;
  if (section.items?.length) return section.items[0];
  return "다음 단계로 이어지는 영향이 관측됩니다.";
};

const getStageKey = (stageTag?: string) => {
  if (!stageTag) return "General Exposure";
  const normalized = stageTag.trim();
  return normalized.length ? normalized : "General Exposure";
};

export default function Home() {
  const [headline, setHeadline] = useState("");
  const [article, setArticle] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFetchingQuotes, setIsFetchingQuotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidateTickers = useMemo(
    () =>
      analysis
        ? analysis.candidates
            .filter((candidate) => candidate.verified)
            .map((candidate) => candidate.ticker)
        : [],
    [analysis]
  );

  const candidatesByStage = useMemo(() => {
    if (!analysis) return new Map<string, Candidate[]>();
    const ordered = new Map<string, Candidate[]>();
    analysis.chain.forEach((section) => ordered.set(section.stage, []));
    analysis.candidates.forEach((candidate) => {
      const stageKey = ordered.has(candidate.stageTag ?? "")
        ? candidate.stageTag!
        : getStageKey(candidate.stageTag);
      const bucket = ordered.get(stageKey) ?? [];
      bucket.push(candidate);
      ordered.set(stageKey, bucket);
    });
    return ordered;
  }, [analysis]);

  const handleAnalyze = async () => {
    if (!headline.trim() || isAnalyzing) return;
    setError(null);
    setAnalysis(null);
    setQuotes({});
    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: headline.trim(),
          article: article.trim() || undefined,
          marketScope: ["KR", "US"],
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "분석 요청에 실패했습니다.");
      }

      const payload = (await response.json()) as AnalysisResult;
      setAnalysis(payload);
    } catch (err: any) {
      setError(err?.message || "알 수 없는 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFetchQuotes = async () => {
    if (!candidateTickers.length || isFetchingQuotes) return;
    setIsFetchingQuotes(true);
    setError(null);

    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: candidateTickers }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "시세 조회에 실패했습니다.");
      }

      const payload = (await response.json()) as Quote[];
      const nextQuotes: Record<string, Quote> = {};
      payload.forEach((quote) => {
        nextQuotes[quote.ticker] = quote;
      });
      setQuotes(nextQuotes);
    } catch (err: any) {
      setError(err?.message || "시세 조회 중 오류가 발생했습니다.");
    } finally {
      setIsFetchingQuotes(false);
    }
  };

  const hasQuotes = Object.keys(quotes).length > 0;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const computeBreakdown = (candidate: Candidate, quote?: Quote) => {
    const narrative = clamp(candidate.score ?? 50, 0, 100);
    const market =
      candidate.market === "KR" && quote?.technical?.marketScore !== undefined
        ? clamp(quote.technical.marketScore, 0, 100)
        : quote?.changePercent !== undefined
          ? clamp(50 + quote.changePercent * 2, 0, 100)
          : 50;
    const hasKrQuality = candidate.market === "KR";
    const roe = quote?.fundamentals?.roe;
    const eps = quote?.fundamentals?.eps;
    const bps = quote?.fundamentals?.bps;

    let quality: number | null = null;
    if (hasKrQuality) {
      const roeScore =
        roe !== undefined ? clamp(40 + roe * 2, 0, 100) : 50;
      const epsScore =
        eps !== undefined
          ? clamp(50 + Math.sign(eps) * Math.min(30, Math.abs(eps) / 200), 0, 100)
          : 50;
      const bpsScore =
        bps !== undefined
          ? clamp(40 + Math.min(40, bps / 5000), 0, 100)
          : 50;

      const baseQuality =
        roe !== undefined && roe < 0 ? Math.min(roeScore, 40) : roeScore;

      quality = Math.round(baseQuality * 0.5 + epsScore * 0.3 + bpsScore * 0.2);
    }

    return {
      narrative: Math.round(narrative),
      market: Math.round(market),
      quality: quality === null ? null : Math.round(quality),
      hasKrQuality,
    };
  };

  const computeFinalScore = (candidate: Candidate, quote?: Quote) => {
    const breakdown = computeBreakdown(candidate, quote);
    const narrativeWeight = 0.6;
    const marketWeight = 0.4;

    if (!breakdown.hasKrQuality) {
      return Math.round(
        breakdown.narrative * narrativeWeight +
          breakdown.market * marketWeight
      );
    }

    return Math.round(
      breakdown.narrative * 0.5 +
        breakdown.market * 0.3 +
        (breakdown.quality ?? 50) * 0.2
    );
  };

  const executiveNarrative = useMemo(() => {
    if (!analysis) return null;
    const parts = analysis.chain
      .map((section) => getBridgeText(section))
      .filter(Boolean)
      .slice(0, 5);
    return `${analysis.trigger} -> ${parts.join(" -> ")}`;
  }, [analysis]);

  const renderCandidateCard = (candidate: Candidate) => {
    const quote = quotes[candidate.ticker];
    const finalScore = computeFinalScore(candidate, quote);
    const breakdown = computeBreakdown(candidate, quote);

    return (
      <div
        key={candidate.ticker}
        className="rounded-lg border-l-2 border-slate-900/20 bg-white px-4 py-3"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {candidate.name} ({candidate.ticker})
            </div>
            <div className="text-xs text-slate-500">
              {candidate.market}
              {!candidate.verified && (
                <span className="ml-2 text-amber-600">unverified</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-slate-900">
              {finalScore}
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
              Score
            </div>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">{candidate.rationale}</p>
        {candidate.stageReason && (
          <div className="mt-2 text-xs text-slate-500">
            {candidate.stageReason}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Narrative", value: breakdown.narrative, color: "bg-slate-700" },
            { label: "Market", value: breakdown.market, color: "bg-slate-400" },
            { label: "Quality", value: breakdown.quality, color: "bg-emerald-400" },
          ].map((item) => (
            <div key={item.label} className="text-[11px] text-slate-500">
              <div className="flex items-center justify-between">
                <span>{item.label}</span>
                <span className="text-slate-400">{item.value ?? "-"}</span>
              </div>
              <div className="score-bar">
                <div
                  className={`score-fill ${item.color}`}
                  style={{ width: `${item.value ?? 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          AI 점수 {candidate.score}점 · 신뢰도{" "}
          {Math.round(candidate.confidence * 100)}%
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {quote ? (
            <>
              <span>현재가 {quote.price ?? "-"}</span>
              <span className="mx-2">|</span>
              <span>등락 {quote.changePercent ?? "-"}%</span>
              <span className="mx-2">|</span>
              <span>거래량 {quote.volume ?? "-"}</span>
              {quote.fundamentals && (
                <>
                  <span className="mx-2">|</span>
                  <span>
                    ROE {quote.fundamentals.roe ?? "-"} / EPS{" "}
                    {quote.fundamentals.eps ?? "-"}
                  </span>
                </>
              )}
              {quote.technical && (
                <>
                  <span className="mx-2">|</span>
                  <span>
                    RSI {quote.technical.rsi?.toFixed(1) ?? "-"} / MA20{" "}
                    {quote.technical.ma20?.toFixed(0) ?? "-"} / MA60{" "}
                    {quote.technical.ma60?.toFixed(0) ?? "-"}
                  </span>
                </>
              )}
              {quote.note && (
                <>
                  <span className="mx-2">|</span>
                  <span>{quote.note}</span>
                </>
              )}
            </>
          ) : (
            <span className="text-slate-400">
              {hasQuotes ? "시세 없음" : "KIS 데이터를 불러오지 않았습니다."}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 selection:bg-slate-200">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <header className="mb-10 border-b border-slate-200 pb-6">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
            <span className="h-px w-6 bg-slate-300" />
            Research Brief
          </div>
          <h1 className="mt-4 font-[var(--font-display)] text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            인과 서사 기반 뉴스 인텔리전스 브리핑
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            헤드라인에서 시작해 사건이 어떤 연쇄를 거쳐 기업에 영향을 미치는지 보고서 형태로
            정리합니다. 점수는 보조 지표이며, 서사가 핵심입니다.
          </p>
        </header>

        <section className="mb-10 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Headline
          </label>
          <textarea
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            placeholder="예) 오바마케어(ACA) 폐지·축소 정책 추진 (트럼프)"
            rows={2}
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                onClick={() => setHeadline(example)}
              >
                {example}
              </button>
            ))}
          </div>

          <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Article Summary (Optional)
          </label>
          <textarea
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            placeholder="기사 핵심 내용 3~7줄 요약을 붙여 넣어주세요."
            rows={4}
            value={article}
            onChange={(event) => setArticle(event.target.value)}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              disabled={isAnalyzing}
            >
              {isAnalyzing ? "분석 중..." : "인과 서사 분석"}
            </button>
            <button
              type="button"
              onClick={handleFetchQuotes}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
              disabled={!analysis || isFetchingQuotes || candidateTickers.length === 0}
            >
              {isFetchingQuotes ? "시장 데이터 조회 중..." : "KIS 데이터 불러오기"}
            </button>
            {error && <span className="text-sm text-rose-600">{error}</span>}
          </div>
        </section>

        {analysis ? (
          <main className="space-y-10">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Executive Summary
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">
                {analysis.trigger}
              </h2>
              {executiveNarrative && (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {executiveNarrative}
                </p>
              )}
              <div className="mt-3 text-xs text-slate-400">
                점수 구성: 서사(주도) + 시장(확인) + 재무(KR 보정)
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-3">
                <h3 className="font-[var(--font-display)] text-lg font-semibold text-slate-900">
                  Causal Chain
                </h3>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Storyline
                </span>
              </div>
              <div className="relative mt-6 pl-6">
                <div className="timeline-line" />
                {analysis.chain.map((section, index) => {
                  const bridgeText = getBridgeText(section);
                  const isLast = index === analysis.chain.length - 1;
                  return (
                    <div
                      key={`${section.stage}-${index}`}
                      className="relative mb-8 pl-6 report-fade-up"
                      style={{ animationDelay: `${index * 80}ms` }}
                    >
                      <div
                        className={`timeline-dot ${index === 0 ? "timeline-dot--active" : ""}`}
                      />
                      {!isLast && (
                        <div className="absolute left-0 top-5 h-full w-px bg-slate-200" />
                      )}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-baseline justify-between">
                          <div className="text-sm font-semibold text-slate-900">
                            {section.stage}
                          </div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                            Step {index + 1}
                          </div>
                        </div>
                        {section.summary && (
                          <p className="mt-2 text-sm text-slate-600">
                            {section.summary}
                          </p>
                        )}
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        {!isLast && (
                          <div className="mt-3 text-xs text-slate-500">
                            다음 단계로 이어진 이유: {bridgeText}
                          </div>
                        )}
                      </div>

                      {candidatesByStage.get(section.stage)?.length ? (
                        <div className="mt-4 space-y-3">
                          {candidatesByStage.get(section.stage)!.map((candidate) =>
                            renderCandidateCard(candidate)
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            {Array.from(candidatesByStage.keys()).some(
              (key) => !analysis.chain.some((section) => section.stage === key)
            ) && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Other Exposure
                </div>
                <div className="mt-4 space-y-3">
                  {Array.from(candidatesByStage.entries())
                    .filter(([stage]) => !analysis.chain.some((s) => s.stage === stage))
                    .map(([stage, list]) => (
                      <div key={stage}>
                        <div className="text-sm font-semibold text-slate-900">{stage}</div>
                        <div className="mt-2 space-y-3">
                          {list.map((candidate) => renderCandidateCard(candidate))}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </main>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
            아직 분석 결과가 없습니다. 헤드라인을 입력하고 분석을 시작하세요.
          </div>
        )}
      </div>
    </div>
  );
}
