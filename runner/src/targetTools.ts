// The tools ClaudeAgentStep.ts adds to a step for each of its ticket's targets, on top of the runner config's fixed lists.
// The write lists mirror .claude/hooks/lib/driveTiers.ts, which can't be imported across the hooks boundary.
import type { SpreadsheetName, Target } from "./ticketTargets.ts";

const liveAliases = {
  app: ["chore", "gen:configs", "probe", "build", "deploy", "configs:diff"],
  dev: [
    "chore",
    "gen:configs",
    "probe",
    "build",
    "deploy",
    "configs:diff",
    "push",
    "run",
  ],
} satisfies Record<SpreadsheetName, string[]>;

const gworkspaceTools = {
  sheets: [
    "list_spreadsheets",
    "get_spreadsheet_info",
    "read_sheet_values",
    "list_sheet_tables",
    "list_spreadsheet_comments",
    "modify_sheet_values",
    "format_sheet_range",
    "manage_conditional_formatting",
    "create_sheet",
    "append_table_rows",
    "manage_sheet_tab",
    "resize_sheet_dimensions",
    "move_sheet_rows",
    "manage_named_range",
    "manage_spreadsheet_comment",
  ],
  docs: [
    "search_docs",
    "get_doc_content",
    "get_doc_as_markdown",
    "inspect_doc_structure",
    "list_document_comments",
    "modify_doc_text",
    "find_and_replace_doc",
    "insert_doc_elements",
    "batch_update_doc",
    "update_paragraph_style",
    "update_doc_headers_footers",
    "manage_doc_tab",
    "insert_doc_image",
    "create_table_with_data",
  ],
};

// Each tool once, in the order the targets name them.
export function toolsOf(targets: Target[]): string[] {
  const tools = targets.flatMap((target) => {
    if (target.kind === "doc") return gworkspaceToolsOf(gworkspaceTools.docs);
    return [
      ...liveAliases[target.name].map(
        (alias) => `Bash(npm run ${target.name}:${alias}*)`,
      ),
      ...gworkspaceToolsOf(gworkspaceTools.sheets),
    ];
  });
  return [...new Set(tools)];
}

function gworkspaceToolsOf(names: string[]): string[] {
  return names.map((name) => `mcp__gworkspace__${name}`);
}
