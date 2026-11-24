import { NextResponse } from "next/server";
import { bunnyConfigured, listLocalFiles, syncFilesToBunny, type SyncResult } from "@/lib/bunny";

let busy = false;
let lastResult: SyncResult | null = null;

export function GET() {
  return NextResponse.json({ busy, lastResult });
}

export async function POST() {
  if (!bunnyConfigured()) {
    return NextResponse.json(
      { error: "Bunny is not configured. Add BUNNY_STORAGE_ZONE, BUNNY_API_KEY and BUNNY_CDN_BASE to .env.local." },
      { status: 503 },
    );
  }
  if (busy) {
    return NextResponse.json({ error: "A sync is already running." }, { status: 409 });
  }
  busy = true;
  void (async () => {
    try {
      lastResult = await syncFilesToBunny(await listLocalFiles());
    } finally {
      busy = false;
    }
  })();
  return NextResponse.json({ queued: true }, { status: 202 });
}
