const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Netlify.env.get('APP_PASSWORD');
  if (!expected) return json({ error: 'APP_PASSWORD is not set in your Netlify environment variables.' }, 500);
  if (req.headers.get('x-access-code') !== expected) return json({ error: 'Wrong access code.' }, 401);

  const key = Netlify.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'AI Gateway is not active yet. Deploy the site to production once and make sure your Netlify plan is credit-based.' }, 500);
  const base = (Netlify.env.get('GOOGLE_GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const model = Netlify.env.get('IMAGE_MODEL') || 'gemini-3.1-flash-image-preview';

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const prompt = String(body.prompt || '').slice(0, 4000);
  if (!prompt) return json({ error: 'Missing prompt' }, 400);
  const aspect = ['3:4', '4:3', '1:1'].includes(body.aspect) ? body.aspect : '3:4';

  const parts = [{ text: prompt }];
  for (const ref of (body.refs || []).slice(0, 4)) {
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(ref || '');
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }

  let res, data;
  try {
    res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }
      })
    });
    data = await res.json();
  } catch (e) {
    return json({ error: 'Could not reach the AI service: ' + e.message }, 502);
  }
  if (!res.ok) return json({ error: data?.error?.message || `AI service error (${res.status})` }, 502);

  const img = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
  const inline = img && (img.inlineData || img.inline_data);
  if (!inline?.data) {
    const why = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'no image returned';
    return json({ error: `The AI did not return an image (${why}). Try rewording the prompt.` }, 422);
  }
  return json({ image: `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}` });
};

export const config = {
  path: '/api/generate',
  method: 'POST',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
