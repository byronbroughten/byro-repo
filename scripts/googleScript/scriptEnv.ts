// The environment `npm run google:script` runs a script in: the caller's, with the agent account's access token and none of the caller's Google or workspace-mcp variables, so no credential path or other token reaches the script.
import { agentAccount } from "../../.claude/hooks/lib/AgentTokenMinter.ts";

const googleVariable = /^(GOOGLE_|WORKSPACE_MCP_)/;

export function scriptEnvOf(
  env: NodeJS.ProcessEnv,
  accessToken: string,
): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(
    Object.entries(env).filter(([name]) => !googleVariable.test(name)),
  );
  return {
    ...kept,
    GOOGLE_ACCESS_TOKEN: accessToken,
    GOOGLE_ACCOUNT: agentAccount,
  };
}
