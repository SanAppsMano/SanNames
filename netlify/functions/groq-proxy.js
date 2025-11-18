// netlify/functions/groq-proxy.js
import fetch from 'node-fetch';

/**
 * Lê as chaves Groq da variável de ambiente GROQ_API_KEYS,
 * que foi configurada no painel do Netlify.
 * Exemplo de valor em GROQ_API_KEYS:
 * "chave1,chave2,chave3"
 */
const API_KEYS = (process.env.GROQ_API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(k => k.length > 0);

// Handler principal (invocado em /.netlify/functions/groq-proxy)
export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido. Use POST.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON inválido no body' })
    };
  }

  if (!Array.isArray(payload.promptMessages)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Faltou promptMessages (array) no JSON' })
    };
  }

  const bodyTemplate = {
    model: 'llama-3.3-70b-versatile',
    messages: payload.promptMessages,
    max_tokens: payload.max_tokens || 512,
    temperature: payload.temperature || 0.2
  };

  let lastError = null;

  for (const key of API_KEYS) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(bodyTemplate)
      });

      if (resp.status === 429) {
        // Rate limit nessa chave, tenta a próxima
        lastError = new Error(`Rate limit (429) com a chave ${key}`);
        continue;
      }

      const text = await resp.text();
      if (resp.ok) {
        // Sucesso: devolve exatamente o JSON que a Groq retornou
        return {
          statusCode: 200,
          body: text
        };
      } else {
        lastError = new Error(`Groq retornou ${resp.status}: ${text}`);
        continue;
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  // Se todas as chaves falharam
  return {
    statusCode: 502,
    body: JSON.stringify({ error: lastError.message })
  };
}
