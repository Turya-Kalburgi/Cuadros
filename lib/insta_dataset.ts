import dataset from "./insta_dataset.json";

export type InstaRules = {
  cleanShotDurationSeconds: number;
  preferredBpm: [number, number];
  brightnessRange: [number, number];
  saturationRange: [number, number];
  text: string;
  cuts: string;
  preferKinds: string[];
  avoidCloseFace: boolean;
  defaultStyle: "clean" | "montage";
};

export const INSTA_DATASET = dataset;
export const INSTA_RULES: InstaRules = dataset.rules as InstaRules;

export function cleanShotDuration(target: number): number {
  return Math.min(target, INSTA_RULES.cleanShotDurationSeconds);
}
