// The words a review finding is judged in: its axis and its verdict, as a review step suggests and a resolve step settles them.
// Each Workflow's review step reviews on its own axes among these.

export const verdicts = ["dismiss", "fix", "propose", "halt"] as const;
export const axes = ["standards", "spec", "reader"] as const;

export type Verdict = (typeof verdicts)[number];
export type Axis = (typeof axes)[number];
