# 배포 (공개 URL 만들기)

이 저장소는 [Render](https://render.com) Blueprint(`render.yaml`)로 바로 배포되도록
설정돼 있습니다. Render 계정 생성/저장소 연결은 사람이 직접 해야 하는 단계라(제가
대신 계정을 만들거나 로그인할 수 없음) 아래 순서대로 진행해 주세요.

## 1. Render에서 배포

1. https://dashboard.render.com 접속 → GitHub 계정으로 로그인/가입
2. **New +** → **Blueprint** 선택
3. `skminkyu/recall_info` 저장소 연결 (처음이면 Render의 GitHub App 설치 권한 요청 —
   전체 저장소 대신 이 저장소만 선택 가능)
4. 브랜치로 `claude/recall-product-management-system-1wmjo8` 선택
   (나중에 `main`에 머지하면 그때는 `main`으로 바꾸면 됩니다)
5. Render가 저장소 루트의 `render.yaml`을 자동으로 읽어 `recall-info`라는 이름의
   Web Service를 구성합니다. `ANTHROPIC_API_KEY` 값 입력란이 나오면
   (`render.yaml`에 `sync: false`로 돼 있어 값은 저장소에 없고 매번 직접 입력해야
   함) [console.anthropic.com](https://console.anthropic.com)에서 발급한 API 키를
   입력하세요 — 사진 업로드 시 서버가 즉시 이미지를 분석하는 기능(비전 API 호출)에
   필요합니다. 나머지는 별도 설정 없이 **Apply**만 누르면 됩니다.
6. 몇 분 내로 빌드/배포가 끝나면 `https://recall-info-XXXX.onrender.com` 같은
   URL이 생성됩니다. 그 링크가 공개 웹앱 주소입니다.

나중에 키를 추가/변경하려면 Render 대시보드 → 해당 서비스 → **Environment** 탭에서
`ANTHROPIC_API_KEY`를 설정하면 됩니다. 키가 없어도 배포/리콜 목록 기능은 정상
동작하고, 사진 매칭 요청만 "실패"로 표시됩니다(앱이 죽지 않음).

배포된 서비스가 시작될 때마다(`startCommand`) `npm run seed:prod`가 먼저 실행돼
`data/seeds/*.json`(git에 커밋된 데이터)을 읽어 SQLite를 구성한 뒤 서버가 뜹니다.
즉 **git에 새 seed 파일을 커밋하고 Render에서 재배포하면 그 데이터가 자동 반영**됩니다.

## 2. 알아둘 점 (무료 플랜 기준)

- Render 무료 웹 서비스는 **영구 디스크가 아닌 일반 파일시스템**을 사용합니다.
  리콜 데이터(`recalls` 테이블)는 매 시작 시 `data/seeds/*.json`에서 재구성되므로
  문제없지만, **사진 매칭 업로드(`/match.html`)로 만든 `match_requests`와 업로드된
  이미지 파일, 분석 결과는 재배포하면 초기화**됩니다. 분석 자체는 업로드 즉시
  서버가 자동으로 끝내므로(Claude 세션 대기 불필요) 평소 사용에는 문제없고,
  단지 재배포 시점 이전 업로드 이력만 사라집니다.
- 무료 플랜은 일정 시간 요청이 없으면 슬립되고, 다음 요청 시 다시 깨어나는 데
  수십 초 걸릴 수 있습니다.
- 사진 매칭 요청까지 재배포 후에도 남기고 싶다면 Render의 **유료 플랜 + Persistent
  Disk**를 `data/` 경로에 마운트하면 됩니다 (Render 대시보드 → 서비스 → Disks).

## 3. 다른 선택지

- **Railway** (railway.app) — GitHub 저장소 연결만으로 유사하게 배포 가능,
  볼륨(영구 디스크) 무료 플랜에도 일부 제공.
- **Fly.io** — `fly launch`로 배포, 볼륨(`fly volumes create`)을 `data/`에 마운트하면
  재배포에도 데이터가 완전히 보존됩니다. CLI 조작이 필요해 Render보다 설정이 조금 더
  손이 갑니다.

## 4. 로컬 실행 (배포 전 확인용)

```bash
npm install
npm run build
npm run seed:prod   # 컴파일된 시드 스크립트로 data/recall_info.db 생성
npm start            # http://localhost:3000
```
