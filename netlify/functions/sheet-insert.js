// netlify/functions/sheet-insert.js
import { google } from 'googleapis';

export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Use POST.' })
    };
  }

  let CREDENTIALS;
  try {
    CREDENTIALS = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Service Account JSON inválido.' })
    };
  }

  const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
  // ID da planilha e nome da aba:
  const SPREADSHEET_ID = '1t3zpEeD5nVyLKgbfZf5jXOZPN2zYWt7Xmy_k817p440';
  const SHEET_NAME     = 'cadcv';

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON inválido no body.' })
    };
  }

  if (!Array.isArray(body.rows)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Faltou “rows” (array) no JSON.' })
    };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: CREDENTIALS,
      scopes: SCOPES
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // (A) Garante cabeçalhos (agora com “Data Modificação”)
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!1:1`
    });
    const existingHeaders = getRes.data.values ? getRes.data.values[0] : [];
    const needed = ['Nome Completo','Experiência','Habilidades','Educação','Idiomas','Data Modificação'];
    const headers = existingHeaders.slice();
    let updated = false;

    needed.forEach(col => {
      if (!headers.includes(col)) {
        headers.push(col);
        updated = true;
      }
    });

    if (updated) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!1:1`,
        valueInputOption: 'RAW',
        resource: { values: [headers] }
      });
    }

    // (B) Faz append das linhas (cada row já terá 6 colunas)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_NAME,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: body.rows }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success', appended: body.rows.length })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', error: err.message })
    };
  }
}
