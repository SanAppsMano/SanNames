let registros = [];
let agregadosOrig = [];
let filtrados = [];
let novos = [];
let registrosIntervalo = [];
let ultimaDataInicio = null;
let ultimaDataFim = null;

const csvFile = document.getElementById("csvFile");
const btnAplicar = document.getElementById("btnAplicar");
const campoPesquisa = document.getElementById("pesquisa");
const tabelaBody = document.querySelector("#tabelaPacientes tbody");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const btnCopiarNovos = document.getElementById("btnCopiarNovos");

// leitura do CSV com mapeamento por nome de coluna (case insensitive)
csvFile.addEventListener("change", () => {
  const f = csvFile.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    registros = parseCSV(e.target.result);
    alert("CSV carregado");
  };
  r.readAsText(f, "UTF-8");
});

function parseCSV(txt) {
  const linhas = txt.trim().split(/\r?\n/);
  if (!linhas.length) return [];
  const rawHeader = linhas.shift().split(";");
  const header = rawHeader.map(h => h.trim().toLowerCase());

  const idx = {
    cns: findCol(header, ["cns"]),
    nome: findCol(header, ["nome"]),
    nasc: findCol(header, ["dt_nascimento", "data_nascimento"]),
    data: findCol(header, ["data_agendamento", "dt_agendamento", "agendamento"]),
    exame: findCol(header, ["descricao_procedimento", "procedimento"])
  };

  return linhas.map(l => {
    const c = l.split(";");
    return {
      cns: c[idx.cns] || "",
      nome: c[idx.nome] || "",
      nasc: c[idx.nasc] || "",
      data: c[idx.data] || "",
      exame: c[idx.exame] || ""
    };
  });
}

function findCol(header, cand) {
  return header.findIndex(h => cand.some(name => h.includes(name)));
}

function normalizarNome(n) {
  return (n || "").toLowerCase().replace(/(?:^|\s)\S/g, m => m.toUpperCase());
}

// data_agendamento no formato dd.mm.aaaa
function parseDataAgendamento(s) {
  if (!s) return null;
  const partes = s.split(".");
  if (partes.length !== 3) return null;
  const [dd, mm, yyyy] = partes;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

// nascimento no formato dd/mm/aaaa ou dd/mm/aa
function calcularIdade(nascStr, hoje = new Date()) {
  if (!nascStr) return null;
  const partes = nascStr.split("/");
  if (partes.length !== 3) return null;
  let [dd, mm, aa] = partes;
  let year = parseInt(aa, 10);
  if (isNaN(year)) return null;
  if (year < 100) {
    year = year >= 30 ? 1900 + year : 2000 + year;
  }
  const month = parseInt(mm, 10) - 1;
  const day = parseInt(dd, 10);
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;

  let idade = hoje.getFullYear() - year;
  const mDiff = hoje.getMonth() - month;
  if (mDiff < 0 || (mDiff === 0 && hoje.getDate() < day)) {
    idade--;
  }
  return idade;
}

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

// tabela
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
    tr.onclick = () => mostrarExames(r.cns);
    tabelaBody.appendChild(tr);
  });
}

// pesquisa
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

// ordenação
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

// modal de exames
function mostrarExames(cns) {
  const lista = registrosIntervalo.length
    ? registrosIntervalo.filter(x => x.cns === cns)
    : registros.filter(x => x.cns === cns);

  const paciente = agregadosOrig.find(x => x.cns === cns);
  let header = "";
  if (paciente) {
    header =
      `<h2>${paciente.nome}</h2>` +
      `<p>CNS: ${paciente.cns}</p>` +
      `<p>Nascimento: ${paciente.nasc} | Idade: ${paciente.idade || "?"}</p>` +
      `<hr>`;
  }

  let html = header + "<h3>Exames no intervalo</h3>";
  lista.forEach(x => {
    html += `<p><b>${x.exame}</b> - ${x.data}</p>`;
  });

  modalContent.innerHTML = html;
  modal.style.display = "flex";
}

modal.onclick = () => {
  modal.style.display = "none";
};

// novos registros
function detectarNovos() {
  let last = [];
  try {
    last = JSON.parse(localStorage.getItem("ultimaLista") || "[]");
  } catch (_) {
    last = [];
  }
  const antigos = new Set(last.map(x => x.cns));
  novos = filtrados.filter(x => !antigos.has(x.cns));
  localStorage.setItem("ultimaLista", JSON.stringify(filtrados));
  const div = document.getElementById("listaNovos");
  div.innerHTML = novos.map(x => x.nome).join("<br>");
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

// armazenamento
function atualizarArmazenamento() {
  let usado = 0;
  try {
    usado = JSON.stringify(localStorage).length;
  } catch (_) {
    usado = 0;
  }
  const max = 5 * 1024 * 1024;
  const pct = ((usado / max) * 100).toFixed(1);
  document.getElementById("armazenamentoInfo").innerText =
    `Uso estimado do localStorage: ${pct}%`;
}

// histórico de intervalos
function salvarHistorico() {
  const key = "historicoIntervalosSanNames";
  let hist;
  try {
    hist = JSON.parse(localStorage.getItem(key) || "[]");
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
    localStorage.setItem(key, JSON.stringify(hist));
  }
  renderHistorico(hist);
}

function renderHistorico(hist) {
  const div = document.getElementById("historico");
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

// carregar histórico na abertura
(function initHistorico() {
  const key = "historicoIntervalosSanNames";
  let hist;
  try {
    hist = JSON.parse(localStorage.getItem(key) || "[]");
  } catch (_) {
    hist = [];
  }
  renderHistorico(hist);
})();
