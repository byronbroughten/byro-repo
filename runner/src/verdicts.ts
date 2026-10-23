// The words a review finding is judged in: its axis and its verdict, as reviewStep.ts suggests and findingTriage.ts settles them.

export const verdicts = ["dismiss", "fix", "propose", "halt"] as const;
export const axes = ["standards", "spec"] as const;

export type Verdict = (typeof verdicts)[number];
export type Axis = (typeof axes)[number];
