const https = require("https");

function callGroq(messages, apiKey) {
  const payload = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    max_tokens: 512,
    messages
  });

  const options = {
    hostname: "api.groq.com",
    path: "/openai/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "Content-Length": Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error("Groq HTTP " + res.statusCode + ": " + data));
        }
      });
    });

    req.on("error", err => reject(err));
    req.write(payload);
    req.end();
  });
}

exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const nomes = body.nomes || [];

    if (!Array.isArray(nomes) || nomes.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          nomesCorrigidos: [],
          error: "Nenhum nome enviado."
        })
      };
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          nomesCorrigidos: nomes,
          error: "Variável de ambiente GROQ_API_KEY não definida."
        })
      };
    }

    const promptMessages = [
      {
        role: "system",
        content: [
          "Você corrige NOME DE PESSOAS em português do Brasil.",
          "Regras obrigatórias:",
          "- Corrija apenas acentuação e maiúsculas/minúsculas.",
          "- NÃO traduza nada.",
          "- NÃO remova nem adicione sobrenomes.",
          "- NÃO remova nem adicione símbolos como *.",
          "- Entrada: uma lista com um nome por linha.",
          "- Saída: MESMA quantidade de linhas, MESMA ordem,",
          "  cada linha contendo apenas o nome corrigido."
        ].join("\n")
      },
      {
        role: "user",
        content: nomes.join("\n")
      }
    ];

    const groqResp = await callGroq(promptMessages, apiKey);
    const texto = (groqResp.choices &&
                   groqResp.choices[0] &&
                   groqResp.choices[0].message &&
                   groqResp.choices[0].message.content) || "";

    const linhas = texto.split(/\r?\n/).map(x => x.trim()).filter(x => x.length > 0);

    let nomesCorrigidos = linhas;
    if (linhas.length !== nomes.length) {
      nomesCorrigidos = nomes;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ nomesCorrigidos })
    };
  } catch (e) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        nomesCorrigidos: [],
        error: e.toString()
      })
    };
  }
};
