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
- `scripts/ingest-file.ts` — MCP 원본 JSON 파일 하나를 DB로 적재하는 CLI
- `scripts/seed-all.ts` — `data/seeds/*.json` 전체를 재적재해 DB를 복원/갱신 (`npm run seed`)
- `data/seeds/` — git에 커밋되는 영속적인 원본 데이터 로그(날짜별 MCP 원본 JSON).
  SQLite DB 파일 자체는 gitignore 대상이라 컨테이너가 새로 떠도 여기서 항상
  재구성됩니다. 현재 국내 50건 + 해외 100건(2026-08-11 최초 수집분) 포함
- `docs/INGESTION.md` — MCP 데이터 수집 및 사진 매칭 워크플로 상세 설명 (**필독**,
  특히 "주기적 수집" 관련 알려진 제약사항)

MCP 도구는 Claude 세션 안에서만 호출 가능하므로, 데이터 **수집**은 "Claude 세션이
MCP를 호출해 넣어주는 데이터를 누적·검색·서빙하는" 구조입니다. 반면 사진으로
유사 제품을 찾는 **매칭**은 서버가 Anthropic API를 직접 호출해 업로드 즉시
자동으로 처리합니다(`ANTHROPIC_API_KEY` 필요). 자세한 흐름은
`docs/INGESTION.md`를 참고하세요.

## 실행

```bash
npm install
npm run seed    # data/seeds/*.json 전체를 적재해 로컬 DB 생성/갱신
export ANTHROPIC_API_KEY=sk-ant-...   # 사진 매칭 기능에 필요 (.env.example 참고)
npm run dev      # http://localhost:3000
```

- `npm run build && npm start` — 프로덕션 실행
- `npm run typecheck` — 타입 체크
- `npm run ingest -- <file.json> [domestic|overseas]` — 새 MCP 데이터 파일 하나만 적재

새 리콜 데이터를 수집하려면(대화로 "리콜 수집해줘" 요청) `docs/INGESTION.md`를
참고하세요. **참고**: 예약 실행(Routine)으로 수집을 완전 자동화하는 것은 현재 이
조직의 Claude Code Remote 설정상 불가능합니다(트리거 세션에 MCP 커넥터를 전달할
수 없음) — 자세한 내용과 대안은 `docs/INGESTION.md`의 "주기적 수집" 절 참고.

## 배포 (공개 URL)

`render.yaml`이 포함돼 있어 [Render](https://render.com)에 Blueprint로 바로 배포할
수 있습니다. 계정 연결처럼 사람이 직접 해야 하는 단계가 있어 순서는
`docs/DEPLOY.md`에 정리했습니다.

## API

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/recalls` | 리콜 검색/목록 (`q`, `source_type`, `source_code`, `brand`, `date_from`, `date_to`, `limit`, `offset`) |
| GET | `/api/recalls/stats` | 출처별 누적 건수, 최신 게시일 |
| GET | `/api/recalls/:id` | 리콜 상세 (원본 raw JSON 포함) |
| POST | `/api/ingest` | `{ source_type, raw: [...] }` MCP 원본 데이터 적재(upsert) |
| POST | `/api/match-requests` | 제품 사진 업로드 (multipart, field `photo`) → 서버가 즉시 Anthropic API로 분석하고 유사 리콜 후보까지 채워서 응답 |
| GET | `/api/match-requests` | 매칭 요청 목록 |
| GET | `/api/match-requests/:id` | 매칭 요청 상세 |
| PATCH | `/api/match-requests/:id` | (수동 보정용) Claude 세션이 직접 분석한 `analysis`/`candidates`로 덮어쓰기 |

## 데이터 모델

`recalls` 테이블은 국내/해외 MCP 응답을 아래 공통 스키마로 정규화해 저장합니다
(`src/normalize.ts`): `id`(`{domestic|overseas}:{source_code}:{external_id}`),
`title`, `brand`, `model`, `manufacturer`, `hazard`, `risk_level`,
`corrective_action`, `country`, `published_date`, `source_url`, `image_urls`,
`korea_relevance`, `raw_json`(원본 전체 보존). `(source_type, source_code,
external_id)` 유니크 제약으로 재수집 시 자동 upsert됩니다.

`match_requests` 테이블은 업로드된 사진과 분석 상태(`pending` → `processing` →
`completed`/`failed`), 분석 결과인 `analysis`/`candidates`를 저장합니다.

## 사진으로 유사 리콜 찾기

`/match.html`에서 사진을 올리면 서버가 그 요청 안에서 바로 Anthropic API로
사진을 분석(`src/vision.ts`)하고, 추출된 키워드로 누적 리콜 DB를 검색
(`src/matching.ts`, FTS5 유사도 순)해 결과를 응답합니다 — 몇 초 내로 화면에
"관련 상품" 목록이 뜹니다. `ANTHROPIC_API_KEY`가 없거나 호출이 실패하면 해당
요청만 `failed`로 표시되고 앱 전체는 계속 정상 동작합니다. 자세한 내용과 수동
보정 방법은 `docs/INGESTION.md`의 "사진으로 유사 리콜 후보 찾기" 섹션 참고.
