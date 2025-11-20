let registros = [];
let agregadosOrig = [];
let filtrados = [];
let novos = [];
let registrosIntervalo = [];
let ultimaDataInicio = null;
let ultimaDataFim = null;
let linhaSelecionada = null;
let ultimoCnsIntervalo = new Set(); // usado para comparar com o intervalo anterior
let graficoModo = "todos";
let totalSolicitacoes = 0;
let graficoBarras = [];
let nomesPorDia = {};
let agregadosPorCns = new Map();
let bancoRegistros = [];

const csvFile = document.getElementById("csvFile");
const campoPesquisa = document.getElementById("pesquisa");
const tabelaBody = document.querySelector("#tabelaPacientes tbody");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const btnCopiarNovos = document.getElementById("btnCopiarNovos");
const btnLimparHistorico = document.getElementById("btnLimparHistorico");
const graficoModoBotoes = document.querySelectorAll("[data-grafico-modo]");
const dataInicioInput = document.getElementById("dataInicio");
const dataFimInput = document.getElementById("dataFim");
const csvStatus = document.getElementById("csvStatus");
const intervaloStatus = document.getElementById("intervaloStatus");
const graficoCanvas = document.getElementById("grafico");

const KEY_HISTORICO = "historicoIntervalosSanNames";
const KEY_BANCO = "SanApps_SUS";

csvFile.addEventListener("change", async () => {
  const files = Array.from(csvFile.files || []);
  if (!files.length) {
    registros = bancoRegistros.slice();
    atualizarStatusPill(csvStatus, "Nenhum arquivo selecionado", "muted");
    renderGrafico();
    return;
  }

  atualizarStatusPill(csvStatus, `Processando ${files.length} arquivo(s)...`, "info");
  try {
    const novosRegistros = (await Promise.all(files.map(f => lerArquivoCSV(f)))).flat();
    mesclarNoBanco(novosRegistros);
    registros = bancoRegistros.slice();

    agregadosOrig = [];
    filtrados = [];
    registrosIntervalo = [];
    ultimoCnsIntervalo = new Set();
    novos = [];
    const divNovos = document.getElementById("listaNovos");
    if (divNovos) divNovos.innerHTML = "Nenhum intervalo aplicado ainda";
    const spanNovos = document.getElementById("novosTotal");
    if (spanNovos) spanNovos.innerText = "(0)";
    if (tabelaBody) tabelaBody.innerHTML = "";

    renderGrafico();
    atualizarStatusPill(csvStatus, `Banco atualizado: ${bancoRegistros.length} linhas`, "ok");
    exportarBanco();
    tentarAplicarIntervalo();
  } catch (err) {
    atualizarStatusPill(csvStatus, err.message || "Erro ao processar CSV", "erro");
  }
});

function parseCSV(txt) {
  const conteudo = txt.trim();
  if (!conteudo) throw new Error("Arquivo vazio ou inválido");

  const linhas = conteudo.split(/\r?\n/);
  if (!linhas.length) throw new Error("Arquivo vazio ou inválido");

  // detecta separador dominante: prioriza ";" se houver empate
  const primeira = linhas[0] || "";
  const sep = ((primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length)
    ? ";"
    : ",";

  const rawHeader = linhas.shift().split(sep);
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

  const faltantes = [];
  if (idx.cns < 0) faltantes.push("CNS");
  if (idx.nome < 0) faltantes.push("Nome do paciente");
  if (idx.data < 0) faltantes.push("Data de agendamento");
  if (idx.exame < 0) faltantes.push("Procedimento");
  if (faltantes.length) {
    throw new Error(`CSV inválido. Colunas ausentes: ${faltantes.join(", ")}`);
  }

  return linhas
    .filter(l => l.trim())
    .map(l => {
      const c = l.split(sep);
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

function findNomePacienteCol(header) {
  let i = header.findIndex(h => h === "nome");
  if (i >= 0) return i;
  i = header.findIndex(h => h === "nome_paciente");
  if (i >= 0) return i;
  return findCol(header, ["nome"]);
}

function findNascCol(header) {
  let i = header.findIndex(h => h === "dt_nascimento");
  if (i >= 0) return i;
  i = header.findIndex(h => h === "data_nascimento");
  if (i >= 0) return i;
  i = header.findIndex(h => h.includes("nasc"));
  return i;
}

function findCol(header, cand) {
  return header.findIndex(h => cand.some(name => h.includes(name)));
}

function normalizarNome(n) {
  return (n || "").toLowerCase().replace(/(?:^|\s)\S/g, m => m.toUpperCase());
}

function parseDataAgendamento(s) {
  if (!s) return null;
  const dt = parseNascimento(s); // aproveita todos os formatos já suportados
  if (!dt) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
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

function formatarNascimentoCurto(nascStr) {
  const dt = parseNascimento(nascStr);
  if (!dt) return "";
  const dia = String(dt.getDate()).padStart(2, "0");
  const mes = String(dt.getMonth() + 1).padStart(2, "0");
  const ano = String(dt.getFullYear()).slice(-2);
  return `${dia}/${mes}/${ano}`;
}

function formatarDataInterface(dataStr) {
  if (!dataStr) return "";
  const [ano, mes, dia] = dataStr.split("-");
  if (!ano || !mes || !dia) return dataStr;
  return `${dia}/${mes}/${ano}`;
}

function atualizarStatusPill(el, texto, estado = "info") {
  if (!el) return;
  el.textContent = texto;
  el.dataset.status = estado;
}

function lerArquivoCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const dados = parseCSV(e.target.result);
        resolve(dados);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsText(file, "UTF-8");
  });
}

function chaveRegistro(r) {
  return [r.cns || "", r.nome || "", r.nasc || "", r.data || "", r.exame || "", r.solicitacao || "", r.codUnificado || ""].join("|");
}

function mesclarNoBanco(novosRegistros) {
  const mapa = new Map();
  bancoRegistros.forEach(r => mapa.set(chaveRegistro(r), r));
  novosRegistros.forEach(r => {
    if (!r) return;
    const k = chaveRegistro(r);
    if (!mapa.has(k)) mapa.set(k, r);
  });

  const todos = Array.from(mapa.values());
  todos.sort((a, b) => {
    const da = parseDataAgendamento(a.data);
    const db = parseDataAgendamento(b.data);
    const va = da ? da.getTime() : Number.POSITIVE_INFINITY;
    const vb = db ? db.getTime() : Number.POSITIVE_INFINITY;
    if (va !== vb) return va - vb;
    return (a.data || "").localeCompare(b.data || "");
  });

  bancoRegistros = todos;
  localStorage.setItem(KEY_BANCO, JSON.stringify(bancoRegistros));
}

function exportarBanco() {
  if (!bancoRegistros.length) return;
  const header = ["cns", "nome", "nasc", "data", "exame", "solicitacao", "codUnificado"];
  const linhas = bancoRegistros.map(r => header.map(h => (r[h] || "").toString().replace(/;/g, ",")).join(";"));
  const csv = [header.join(";"), ...linhas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "SanApps_SUS.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function obterNomeParaRegistro(reg) {
  if (reg.cns && agregadosPorCns.has(reg.cns)) {
    return agregadosPorCns.get(reg.cns).nome;
  }
  const nomeBase = normalizarNome(reg.nome);
  const nasc = formatarNascimentoCurto(reg.nasc);
  return nasc ? `${nomeBase} ${nasc}` : nomeBase;
}

function ajustarNomesDuplicados(lista) {
  const grupos = new Map();
  lista.forEach(item => {
    if (!item.nomeBase) return;
    if (!grupos.has(item.nomeBase)) grupos.set(item.nomeBase, []);
    grupos.get(item.nomeBase).push(item);
  });

  grupos.forEach(grupo => {
    if (grupo.length <= 1) return;
    grupo.forEach(item => {
      const nascCurta = formatarNascimentoCurto(item.nasc);
      if (!nascCurta) return;
      const sufixoIdoso = item.idoso ? "*" : "";
      item.nome = `${item.nomeBase} ${nascCurta}${sufixoIdoso}`;
    });
  });
}

if (btnLimparHistorico) btnLimparHistorico.onclick = () => limparHistorico();

[dataInicioInput, dataFimInput].forEach(campo => {
  if (!campo) return;
  campo.addEventListener("change", () => tentarAplicarIntervalo());
});

graficoModoBotoes.forEach(btn => {
  btn.addEventListener("click", () => {
    graficoModo = btn.dataset.graficoModo || "todos";
    graficoModoBotoes.forEach(b => b.classList.toggle("ativo", b === btn));
    renderGrafico();
  });
});

if (graficoCanvas) {
  graficoCanvas.addEventListener("click", onGraficoClick);
}

function validarIntervaloSelecionado() {
  if (!dataInicioInput || !dataFimInput) {
    return { ok: false, mensagem: "Campos de data indisponíveis", estado: "erro" };
  }
  const iniStr = dataInicioInput.value;
  const fimStr = dataFimInput.value;
  if (!iniStr || !fimStr) {
    return { ok: false, mensagem: "Selecione as duas datas", estado: "muted" };
  }
  const inicio = new Date(`${iniStr}T00:00:00`);
  const fim = new Date(`${fimStr}T23:59:59`);
  if (isNaN(inicio) || isNaN(fim)) {
    return { ok: false, mensagem: "Datas inválidas", estado: "erro" };
  }
  if (inicio > fim) {
    return { ok: false, mensagem: "Data inicial maior que a final", estado: "erro" };
  }
  return { ok: true, iniStr, fimStr };
}

function tentarAplicarIntervalo() {
  if (!intervaloStatus) return false;
  const validacao = validarIntervaloSelecionado();
  if (!validacao.ok) {
    atualizarStatusPill(intervaloStatus, validacao.mensagem, validacao.estado);
    return false;
  }
  if (!registros.length) {
    atualizarStatusPill(intervaloStatus, "Carregue um CSV válido", "alert");
    return false;
  }
  atualizarStatusPill(intervaloStatus, "Aplicando intervalo...", "info");
  const sucesso = processar(validacao.iniStr, validacao.fimStr);
  if (sucesso) {
    const textoBase = registrosIntervalo.length
      ? `Intervalo aplicado (${formatarDataInterface(validacao.iniStr)} a ${formatarDataInterface(validacao.fimStr)})`
      : `Intervalo sem registros (${formatarDataInterface(validacao.iniStr)} a ${formatarDataInterface(validacao.fimStr)})`;
    atualizarStatusPill(intervaloStatus, textoBase, registrosIntervalo.length ? "ok" : "alert");
  } else {
    atualizarStatusPill(intervaloStatus, "Não foi possível aplicar o intervalo", "erro");
  }
  return sucesso;
}

function processar(iniOverride, fimOverride) {
  if (!registros.length) return false;
  const iniStr = iniOverride ?? (dataInicioInput ? dataInicioInput.value : "");
  const fimStr = fimOverride ?? (dataFimInput ? dataFimInput.value : "");
  if (!iniStr || !fimStr) return false;

  ultimaDataInicio = iniStr;
  ultimaDataFim = fimStr;

  const d1 = new Date(iniStr + "T00:00:00");
  const d2 = new Date(fimStr + "T23:59:59");

  const mapa = {};
  registrosIntervalo = [];
  const solicitacoesSet = new Set();

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
      if (r.solicitacao) {
        solicitacoesSet.add((r.solicitacao || "").trim());
      }
    }
  });

  totalSolicitacoes = solicitacoesSet.size;

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

  agregadosPorCns = new Map();
  agregadosOrig.forEach(item => {
    if (item.cns) agregadosPorCns.set(item.cns, item);
  });

  filtrados = agregadosOrig.slice();
  ajustarNomesDuplicados(agregadosOrig);
  detectarNovos();
  renderTabela();
  renderGrafico();
  atualizarArmazenamento();
  salvarHistorico();
  return true;
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
      (x.nome || "").toLowerCase().includes(q) ||
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

function mostrarNomesPorDia(diaLabel, nomes) {
  modalContent.innerHTML = "";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-header";

  const infoDiv = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = `Pacientes em ${diaLabel}`;
  const p = document.createElement("p");
  const plural = nomes.length === 1 ? "paciente" : "pacientes";
  p.textContent = `${nomes.length} ${plural}`;
  infoDiv.appendChild(h2);
  infoDiv.appendChild(p);

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

  const actions = document.createElement("div");
  actions.className = "nomes-dia-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copiar nomes do dia";
  copyBtn.onclick = () => copiarCampo(nomes.join("\n"), "Nomes do dia copiados");
  actions.appendChild(copyBtn);
  modalContent.appendChild(actions);

  const listDiv = document.createElement("div");
  listDiv.className = "nomes-dia-list";
  nomes.forEach(nome => {
    const item = document.createElement("div");
    item.className = "nomes-dia-item";
    item.textContent = nome;
    listDiv.appendChild(item);
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

function onGraficoClick(event) {
  if (!graficoBarras.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (y < 0 || y > event.currentTarget.height) return;
  const barra = graficoBarras.find(b => x >= b.x1 && x <= b.x2);
  if (!barra) return;
  const nomes = nomesPorDia[barra.label] || [];
  if (!nomes.length) {
    alert("Nenhum paciente registrado neste dia");
    return;
  }
  mostrarNomesPorDia(barra.label, nomes);
}

modal.onclick = () => fecharModal();
modalContent.addEventListener("click", e => e.stopPropagation());

function detectarNovos() {
  // novos em relação ao intervalo anterior
  const atualSet = new Set(
    filtrados.map(x => x.cns).filter(Boolean)
  );

  novos = filtrados.filter(x => x.cns && !ultimoCnsIntervalo.has(x.cns));

  ultimoCnsIntervalo = atualSet;

  const div = document.getElementById("listaNovos");
  if (div) {
    div.innerHTML = novos.length
      ? novos.map(x => x.nome).join("<br>")
      : "Nenhum novo nome neste intervalo";
  }
  const span = document.getElementById("novosTotal");
  if (span) span.innerText = `(${novos.length})`;
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
  const totalPacientes = agregadosOrig.length;
  const totalExames = agregadosOrig.reduce((s, x) => s + x.exames, 0);
  const reg = {
    inicio: ultimaDataInicio,
    fim: ultimaDataFim,
    totalPacientes,
    totalExames,
    totalSolicitacoes,
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
  let html = "<ul>";
  hist.slice().reverse().forEach(h => {
    const solicitacoesTxt = typeof h.totalSolicitacoes === "number"
      ? `, ${h.totalSolicitacoes} solicitações`
      : "";
    html += `<li>${h.inicio} até ${h.fim} - ${h.totalPacientes} pacientes, ${h.totalExames} exames${solicitacoesTxt}</li>`;
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

(function initBanco() {
  try {
    const salvo = localStorage.getItem(KEY_BANCO);
    if (salvo) {
      bancoRegistros = JSON.parse(salvo) || [];
    }
  } catch (_) {
    bancoRegistros = [];
  }
  registros = bancoRegistros.slice();
})();

function renderGrafico() {
  const canvas = document.getElementById("grafico");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth || 600;
  const h = canvas.height = canvas.clientHeight || 320;
  ctx.clearRect(0, 0, w, h);
  graficoBarras = [];
  nomesPorDia = {};
  if (!registrosIntervalo.length) return;

  const dias = {};
  const pacientesPorDia = {};
  const nomesPorDiaTemp = {};
  registrosIntervalo.forEach(r => {
    const d = r.data || "";
    dias[d] = (dias[d] || 0) + 1;
    if (!pacientesPorDia[d]) pacientesPorDia[d] = new Set();
    const key = r.cns || `${r.nome || ""}|${r.nasc || ""}`;
    pacientesPorDia[d].add(key);
    if (!nomesPorDiaTemp[d]) nomesPorDiaTemp[d] = new Set();
    nomesPorDiaTemp[d].add(obterNomeParaRegistro(r));
  });

  const labels = Object.keys(dias);
  if (!labels.length) return;

  labels.forEach(label => {
    const nomesSet = nomesPorDiaTemp[label];
    nomesPorDia[label] = nomesSet
      ? Array.from(nomesSet).sort((a, b) => a.localeCompare(b, "pt-BR"))
      : [];
  });

  const examesValores = labels.map(d => dias[d]);
  const pacientesValores = labels.map(d => (pacientesPorDia[d] ? pacientesPorDia[d].size : 0));

  const datasets = [];
  const modo = graficoModo || "todos";
  if (modo === "todos" || modo === "exames") {
    datasets.push({ valores: examesValores, cor: "#005dff", texto: "exames" });
  }
  if (modo === "todos" || modo === "pacientes") {
    datasets.push({ valores: pacientesValores, cor: "#01b574", texto: "pacientes" });
  }
  if (!datasets.length) return;

  const todosValores = datasets.reduce((acc, ds) => acc.concat(ds.valores), []);
  const max = Math.max(...todosValores, 1);
  const barWidth = w / Math.max(labels.length, 1);
  const multiDataset = datasets.length > 1;
  const offset = multiDataset ? barWidth * 0.3 : 0;
  const larguraBarra = multiDataset ? barWidth * 0.25 : barWidth * 0.45;
  const areaUtil = h - 70;

  ctx.font = "11px Inter, Arial";
  ctx.textAlign = "center";

  datasets.forEach((ds, dsIndex) => {
    ds.valores.forEach((v, i) => {
      const baseX = i * barWidth + barWidth / 2;
      const x = multiDataset
        ? baseX + (dsIndex - (datasets.length - 1) / 2) * offset
        : baseX;
      const barH = max ? (v / max) * areaUtil : 0;
      const y = h - 30 - barH;

      ctx.fillStyle = ds.cor;
      ctx.fillRect(x - larguraBarra / 2, y, larguraBarra, barH);

      ctx.fillStyle = "#0f172a";
      ctx.textBaseline = "middle";
      let textoY = y - 12;
      if (textoY < 12) textoY = y + 12;
      ctx.fillText(`${v} ${ds.texto}`, x, textoY);
    });
  });

  ctx.fillStyle = "#475569";
  ctx.textBaseline = "alphabetic";
  labels.forEach((label, i) => {
    const baseX = i * barWidth + barWidth / 2;
    ctx.fillText(label, baseX, h - 8);
  });

  graficoBarras = labels.map((label, i) => ({
    label,
    x1: i * barWidth,
    x2: (i + 1) * barWidth
  }));
}
