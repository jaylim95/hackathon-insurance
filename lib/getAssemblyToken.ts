'use server';

export async function getAssemblyToken(): Promise<{ token: string } | { error: string }> {
  const apiKey = process.env.ASSEMBLY_API_KEY;

  if (!apiKey) {
    return { error: 'ASSEMBLY_API_KEY is not configured' };
  }

  const url = new URL('https://streaming.assemblyai.com/v3/token');
  url.searchParams.set('expires_in_seconds', '600');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: apiKey,
    },
  });

  const text = await response.text();
  console.log('[assemblyai] response:', response.status, text);

  if (!response.ok) {
    return { error: text };
  }

  const data = JSON.parse(text);
  return { token: data.token };
}
