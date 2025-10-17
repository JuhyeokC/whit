import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TaskCreate } from './endpoints/taskCreate';
import { TaskDelete } from './endpoints/taskDelete';
import { TaskFetch } from './endpoints/taskFetch';
import { TaskList } from './endpoints/taskList';

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// CORS for all routes (allow extension and local testing)
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['*'],
  })
);

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: '/',
});

// Register OpenAPI endpoints
openapi.get('/api/tasks', TaskList);
openapi.post('/api/tasks', TaskCreate);
openapi.get('/api/tasks/:taskSlug', TaskFetch);
openapi.delete('/api/tasks/:taskSlug', TaskDelete);

// Health check
app.get('/health', (c) => {
  return c.json({ ok: true, time: new Date().toISOString() });
});

// Analyze image via OpenAI (Vision)
app.post('/analyze', async (c) => {
  type AnalyzeBody = {
    dataUrl: string;
    model?: string;
    prompt?: string;
  };

  try {
    const body = await c.req.json<AnalyzeBody>();
    const dataUrl = body?.dataUrl;
    const model = body?.model || 'gpt-4o-mini';
    const prompt =
      body?.prompt ||
      '이 이미지를 분석해줘. 주요 객체/텍스트/브랜드/맥락을 bullet로 간결히 요약해.';

    if (!dataUrl || typeof dataUrl !== 'string') {
      return c.json({ ok: false, error: 'missing dataUrl' }, 400);
    }

    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are WHIT?, an expert visual analyst. Return concise, structured results in Korean.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.2,
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const t = await r.text();
      return c.json(
        { ok: false, error: `OpenAI error: ${r.status} ${t}` },
        r.status
      );
    }

    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json?.choices?.[0]?.message?.content?.trim() || '(no content)';
    return c.json({ ok: true, result: text });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
