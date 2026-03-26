/**
 * コンサルティング分析システム - フロントエンド
 *
 * 5フェーズのコンサルティングフロー:
 * 1. 初期ヒヤリング → 2. 課題の深掘り → 3. As-Is分析 → 4. To-Be策定 → 5. 改善提案
 */

// ─── 定数 ──────────────────────────────────────────────────────────────────

const PHASES = [
  { id: "intake",    label: "初期ヒヤリング",   desc: "背景・役割・問題の全体像",          icon: "💬" },
  { id: "deep_dive", label: "課題の深掘り",     desc: "根本原因の探索",                   icon: "🔍" },
  { id: "asis",      label: "As-Is 現状分析",  desc: "現状の構造化・明文化",              icon: "📊" },
  { id: "tobe",      label: "To-Be 策定",      desc: "あるべき姿・ギャップ定義",          icon: "🎯" },
  { id: "proposals", label: "改善提案",         desc: "実行可能な施策・ロードマップ",      icon: "🚀" },
];

const QUICK_STARTS = [
  "ERPの月次決算処理が遅く、残業が常態化しています",
  "部門間でのデータの不整合が多く、突合作業に時間がかかっています",
  "受注から納品までのプロセスにエラーや手戻りが頻発しています",
  "データ分析基盤を整備したいが、何から始めればよいかわかりません",
  "マスタデータが複数システムに散在していて管理できていません",
  "業務が属人化していて、担当者が変わると品質が落ちます",
];

// ─── 状態管理 ────────────────────────────────────────────────────────────────

const state = {
  messages: [],
  currentPhase: "intake",
  isStreaming: false,
  sessionContext: { department: null, domain: null, issues: [], keywords: [] },
  transitionSuggested: false,
};

// ─── DOM 参照 ────────────────────────────────────────────────────────────────

const messagesEl     = document.getElementById("messages");
const messageInput   = document.getElementById("message-input");
const sendBtn        = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const transitionHint = document.getElementById("transition-hint");
const contextContent = document.getElementById("context-content");
const reportModal    = document.getElementById("report-modal");
const reportContent  = document.getElementById("report-content");

// ─── フェーズ UI ──────────────────────────────────────────────────────────────

function renderPhaseList() {
  const list = document.getElementById("phase-list");
  const currentIndex = PHASES.findIndex((p) => p.id === state.currentPhase);
  list.innerHTML = PHASES.map((phase, i) => {
    const isActive    = phase.id === state.currentPhase;
    const isCompleted = i < currentIndex;
    const cls = isActive ? "phase-item active" : isCompleted ? "phase-item completed" : "phase-item";
    const numContent = isCompleted ? "✓" : i + 1;
    return `
      <div class="${cls}" onclick="switchPhase('${phase.id}')">
        <div class="phase-number">${numContent}</div>
        <div class="phase-info">
          <div class="phase-name">${phase.icon} ${phase.label}</div>
          <div class="phase-desc">${phase.desc}</div>
        </div>
        <div class="phase-connector"></div>
      </div>
    `;
  }).join("");
}

function updatePhaseBar() {
  const phase = PHASES.find((p) => p.id === state.currentPhase);
  document.getElementById("current-phase-label").textContent =
    `フェーズ ${PHASES.indexOf(phase) + 1}：${phase.label}`;
}

function switchPhase(phaseId) {
  state.currentPhase = phaseId;
  state.transitionSuggested = false;
  transitionHint.classList.remove("visible");
  renderPhaseList();
  updatePhaseBar();
  updateContextPanel();
}

// ─── メッセージ レンダリング ──────────────────────────────────────────────────

function parseMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return `<pre><code>${escapeHtml(inner)}</code></pre>`;
    })
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    .replace(/^---+$/gm, "<hr>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`]+)`/g,     "<code>$1</code>")
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    .replace(/^> (.+)$/gm,      "<blockquote>$1</blockquote>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g,   "<br>");
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderMessage(role, content) {
  const isUser = role === "user";
  const avatarChar = isUser ? "あ" : "C";
  const html = isUser ? escapeHtml(content).replace(/\n/g,"<br>") : parseMarkdown(content);
  return `
    <div class="message ${role}">
      <div class="avatar">${avatarChar}</div>
      <div class="bubble">${html}</div>
    </div>
  `;
}

function appendMessage(role, content) {
  const msgEl = document.createElement("div");
  msgEl.innerHTML = renderMessage(role, content);
  const node = msgEl.firstElementChild;
  messagesEl.appendChild(node);
  scrollToBottom();
  return node;
}

function scrollToBottom() {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
}

// ─── ウェルカム画面 ───────────────────────────────────────────────────────────

function showWelcomeScreen() {
  const welcome = document.createElement("div");
  welcome.id = "welcome-screen";
  welcome.className = "welcome-screen";
  welcome.innerHTML = `
    <div class="welcome-icon">🤝</div>
    <div class="welcome-title">コンサルティング分析システム</div>
    <div class="welcome-desc">
      ERP・データ統合基盤・ビジネスプロセスに関するご相談を、
      ヒヤリングから改善提案まで体系的にサポートします。
    </div>
    <div class="quick-starts">
      ${QUICK_STARTS.map((q) => `<button class="quick-start-btn" onclick="sendQuickStart(this)">${q}</button>`).join("")}
    </div>
  `;
  messagesEl.appendChild(welcome);
}

function removeWelcomeScreen() {
  const el = document.getElementById("welcome-screen");
  if (el) el.remove();
}

window.sendQuickStart = function(btn) {
  messageInput.value = btn.textContent;
  sendMessage();
};

// ─── メッセージ送信 ───────────────────────────────────────────────────────────

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || state.isStreaming) return;

  removeWelcomeScreen();
  state.messages.push({ role: "user", content });
  appendMessage("user", content);
  messageInput.value = "";
  messageInput.style.height = "";

  state.isStreaming = true;
  sendBtn.disabled = true;
  typingIndicator.classList.add("visible");
  scrollToBottom();

  const assistantNode = document.createElement("div");
  assistantNode.innerHTML = renderMessage("assistant", "");
  const bubble = assistantNode.firstElementChild.querySelector(".bubble");
  messagesEl.appendChild(assistantNode.firstElementChild);

  let fullResponse = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, phase: state.currentPhase }),
    });

    typingIndicator.classList.remove("visible");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "text") {
            fullResponse += data.text;
            bubble.innerHTML = parseMarkdown(fullResponse);
            scrollToBottom();
          } else if (data.type === "error") {
            bubble.innerHTML = `<span style="color:red">エラー: ${data.message}</span>`;
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    typingIndicator.classList.remove("visible");
    bubble.innerHTML = `<span style="color:red">通信エラー: ${err.message}</span>`;
  }

  state.messages.push({ role: "assistant", content: fullResponse });
  state.isStreaming = false;
  sendBtn.disabled = false;

  extractContextFromMessages();
  updateContextPanel();

  if (state.messages.length >= 4 && !state.transitionSuggested) {
    checkPhaseTransition();
  }
}

// ─── フェーズ移行チェック ─────────────────────────────────────────────────────

async function checkPhaseTransition() {
  try {
    const res = await fetch("/api/suggest-phase-transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, current_phase: state.currentPhase }),
    });
    const data = await res.json();
    if (data.should_transition && data.confidence > 0.65) {
      state.transitionSuggested = true;
      transitionHint.textContent = `→ ${data.next_phase_label} へ進む`;
      transitionHint.classList.add("visible");
      transitionHint.onclick = () => switchPhase(data.next_phase);
    }
  } catch (_) {}
}

// ─── コンテキスト抽出 ────────────────────────────────────────────────────────

function extractContextFromMessages() {
  const allText = state.messages.map((m) => m.content).join(" ");
  const deptMatch = allText.match(/(営業|購買|調達|会計|経理|物流|製造|情報システム|IT|人事|総務|マーケ|企画)[\s部門課]/);
  if (deptMatch) state.sessionContext.department = deptMatch[0].trim();

  const domains = {
    ERP:         /ERP|SAP|Oracle|Dynamics|基幹/i,
    データ統合:   /データ統合|ETL|DWH|データレイク|データウェアハウス/i,
    業務プロセス: /プロセス|フロー|業務|ワークフロー/i,
    マスタデータ: /マスタ|マスター|品目|取引先/i,
  };
  state.sessionContext.domain = null;
  for (const [label, re] of Object.entries(domains)) {
    if (re.test(allText)) { state.sessionContext.domain = label; break; }
  }

  const keywords = new Set();
  (allText.match(/[ァ-ヶー]{4,}/g) || []).forEach((w) => keywords.add(w));
  state.sessionContext.keywords = [...keywords].slice(0, 8);
}

function updateContextPanel() {
  const ctx = state.sessionContext;
  let html = "";
  if (ctx.department) html += `<div class="context-card"><div class="context-card-title">部署・役割</div><div class="context-card-body">${ctx.department}</div></div>`;
  if (ctx.domain)     html += `<div class="context-card"><div class="context-card-title">相談ドメイン</div><div class="context-card-body">${ctx.domain}</div></div>`;
  if (ctx.keywords.length > 0) html += `<div class="context-card"><div class="context-card-title">キーワード</div><div class="context-card-body">${ctx.keywords.map((k) => `<span class="context-tag">${k}</span>`).join("")}</div></div>`;
  const phase = PHASES.find((p) => p.id === state.currentPhase);
  html += `<div class="context-card"><div class="context-card-title">現在のフェーズ</div><div class="context-card-body">${phase.icon} ${phase.label}<br><span style="font-size:12px;color:var(--text-secondary)">${phase.desc}</span></div></div>`;
  html += `<div class="context-card"><div class="context-card-title">会話ターン数</div><div class="context-card-body">${Math.floor(state.messages.length / 2)} ターン</div></div>`;
  if (!ctx.department && !ctx.domain && ctx.keywords.length === 0) {
    html = `<div class="context-empty">ヒヤリングが進むと、ここに相談内容のコンテキストが表示されます。</div>` + html;
  }
  contextContent.innerHTML = html;
}

// ─── レポート生成 ────────────────────────────────────────────────────────────

window.openReportModal = async function() {
  if (state.messages.length < 4) { alert("もう少し会話を進めてください。"); return; }
  reportModal.classList.add("open");
  reportContent.innerHTML = `<div class="report-generating"><div class="spinner"></div><div>レポートを生成中...</div></div>`;
  let fullReport = "";
  try {
    const res = await fetch("/api/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    reportContent.innerHTML = '<div class="report-content" id="report-body"></div>';
    const reportBody = document.getElementById("report-body");
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "text") { fullReport += data.text; reportBody.innerHTML = parseMarkdown(fullReport); }
        } catch (_) {}
      }
    }
  } catch (err) {
    reportContent.innerHTML = `<p style="color:red">生成に失敗しました: ${err.message}</p>`;
  }
};

window.closeReportModal = function() { reportModal.classList.remove("open"); };

window.downloadReport = function() {
  const reportBody = document.getElementById("report-body");
  if (!reportBody) return;
  const blob = new Blob([reportBody.innerText || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `consulting-report-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

window.copyReport = function() {
  const reportBody = document.getElementById("report-body");
  if (!reportBody) return;
  navigator.clipboard.writeText(reportBody.innerText || "").then(() => {
    const btn = document.getElementById("copy-btn");
    btn.textContent = "✓ コピーしました";
    setTimeout(() => { btn.textContent = "📋 コピー"; }, 2000);
  });
};

// ─── セッションリセット ───────────────────────────────────────────────────────

window.resetSession = function() {
  if (!confirm("セッションをリセットしますか？会話履歴が削除されます。")) return;
  state.messages = [];
  state.currentPhase = "intake";
  state.isStreaming = false;
  state.transitionSuggested = false;
  state.sessionContext = { department: null, domain: null, issues: [], keywords: [] };
  messagesEl.innerHTML = "";
  transitionHint.classList.remove("visible");
  renderPhaseList();
  updatePhaseBar();
  updateContextPanel();
  showWelcomeScreen();
};

// ─── 入力ハンドリング ─────────────────────────────────────────────────────────

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
});
sendBtn.addEventListener("click", sendMessage);

// ─── 初期化 ──────────────────────────────────────────────────────────────────

function init() {
  renderPhaseList();
  updatePhaseBar();
  updateContextPanel();
  showWelcomeScreen();
  messageInput.focus();
}

init();
