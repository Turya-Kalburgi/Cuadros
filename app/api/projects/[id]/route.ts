import { NextRequest, NextResponse } from "next/server";
import { loadProject, saveProject } from "@/lib/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const { promises: fs } = await import("fs");
  const { projectDir } = await import("@/lib/paths");
  await fs.rm(projectDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { originalName?: string } | null;
  if (!body || typeof body.originalName !== "string" || !body.originalName.trim()) {
    return NextResponse.json({ error: "originalName is required." }, { status: 400 });
  }
  const next = { ...project, originalName: body.originalName.trim().slice(0, 200) };
  await saveProject(next);
  return NextResponse.json({ project: next });
}
