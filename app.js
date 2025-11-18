// ============================================
// app.js (versão completa atualizada - data no formato Brasil)
// ============================================

// Endpoints das Netlify Functions (mesmo domínio -> sem CORS)
const GROQ_FUNCTION   = '/.netlify/functions/groq-proxy';
const SHEET_FUNCTION  = '/.netlify/functions/sheet-insert';

const fileInput      = document.getElementById('file-input');
const processBtn     = document.getElementById('process-btn');
const extractBtn     = document.getElementById('extract-btn');
const retrySelect    = document.getElementById('retry-count');
const jobTitleFld    = document.getElementById('job-title');
const jobDescFld     = document.getElementById('job-desc');
const outputDiv      = document.getElementById('output');
const usageDiv       = document.getElementById('usage-info');
const loaderSpan     = document.getElementById('loader');
const extractLoader  = document.getElementById('extract-loader');
const chartContainer = document.getElementById('chart-container');
const chartCtx       = document.getElementById('scoreChart').getContext('2d');

const DAILY_TOKEN_LIMIT = 100000;
const STORAGE_KEY       = 'dailyTokenUsage';
let latestRequestTokens = 0;

let chartLabels   = [];
let chartData     = [];
let chartInstance = null;

// Habilita/desabilita botões conforme seleção de arquivos
function checkFormValidity() {
  const hasCVs = fileInput.files.length > 0;
  processBtn.disabled = !hasCVs;
  extractBtn.disabled = !hasCVs;
}

fileInput.addEventListener('change', () => {
  outputDiv.textContent = '';
  chartLabels = [];
  chartData   = [];
  latestRequestTokens = 0;
  chartContainer.style.display = 'none';
  if (chartInstance) {
    chartInstance.destroy();
  }
  document.querySelectorAll('.file-summary').forEach(el => el.remove());
  updateDailyUsageDisplay();
  checkFormValidity();
});
jobTitleFld.addEventListener('input', checkFormValidity);
jobDescFld.addEventListener('input', checkFormValidity);

// Configurar PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js';

// Extrai texto do PDF
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n\n';
  }
  return fullText;
}

// Gera resumo em Markdown usando proxy via Netlify Function
async function resumeCV(cvText) {
  const promptMessages = [
    {
      role: 'system',
      content: 'Você é um assistente que resume currículos em Markdown seguindo rigorosamente o formato especificado.'
    },
    {
      role: 'user',
      content:
`**Solicitação de Resumo de Currículo em Markdown:**

# Currículo do candidato para resumir:

${cvText}

Por favor, gere um resumo do currículo fornecido, formatado em Markdown, seguindo rigorosamente o modelo abaixo. **Não adicione seções extras, tabelas ou qualquer outro tipo de formatação diferente da especificada.** Preencha cada seção com as informações relevantes, garantindo que o resumo seja preciso e focado.

**Formato de Output Esperado:**
\`\`\`markdown
## Nome Completo
nome_completo aqui

## Experiência
experiencia aqui

## Habilidades 
habilidades aqui

## Educação 
educacao aqui

## Idiomas 
idiomas aqui
\`\`\`
`
    }
  ];

  const response = await fetch(GROQ_FUNCTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptMessages: promptMessages,
      max_tokens: 512,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`Erro proxy Groq: ${response.status} – ${await response.text()}`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(`Groq retornou erro: ${json.error}`);
  }

  const content = json.choices && json.choices[0] && json.choices[0].message.content;
  const totalTokensUsed = json.usage ? json.usage.total_tokens : 0;
  latestRequestTokens = totalTokensUsed;

  let result = content;
  if (content.includes('```markdown')) {
    result = content.split('```markdown')[1].trim();
    if (result.endsWith('```')) {
      result = result.slice(0, -3).trim();
    }
  }
  return { markdown: result, tokens: totalTokensUsed };
}

// Extrai seções do Markdown
function parseMarkdownSections(markdown) {
  const sections = {
    'Nome Completo': '',
    'Experiência': '',
    'Habilidades': '',
    'Educação': '',
    'Idiomas': ''
  };
  const lines = markdown.split('\n');
  let currentKey = null;
  for (let line of lines) {
    const headerMatch = line.match(/^##\s+(.*)$/);
    if (headerMatch) {
      const key = headerMatch[1].trim();
      if (sections.hasOwnProperty(key)) {
        currentKey = key;
        continue;
      } else {
        currentKey = null;
        continue;
      }
    }
    if (currentKey) {
      sections[currentKey] += (sections[currentKey] ? '\n' : '') + line.trim();
    }
  }
  for (let k in sections) {
    if (!sections[k]) sections[k] = '';
  }
  return sections;
}

// Extrai nome do candidato
function extractCandidateName(markdown) {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase().startsWith('## nome completo')) {
      if (i + 1 < lines.length) {
        return lines[i + 1].trim();
      }
    }
  }
  return null;
}

// Delay
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Gera nota em uma tentativa (proxy via Netlify Function)
async function generateScore(cvText, jobTitle, jobDesc) {
  const promptMessages = [
    {
      role: 'system',
      content: 'Você é um assistente que avalia currículos e retorna “Nota: X/10” em uma escala de 0 a 10, formatando a análise com títulos grandes.'
    },
    {
      role: 'user',
      content:
`**SOLICITAÇÃO DE ANÁLISE CRÍTICA (TÍTULOS GRANDES):**

Você deve devolver essa análise crítica formatada como se fosse um **RELATÓRIO ANALÍTICO** do currículo em relação à vaga, com títulos grandes em destaque.  
No final, inclua apenas:  
\`\`\`
Nota: X/10
\`\`\`

**Vaga:**  
Título: ${jobTitle}  
Descrição:  
${jobDesc}

**Instruções para Avaliação:**  
1. **EXPERIÊNCIA (PESO: 30%)**: Avalie a relevância da experiência.  
2. **HABILIDADES TÉCNICAS (PESO: 25%)**: Verifique alinhamento com requisitos.  
3. **EDUCAÇÃO (PESO: 10%)**: Avalie relevância da formação.  
4. **IDIOMAS (PESO: 10%)**: Avalie proficiência de idiomas.  
5. **PONTOS FORTES (PESO: 15%)**: Avalie relevância de pontos fortes.  
6. **PONTOS FRACOS (DESCONTO ATÉ 10%)**: Avalie impacto dos pontos fracos.  

**Currículo do Candidato:**  
${cvText}`    }
  ];

  const response = await fetch(GROQ_FUNCTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptMessages: promptMessages,
      max_tokens: 512,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`Erro proxy Groq: ${response.status} – ${await response.text()}`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(`Groq retornou erro: ${json.error}`);
  }

  const content = json.choices && json.choices[0] && json.choices[0].message.content;
  const totalTokensUsed = json.usage ? json.usage.total_tokens : 0;
  latestRequestTokens = totalTokensUsed;

  const match = content.match(/Nota[:\s]*([\d]+)\/10/i);
  let score = null;
  if (match) {
    score = parseFloat(match[1]);
  }
  return { score, tokens: totalTokensUsed, raw: content };
}

// Gera nota com tentativas múltiplas
async function generateScoreWithRetries(cvText, jobTitle, jobDesc, progressBar, maxRetries) {
  let score = null;
  let rawContent = '';
  let usedTokensTotal = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { score: sc, tokens: t, raw } = await generateScore(cvText, jobTitle, jobDesc);
    usedTokensTotal += t;
    if (sc !== null) {
      score = sc;
      rawContent = raw;
      break;
    }
    rawContent = raw;
    if (attempt < maxRetries) {
      progressBar.style.width = '0%';
      progressBar.getBoundingClientRect();
      progressBar.style.transition = 'width 15s linear';
      progressBar.style.width = '100%';
      await wait(15000);
      progressBar.style.transition = '';
      progressBar.style.width = '0%';
    }
  }
  return { score, tokens: usedTokensTotal, raw: rawContent };
}

// Chama a API Groq alternando chaves
async function callGroqAPI(promptMessages) {
  let lastError = null;
  for (const apiKey of API_KEYS) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: promptMessages,
          max_tokens: 512,
          temperature: 0.2
        })
      });
      if (response.status === 429) {
        lastError = await response.json();
        continue;
      }
      if (!response.ok) {
        const erro = await response.text();
        throw new Error(`Erro na API: ${response.status} – ${erro}`);
      }
      const json = await response.json();
      const content = json.choices && json.choices[0] && json.choices[0].message.content;
      const totalTokensUsed = json.usage ? json.usage.total_tokens : 0;
      return { content, totalTokensUsed };
    } catch (e) {
      lastError = e;
      if (!(e.message && e.message.includes('429'))) {
        throw e;
      }
    }
  }
  throw new Error(`Todas as chaves bateram no rate limit ou ocorreram erros: ${JSON.stringify(lastError)}`);
}

// Retorna YYYY-MM-DD
function getTodayKey() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Atualiza uso diário
function updateDailyUsage(tokensUsedNow) {
  const key = getTodayKey();
  let usageMap = {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      usageMap = JSON.parse(raw);
    } catch {
      usageMap = {};
    }
  }
  const usadoHoje = (usageMap[key] || 0) + tokensUsedNow;
  usageMap[key] = usadoHoje;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(usageMap));
  return usadoHoje;
}

// Exibe uso diário
function displayUsageInfo(totalUsedToday) {
  let restante = DAILY_TOKEN_LIMIT - totalUsedToday;
  if (restante < 0) restante = 0;
  usageDiv.textContent =
    `Tokens nesta requisição: ${latestRequestTokens}  •  ` +
    `Total usado hoje: ${totalUsedToday}  •  ` +
    `Restam (aprox.): ${restante}`;
}

function updateDailyUsageDisplay() {
  const key = getTodayKey();
  let currentUsage = 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const usageMap = JSON.parse(raw);
      currentUsage = usageMap[key] || 0;
    } catch {
      currentUsage = 0;
    }
  }
  displayUsageInfo(currentUsage);
}

// Desenha gráfico
function renderChart(labels, scores) {
  chartContainer.style.display = 'block';
  if (chartInstance) {
    chartInstance.destroy();
  }
  chartInstance = new Chart(chartCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Nota (0–10)',
        data: scores,
        backgroundColor: 'rgba(41, 128, 185, 0.7)',
        borderColor: 'rgba(41, 128, 185, 1)',
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          max: 10,
          ticks: { stepSize: 1 }
        },
        y: {
          ticks: {
            color: '#2c3e50',
            font: { size: 14 }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ctx.parsed.x.toFixed(1) + '/10' }
        }
      }
    }
  });
}

// Processar currículos
processBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;
  processBtn.disabled = true;
  loaderSpan.style.display = 'inline';
  outputDiv.textContent = '';

  const pdfFiles = Array.from(fileInput.files).filter(f =>
    f.name.toLowerCase().endsWith('.pdf')
  );
  if (!pdfFiles.length) {
    outputDiv.textContent = 'Nenhum arquivo PDF válido selecionado.';
    loaderSpan.style.display = 'none';
    processBtn.disabled = false;
    return;
  }

  const jobTitle = jobTitleFld.value.trim();
  const jobDesc  = jobDescFld.value.trim();
  const maxRetries = parseInt(retrySelect.value, 10);
  const apenasResumo = !(jobTitle && jobDesc);

  let candidateScoresList = [];

  try {
    for (const file of pdfFiles) {
      const cvText = await extractTextFromPDF(file);
      const { markdown, tokens: t1 } = await resumeCV(cvText);
      updateDailyUsage(t1);

      const extractedName = extractCandidateName(markdown) || 'Nome não encontrado';

      const container = document.createElement('div');
      container.className = 'file-summary';

      const title = document.createElement('h2');
      title.textContent = `Candidato: ${extractedName}`;
      container.appendChild(title);

      const mdTitle = document.createElement('h3');
      mdTitle.textContent = 'Resumo (Markdown):';
      container.appendChild(mdTitle);

      const mdPre = document.createElement('pre');
      mdPre.textContent = markdown;
      container.appendChild(mdPre);

      if (!apenasResumo) {
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressContainer.appendChild(progressBar);
        container.appendChild(progressContainer);

        const tokenInfo = document.createElement('div');
        tokenInfo.className = 'token-info';
        container.appendChild(tokenInfo);

        const scoreTitle = document.createElement('h3');
        scoreTitle.textContent = 'Nota Final:';
        container.appendChild(scoreTitle);

        const scorePara = document.createElement('p');
        container.appendChild(scorePara);

        const { score, tokens: t2, raw: rawScore } = await generateScoreWithRetries(
          cvText,
          jobTitle,
          jobDesc,
          progressBar,
          maxRetries
        );
        const usedTokens = updateDailyUsage(t2);

        const label = `${extractedName} (${file.name})`;
        chartLabels.push(label);
        chartData.push(score !== null ? parseFloat(score.toFixed(1)) : 0);

        candidateScoresList.push({ name: extractedName, score: score !== null ? parseFloat(score.toFixed(1)) : 0 });

        tokenInfo.textContent = `Tokens usados nesta avaliação: ${usedTokens}  •  Total usado hoje: ${usedTokens}`;
        if (score !== null) {
          scorePara.textContent = `Nota: ${score.toFixed(1)}/10`;
        } else {
          scorePara.textContent = `Não foi possível extrair nota após ${maxRetries} tentativas. Resposta bruta final:\n${rawScore}`;
        }
        displayUsageInfo(usedTokens);
      }

      outputDiv.appendChild(container);
    }

    if (!apenasResumo) {
      let maxScore = -1;
      let winnerIndex = -1;
      candidateScoresList.forEach((c, idx) => {
        if (c.score > maxScore) {
          maxScore = c.score;
          winnerIndex = idx;
        }
      });
      if (winnerIndex >= 0) {
        const summaryHeaders = outputDiv.querySelectorAll('.file-summary h2');
        if (summaryHeaders[winnerIndex]) {
          summaryHeaders[winnerIndex].textContent += ' ⭐';
        }
        chartLabels[winnerIndex] += ' ⭐';
      }
      renderChart(chartLabels, chartData);
    }

  } catch (err) {
    console.error('Erro no processamento de currículos:', err);
    const errorPara = document.createElement('p');
    errorPara.style.color = 'red';
    errorPara.textContent = 'Ocorreu um erro: ' + (err.message || JSON.stringify(err));
    outputDiv.appendChild(errorPara);
  } finally {
    loaderSpan.style.display = 'none';
    processBtn.disabled = false;
  }
});

// Extrair dados para Google Sheets (via Netlify Function)
extractBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;
  extractBtn.disabled = true;
  extractLoader.style.display = 'inline';

  const pdfFiles = Array.from(fileInput.files).filter(f =>
    f.name.toLowerCase().endsWith('.pdf')
  );
  if (!pdfFiles.length) {
    alert('Nenhum PDF válido selecionado para extração.');
    extractLoader.style.display = 'none';
    extractBtn.disabled = false;
    return;
  }

  try {
    // Monta as linhas para enviar à função
    const rowsToAppend = [];
    // Primeiro, extraímos o Markdown e formamos cada linha
    for (const file of pdfFiles) {
      const cvText = await extractTextFromPDF(file);
      const { markdown, tokens: t1 } = await resumeCV(cvText);
      updateDailyUsage(t1);

      const sections = parseMarkdownSections(markdown);

      // Data Modificação no formato brasileiro DD/MM/YYYY
      const dt = new Date(file.lastModified);
      const day = String(dt.getDate()).padStart(2, '0');
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const year = dt.getFullYear();
      const dateMod = `${day}/${month}/${year}`;

      const row = [
        sections['Nome Completo'] || '',
        sections['Experiência']   || '',
        sections['Habilidades']   || '',
        sections['Educação']      || '',
        sections['Idiomas']       || '',
        dateMod
      ];
      rowsToAppend.push(row);
    }

    // Chama a Netlify Function para inserir as linhas na planilha
    const response = await fetch(SHEET_FUNCTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rowsToAppend })
    });

    if (!response.ok) {
      throw new Error(`Erro no proxy sheet: ${response.status} – ${await response.text()}`);
    }
    const result = await response.json();
    if (result.status === 'success') {
      alert(`Foram extraídos e adicionados ${result.appended} registros na planilha.`);
    } else {
      throw new Error(result.error || JSON.stringify(result));
    }

  } catch (err) {
    console.error('Erro ao extrair dados para a planilha:', err);
    alert('Erro ao extrair dados: ' + (err.message || JSON.stringify(err)));
  } finally {
    extractLoader.style.display = 'none';
    extractBtn.disabled = false;
    updateDailyUsageDisplay();
  }
});

// Ao carregar a página, exibe consumo acumulado atual do dia
document.addEventListener('DOMContentLoaded', () => {
  const key = getTodayKey();
  let currentUsage = 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const usageMap = JSON.parse(raw);
      currentUsage = usageMap[key] || 0;
    } catch {
      currentUsage = 0;
    }
  }
  displayUsageInfo(currentUsage);
  checkFormValidity();
});
