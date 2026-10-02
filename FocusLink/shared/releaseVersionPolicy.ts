/** User release cadence: x.y.0 through x.y.9, then x.(y+1).0. */
export function nextReleaseVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.([0-9])$/.exec(version);
  if (!match) throw new Error('版本必须为 major.minor.patch，patch 只能为 0–9');
  const [, major, minor, patch] = match.map(Number);
  return patch === 9 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
