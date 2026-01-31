# Scoring Spec (Final)

This document fixes the scoring methodology. Do not change weights or formulas unless explicitly requested.

## Overview

- Narrative score: LLM output (0–100)
- Market score:
  - KR: MA/RSI/Volume/ATR from KIS daily bars
  - US: simple change% based proxy
- Quality score:
  - KR only (ROE/EPS/BPS)
  - US: omitted and weights are reallocated

## Final Score Weights

- KR: Narrative 50% + Market 30% + Quality 20%
- US: Narrative 60% + Market 40% (Quality omitted)

## KR Market Score (0–100)

Inputs (daily bars, last ~120 days):
- MA20 / MA60
- RSI(14)
- Volume ratio: avg(last 3 days) / avg(last 20 days)
- ATR(14) as % of price

Components:
- Trend score:
  - Price > MA20: +5 else -5
  - MA20 > MA60: +5 else -5
- Momentum score:
  - 10‑day return * 50, capped to [-20, +20]
- Volume score:
  - VolRatio > 2.0: +10
  - VolRatio > 1.5: +6
  - VolRatio < 0.5: -6
- RSI penalty:
  - RSI > 75: -7
  - RSI < 25: -6
- ATR penalty:
  - ATR% > 10%: -7
  - ATR% > 7%: -4

Raw score range roughly [-30, +30], normalized:
```
MarketScore = ((raw + 30) / 60) * 100
```
Clamped to [0, 100].

## KR Quality Score (0–100)

Inputs:
- ROE
- EPS
- BPS

Scores:
- ROE score: `clamp(40 + ROE * 2, 0, 100)`
- EPS score: `clamp(50 + sign(EPS) * min(30, |EPS|/200), 0, 100)`
- BPS score: `clamp(40 + min(40, BPS/5000), 0, 100)`

If ROE is negative, cap quality using `min(roeScore, 40)`.

Final quality score:
```
Quality = round(roeScore * 0.5 + epsScore * 0.3 + bpsScore * 0.2)
```

## US Market Score (0–100)

Fallback proxy:
```
Market = clamp(50 + changePercent * 2, 0, 100)
```

## Narrative Score

Provided by LLM (0–100). Used as-is.

## Notes

- US quality is omitted to avoid imputed fundamentals.
- KR technicals use KIS daily bars (FHKST03010100).
- Keep this spec stable unless explicitly requested to change.
