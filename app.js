let allRows = [];
let basePatients = [];
let currentPatients = [];
let sortState = { col: null, dir: 1 };
let fileKey = "";
let seenKeys = new Set();
let historyEntries = [];
let lastNewNames = [];
let selectedRowEl = null;

function normHeader(h) {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// aceita "dd/mm/aaaa", "dd/mm/aa" e com horário junto ("dd/mm/aaaa 00:00")
function parseDateBR(str) {
  if (!str) return null;
  let s = String(str).trim();
  // se vier "05/11/2025 00:00:00", pega só a parte da data
  const spaceIdx = s.indexOf(" ");
  if (spaceIdx > 0) s = s.slice(0, spaceIdx);

  const m = s.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})$/);
  if (!m) return null;
  let d = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10) - 1;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  return new Date(y, mo, d);
}

function formatDateBR(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function formatInputDate(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${yy}-${mm}-${dd}`;
}

function formatShortNasc(nascDt, nascStr) {
  let d = nascDt;
  if (!d && nascStr) d = parseDateBR(nascStr);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function calcAge(nasc, ref) {
  if (!nasc) return null;
  const today = ref || new Date();
  let age = today.getFullYear() - nasc.getFullYear();
  const m = today.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < nasc.getDate())) age--;
  return age;
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function setFileStatus(ok, msg) {
  const el = document.getElementById("fileStatus");
  if (!el) return;
  el.style.display = "block";
  el.textContent = msg;
  el.className = ok ? "alert-success" : "alert-error";
}

function getSeenKey() {
  return fileKey ? "sannames_seen_" + fileKey : "";
}

function getHistoryKey() {
  return fileKey ? "sannames_hist_" + fileKey : "";
}

function loadSeen() {
  const k = getSeenKey();
  if (!k) {
    seenKeys = new Set();
    return;
  }
  const raw = localStorage.getItem(k);
  seenKeys = raw ? new Set(JSON.parse(raw)) : new Set();
}

function saveSeen() {
  const k = getSeenKey();
  if (!k) return;
  localStorage.setItem(k, JSON.stringify(Array.from(seenKeys)));
}

function loadHistory() {
  const k = getHistoryKey();
  if (!k) {
    historyEntries = [];
    renderHistory();
    return;
  }
  const raw = localStorage.getItem(k);
  historyEntries = raw ? JSON.parse(raw) : [];
  renderHistory();
}

function saveHistory() {
  const k = getHistoryKey();
  if (!k) return;
  localStorage.setItem(k, JSON.stringify(historyEntries));
}

function updateStorageUsage() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      total += (key.length + (val ? val.length : 0));
    }
    const usedBytes = total * 2;
    const quota = 5 * 1024 * 1024;
    const pct = Math.min(100, (usedBytes / quota) * 100);
    const el = document.getElementById("armazenamentoInfo");
    if (el) el.textContent = `Uso estimado do localStorage: ${pct.toFixed(1)}%`;
  } catch (_) {}
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const headerLine = lines[0];
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  const delim = semi >= comma ? ";" : ",";
  const headers = headerLine.split(delim).map(h => h.trim());
  const normHeaders = headers.map(normHeader);

  const idx = {
    cns: -1,
    nome: -1,
    nasc: -1,
    idade: -1,
    ag: -1,
    qtd: -1,
    solicitacao: -1,
    codigo: -1,
    desc: -1
  };

  normHeaders.forEach((n, i) => {
    if (n.includes("cns")) idx.cns = i;
    else if (n === "nome" || n.includes("nomepaciente")) idx.nome = i;
    else if (n.includes("nasc")) idx.nasc = i;
    else if (n.includes("idade")) idx.idade = i;
    else if (n.includes("agend") || n.includes("dataatendimento") || n.includes("dataagendamento"))
      idx.ag = i;
    else if (n.includes("qtdeexames") || n.includes("qtd") || n.includes("quantidadeexames"))
      idx.qtd = i;
    else if (n.includes("solicitacao")) idx.solicitacao = i;
    else if (n.includes("codigounificado") || n === "codunificado") idx.codigo = i;
    else if (n.includes("descricao") || n.includes("procedimento")) idx.desc = i;
  });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim);
    if (parts.length === 1 && parts[0].trim() === "") continue;
    const get = index =>
      index >= 0 && index < parts.length ? parts[index].trim() : "";

    const cns = get(idx.cns);
    const nome = get(idx.nome);
    if (!cns && !nome) continue;

    const nascStr = get(idx.nasc);
    const nascDt = parseDateBR(nascStr);
    const idadeCsv = parseInt(get(idx.idade).replace(/\D/g, "")) || null;
    const agStr = get(idx.ag);
    const agDt = parseDateBR(agStr);
    let qtd = parseInt(get(idx.qtd).replace(/\D/g, "")) || 1;
    if (!Number.isFinite(qtd) || qtd <= 0) qtd = 1;

    rows.push({
      cns,
      nome,
      nascStr,
      nascDt,
      idadeCsv,
      agStr,
      agDt,
      qtd,
      solicitacao: get(idx.solicitacao),
      codigo: get(idx.codigo),
      descricao: get(idx.desc)
    });
  }
  return rows;
}

function computeMinMaxDates(rows) {
  let min = null,
    max = null;
  for (const r of rows) {
    if (!r.agDt) continue;
    if (!min || r.agDt < min) min = r.agDt;
    if (!max || r.agDt > max) max = r.agDt;
  }
  return { min, max };
}

// acrescenta dd/mm/aa antes do * quando houver nomes iguais com CNS diferente
function disambiguateSameNames(patients) {
  const groups = new Map();
  for (const p of patients) {
    const base = (p.baseName || p.displayName || "")
      .replace(/\*+$/g, "")
      .trim();
    const key = base.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  for (const arr of groups.values()) {
    if (arr.length <= 1) continue;

    for (const p of arr) {
      const short = formatShortNasc(p.nascDt, p.nascStr);
      if (!short) continue;
      const base = (p.baseName || p.displayName || "")
        .replace(/\*+$/g, "")
        .trim();
      const hasStar = /\*$/.test(p.displayName || "");
      p.displayName = `${base} ${short}${hasStar ? "*" : ""}`;
    }
  }
}

function buildPatientsForInterval(start, end) {
  // se houver datas válidas, filtra; se não houver nenhuma, usa tudo
  const rowsWithDate = allRows.filter(r => r.agDt);
  let rowsInInterval;
  if (rowsWithDate.length === 0) {
    rowsInInterval = allRows.slice();
  } else {
    rowsInInterval = rowsWithDate.filter(
      r => r.agDt >= start && r.agDt <= end
    );
  }

  const map = new Map();
  for (const r of rowsInInterval) {
    const key = r.cns || r.nome;
    if (!key) continue;
    let g = map.get(key);
    if (!g) {
      g = {
        cns: r.cns || "",
        nomeOriginal: r.nome || "",
        nascDt: r.nascDt || null,
        nascStr: r.nascStr || "",
        idade: null,
        totalExames: 0,
        diasSet: new Set(),
        rows: []
      };
      map.set(key, g);
    }
    if (!g.nascDt && r.nascDt) {
      g.nascDt = r.nascDt;
      g.nascStr = r.nascStr;
    }
    if (g.idade == null && r.idadeCsv != null) g.idade = r.idadeCsv;
    g.totalExames += r.qtd || 1;
    if (r.agStr) g.diasSet.add(r.agStr);
    g.rows.push(r);
  }

  const intervalNewKeys = new Set();
  const newNamesSet = new Set();

  const patients = [];
  for (const g of map.values()) {
    const refDate = end || new Date();
    const ageCalc = calcAge(g.nascDt, refDate);
    if (ageCalc != null) g.idade = ageCalc;

    const rawName = (g.nomeOriginal || "").trim();
    const hasStarOrig = /\*$/.test(rawName);
    const baseName = hasStarOrig
      ? rawName.replace(/\*+$/g, "").trim()
      : rawName;
    const elderly = g.idade != null && g.idade >= 60;
    const finalStar = hasStarOrig || elderly;
    let finalName = baseName + (finalStar ? "*" : "");

    let isNovo = false;
    for (const r of g.rows) {
      if (!r.agDt) continue;
      const dKey = r.agStr || formatDateBR(r.agDt);
      const kk = `${g.cns}|${dKey}`;
      if (!seenKeys.has(kk)) {
        isNovo = true;
        intervalNewKeys.add(kk);
      }
    }
    if (isNovo) newNamesSet.add(finalName);

    patients.push({
      cns: g.cns,
      nomeOriginal: g.nomeOriginal,
      baseName,
      displayName: finalName,
      nascDt: g.nascDt,
      nascStr: g.nascStr,
      idade: g.idade,
      totalExames: g.totalExames,
      dias: g.diasSet.size || 1,
      rows: g.rows
    });
  }

  disambiguateSameNames(patients);

  intervalNewKeys.forEach(k => seenKeys.add(k));
  saveSeen();

  renderNewNames(newNamesSet);
  drawChart(rowsInInterval);

  return patients;
}

function renderNewNames(setNames) {
  const lista = document.getElementById("listaNovos");
  const spanTotal = document.getElementById("novosTotal");
  const arr = Array.from(setNames);
  lastNewNames = arr;
  if (spanTotal) spanTotal.textContent = `(${arr.length})`;
  if (!arr.length) {
    lista.textContent = "Nenhum novo nome neste intervalo";
    return;
  }
  arr.sort((a, b) => a.localeCompare(b, "pt-BR"));
  lista.innerHTML = arr.map(escapeHtml).join("<br>");
}

function renderHistory() {
  const div = document.getElementById("historico");
  if (!historyEntries.length) {
    div.textContent = "Nenhum intervalo salvo ainda";
    return;
  }
  let html = "<ul>";
  historyEntries.forEach(h => {
    html += `<li>${escapeHtml(h.label)}</li>`;
  });
  html += "</ul>";
  div.innerHTML = html;
}

function renderPatientsTable() {
  const tbody = document.querySelector("#tabelaPacientes tbody");
  tbody.innerHTML = "";
  currentPatients.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const tdCns = document.createElement("td");
    tdCns.textContent = p.cns;

    const tdNome = document.createElement("td");
    tdNome.textContent = p.displayName;

    const tdNasc = document.createElement("td");
    tdNasc.textContent = p.nascStr || "";

    const tdIdade = document.createElement("td");
    tdIdade.textContent = p.idade != null ? String(p.idade) : "";

    const tdEx = document.createElement("td");
    tdEx.textContent = String(p.totalExames);
    tdEx.classList.add("cell-exames");
    tdEx.style.color = "#005dff";
    tdEx.style.fontWeight = "600";
    tdEx.style.cursor = "pointer";

    const tdDias = document.createElement("td");
    tdDias.textContent = String(p.dias);

    tr.appendChild(tdCns);
    tr.appendChild(tdNome);
    tr.appendChild(tdNasc);
    tr.appendChild(tdIdade);
    tr.appendChild(tdEx);
    tr.appendChild(tdDias);
    tbody.appendChild(tr);
  });
}

function applySearchAndSort() {
  const term = document.getElementById("pesquisa").value
    .trim()
    .toLowerCase();

  let list = basePatients.filter(p => {
    if (!term) return true;
    return (
      (p.cns && p.cns.toLowerCase().includes(term)) ||
      (p.displayName && p.displayName.toLowerCase().includes(term))
    );
  });

  if (sortState.col) {
    const col = sortState.col;
    const dir = sortState.dir;
    list.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (col === "displayName" || col === "cns") {
        return (
          va
            .toString()
            .localeCompare(vb.toString(), "pt-BR") * dir
        );
      }
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
  }

  currentPatients = list;
  renderPatientsTable();
}

function drawChart(rows) {
  const canvas = document.getElementById("grafico");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = (canvas.width = canvas.clientWidth || 600);
  const height = (canvas.height = canvas.clientHeight || 320);
  ctx.clearRect(0, 0, width, height);

  const map = new Map();
  for (const r of rows) {
    if (!r.agDt) continue;
    const t = r.agDt.getTime();
    let item = map.get(t);
    if (!item) {
      item = {
        time: t,
        date: r.agStr || formatDateBR(r.agDt),
        total: 0
      };
      map.set(t, item);
    }
    item.total += r.qtd || 1;
  }
  const days = Array.from(map.values()).sort((a, b) => a.time - b.time);
  if (!days.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillText("Nenhum exame no intervalo", width / 2, height / 2);
    return;
  }

  const margin = { left: 40, right: 20, top: 20, bottom: 48 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const maxVal = Math.max(...days.map(d => d.total));
  const barW = Math.max(12, chartW / (days.length * 1.5));
  const gap =
    days.length > 1
      ? (chartW - barW * days.length) / (days.length - 1)
      : 0;

  ctx.strokeStyle = "#cbd5f5";
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + chartH);
  ctx.lineTo(margin.left + chartW, margin.top + chartH);
  ctx.stroke();

  ctx.font = "11px Inter, Arial";
  ctx.textAlign = "center";

  days.forEach((d, i) => {
    const x = margin.left + i * (barW + gap);
    const h = maxVal ? ((d.total / maxVal) * (chartH - 20)) : 0;
    const y = margin.top + chartH - h;
    ctx.fillStyle = "#005dff";
    ctx.fillRect(x, y, barW, h);

    ctx.fillStyle = "#111827";
    ctx.fillText(String(d.total), x + barW / 2, y - 4);

    ctx.save();
    ctx.translate(x + barW / 2, margin.top + chartH + 16);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#374151";
    ctx.fillText(d.date, 0, 0);
    ctx.restore();
  });
}

function openModalFor(index, rowEl) {
  const modal = document.getElementById("modal");
  const content = document.getElementById("modalContent");
  const p = currentPatients[index];
  if (!p) return;

  if (selectedRowEl) selectedRowEl.classList.remove("linha-selecionada");
  selectedRowEl = rowEl;
  if (selectedRowEl) selectedRowEl.classList.add("linha-selecionada");

  let html = `<div class="modal-header">
      <div>
        <h2>${escapeHtml(p.displayName)}</h2>
        <p>CNS ${escapeHtml(p.cns || "")} • ${p.rows.length} linhas • ${
    p.totalExames
  } exames</p>
      </div>
      <button type="button" class="modal-close">&times;</button>
    </div>
    <div class="exam-list">`;

  p.rows.forEach(r => {
    html += `<div class="exam-row">
      <div class="exam-info">
        <div class="exam-desc">${escapeHtml(
          r.descricao || "Exame sem descrição"
        )}</div>
        <div class="exam-meta">
          Solicitação: ${escapeHtml(r.solicitacao || "-")} • Código: ${escapeHtml(
      r.codigo || "-"
    )} • Agendamento: ${escapeHtml(r.agStr || "")}
        </div>
      </div>
      <div class="exam-actions">
        <button class="chip" data-copy="${escapeHtml(
          r.solicitacao || ""
        )}">Copiar solicitação</button>
        <button class="chip" data-copy="${escapeHtml(
          r.codigo || ""
        )}">Copiar código</button>
        <button class="chip" data-copy="${escapeHtml(
          r.descricao || ""
        )}">Copiar descrição</button>
      </div>
    </div>`;
  });

  html += "</div>";
  content.innerHTML = html;
  modal.style.display = "flex";
}

function closeModal() {
  const modal = document.getElementById("modal");
  modal.style.display = "none";
  if (selectedRowEl) selectedRowEl.classList.remove("linha-selecionada");
  selectedRowEl = null;
}

document.addEventListener("DOMContentLoaded", () => {
  setFileStatus(false, "Nenhum arquivo carregado ainda");
  updateStorageUsage();

  const fileInput = document.getElementById("csvFile");
  const btnAplicar = document.getElementById("btnAplicar");
  const searchInput = document.getElementById("pesquisa");
  const ths = document.querySelectorAll("#tabelaPacientes th");
  const tbody = document.querySelector("#tabelaPacientes tbody");
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");
  const btnCopiarNovos = document.getElementById("btnCopiarNovos");
  const btnLimparHistorico = document.getElementById("btnLimparHistorico");

  fileInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) {
      allRows = [];
      basePatients = [];
      currentPatients = [];
      renderPatientsTable();
      setFileStatus(false, "Nenhum arquivo carregado ainda");
      return;
    }
    fileKey = file.name || "arquivo";
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        allRows = parseCSV(ev.target.result);
        if (!allRows.length) {
          setFileStatus(false, "Não foi possível ler linhas válidas do CSV.");
          return;
        }
        const { min, max } = computeMinMaxDates(allRows);
        const di = document.getElementById("dataInicio");
        const df = document.getElementById("dataFim");
        if (min && di.value === "") di.value = formatInputDate(min);
        if (max && df.value === "") df.value = formatInputDate(max);
        setFileStatus(true, `Arquivo carregado com ${allRows.length} linhas.`);
        loadSeen();
        loadHistory();
        updateStorageUsage();
      } catch (err) {
        console.error(err);
        setFileStatus(false, "Erro ao processar o CSV.");
      }
    };
    reader.readAsText(file, "utf-8");
  });

  btnAplicar.addEventListener("click", () => {
    if (!allRows.length) {
      setFileStatus(false, "Carregue o arquivo CSV antes de aplicar o intervalo.");
      return;
    }
    const di = document.getElementById("dataInicio").value;
    const df = document.getElementById("dataFim").value;
    let start = di ? new Date(di + "T00:00:00") : null;
    let end = df ? new Date(df + "T23:59:59") : null;
    const { min, max } = computeMinMaxDates(allRows);
    if (!start) start = min || new Date();
    if (!end) end = max || new Date();

    basePatients = buildPatientsForInterval(start, end);
    sortState = { col: null, dir: 1 };
    applySearchAndSort();

    const totalExames = allRows
      .filter(r => r.agDt && r.agDt >= start && r.agDt <= end)
      .reduce((s, r) => s + (r.qtd || 1), 0);

    const startStr = formatDateBR(start);
    const endStr = formatDateBR(end);
    historyEntries.push({
      start: startStr,
      end: endStr,
      label: `${startStr} até ${endStr} — ${basePatients.length} pacientes únicos • ${totalExames} exames`
    });
    saveHistory();
    renderHistory();
    updateStorageUsage();
  });

  searchInput.addEventListener("input", () => {
    applySearchAndSort();
  });

  ths.forEach(th => {
    th.addEventListener("click", () => {
      const colId = th.getAttribute("data-col");
      const map = {
        cns: "cns",
        nome: "displayName",
        nasc: "nascDt",
        idade: "idade",
        exames: "totalExames",
        presencas: "dias"
      };
      const col = map[colId];
      if (!col) return;
      if (sortState.col === col) sortState.dir *= -1;
      else {
        sortState.col = col;
        sortState.dir = 1;
      }
      applySearchAndSort();
    });
  });

  tbody.addEventListener("click", e => {
    const cell = e.target.closest("td");
    if (!cell) return;
    const row = cell.parentElement;
    const idx = parseInt(row.dataset.index, 10);
    if (Number.isNaN(idx)) return;
    if (cell.classList.contains("cell-exames")) {
      openModalFor(idx, row);
    }
  });

  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal();
  });

  modalContent.addEventListener("click", e => {
    if (e.target.classList.contains("modal-close")) {
      closeModal();
      return;
    }
    if (e.target.classList.contains("chip")) {
      const txt = e.target.getAttribute("data-copy") || "";
      if (!txt) {
        alert("Nada para copiar.");
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(txt)
          .then(() => {
            alert("Copiado para a área de transferência.");
          })
          .catch(() => {
            alert("Não foi possível copiar.");
          });
      } else {
        alert("Seu navegador não suporta cópia automática.");
      }
    }
  });

  btnCopiarNovos.addEventListener("click", () => {
    if (!lastNewNames.length) {
      alert("Não há novos nomes neste intervalo.");
      return;
    }
    const txt = lastNewNames.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(txt)
        .then(() => {
          alert("Novos nomes copiados para a área de transferência.");
        })
        .catch(() => {
          alert("Não foi possível copiar.");
        });
    } else {
      alert("Seu navegador não suporta cópia automática.");
    }
  });

  btnLimparHistorico.addEventListener("click", () => {
    if (!fileKey) {
      alert("Nenhum arquivo carregado.");
      return;
    }
    if (
      !confirm(
        "Limpar histórico e marcar todos os registros como novos novamente?"
      )
    )
      return;
    historyEntries = [];
    renderHistory();
    const sk = getSeenKey();
    if (sk) localStorage.removeItem(sk);
    seenKeys = new Set();
    lastNewNames = [];
    renderNewNames(new Set());
    updateStorageUsage();
  });
});
