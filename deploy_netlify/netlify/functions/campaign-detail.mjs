import { cacheHeaders, getCampaigns } from './lib/content-api.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Solo GET' } }), {
      status: 405,
      headers: cacheHeaders(0),
    });
  }
  const url = new URL(req.url);
  const data = await getCampaigns({ ...Object.fromEntries(url.searchParams.entries()), slug: url.searchParams.get('slug') });
  const item = data.items[0] || null;
  return new Response(JSON.stringify({ ok: true, source: data.source, item }), { status: item ? 200 : 404, headers: cacheHeaders() });
};

export const config = { path: '/api/campaign-detail' };
