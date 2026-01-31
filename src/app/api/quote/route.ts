import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/kis";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const tickers = Array.isArray(payload.tickers)
      ? payload.tickers.map((ticker: any) => String(ticker).trim()).filter(Boolean)
      : [];

    if (!tickers.length) {
      return NextResponse.json(
        { error: "tickers가 비어 있습니다." },
        { status: 400 }
      );
    }

    const quotes = await fetchQuotes(tickers);
    return NextResponse.json(quotes);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "시세 조회 실패" },
      { status: 500 }
    );
  }
}
