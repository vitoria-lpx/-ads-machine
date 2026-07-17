const SCENE_SPLIT_PATTERN = /(\[(?:Cena|Texto na tela):[^\]]*\])/g;
const SCENE_MATCH_PATTERN = /^\[(?:Cena|Texto na tela):[^\]]*\]$/;

export type SceneSegment = {
  text: string;
  isDirection: boolean;
};

/**
 * Splits briefing text into alternating spoken-word / production-direction
 * segments — e.g. "[Cena: ...]" and "[Texto na tela: ...]" annotations —
 * shared by the on-screen overlay and the PDF mirror so both italicize the
 * exact same spans.
 */
export function splitSceneSegments(value: string): SceneSegment[] {
  return value
    .split(SCENE_SPLIT_PATTERN)
    .filter(part => part.length > 0)
    .map(part => ({ text: part, isDirection: SCENE_MATCH_PATTERN.test(part) }));
}
