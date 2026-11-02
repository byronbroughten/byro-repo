// The way out of the sandbox, for every message that tells a call to run alone: the hooks', the runner's and the scripts lint's.
export function callOfItsOwn(instruction: string): string {
  return `${instruction} in a call of its own, with no pipe, \`cd\`, \`$(…)\`, redirect other than \`2>&1\`, heredoc, flag before the script name, env prefix or other command beside it`;
}
