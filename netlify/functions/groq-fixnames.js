exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const nomes = body.nomes || [];

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

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        max_tokens: 512,
        messages: promptMessages
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error("Groq HTTP " + resp.status + ": " + txt);
    }

    const data = await resp.json();
    const texto = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    const nomesCorrigidos = texto.split(/\r?\n/).map(x => x.trim()).filter(x => x.length > 0);

    return {
      statusCode: 200,
      body: JSON.stringify({ nomesCorrigidos })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.toString() })
    };
  }
};
