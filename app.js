let registros = [];
let agregadosOrig = [];
let filtrados = [];
let novos = [];
let registrosIntervalo = [];
let ultimaDataInicio = null;
let ultimaDataFim = null;
let linhaSelecionada = null;

const csvFile = document.getElementById("csvFile");
const btnAplicar = document.getElementById("btnAplicar");
const campoPesquisa = document.getElementById("pesquisa");
const tabelaBody = document.querySelector("#tabelaPacientes tbody");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const btnCopiarNovos = document.getElementById("btnCopiarNovos");

// chave de storage para novos nomes e histórico
const KEY_ULTIMA_LISTA = "ultimaLista";
const KEY_HISTORICO = "historicoIntervalosSanNames";

// Quando trocar de CSV, zera a memória de "novos"
csvFile.addEventListener("change", () => {
  const f = csvFile.files[0];
  if (!f) return;

  const r = new FileReader();
  r.onload = e => {
    registros = parseCSV(e.target.result);
    // reset de novos nomes para este arquivo
    localStorage.removeItem(KEY_ULTIMA_LISTA);
    const divNovos = document.getElementById("listaNovos");
    if (divNovos) divNovos.innerHTML = "";
    alert("CSV carregado");
  };
  r.readAsText(f, "UTF-8");
});

// -------- PARSE DO CSV --------
function parseCSV(txt) {
  const linhas = txt.trim().split(/\r?\n/);
  if (!linhas.length) return [];

  const rawHeader = linhas.shift().split(";");
  const header = rawHeader.map(h => h.trim().toLowerCase());

  const idx = {
    cns: findCol(header, ["cns"]),
    nome: findNomePacienteCol(header),
    nasc: findNascCol(header),
    data: findCol(header, ["data_agendamento", "dt_agendamento", "agendamento"]),
    exame: findCol(header, ["descricao_procedimento", "procedimento"]),
    solicitacao: findCol(header, ["numero_solicitacao", "solicitacao"]),
    codUnificado: findCol(header, ["codigo_unificado", "cod_unificado"])
  };

  return linhas.map(l => {
    const c = l.split(";");
    return {
      cns: c[idx.cns] || "",
      nome: c[idx.nome] || "",
      nasc: idx.nasc >= 0 ? (c[idx.nasc] || "") : "",
      data: c[idx.data] || "",
      exame: c[idx.exame] || "",
      solicitacao: idx.solicitacao >= 0 ? (c[idx.solicitacao] || "") : "",
      codUnificado: idx.codUnificado >= 0 ? (c[idx.codUnificado] || "") : ""
    };
  });
}

// nome do paciente: prioriza "nome" exato
function findNomePacienteCol(header) {
  let i = header.findIndex(h => h === "nome");
  if (i >= 0) return i;
  i = header.findIndex(h => h === "nome_paciente");
  if (i >= 0) return i;
  // fallback (evitar profissional_executante, mas último recurso)
  return findCol(header, ["nome"]);
}

// nascimento: qualquer coluna que pareça data de nascimento, evitando profissional
function findNascCol(header) {
  let i = header.findIndex(h => h === "dt_nascimento");
  if (i >= 0) return i;
  i = header.findIndex(h => h === "data_nascimento");
  if (i >= 0) return i;
  i = header.findIndex(h => h.includes("nasc"));
  return i; // pode ser -1, tratamos depois
}

function findCol(header, cand) {
  return header.findIndex(h => cand.some(name => h.includes(name)));
}

// -------- NORMALIZAÇÕES --------
function normalizarNome(n) {
  return (n || "").toLowerCase().replace(/(?:^|\s)\S/g, m => m.toUpperCase());
}

// data_agendamento vem como dd.mm.aaaa (SISREG)
function parseDataAgendamento(s) {
  if (!s) return null;
  const partes = s.split(".");
  if (partes.length !== 3) return null;
  const [dd, mm, yyyy] = partes;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

// parse flexível de nascimento (vários formatos)
function parseNascimento(nascStr) {
  if (!nascStr) return null;
  const s = nascStr.trim();
  let d, m, y;

  // dd/mm/aa ou dd/mm/aaaa
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) {
    [d, m, y] = s.split("/");
  }
  // dd-mm-aaaa
  else if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    [d, m, y] = s.split("-");
  }
  // dd.mm.aaaa
  else if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    [d, m, y] = s.split(".");
  }
  // aaaa-mm-dd
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    [y, m, d] = s.split("-");
  } else {
    return null;
  }

  let year = parseInt(y, 10);
  if (isNaN(year)) return null;

  if (y.length === 2) {
    year = year >= 30 ? 1900 + year : 2000 + year;
  }

  const month = parseInt(m, 10) - 1;
  const day = parseInt(d, 10);
  const dt = new Date(year, month, day);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function calcularIdade(nascStr, hoje = new Date()) {
  const dt = parseNascimento(nascStr);
  if (!dt) return null;
  const year = dt.getFullYear();
  const month = dt.getMonth();
  const day = dt.getDate();

  let idade = hoje.getFullYear() - year;
  const mDiff = hoje.getMonth() - month;
  if (mDiff < 0 || (mDiff === 0 && hoje.getDate() < day)) idade--;
  return idade;
}

// -------- PROCESSAMENTO PRINCIPAL --------
btnAplicar.onclick = () => processar();

function processar() {
  if (!registros.length) {
    alert("Carregue um CSV primeiro");
    return;
  }
  const iniStr = document.getElementById("dataInicio").value;
  const fimStr = document.getElementById("dataFim").value;
  if (!iniStr || !fimStr) {
    alert("Selecione o intervalo de datas");
    return;
  }

  ultimaDataInicio = iniStr;
  ultimaDataFim = fimStr;

  const d1 = new Date(iniStr + "T00:00:00");
  const d2 = new Date(fimStr + "T23:59:59");

  const mapa = {};
  registrosIntervalo = [];

  registros.forEach(r => {
    const dt = parseDataAgendamento(r.data);
    if (!dt) return;
    if (dt >= d1 && dt <= d2) {
      registrosIntervalo.push(r);
      if (!mapa[r.cns]) {
        mapa[r.cns] = {
          cns: r.cns,
          nome: r.nome,
          nasc: r.nasc,
          exames: 0,
          dias: {}
        };
      }
      mapa[r.cns].exames += 1;
      mapa[r.cns].dias[r.data] = true;
    }
  });

  const hoje = new Date();

  agregadosOrig = Object.values(mapa).map(x => {
    const idade = calcularIdade(x.nasc, hoje);
    const idoso = idade !== null && idade >= 60;
    const nomeBase = normalizarNome(x.nome);
    return {
      cns: x.cns,
      nomeBase,
      nome: nomeBase + (idoso ? "*" : ""),
      nasc: x.nasc,
      idade: idade !== null ? idade : "",
      idoso,
      exames: x.exames,
      dias: x.dias,
      presencas: Object.keys(x.dias).length
    };
  });

  filtrados = agregadosOrig.slice();
  detectarNovos();
  renderTabela();
  renderGrafico();
  atualizarArmazenamento();
  salvarHistorico();
}

// -------- TABELA / BUSCA / ORDEM --------
function renderTabela() {
  tabelaBody.innerHTML = "";
  filtrados.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${r.cns}</td>` +
      `<td>${r.nome}</td>` +
      `<td>${r.nasc}</td>` +
      `<td>${r.idade}</td>` +
      `<td>${r.exames}</td>` +
      `<td>${r.presencas}</td>`;

    tr.onclick = () => {
      if (linhaSelecionada) linhaSelecionada.classList.remove("linha-selecionada");
      linhaSelecionada = tr;
      tr.classList.add("linha-selecionada");
      mostrarExames(r.cns);
    };

    tabelaBody.appendChild(tr);
  });
}

campoPesquisa.oninput = () => {
  const q = campoPesquisa.value.toLowerCase().trim();
  if (!q) {
    filtrados = agregadosOrig.slice();
  } else {
    filtrados = agregadosOrig.filter(x =>
      x.nomeBase.toLowerCase().includes(q) ||
      (x.cns || "").includes(q)
    );
  }
  renderTabela();
};

const ths = document.querySelectorAll("#tabelaPacientes th");
const numericCols = new Set(["idade", "exames", "presencas"]);

ths.forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    filtrados.sort((a, b) => {
      const va = a[col] ?? "";
      const vb = b[col] ?? "";
      if (numericCols.has(col)) {
        return (Number(va) || 0) - (Number(vb) || 0);
      }
      return String(va).localeCompare(String(vb), "pt-BR");
    });
    renderTabela();
  });
});

// -------- MODAL DE EXAMES --------
function mostrarExames(cns) {
  const lista = registrosIntervalo.length
    ? registrosIntervalo.filter(x => x.cns === cns)
    : registros.filter(x => x.cns === cns);

  const paciente = agregadosOrig.find(x => x.cns === cns);

  modalContent.innerHTML = "";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-header";

  const infoDiv = document.createElement("div");
  if (paciente) {
    const h2 = document.createElement("h2");
    h2.textContent = paciente.nome;
    const p1 = document.createElement("p");
    p1.textContent = `CNS: ${paciente.cns}`;
    const p2 = document.createElement("p");
    p2.textContent = `Nascimento: ${paciente.nasc}  •  Idade: ${paciente.idade || "?"}`;
    infoDiv.appendChild(h2);
    infoDiv.appendChild(p1);
    infoDiv.appendChild(p2);
  } else {
    const h2 = document.createElement("h2");
    h2.textContent = "Exames";
    infoDiv.appendChild(h2);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close";
  closeBtn.textContent = "×";
  closeBtn.onclick = e => {
    e.stopPropagation();
    fecharModal();
  };

  headerDiv.appendChild(infoDiv);
  headerDiv.appendChild(closeBtn);
  modalContent.appendChild(headerDiv);

  const listDiv = document.createElement("div");
  listDiv.className = "exam-list";

  lista.forEach(x => {
    const row = document.createElement("div");
    row.className = "exam-row";

    const info = document.createElement("div");
    info.className = "exam-info";

    const desc = document.createElement("div");
    desc.className = "exam-desc";
    desc.textContent = x.exame || "";

    const meta = document.createElement("div");
    meta.className = "exam-meta";
    meta.textContent =
      `Solicitação: ${x.solicitacao || "-"} • Código: ${x.codUnificado || "-"} • Data: ${x.data || ""}`;

    info.appendChild(desc);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "exam-actions";

    const b1 = document.createElement("button");
    b1.type = "button";
    b1.className = "chip";
    b1.textContent = "Solicitação";
    b1.onclick = () => copiarCampo(x.solicitacao || "", "Solicitação copiada");

    const b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "chip";
    b2.textContent = "Código";
    b2.onclick = () => copiarCampo(x.codUnificado || "", "Código copiado");

    const b3 = document.createElement("button");
    b3.type = "button";
    b3.className = "chip";
    b3.textContent = "Descrição";
    b3.onclick = () => copiarCampo(x.exame || "", "Descrição copiada");

    actions.appendChild(b1);
    actions.appendChild(b2);
    actions.appendChild(b3);

    row.appendChild(info);
    row.appendChild(actions);
    listDiv.appendChild(row);
  });

  modalContent.appendChild(listDiv);
  modal.style.display = "flex";
}

function copiarCampo(valor, msg) {
  const v = (valor || "").toString().trim();
  if (!v) {
    alert("Dado vazio");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(v)
      .then(() => alert(msg))
      .catch(() => alert("Não foi possível copiar"));
  } else {
    const ta = document.createElement("textarea");
    ta.value = v;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    alert(msg);
  }
}

function fecharModal() {
  modal.style.display = "none";
  if (linhaSelecionada) {
    linhaSelecionada.classList.remove("linha-selecionada");
    linhaSelecionada = null;
  }
}

modal.onclick = () => {
  fecharModal();
};

modalContent.addEventListener("click", e => {
  e.stopPropagation();
});

// -------- NOVOS REGISTROS --------
function detectarNovos() {
  let last = [];
  try {
    last = JSON.parse(localStorage.getItem(KEY_ULTIMA_LISTA) || "[]");
  } catch (_) {
    last = [];
  }
  const antigos = new Set(last.map(x => x.cns));
  novos = filtrados.filter(x => !antigos.has(x.cns));
  localStorage.setItem(KEY_ULTIMA_LISTA, JSON.stringify(filtrados));
  const div = document.getElementById("listaNovos");
  if (div) div.innerHTML = novos.map(x => x.nome).join("<br>");
}

btnCopiarNovos.onclick = () => {
  const txt = novos.map(x => x.nome).join("\n");
  if (!txt) {
    alert("Não há novos nomes");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt)
      .then(() => alert("Novos nomes copiados"))
      .catch(() => alert("Não foi possível copiar"));
  } else {
    alert("Clipboard não suportado neste navegador");
  }
};

// -------- ARMAZENAMENTO / HISTÓRICO / GRÁFICO --------
function atualizarArmazenamento() {
  let usado = 0;
  try {
    usado = JSON.stringify(localStorage).length;
  } catch (_) {
    usado = 0;
  }
  const max = 5 * 1024 * 1024;
  const pct = ((usado / max) * 100).toFixed(1);
  const el = document.getElementById("armazenamentoInfo");
  if (el) el.innerText = `Uso estimado do localStorage: ${pct}%`;
}

function salvarHistorico() {
  let hist;
  try {
    hist = JSON.parse(localStorage.getItem(KEY_HISTORICO) || "[]");
  } catch (_) {
    hist = [];
  }
  const totalPacientes = agregadosOrig.length;
  const totalExames = agregadosOrig.reduce((s, x) => s + x.exames, 0);
  const reg = {
    inicio: ultimaDataInicio,
    fim: ultimaDataFim,
    totalPacientes,
    totalExames,
    ts: new Date().toISOString()
  };
  const jaExiste = hist.some(h => h.inicio === reg.inicio && h.fim === reg.fim);
  if (!jaExiste) {
    hist.push(reg);
    if (hist.length > 50) hist = hist.slice(hist.length - 50);
    localStorage.setItem(KEY_HISTORICO, JSON.stringify(hist));
  }
  renderHistorico(hist);
}

function renderHistorico(hist) {
  const div = document.getElementById("historico");
  if (!div) return;
  if (!hist || !hist.length) {
    div.innerText = "Nenhum intervalo salvo ainda";
    return;
  }
  let html = "<ul>";
  hist.slice().reverse().forEach(h => {
    html += `<li>${h.inicio} até ${h.fim} - ${h.totalPacientes} pacientes, ${h.totalExames} exames</li>`;
  });
  html += "</ul>";
  div.innerHTML = html;
}

(function initHistorico() {
  let hist;
  try {
    hist = JSON.parse(localStorage.getItem(KEY_HISTORICO) || "[]");
  } catch (_) {
    hist = [];
  }
  renderHistorico(hist);
})();

function renderGrafico() {
  const canvas = document.getElementById("grafico");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth || 600;
  const h = canvas.height = canvas.clientHeight || 300;
  ctx.clearRect(0, 0, w, h);
  if (!registrosIntervalo.length) return;
  const dias = {};
  registrosIntervalo.forEach(r => {
    const d = r.data || "";
    dias[d] = (dias[d] || 0) + 1;
  });
  const labels = Object.keys(dias);
  const valores = labels.map(d => dias[d]);
  const max = Math.max(...valores, 1);
  const barWidth = w / (labels.length || 1);
  ctx.fillStyle = "#005dff";
  ctx.font = "10px Arial";
  ctx.textAlign = "center";
  valores.forEach((v, i) => {
    const x = i * barWidth + barWidth / 2;
    const barH = (v / max) * (h - 40);
    const y = h - 20 - barH;
    ctx.fillRect(x - (barWidth * 0.5) * 0.6, y, barWidth * 0.6, barH);
    ctx.fillText(labels[i], x, h - 8);
  });
}
