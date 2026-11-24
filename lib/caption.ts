export function buildInstagramCaption(opts: {
  title: string;
  focus: string;
  song: string | null;
  index: number;
}): string {
  const cleanTitle = opts.title.trim() || "A little moment";
  const focus = opts.focus.trim();
  const songLine = opts.song ? `Audio: ${opts.song}\n\n` : "";
  const vibe = focus
    ? `${focus} — the little things that make the day feel good.`
    : "The little things that make the day feel good.";
  return [
    `${cleanTitle} ✨`,
    "",
    vibe,
    "",
    songLine.trimEnd(),
    "",
    "#livingalone #morningroutine #slowliving #dayinthelife #aestheticvlog #selfcare #routine #reels",
  ]
    .filter((line, i, all) => i === 0 || line !== "" || all[i - 1] !== "")
    .join("\n")
    .trim();
}
