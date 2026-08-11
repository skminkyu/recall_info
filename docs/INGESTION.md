# 리콜 데이터 수집 & 사진 매칭 워크플로

이 앱(SQLite + Express)은 MCP 커넥터를 직접 호출하지 못합니다. MCP 도구(`mcp__MCP__*`,
`mcp__MCP-c805d72e__*`)는 Claude 세션 안에서만 호출할 수 있기 때문에, 데이터 수집과
사진 분석은 **Claude 세션(대화형 또는 예약된 Routine)** 이 대신 수행하고, 결과를 이
앱의 REST API로 전달하는 구조입니다.

```
[국내리콜 MCP]  [해외리콜 MCP]
      \              /
       \            /
      Claude 세션 / Routine  ──(사진 첨부 대화)──▶ 사용자
              │
              ▼
     POST /api/ingest, PATCH /api/match-requests/:id
              │
              ▼
        SQLite (recalls, match_requests)
              │
              ▼
        웹 UI (/ , /match.html)
```

## 1. 리콜 데이터 수집 (국내 + 해외)

### 사용하는 MCP 도구

- **국내 (`mcp__MCP__*`, 한국제품안전협회 SafetyKorea)**
  - `list_recent_recalls({ limit })` — 최신순 리콜 목록
  - `search({ q, brand, model, published_from, published_to, limit, cursor })` — 키워드 검색
  - `fetch({ recall_uid })` — 단건 상세
- **해외 (`mcp__MCP-c805d72e__*`, 13개국 정부기관: AU/CA/CN/EN/EU/FR/GE/JP_METI/JP_RECALLPLUS/NZ/OECD/US_CPSC/US_NHTSA)**
  - `search_recalls({ recent_days, sources, query, date_from, date_to, limit, offset })` — 검색/필터
  - `find_recalls_by_model({ brand, model })` — 브랜드/모델 기반 검색
  - `get_recall_detail({ source, guid })` — 단건 상세
  - `get_recall_stats(...)` — 통계

MCP 응답이 큰 경우(수십~수백 건) 도구 결과가 파일로 저장되고 요약 지시가 내려오는데,
그 파일은 이미 `{"data": [...]}` 형태의 JSON이므로 내용을 굳이 읽어 요약할 필요 없이
그대로 복사해서 아래 CLI로 적재하면 됩니다.

### 적재 방법 (둘 중 하나)

**A. CLI (서버 실행 여부 무관, 권장)**

```bash
npm run ingest -- <파일.json> domestic   # 국내
npm run ingest -- <파일.json> overseas   # 해외
```

`<파일.json>`은 `{"data": [...]}` 형태(MCP 원본 응답) 또는 `{"source_type": "...", "raw": [...]}`
형태 둘 다 지원합니다. 이미 저장된 초기 시드 데이터를 다시 적재하려면:

```bash
npm run seed
```

**B. HTTP API (서버가 떠 있을 때)**

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"source_type": "domestic", "raw": [ ...MCP data 배열... ]}'
```

두 경로 모두 내부적으로 `src/normalize.ts`의 `normalizeDomestic` / `normalizeOverseas`로
공통 스키마(`recalls` 테이블)로 변환한 뒤 `(source_type, source_code, external_id)` 기준
upsert 하므로 여러 번 반복 적재해도 중복이 생기지 않습니다.

### 주기적 수집 (Routine)

Claude Code의 Routine(`create_trigger`)을 이용해 예: 매일 1회 아래를 수행하도록 세션에
지시할 수 있습니다.

1. `mcp__MCP__list_recent_recalls` / `mcp__MCP-c805d72e__search_recalls`(`recent_days` 지정)로
   최근 리콜을 가져온다.
2. 결과를 `npm run ingest -- <파일> domestic|overseas` 로 적재한다(또는 `/api/ingest` 호출).
3. 새로 추가된 건수를 사용자에게 간단히 보고한다.

## 2. 사진으로 유사 리콜 후보 찾기

1. 사용자가 `/match.html`에서 제품 사진을 업로드하면 `POST /api/match-requests`가
   `match_requests` 테이블에 `status: pending` 레코드를 만들고 이미지를
   `data/uploads/`에 저장합니다.
2. Claude 세션이 (대화 중 직접, 또는 pending 요청을 감지하는 Routine을 통해) 다음을 수행합니다.
   - 이미지를 열어보고 `mcp__MCP__match_recall_by_image_features`가 요구하는
     `analysis` 스키마(schema_version "2.0": `product_identity`, `visual_attributes`,
     `ocr_text`, `confidence` 등)를 직접 채워 호출 → **국내** 후보 획득.
   - 이미지에서 읽은 브랜드/모델/제품군 키워드로 `mcp__MCP-c805d72e__find_recalls_by_model`
     또는 `search_recalls`를 호출 → **해외** 후보 획득.
   - 두 결과를 합쳐 `MatchCandidate[]` 형태(`src/types.ts` 참고: `recall_id, source_type,
     source_code, title, brand, model, similarity, reason, url, image_url`)로 정리합니다.
3. 결과를 아래처럼 반영합니다.

```bash
curl -X PATCH http://localhost:3000/api/match-requests/<id> \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "analysis": { ... match_recall_by_image_features에 보낸 analysis 객체 ... },
    "candidates": [
      {"recall_id":"domestic:KR:10022790","source_type":"domestic","source_code":"KR",
       "title":"Manual Motor starter","brand":"ABB","model":"MS116","similarity":0.82,
       "reason":"제품 형태/컬러 유사","url":"https://...","image_url":null}
    ]
  }'
```

4. 웹 UI(`/match.html`)는 5초마다 폴링하며 완료된 요청의 후보 목록을 보여줍니다.

> 참고: `match_recall_by_image_features`의 결과는 "유사 후보"일 뿐, 최종 동일 제품
> 판정은 모델명·표시·위해 정보 대조가 필요하다는 것이 MCP 도구 설명에 명시되어 있습니다.
> UI에도 이를 감안해 "후보"로만 표기합니다.
