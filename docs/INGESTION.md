# 리콜 데이터 수집 & 사진 매칭 워크플로

이 앱(SQLite + Express)은 두 가지를 서로 다른 방식으로 처리합니다.

- **리콜 데이터 수집**(1절): MCP 도구(`mcp__MCP__*`, `mcp__MCP-c805d72e__*`)는
  Claude 세션 안에서만 호출 가능하므로, **Claude 세션(대화형 또는 예약된
  Routine)** 이 대신 MCP를 호출해 결과를 이 앱의 REST API로 전달합니다.
- **사진으로 유사 제품 찾기**(2절): 서버가 **Anthropic API를 직접 호출**해
  업로드 즉시 자동으로 처리합니다. Claude 세션 개입 없이 동작합니다.

```
[국내리콜 MCP]  [해외리콜 MCP]              [Anthropic API]
      \              /                          ▲
       \            /                           │ 업로드 즉시 자동 호출
      Claude 세션 / Routine                     │
              │                        POST /api/match-requests
              ▼                                 │
     POST /api/ingest                           │
              │                                 │
              ▼                                 ▼
        SQLite (recalls) ◀──────────── SQLite (match_requests)
              │                                 │
              ▼                                 ▼
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

### 주기적 수집 — 매주 월요일 자동 수집 Routine (재시도, 결과 확인 전)

과거(2026-08) 시도에서는 `create_trigger`의 `connectors` 파라미터가 이 조직
설정에서 비활성화돼 있어, 예약 실행 세션에 MCP 커넥터를 명시적으로 전달할
방법이 없었습니다. 2026-10-22에 다시 시도했고, 이번엔 `persistent_session_id`로
**이 대화 세션 자체에 바인딩**해서(새 세션을 만드는 게 아니라 이 세션을 다시
깨우는 방식) 매주 월요일 00:00 UTC(09:00 KST)에 실행되는 Routine
(`trig_01En7z8qurEZAn1FnnxadiEF`)을 만들어뒀습니다.

- 이 세션은 이미 국내리콜MCP/해외리콜MCP 커넥터가 연결된 상태라, Routine이
  이 세션을 다시 깨울 때 그 연결이 유지되는지는 **다음 실행(2026-10-26) 전까지는
  확인 불가**합니다. 과거처럼 커넥터 없이 깨어날 가능성도 있습니다.
- 그래서 프롬프트 맨 앞에 "MCP 도구가 실제로 호출되는지부터 테스트하고, 안 되면
  그 사실만 보고하고 멈춰라"라는 자가진단 단계를 넣어뒀습니다 — 안 되더라도
  조용히 아무 일도 안 하거나 깨지는 대신, 명확하게 알려드리도록.
- 성공하면: `git pull` → 국내(`list_recent_recalls`)/해외(`search_recalls`,
  `recent_days: 8`, 페이지네이션) 수집 → `data/seeds/`에 저장 → `npm run seed` →
  git commit/push → 수집 결과 요약까지 전부 자동으로 끝납니다.
- 실패하면: 아래 "대안" 중 하나로 수동 진행하면 됩니다. Routine 자체는
  `update_trigger(enabled: false)`로 끄거나 `delete_trigger`로 지우면 됩니다.

대안 (Routine이 안 될 경우):

1. **대화로 요청** — 이 세션(또는 저장소에 접근 가능한 다른 세션)에서 "이번 주 리콜
   수집해줘"라고 요청하면, 위 "적재 방법 A" 절차(MCP 호출 → `data/seeds/`에 저장 →
   `npm run seed` → git commit/push)를 그대로 수행합니다.
2. **claude.ai Routines UI에서 직접 생성** — 웹의 Routines 설정 화면에서는 Routine에
   연결할 커넥터를 사람이 직접 선택할 수 있어, 이 MCP 툴 경로의 제약을 받지 않을 수
   있습니다. 국내리콜MCP/해외리콜MCP 커넥터를 허용한 뒤 위 "적재 방법 A" 절차를 프롬프트로
   등록하면 될 가능성이 있습니다(플랫폼 정책에 따라 다를 수 있음).

## 2. 사진으로 유사 리콜 후보 찾기 (서버가 업로드 즉시 자동 처리)

MCP 이미지 매칭 도구(`mcp__MCP__match_recall_by_image_features`)는 Claude 세션
안에서만 호출 가능해서 배포된 웹서버가 스스로 쓸 수 없습니다. 대신 서버가
**Anthropic API(비전 + 구조화 출력)를 직접 호출**해 사진을 분석하고, 그 결과를
이미 누적해둔 로컬 `recalls` 테이블(FTS5)과 텍스트 유사도로 대조합니다 — 실시간
MCP 조회가 아니라 그때까지 수집된 데이터 안에서 찾는 것이라, 최신성은 주기적
수집(1절)에 달려 있습니다.

### 흐름

1. 사용자가 `/match.html`에서 사진을 올리면 `POST /api/match-requests`가 파일을
   `data/uploads/`에 저장하고, **같은 요청 안에서 동기적으로** 다음을 수행합니다.
   - `src/vision.ts`의 `analyzeProductImage()`가 Anthropic API(`claude-opus-5`,
     이미지 입력 + `output_config.format`으로 구조화된 JSON 강제)를 호출해
     `category/name/brand/model/colors/markings/keywords/confidence`를 추출.
   - `src/matching.ts`의 `findSimilarRecalls()`가 추출된 키워드로
     `recalls_fts` MATCH 쿼리(OR 조합)를 실행하고 `bm25()` 순위로 정렬해
     상위 8건을 `MatchCandidate[]`로 반환. `similarity`는 bm25 원점수가 아니라
     **순위 기반 근사치**(0.95부터 0.08씩 감소, 최저 0.3)입니다 — 진짜 이미지
     임베딩 유사도가 아니라 텍스트 키워드 매칭이라는 점을 UI에도 명시합니다.
   - 성공하면 `status: completed` + `analysis`/`candidates`로 갱신, 실패(API
     키 없음/오류 등)하면 `status: failed` + 에러 메시지를 `note`에 남기고
     항상 200번대로 응답합니다(요청 자체는 실패하지 않음).
2. 응답에 이미 분석 결과가 담겨 있으므로 프론트엔드는 업로드 fetch가 끝나는
   즉시 후보 목록을 렌더링합니다(폴링에 의존하지 않음).

### 필요 설정

`ANTHROPIC_API_KEY` 환경변수가 필요합니다(로컬은 `.env.example` 참고, Render는
`docs/DEPLOY.md`의 안내대로 대시보드에서 직접 입력). 키가 없거나 API 호출이
실패하면 요청 자체가 500을 내지 않고 해당 `match_requests` 행만 `failed`로
표시됩니다.

### 수동 개입이 필요할 때

`PATCH /api/match-requests/:id`는 그대로 남아 있어서, 자동 분석이 실패했거나
결과를 더 다듬고 싶을 때 이 대화(Claude 세션)에서 사진을 직접 보고 MCP
(`mcp__MCP__match_recall_by_image_features`, `mcp__MCP-c805d72e__search_recalls`
등)까지 활용해 결과를 덮어쓸 수 있습니다:

```bash
curl -X PATCH http://localhost:3000/api/match-requests/<id> \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "analysis": { ... },
    "candidates": [
      {"recall_id":"domestic:KR:10022790","source_type":"domestic","source_code":"KR",
       "title":"Manual Motor starter","brand":"ABB","model":"MS116","similarity":0.82,
       "reason":"MCP 이미지 매칭 결과","url":"https://...","image_url":null}
    ]
  }'
```

> 참고: 자동/수동 어느 경로든 결과는 "관련 후보"일 뿐이며, 최종 동일 제품 판정은
> 모델명·표시·위해 정보 대조가 필요합니다. UI에도 "후보"/"유사도"로만 표기합니다.
