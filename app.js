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

csvFile.addEventListener("change", () => {
  const f = csvFile.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    registros = parseCSV(e.target.result);
    alert("CSV carregado!");
  };
  r.readAsText(f, "UTF-8");
});

function parseCSV(txt) {
  const linhas = txt.trim().split(/\r?\n/);
  if (!linhas.length) return [];
  const header = linhas.shift().split(";");
  const idx = {
    cns: header.indexOf("cns"),
    nome: header.indexOf("nome"),
    nasc: header.indexOf("dt_nascimento"),
    data: header.indexOf("data_agendamento"),
    exame: header.indexOf("descricao_procedimento")
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

function normalizarNome(n) {
  return (n || "").toLowerCase().replace(/(?:^|\s)\S/g, m => m.toUpperCase());
}

function parseDataAgendamento(s) {
  if (!s) return null;
  const partes = s.split(".");
  if (partes.length !== 3) return null;
  const [dd, mm, yyyy] = partes;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

btnAplicar.onclick = () => processar();

function processar() {
  if (!registros.length) {
    alert("Carregue um CSV primeiro.");
    return;
  }
  const iniStr = document.getElementById("dataInicio").value;
  const fimStr = document.getElementById("dataFim").value;
  if (!iniStr || !fimStr) {
    alert("Selecione o intervalo de datas.");
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

  agregadosOrig = Object.values(mapa).map(x => {
    return {
      cns: x.cns,
      nome: normalizarNome(x.nome),
      nasc: x.nasc,
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
}

function renderTabela() {
  tabelaBody.innerHTML = "";
  filtrados.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.cns}</td><td>${r.nome}</td><td>${r.nasc}</td><td>${r.exames}</td><td>${r.presencas}</td>`;
    tr.onclick = () => mostrarExames(r.cns);
    tabelaBody.appendChild(tr);
  });
}

campoPesquisa.oninput = () => {
  const q = campoPesquisa.value.toLowerCase().trim();
  if (!q) {
    filtrados = agregadosOrig.slice();
  } else {
    filtrados = agregadosOrig.filter(x =>
      x.nome.toLowerCase().includes(q) || (x.cns || "").includes(q)
    );
  }
  renderTabela();
};

const ths = document.querySelectorAll("#tabelaPacientes th");
ths.forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    filtrados.sort((a, b) => {
      const va = a[col] || "";
      const vb = b[col] || "";
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb), "pt-BR");
    });
    renderTabela();
  });
});

function mostrarExames(cns) {
  const lista = registrosIntervalo.length
    ? registrosIntervalo.filter(x => x.cns === cns)
    : registros.filter(x => x.cns === cns);
  let html = `<h2>Exames</h2>`;
  lista.forEach(x => {
    html += `<p><b>${x.exame}</b> — ${x.data}</p>`;
  });
  modalContent.innerHTML = html;
  modal.style.display = "flex";
}

modal.onclick = () => {
  modal.style.display = "none";
};

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
    alert("Não há novos nomes.");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      alert("Novos nomes copiados.");
    }).catch(() => {
      alert("Não foi possível copiar automaticamente.");
    });
  } else {
    alert("Clipboard não suportado neste navegador.");
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
  document.getElementById("armazenamentoInfo").innerText = `Uso estimado do localStorage: ${pct}%`;
}

function renderGrafico() {
  const canvas = document.getElementById("grafico");
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
