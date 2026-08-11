const resultsEl = document.getElementById("results");
const paginationEl = document.getElementById("pagination");
const statsEl = document.getElementById("stats");
const form = document.getElementById("search-form");

const SOURCE_LABEL = { domestic: "국내", overseas: "해외" };
const PAGE_SIZE = 20;
let currentOffset = 0;
let currentQuery = {};

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadStats() {
  const res = await fetch("/api/recalls/stats");
  const stats = await res.json();
  statsEl.innerHTML = `
    <div class="stat-chip">누적 리콜 <strong>${stats.total}</strong>건</div>
    ${stats.by_source
      .slice(0, 6)
      .map((s) => `<div class="stat-chip">${SOURCE_LABEL[s.source_type] ?? s.source_type} ${s.source_code} <strong>${s.count}</strong></div>`)
      .join("")}
    <div class="stat-chip">최신 게시일 <strong>${stats.latest_published_date ?? "-"}</strong></div>
  `;
}

function renderCard(recall) {
  const badgeClass = recall.source_type === "domestic" ? "domestic" : "overseas";
  const thumb = recall.image_urls?.[0];
  return `
    <div class="recall-card">
      ${thumb ? `<img class="thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : ""}
      <div class="meta">
        <div class="badges">
          <span class="badge ${badgeClass}">${SOURCE_LABEL[recall.source_type]} · ${escapeHtml(recall.source_code)}</span>
          ${recall.risk_level ? `<span class="badge muted">${escapeHtml(recall.risk_level)}</span>` : ""}
        </div>
        <h3>${escapeHtml(recall.title)} ${recall.brand ? `<span style="color:var(--text-muted); font-weight:400;">· ${escapeHtml(recall.brand)}</span>` : ""}</h3>
        <div class="hazard">${escapeHtml(recall.hazard ?? "위해 정보 없음")}</div>
        <div class="footer-line">
          <span>모델: ${escapeHtml(recall.model ?? "-")}</span>
          <span>게시일: ${escapeHtml(recall.published_date ?? "-")}</span>
          ${recall.source_url ? `<a href="${escapeHtml(recall.source_url)}" target="_blank" rel="noopener">원문 보기 ↗</a>` : ""}
        </div>
      </div>
    </div>
  `;
}

async function search(offset = 0) {
  currentOffset = offset;
  const params = new URLSearchParams({ ...currentQuery, limit: PAGE_SIZE, offset });
  const res = await fetch(`/api/recalls?${params.toString()}`);
  const data = await res.json();

  if (data.data.length === 0) {
    resultsEl.innerHTML = `<div class="empty-state">검색 결과가 없습니다.</div>`;
    paginationEl.innerHTML = "";
    return;
  }

  resultsEl.innerHTML = data.data.map(renderCard).join("");

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < data.total;
  paginationEl.innerHTML = `
    ${hasPrev ? `<button class="secondary" id="prev-btn">이전</button>` : ""}
    <span style="align-self:center; color:var(--text-muted); font-size:13px;">${offset + 1}-${Math.min(offset + PAGE_SIZE, data.total)} / ${data.total}</span>
    ${hasNext ? `<button class="secondary" id="next-btn">다음</button>` : ""}
  `;
  document.getElementById("prev-btn")?.addEventListener("click", () => search(Math.max(0, offset - PAGE_SIZE)));
  document.getElementById("next-btn")?.addEventListener("click", () => search(offset + PAGE_SIZE));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  currentQuery = Object.fromEntries([...formData.entries()].filter(([, v]) => v));
  search(0);
});

loadStats();
search(0);
