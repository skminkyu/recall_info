# recall_info

국내·해외 리콜 제품 정보를 누적/관리하고, 제품 사진을 첨부하면 유사한 리콜 제품
후보를 제시하는 시스템입니다. Claude Code에 연결된 두 개의 MCP 커넥터를 데이터
소스로 사용합니다.

- **국내리콜 MCP** (`mcp__MCP__*`) — 한국제품안전협회(SafetyKorea) 공개 리콜
- **해외리콜 MCP** (`mcp__MCP-c805d72e__*`) — AU/CA/CN/EN/EU/FR/GE/JP_METI/
  JP_RECALLPLUS/NZ/OECD/US_CPSC/US_NHTSA 13개국 정부기관 리콜

## 구성

- Node.js + TypeScript + Express, SQLite(better-sqlite3, FTS5 전문검색)
- `src/` — 서버, DB 스키마, 정규화 로직, API 라우트
- `public/` — 정적 웹 UI (리콜 목록/검색, 사진 업로드 매칭)
- `scripts/ingest-file.ts` — MCP 원본 JSON을 DB로 적재하는 CLI
- `data/seeds/` — 최초 적재된 실데이터 스냅샷(국내 50건, 해외 100건, 2026-08-11 기준)
- `docs/INGESTION.md` — MCP 데이터 수집 및 사진 매칭 워크플로 상세 설명 (**필독**)

MCP 도구는 Claude 세션 안에서만 호출 가능하므로, 이 저장소의 앱은 "MCP를 직접
호출하는 서버"가 아니라 "Claude 세션이 MCP를 호출해 넣어주는 데이터를 누적·검색·
서빙하는 앱"입니다. 자세한 수집/매칭 흐름은 `docs/INGESTION.md`를 참고하세요.

## 실행

```bash
npm install
npm run seed    # (최초 1회) 시드 데이터 적재 — 국내 50건 + 해외 100건
npm run dev      # http://localhost:3000
```

- `npm run build && npm start` — 프로덕션 실행
- `npm run typecheck` — 타입 체크
- `npm run ingest -- <file.json> [domestic|overseas]` — 새 MCP 데이터 적재

## API

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/recalls` | 리콜 검색/목록 (`q`, `source_type`, `source_code`, `brand`, `date_from`, `date_to`, `limit`, `offset`) |
| GET | `/api/recalls/stats` | 출처별 누적 건수, 최신 게시일 |
| GET | `/api/recalls/:id` | 리콜 상세 (원본 raw JSON 포함) |
| POST | `/api/ingest` | `{ source_type, raw: [...] }` MCP 원본 데이터 적재(upsert) |
| POST | `/api/match-requests` | 제품 사진 업로드 (multipart, field `photo`) → 매칭 요청 생성 |
| GET | `/api/match-requests` | 매칭 요청 목록 |
| GET | `/api/match-requests/:id` | 매칭 요청 상세 |
| PATCH | `/api/match-requests/:id` | Claude 세션이 분석한 `analysis`/`candidates` 결과 반영 |

## 데이터 모델

`recalls` 테이블은 국내/해외 MCP 응답을 아래 공통 스키마로 정규화해 저장합니다
(`src/normalize.ts`): `id`(`{domestic|overseas}:{source_code}:{external_id}`),
`title`, `brand`, `model`, `manufacturer`, `hazard`, `risk_level`,
`corrective_action`, `country`, `published_date`, `source_url`, `image_urls`,
`korea_relevance`, `raw_json`(원본 전체 보존). `(source_type, source_code,
external_id)` 유니크 제약으로 재수집 시 자동 upsert됩니다.

`match_requests` 테이블은 업로드된 사진과 분석 상태(`pending` → `completed`/
`failed`), Claude가 산출한 `analysis`/`candidates`를 저장합니다.

## 사진으로 유사 리콜 찾기

`/match.html`에서 사진을 올리면 요청이 `pending` 상태로 쌓입니다. 실제 이미지
분석과 MCP 매칭 호출은 Claude 세션이 수행해 결과를 `PATCH /api/match-requests/:id`
로 채워 넣습니다. 절차는 `docs/INGESTION.md`의 "사진으로 유사 리콜 후보 찾기"
섹션을 참고하세요.
