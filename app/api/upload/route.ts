import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  const { url } = await put("jay.png", file, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  });
  console.log(url)

  return NextResponse.json({ url });
}
