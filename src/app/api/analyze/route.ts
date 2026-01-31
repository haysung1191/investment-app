import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis";
import type { Market } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const headline = typeof payload.headline === "string" ? payload.headline : "";
    const article = typeof payload.article === "string" ? payload.article : undefined;
    const marketScope: Market[] = Array.isArray(payload.marketScope)
      ? (payload.marketScope as unknown[]).reduce<Market[]>((acc, value) => {
          if (value === "KR" || value === "US") acc.push(value);
          return acc;
        }, [])
      : ["KR", "US"];

    if (!headline.trim()) {
      return NextResponse.json(
        { error: "headline이 비어 있습니다." },
        { status: 400 }
      );
    }

    const analysis = await runAnalysis({
      headline: headline.trim(),
      article,
      markets: marketScope,
    });

    return NextResponse.json(analysis);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "분석 실패" },
      { status: 500 }
    );
  }
}
