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

### 적재 방법 (셋 중 하나)

**A. 시드 로그에 새 파일을 추가하고 전체 재적재 (권장 — 영속성 확보)**

`data/seeds/*.json`은 git에 커밋되는 원본 데이터 로그입니다. SQLite DB 파일 자체는
`.gitignore`에 걸려 있어 컨테이너가 재생성되면 사라지지만, `data/seeds/`에 쌓인 JSON은
git 히스토리에 영구히 남고, 언제든 아래 명령으로 DB를 완전히 재구성할 수 있습니다.

```bash
# 1) 새로 받아온 MCP 원본 JSON을 날짜가 들어간 파일명으로 저장
#    (파일명은 반드시 domestic 또는 overseas로 시작해야 함)
#    예: data/seeds/domestic-2026-08-18.json, data/seeds/overseas-2026-08-18.json

# 2) data/seeds/ 안의 모든 파일을 순서대로 재적재 (idempotent upsert)
npm run seed
```

**B. 특정 파일 하나만 적재**

```bash
npm run ingest -- <파일.json> domestic   # 국내
npm run ingest -- <파일.json> overseas   # 해외
```

`<파일.json>`은 `{"data": [...]}` 형태(MCP 원본 응답) 또는 `{"source_type": "...", "raw": [...]}`
형태 둘 다 지원합니다.

**C. HTTP API (서버가 떠 있을 때)**

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"source_type": "domestic", "raw": [ ...MCP data 배열... ]}'
```

세 경로 모두 내부적으로 `src/normalize.ts`의 `normalizeDomestic` / `normalizeOverseas`로
공통 스키마(`recalls` 테이블)로 변환한 뒤 `(source_type, source_code, external_id)` 기준
upsert 하므로 여러 번 반복 적재해도 중복이 생기지 않습니다. `data/seeds/`에 새 파일을
추가한 뒤에는 반드시 git에 커밋+푸시해야 다음에 컨테이너가 새로 뜨거나 다른 세션이
`npm run seed`를 돌려도 데이터가 유지됩니다.

### 주기적 수집 — 현재는 수동/대화 요청으로만 가능

Claude Code Remote의 Routine(예약 실행, `create_trigger`)으로 "매주 자동 수집"을
시도했으나, **이 조직 설정에서는 예약 실행되는 세션에 MCP 커넥터(국내리콜MCP/
해외리콜MCP)를 전달할 수 없습니다** (`create_trigger`의 `connectors` 파라미터가
비활성화되어 있음). 즉 Routine이 정해진 시간에 깨어나도 리콜 MCP 도구 자체를 호출할
수 없어 완전 자동화는 불가능한 상태입니다.

대안:

1. **대화로 요청** — 이 세션(또는 저장소에 접근 가능한 다른 세션)에서 "이번 주 리콜
   수집해줘"라고 요청하면, 위 "적재 방법 A" 절차(MCP 호출 → `data/seeds/`에 저장 →
   `npm run seed` → git commit/push)를 그대로 수행합니다.
2. **claude.ai Routines UI에서 직접 생성** — 웹의 Routines 설정 화면에서는 Routine에
   연결할 커넥터를 사람이 직접 선택할 수 있어, 이 MCP 툴 경로의 제약을 받지 않을 수
   있습니다. 국내리콜MCP/해외리콜MCP 커넥터를 허용한 뒤 위 "적재 방법 A" 절차를 프롬프트로
   등록하면 될 가능성이 있습니다(플랫폼 정책에 따라 다를 수 있음).
3. 향후 조직 설정이 바뀌어 트리거에 커넥터를 전달할 수 있게 되면, 이 저장소의 커밋
   히스토리에 있던 최초 시도 프롬프트(주간, 월요일 00:00 UTC 실행)를 그대로 재사용해
   `create_trigger`로 재생성하면 됩니다.

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
