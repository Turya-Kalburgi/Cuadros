import { NextResponse } from "next/server";
import { bunnyStatus } from "@/lib/bunny";

export function GET() {
  return NextResponse.json(bunnyStatus());
}
