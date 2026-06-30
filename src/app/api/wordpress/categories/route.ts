import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { siteUrl, username, password } = await request.json();

    if (!siteUrl) {
      return NextResponse.json({ error: 'WordPress Site URL is required' }, { status: 400 });
    }

    const cleanUrl = siteUrl.replace(/\/$/, "");
    const apiEndpoint = `${cleanUrl}/wp-json/wp/v2/categories?per_page=100`;

    const headers = new Headers();
    if (username && password) {
      const credentials = btoa(`${username}:${password}`);
      headers.set('Authorization', `Basic ${credentials}`);
    }

    const res = await fetch(apiEndpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000) // 5s timeout
    });

    if (res.ok) {
      const categories = await res.json();
      const formatted = categories.map((cat: any) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug
      }));
      return NextResponse.json({ success: true, categories: formatted });
    } else {
      const text = await res.text();
      return NextResponse.json({ error: `WP API returned status ${res.status}: ${text}` }, { status: res.status });
    }
  } catch (e: any) {
    console.error("Error fetching WP categories:", e);
    return NextResponse.json({ error: e.message || 'Failed to fetch categories' }, { status: 500 });
  }
}
