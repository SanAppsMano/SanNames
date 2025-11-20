// app.js

let registros = [];
let registrosIntervalo = [];
let agregadosAtual = [];
let chartInstance = null;

const STORAGE_PACIENTES = "sanapps_sus_pacientes_vistos_v2";
const STORAGE_HISTORICO = "sanapps_sus_intervalos_v2";

function $(id) {
  return document.getElementById(id);
}

// --------- PARSE / FORMAT ---------

function parseDataCsv(str) {
  if (!str) return null;
  str = String(str).trim();
  if (!str) return null;
  // aceita 03.11.2025, 03/11/2025, 2025-11-03
  str = str.replace(/\./g, "/").replace(/-/g, "/");
  const p = str.split("/");
  if (p.length === 3) {
    let [d, m, a] = p.map(v => parseInt(v, 10));
    if (isNaN(d) || isNaN(m) || isNaN(a)) return null;
    if (a < 100) a = a >= 50 ? 1900 + a : 2000 + a;
    return new Date(a, m - 1, d);
  }
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDate(dt, short = false) {
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  let a = dt.getFullYear();
  if (short) a = String(a).slice(-2);
  return `${d}/${m}/${a}`;
}

function calcIdade(nasc, ref) {
  if (!nasc || !ref) return null;
  let idade = ref.getFullYear() - nasc.getFullYear();
  const m = ref.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < nasc.getDate())) idade--;
  return idade;
}

function normalizarNome(nome) {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --------- CSV ---------

function parseCSV(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return [];

  const cab = linhas[0].split(";");
  const idx = {
    cns: cab.indexOf("cns"),
    nome: cab.indexOf("nome"),
    nasc: cab.indexOf("dt_nascimento"),
    ag: cab.indexOf("data_agendamento"),
    desc: cab.indexOf("descricao_procedimento"),
    solicitacao: cab.indexOf("solicitacao"),
    codUnif: cab.indexOf("codigo_unificado")
  };

  if (idx.cns < 0 || idx.nome < 0 || idx.nasc < 0 || idx.ag < 0 || idx.desc < 0) {
    alert("Colunas obrigatórias não encontradas no CSV.");
    return [];
  }

  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.trim()) continue;
    const cols = l.split(";");
    const cns = (cols[idx.cns] || "").trim();
    const nome = (cols[idx.nome] || "").trim();
    const nasc = (cols[idx.nasc] || "").trim();
    const ag = (cols[idx.ag] || "").trim();
    const desc = (cols[idx.desc] || "").trim();
    if (!cns || !nome || !nasc || !ag) continue;
    out.push({
      cns,
      nome,
      dt_nascimento: nasc,
      data_agendamento: ag,
      descricao_procedimento: desc,
      solicitacao: idx.solicitacao >= 0 ? (cols[idx.solicitacao] || "").trim() : "",
      codigo_unificado: idx.codUnif >= 0 ? (cols[idx.codUnif] || "").trim() : ""
    });
  }
  return out;
}

// --------- LOCALSTORAGE ---------

function carregarPacientesVistos() {
  try {
    const raw = localStorage.getItem(STORAGE_PACIENTES);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function salvarPacientesVistos(set) {
  try {
    localStorage.setItem(STORAGE_PACIENTES, JSON.stringify(Array.from(set)));
  } catch {}
}

function carregarHistorico() {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORICO);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function salvarHistorico(arr) {
  try {
    localStorage.setItem(STORAGE_HISTORICO, JSON.stringify(arr));
  } catch {}
}

// --------- UI AUX ---------

function atualizarStatusArquivo(msg) {
  const el = $("armazenamentoInfo");
  if (el) el.textContent = msg;
}

function atualizarHistoricoUI() {
  const ul = $("listaHistorico");
  if (!ul) return;
  const hist = carregarHistorico();
  if (!hist.length) {
    ul.innerHTML = "<li>Nenhum intervalo registrado ainda.</li>";
    return;
  }
  ul.innerHTML = hist
    .map(
      h =>
        `<li>${h.de} até ${h.ate} — ${h.pacientes} pacientes únicos • ${h.exames} exames</li>`
    )
    .join("");
}

// --------- PROCESSAMENTO PRINCIPAL ---------

function processar() {
  if (!registros.length) {
    alert("Carregue primeiro um arquivo CSV.");
    return;
  }

  const inpIni = $("dataInicio");
  const inpFim = $("dataFim");
  const vIni = inpIni ? inpIni.value : "";
  const vFim = inpFim ? inpFim.value : "";

  if (!vIni || !vFim) {
    alert("Selecione o intervalo de datas.");
    return;
  }

  const dIni = new Date(vIni + "T00:00:00");
  const dFim = new Date(vFim + "T23:59:59");
  if (isNaN(dIni) || isNaN(dFim) || dFim < dIni) {
    alert("Intervalo de datas inválido.");
    return;
  }

  // filtra registros do intervalo
  registrosIntervalo = [];
  const mapa = {};
  const contagemPorDia = {};
  let totalExames = 0;

  for (const r of registros) {
    const dtAg = parseDataCsv(r.data_agendamento);
    if (!dtAg) continue;
    if (dtAg < dIni || dtAg > dFim) continue;

    registrosIntervalo.push(r);

    const chavePac = `${r.cns}|${r.dt_nascimento}`;
    if (!mapa[chavePac]) {
      mapa[chavePac] = {
        cns: r.cns,
        nome: r.nome,
        dt_nascimento: r.dt_nascimento,
        exames: 0,
        dias: new Set()
      };
    }
    mapa[chavePac].exames++;
    mapa[chavePac].dias.add(r.data_agendamento);
    totalExames++;

    const chDia = formatDate(dtAg, false);
    contagemPorDia[chDia] = (contagemPorDia[chDia] || 0) + 1;
  }

  // homônimos (mesmo nome com CNS diferente)
  const mapaHom = {};
  Object.values(mapa).forEach(p => {
    const keyNome = normalizarNome(p.nome);
    if (!mapaHom[keyNome]) mapaHom[keyNome] = new Set();
    mapaHom[keyNome].add(p.cns);
  });

  const hojeRef = new Date();
  const agregados = Object.values(mapa).map(p => {
    const dtNasc = parseDataCsv(p.dt_nascimento);
    const idade = dtNasc ? calcIdade(dtNasc, hojeRef) : null;
    const idoso = idade !== null && idade >= 60;

    const temHomOnimo = mapaHom[normalizarNome(p.nome)]?.size > 1;
    let sufixo = "";
    if (temHomOnimo && dtNasc) {
      sufixo += " " + formatDate(dtNasc, true); // dd/mm/aa
    }
    if (idoso) sufixo += "*";

    const nomeExibicao = p.nome + sufixo;

    return {
      ...p,
      idade,
      idoso,
      nomeExibicao,
      diasCount: p.dias.size
    };
  });

  agregados.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  agregadosAtual = agregados;

  atualizarTabela(agregados);
  atualizarNovosNomes(agregados);
  atualizarGrafico(contagemPorDia, totalExames);
  registrarHistorico(vIni, vFim, agregados.length, totalExames);
}

function atualizarTabela(agregados) {
  const tabela = $("tabelaPacientes");
  if (!tabela) return;
  const tbody = tabela.tBodies[0] || tabela.createTBody();
  const termo = normalizarNome($("pesquisa")?.value || "");

  const linhas = [];
  for (const p of agregados) {
    const nomeNorm = normalizarNome(p.nomeExibicao);
    const cnsNorm = normalizarNome(p.cns);
    if (termo && !nomeNorm.includes(termo) && !cnsNorm.includes(termo)) continue;

    const dtNasc = parseDataCsv(p.dt_nascimento);
    const nascFmt = dtNasc ? formatDate(dtNasc, false) : p.dt_nascimento;

    const idadeStr = p.idade != null ? ` (${p.idade} anos)` : "";
    const nomeMostrar = p.nomeExibicao + idadeStr;

    linhas.push(
      `<tr data-cns="${p.cns}">
        <td>${p.cns}</td>
        <td>${nomeMostrar}</td>
        <td>${nascFmt}</td>
        <td class="td-exames" data-role="exames" style="cursor:pointer;text-align:right;font-weight:600;color:#1d4ed8">
          ${p.exames}
        </td>
      </tr>`
    );
  }

  tbody.innerHTML = linhas.length
    ? linhas.join("")
    : `<tr><td colspan="4">Nenhum paciente neste intervalo.</td></tr>`;
}

function atualizarNovosNomes(agregados) {
  const divLista = $("listaNovos");
  const btnCopiar = $("btnCopiarNovos");
  const tituloCard = document.querySelector('[data-card="novos-nomes-titulo"]'); // opcional

  if (!divLista) return;

  const vistos = carregarPacientesVistos();
  const chaveIntervalo = new Set();
  const novos = [];

  for (const p of agregados) {
    const dtNasc = parseDataCsv(p.dt_nascimento);
    const nascKey = dtNasc ? formatDate(dtNasc, false) : p.dt_nascimento;
    const chave = `${normalizarNome(p.nome)}|${nascKey}`;
    chaveIntervalo.add(chave);
    if (!vistos.has(chave)) {
      vistos.add(chave);
      novos.push(p);
    }
  }

  salvarPacientesVistos(vistos);

  const totalNovos = novos.length;
  if (tituloCard) {
    tituloCard.textContent = `Novos nomes neste intervalo (${totalNovos})`;
  }

  if (!totalNovos) {
    divLista.innerHTML = `<p>Nenhum novo nome neste intervalo</p>`;
  } else {
    divLista.innerHTML =
      "<ul>" +
      novos
        .map(p => {
          const dtNasc = parseDataCsv(p.dt_nascimento);
          const nascFmt = dtNasc ? formatDate(dtNasc, false) : p.dt_nascimento;
          return `<li>${p.nomeExibicao} — CNS ${p.cns} — Nasc. ${nascFmt}</li>`;
        })
        .join("") +
      "</ul>";
  }

  if (btnCopiar) {
    btnCopiar.disabled = !totalNovos;
    btnCopiar.onclick = () => {
      if (!totalNovos) return;
      const texto = novos
        .map(p => {
          const dtNasc = parseDataCsv(p.dt_nascimento);
          const nascFmt = dtNasc ? formatDate(dtNasc, false) : p.dt_nascimento;
          return `${p.nomeExibicao};${p.cns};${nascFmt}`;
        })
        .join("\n");
      navigator.clipboard
        .writeText(texto)
        .then(() => alert("Novos nomes copiados para a área de transferência."))
        .catch(() => alert("Não foi possível copiar para a área de transferência."));
    };
  }
}

function atualizarGrafico(contagemPorDia, totalExames) {
  const canvas = $("grafico");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = Object.keys(contagemPorDia).sort((a, b) => {
    const [da, ma, aa] = a.split("/").map(Number);
    const [db, mb, ab] = b.split("/").map(Number);
    return new Date(aa, ma - 1, da) - new Date(ab, mb - 1, db);
  });
  const valores = labels.map(l => contagemPorDia[l]);

  if (chartInstance) chartInstance.destroy();

  const ctx = canvas.getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Exames",
          data: valores
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Exames: ${ctx.raw}`
          }
        },
        datalabels: {
          display: true,
          color: "#111827",
          anchor: "end",
          align: "end",
          formatter: v => v
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function registrarHistorico(vIni, vFim, totalPac, totalExames) {
  const hist = carregarHistorico();
  hist.push({
    de: vIni.split("-").reverse().join("/"),
    ate: vFim.split("-").reverse().join("/"),
    pacientes: totalPac,
    exames: totalExames
  });
  salvarHistorico(hist);
  atualizarHistoricoUI();
}

// --------- MODAL EXAMES ---------

function abrirModalExames(cns, linhaTr) {
  const modal = $("modalExames");
  const titulo = $("modalTitulo");
  const resumo = $("modalResumo");
  const lista = $("listaExames");
  if (!modal || !titulo || !lista) return;

  const regPac = registrosIntervalo.filter(r => r.cns === cns);
  if (!regPac.length) return;

  if (linhaTr) {
    document
      .querySelectorAll("#tabelaPacientes tbody tr")
      .forEach(tr => tr.classList.remove("linha-selecionada"));
    linhaTr.classList.add("linha-selecionada");
  }

  const nome = regPac[0].nome;
  titulo.textContent = `${nome} — CNS ${cns}`;
  const dias = new Set(regPac.map(r => r.data_agendamento));
  resumo.textContent = `${regPac.length} exame(s) em ${dias.size} dia(s) de agendamento`;

  lista.innerHTML = regPac
    .map(r => {
      const desc = r.descricao_procedimento || "";
      const soli = r.solicitacao || "";
      const cod = r.codigo_unificado || "";
      return `
        <div class="exam-row">
          <div class="exam-info">
            <div class="exam-desc">${desc}</div>
            <div class="exam-meta">
              Agendamento: ${r.data_agendamento}
            </div>
          </div>
          <div class="exam-actions">
            ${soli ? `<button class="chip" data-copy="${soli}">Solicitação</button>` : ""}
            ${cod ? `<button class="chip" data-copy="${cod}">Cód. unificado</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  lista.onclick = ev => {
    const btn = ev.target.closest("[data-copy]");
    if (!btn) return;
    const txt = btn.getAttribute("data-copy");
    navigator.clipboard
      .writeText(txt)
      .then(() => {
        btn.textContent = "Copiado!";
        setTimeout(() => (btn.textContent = btn.textContent.includes("Solicitação") ? "Solicitação" : "Cód. unificado"), 1000);
      })
      .catch(() => alert("Falha ao copiar para a área de transferência."));
  };

  modal.style.display = "flex";
}

function fecharModal() {
  const modal = $("modalExames");
  if (!modal) return;
  modal.style.display = "none";
  document
    .querySelectorAll("#tabelaPacientes tbody tr")
    .forEach(tr => tr.classList.remove("linha-selecionada"));
}

// --------- INICIALIZAÇÃO ---------

document.addEventListener("DOMContentLoaded", () => {
  const inputFile = $("csvFile");
  if (inputFile) {
    inputFile.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) {
        atualizarStatusArquivo("Nenhum arquivo carregado.");
        registros = [];
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        const txt = ev.target.result;
        registros = parseCSV(txt);
        atualizarStatusArquivo(
          registros.length
            ? `Arquivo carregado com ${registros.length} linhas válidas.`
            : "Arquivo carregado, mas nenhuma linha válida foi encontrada."
        );
      };
      reader.readAsText(file, "utf-8");
    });
  }

  const btnAplicar = $("btnAplicar");
  if (btnAplicar) btnAplicar.addEventListener("click", () => processar());

  const pesquisa = $("pesquisa");
  if (pesquisa) {
    pesquisa.addEventListener("input", () => atualizarTabela(agregadosAtual || []));
  }

  const btnLimparHist = $("btnLimparHistorico");
  if (btnLimparHist) {
    btnLimparHist.addEventListener("click", () => {
      if (!confirm("Deseja limpar o histórico de intervalos?")) return;
      salvarHistorico([]);
      atualizarHistoricoUI();
    });
  }

  const tabela = $("tabelaPacientes");
  if (tabela) {
    tabela.addEventListener("click", ev => {
      const td = ev.target.closest("td");
      if (!td || td.getAttribute("data-role") !== "exames") return;
      const tr = td.closest("tr");
      const cns = tr.getAttribute("data-cns");
      if (!cns) return;
      abrirModalExames(cns, tr);
    });
  }

  const btnFechar = $("modalFechar");
  if (btnFechar) btnFechar.addEventListener("click", fecharModal);
  const modal = $("modalExames");
  if (modal) {
    modal.addEventListener("click", ev => {
      if (ev.target === modal) fecharModal();
    });
  }

  atualizarHistoricoUI();
  atualizarStatusArquivo("Nenhum arquivo carregado.");
});
