const form = document.getElementById("upload-form");
const requestsEl = document.getElementById("requests");

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STATUS_LABEL = { pending: "분석 대기중", completed: "완료", failed: "실패" };

function renderRequest(req) {
  const candidates = req.candidates ?? [];
  return `
    <div class="match-request">
      <img src="/${req.image_path}" alt="" onerror="this.style.display='none'" />
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <span class="status-pill ${req.status}">${STATUS_LABEL[req.status]}</span>
          <span style="font-size:12px; color:var(--text-muted);">${new Date(req.created_at).toLocaleString("ko-KR")}</span>
        </div>
        ${req.note ? `<div style="font-size:13px; color:var(--text-muted);">메모: ${escapeHtml(req.note)}</div>` : ""}
        ${
          req.status === "completed"
            ? candidates.length > 0
              ? `<ul class="candidate-list">${candidates
                  .map(
                    (c) => `<li>
                      <strong>${escapeHtml(c.title)}</strong>
                      ${c.brand ? `· ${escapeHtml(c.brand)}` : ""}
                      <span style="color:var(--text-muted);">(${c.source_type === "domestic" ? "국내" : "해외"} ${escapeHtml(c.source_code)}${c.similarity != null ? `, 유사도 ${(c.similarity * 100).toFixed(0)}%` : ""})</span>
                      ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">↗</a>` : ""}
                    </li>`
                  )
                  .join("")}</ul>`
              : `<div style="font-size:13px; color:var(--text-muted); margin-top:6px;">유사 리콜 제품을 찾지 못했습니다.</div>`
            : req.status === "pending"
            ? `<div style="font-size:13px; color:var(--text-muted); margin-top:6px;">Claude 세션의 분석을 기다리는 중입니다.</div>`
            : `<div style="font-size:13px; color:var(--danger); margin-top:6px;">분석에 실패했습니다.</div>`
        }
      </div>
    </div>
  `;
}

async function loadRequests() {
  const res = await fetch("/api/match-requests");
  const data = await res.json();
  requestsEl.innerHTML = data.data.length
    ? data.data.map(renderRequest).join("")
    : `<div class="empty-state">아직 업로드된 사진이 없습니다.</div>`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const res = await fetch("/api/match-requests", { method: "POST", body: formData });
  if (!res.ok) {
    alert("업로드에 실패했습니다.");
    return;
  }
  form.reset();
  loadRequests();
});

loadRequests();
setInterval(loadRequests, 5000);
