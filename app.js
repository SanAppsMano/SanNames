let registros = [];
let agregadosOrig = [];
let filtrados = [];
let novos = [];
let registrosIntervalo = [];
let ultimaDataInicio = null;
let ultimaDataFim = null;
let linhaSelecionada = null;
let ultimoCnsIntervalo = new Set(); // usado para comparar com o intervalo anterior

const csvFile = document.getElementById("csvFile");
const btnAplicar = document.getElementById("btnAplicar");
const campoPesquisa = document.getElementById("pesquisa");
const tabelaBody = document.querySelector("#tabelaPacientes tbody");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const btnLimparHistorico = document.getElementById("btnLimparHistorico");
const btnCopiarNovos = document.getElementById("btnCopiarNovos");
const KEY_HISTORICO = "historicoIntervalosSanNames";

csvFile.addEventListener("change", () => {
  const file = csvFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const txt = e.target.result;
    processarCSV(txt);
  };
  reader.readAsText(file, "utf-8");
});

function processarCSV(txt) {
  const linhas = txt.trim().split(/\r?\n/);
  if (!linhas.length) {
    alert("CSV vazio");
    return;
  }
  const header = linhas[0].split(";").map(h => h.trim().toLowerCase());
  const idx = {
    cns: findCol(header, ["cns", "numero_cartao_sus", "num_cns", "cartao_sus"]),
    nome: findCol(header, ["nome", "nome_paciente", "nome_usuario"]),
    nasc: findColNasc(header),
    data: findCol(header, ["dt_agendamento", "data_agendamento", "data", "dt_atendimento"]),
    exame: findCol(header, ["descricao_procedimento", "procedimento", "exame", "descricao_exame"]),
    solicitacao: findCol(header, ["numero_solicitacao", "num_solicitacao", "nr_solicitacao", "solicitacao"])
  };

  const obrig = ["cns", "nome", "data", "exame"];
  const faltando = obrig.filter(k => idx[k] < 0);
  if (faltando.length) {
    alert("Não foi possível localizar colunas obrigatórias: " + faltando.join(", "));
    return;
  }

  registros = linhas.slice(1).map(l => {
    const c = l.split(";");
    return {
      cns: c[idx.cns] || "",
      nome: c[idx.nome] || "",
      nasc: idx.nasc >= 0 ? (c[idx.nasc] || "") : "",
      data: c[idx.data] || "",
      exame: c[idx.exame] || "",
      solicitacao: idx.solicitacao >= 0 ? (c[idx.solicitacao] || "") : "",
      linha: l
    };
  }).filter(r => r.cns && r.nome && r.data && r.exame);

  if (!registros.length) {
    alert("Nenhum registro válido encontrado no CSV");
    return;
  }

  alert("CSV carregado com " + registros.length + " linhas válidas.\nAgora selecione o intervalo de datas e clique em Aplicar.");
}

function findCol(header, cand) {
  for (let name of cand) {
    let i = header.findIndex(h => h === name);
    if (i >= 0) return i;
  }
  for (let name of cand) {
    let i = header.findIndex(h => h.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

function findColNasc(header) {
  let i = header.findIndex(h => h === "dt_nascimento");
  i = i < 0 ? header.findIndex(h => h === "data_nascimento") : i;
  if (i >= 0) return i;
  i = header.findIndex(h => h.includes("nasc"));
  return i;
}

function normalizarNome(n) {
  if (!n) return "";
  let s = n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\s+de\s+/g, " de ");
  s = s.replace(/\s+da\s+/g, " da ");
  s = s.replace(/\s+do\s+/g, " do ");
  s = s.replace(/\s+dos\s+/g, " dos ");
  s = s.replace(/\s+das\s+/g, " das ");
  s = s.replace(/\s+e\s+/g, " e ");
  s = s.replace(/\s+([a-z])/g, (_, c) => " " + c.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseDataAgendamento(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yyyy, mm, dd] = s.split("-");
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) {
    const [dd, mm, yy] = s.split("/");
    const yyyy = parseInt(yy, 10) >= 30 ? "19" + yy : "20" + yy;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  return null;
}

function parseNascimento(nascStr) {
  if (!nascStr) return null;
  const s = nascStr.trim();
  let d, m, y;

  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) {
    [d, m, y] = s.split("/");
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    [d, m, y] = s.split("-");
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    [d, m, y] = s.split(".");
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
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

function formatNascimentoCurto(nascStr) {
  const dt = parseNascimento(nascStr);
  if (!dt) return "";
  const dd = String(dt.getDate()).padStart(2,"0");
  const mm = String(dt.getMonth() + 1).padStart(2,"0");
  const yy = String(dt.getFullYear() % 100).padStart(2,"0");
  return dd + "/" + mm + "/" + yy;
}

btnAplicar.onclick = () => processar();
if (btnLimparHistorico) btnLimparHistorico.onclick = () => limparHistorico();

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

  ajustarNomesDuplicados(agregadosOrig);

  filtrados = agregadosOrig.slice();
  detectarNovos();
  renderTabela();
  renderGrafico();
  atualizarArmazenamento();
  salvarHistorico();
}

function ajustarNomesDuplicados(lista) {
  const grupos = {};
  lista.forEach(r => {
    const chave = (r.nomeBase || "").toLowerCase();
    if (!chave) return;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(r);
  });

  Object.values(grupos).forEach(grupo => {
    const cnsSet = new Set(grupo.map(x => x.cns).filter(Boolean));
    if (cnsSet.size <= 1) return;

    grupo.forEach(r => {
      const nascCurta = formatNascimentoCurto(r.nasc);
      if (!nascCurta) return;
      const nomeAtual = String(r.nome || "");
      const temAsterisco = nomeAtual.endsWith("*");
      const base = temAsterisco ? nomeAtual.slice(0, -1).trim() : nomeAtual.trim();
      if (!base.toLowerCase().includes(nascCurta.toLowerCase())) {
        r.nome = base + " " + nascCurta + (temAsterisco ? "*" : "");
      }
    });
  });
}

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

const ths = document.querySelectorAll("#tabelaPacientes thead th");
ths.forEach(th => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-col");
    const asc = !th.dataset.asc || th.dataset.asc === "false";
    th.dataset.asc = asc ? "true" : "false";
    filtrados.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (col === "presencas" || col === "exames" || col === "idade") {
        const na = parseInt(va || "0", 10);
        const nb = parseInt(vb || "0", 10);
        return asc ? na - nb : nb - na;
      }
      va = String(va || "");
      vb = String(vb || "");
      return asc
        ? va.localeCompare(String(vb), "pt-BR")
        : vb.localeCompare(String(va), "pt-BR");
    });
    renderTabela();
  });
});

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
  closeBtn.onclick = () => {
    modal.style.display = "none";
  };

  headerDiv.appendChild(infoDiv);
  headerDiv.appendChild(closeBtn);
  modalContent.appendChild(headerDiv);

  const listaDiv = document.createElement("div");
  listaDiv.className = "exam-list";

  lista.forEach(x => {
    const row = document.createElement("div");
    row.className = "exam-row";

    const info = document.createElement("div");
    info.className = "exam-info";

    const desc = document.createElement("div");
    desc.className = "exam-desc";
    desc.textContent = x.exame;
    info.appendChild(desc);

    const meta = document.createElement("div");
    meta.className = "exam-meta";
    const dt = x.data || "";
    meta.textContent = dt ? `Agendado para: ${dt}` : "Sem data de agendamento";
    info.appendChild(meta);

    const chips = document.createElement("div");
    chips.className = "exam-chips";

    const b1 = document.createElement("button");
    b1.type = "button";
    b1.className = "chip";
    b1.textContent = "Nome";
    b1.onclick = () => copiarCampo(paciente ? paciente.nome : x.nome || "", "Nome copiado");

    const b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "chip";
    b2.textContent = "CNS";
    b2.onclick = () => copiarCampo(x.cns || "", "CNS copiado");

    const b3 = document.createElement("button");
    b3.type = "button";
    b3.className = "chip";
    b3.textContent = "Descrição";
    b3.onclick = () => copiarCampo(x.exame || "", "Descrição copiada");

    chips.appendChild(b1);
    chips.appendChild(b2);
    chips.appendChild(b3);
    info.appendChild(chips);

    const meta2 = document.createElement("div");
    meta2.className = "exam-meta-secundaria";
    meta2.textContent = x.solicitacao ? `Solicitação: ${x.solicitacao}` : "";
    info.appendChild(meta2);

    row.appendChild(info);
    listaDiv.appendChild(row);
  });

  modalContent.appendChild(listaDiv);
  modal.style.display = "flex";
}

function copiarCampo(txt, msgSucesso) {
  if (!txt) {
    alert("Nada para copiar");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt)
      .then(() => alert(msgSucesso))
      .catch(() => alert("Não foi possível copiar"));
  } else {
    alert("Clipboard não suportado neste navegador");
  }
}

window.addEventListener("click", e => {
  if (e.target === modal) {
    modal.style.display = "none";
  }
});

function detectarNovos() {
  const atualSet = new Set(
    filtrados.map(x => x.cns).filter(Boolean)
  );

  novos = filtrados.filter(x => x.cns && !ultimoCnsIntervalo.has(x.cns));
  ultimoCnsIntervalo = atualSet;

  const div = document.getElementById("listaNovos");
  if (div) {
    if (novos.length) {
      div.innerHTML = novos.map(x => x.nome).join("<br>");
    } else {
      div.innerHTML = "Nenhum novo nome neste intervalo";
    }
  }

  const spanTotal = document.getElementById("novosTotal");
  if (spanTotal) {
    spanTotal.innerText = `(${novos.length})`;
  }
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
  hist.unshift({
    dataInicio: ultimaDataInicio,
    dataFim: ultimaDataFim,
    qtdePacientes: filtrados.length,
    qtdeNovos: novos.length,
    criadoEm: new Date().toISOString()
  });
  hist = hist.slice(0, 50);
  localStorage.setItem(KEY_HISTORICO, JSON.stringify(hist));
  renderHistorico(hist);
}

function carregarHistorico() {
  let hist;
  try {
    hist = JSON.parse(localStorage.getItem(KEY_HISTORICO) || "[]");
  } catch (_) {
    hist = [];
  }
  renderHistorico(hist);
}

function limparHistorico() {
  localStorage.removeItem(KEY_HISTORICO);
  renderHistorico([]);
}

function renderHistorico(hist) {
  const div = document.getElementById("historico");
  if (!div) return;
  if (!hist || !hist.length) {
    div.innerText = "Nenhum intervalo salvo ainda";
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "hist-list";

  hist.forEach(item => {
    const li = document.createElement("li");
    li.className = "hist-item";
    const titulo = document.createElement("div");
    titulo.className = "hist-title";
    titulo.textContent = `${item.dataInicio} até ${item.dataFim}`;
    const detalhe = document.createElement("div");
    detalhe.className = "hist-detail";
    detalhe.textContent =
      `Pacientes: ${item.qtdePacientes}  •  Novos: ${item.qtdeNovos}`;
    li.appendChild(titulo);
    li.appendChild(detalhe);
    ul.appendChild(li);
  });

  div.innerHTML = "";
  div.appendChild(ul);
}

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
  if (!labels.length) return;
  labels.sort((a, b) => {
    const da = parseDataAgendamento(a) || new Date(a);
    const db = parseDataAgendamento(b) || new Date(b);
    return da - db;
  });

  const valores = labels.map(d => dias[d]);
  const max = Math.max(...valores, 1);
  const barWidth = w / (labels.length || 1);

  ctx.font = "10px Arial";
  ctx.textAlign = "center";

  valores.forEach((v, i) => {
    const x = i * barWidth + barWidth / 2;
    const barH = (v / max) * (h - 40);
    const y = h - 20 - barH;
    const larguraBarra = barWidth * 0.6;

    ctx.fillStyle = "#005dff";
    ctx.fillRect(x - larguraBarra / 2, y, larguraBarra, barH);

    ctx.fillStyle = "#0f172a";
    ctx.fillText(String(v), x, y - 4);        // quantidade no dia
    ctx.fillText(labels[i], x, h - 8);        // data
  });
}

carregarHistorico();
atualizarArmazenamento();
