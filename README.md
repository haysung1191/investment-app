# News → Causal Chain → Stock Candidates (Prototype)

빠르게 동작하는 콘셉트 데모용 Next.js 풀스택 프로젝트입니다.

## Quick Start

1) 환경 변수 설정
```
copy .env.local.example .env.local
```

2) 실행
```
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 됩니다.

## API

- `POST /api/analyze`
  - 입력: `{ headline: string, article?: string, marketScope?: ["KR","US"] }`
  - 출력: 인과 체인 + 후보 종목

- `POST /api/quote`
  - 입력: `{ tickers: string[] }`
  - 출력: KIS 시세 (현재는 스텁)

## Next Steps

- 후보 종목 scoring 로직 보강
- 한국/미국 티커 검증 및 화이트리스트 확장 (`src/lib/universe/*.json`)

## Universe 갱신

종목정보파일을 `종목정보파일/` 폴더에 넣고 아래 스크립트를 실행하세요.

```
npm run build:universe
```
