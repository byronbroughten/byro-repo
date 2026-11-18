// A plain-text table for a script's report: each column padded to its widest cell, two spaces between columns.
export function paddedLinesOf(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}
