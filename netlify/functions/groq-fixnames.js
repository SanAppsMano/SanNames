import Groq from "groq-sdk";

export const handler = async (event) => {
  try {
    const { name } = JSON.parse(event.body || "{}");

    if (!name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Faltou o nome" })
      };
    }

    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const response = await client.chat.completions.create({
      model: "mixtral-8x7b-32768",
      messages: [
        {
          role: "user",
          content: `Corrija apenas a acentuação do nome próprio abaixo e devolva somente o nome corrigido, sem comentários: "${name}"`
        }
      ],
      temperature: 0.1
    });

    // *** DEBUG CRÍTICO ***
    return {
      statusCode: 200,
      body: JSON.stringify({
        debug: true,
        raw: response
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: true,
        message: err.message,
        stack: err.stack
      })
    };
  }
};
