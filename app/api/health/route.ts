import { NextResponse } from "next/server";
import { connection } from "next/server";
import { mediaToolsAvailable, linkImportAvailable } from "@/lib/binaries";
import { aiProviderLabel, detectAiProvider } from "@/lib/ai";

export async function GET() {
  await connection();
  return NextResponse.json({
    ffmpeg: await mediaToolsAvailable(),
    ytDlp: await linkImportAvailable(),
    ai: detectAiProvider(),
    aiLabel: aiProviderLabel(),
  });
}
