exports.handler = async function () {
  const apiKey = process.env.GROQ_API_KEY || "";
  return {
    statusCode: 200,
    body: JSON.stringify({
      debug: true,
      length: apiKey.length,
      startsWith: apiKey.slice(0, 12),
      endsWith: apiKey.slice(-4),
      fullIfShort: apiKey.length < 20 ? apiKey : undefined
    })
  };
};
