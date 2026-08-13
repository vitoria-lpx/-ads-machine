import stringSimilarity from 'string-similarity';

export const MATCH_THRESHOLD = 0.8;

export interface MatchResult {
  index: number;
  rating: number;
}

export function bestMatch(text: string, candidates: string[]): MatchResult {
  if (candidates.length === 0) return { index: -1, rating: 0 };
  const { bestMatchIndex, bestMatch } = stringSimilarity.findBestMatch(text, candidates);
  return { index: bestMatchIndex, rating: bestMatch.rating };
}
