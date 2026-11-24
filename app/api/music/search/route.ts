import { NextRequest, NextResponse } from "next/server";
import { resolveYtDlp } from "@/lib/binaries";
import { searchMusic } from "@/lib/music";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) return NextResponse.json({ results: [] });

  if (!(await resolveYtDlp())) {
    return NextResponse.json(
      { results: [], error: "yt-dlp is not installed." },
      { status: 503 },
    );
  }

  const results = await searchMusic(q);
  return NextResponse.json({ results });
}
