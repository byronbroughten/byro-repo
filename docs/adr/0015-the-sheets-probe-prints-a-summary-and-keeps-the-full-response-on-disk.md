# The Sheets probe prints a summary and keeps the full response on disk

Live Sheets JSON logged by throwaway probe scripts rode along in context through later unrelated work. One committed, read-only probe replaces those scripts: it prints only top-level keys, array counts and sheet titles, or one subtree when given a path, and writes the full response to a gitignored file for a ranged `Read`, so the summary never hides detail that is needed.

Source: byronbroughten/byro-repo#53
