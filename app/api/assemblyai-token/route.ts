import { NextResponse } from 'next/server';

const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY;

export async function POST() {
  if (!ASSEMBLY_API_KEY) {
    return new NextResponse('ASSEMBLY_API_KEY is not configured', { status: 500 });
  }

  try {
    const response = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        Authorization: ASSEMBLY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expires_in: 3600 }),
    });

    if (!response.ok) {
      const text = await response.text();
      return new NextResponse(text, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json({ token: data.token });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Failed to generate token',
      { status: 500 },
    );
  }
}
