// Each pattern needs a token-length body after its prefix, so prose naming a prefix never matches.
const secretPatterns = {
  "Google OAuth access token": /\bya29\.[\w-]{20,}/,
  "Google OAuth refresh token": /\b1\/\/[\w-]{30,}/,
  "Google API key": /\bAIza[\w-]{35}/,
  "GitHub token": /\b(?:gh[po]_[A-Za-z0-9]{36}|github_pat_\w{22,})/,
  "Anthropic key": /\bsk-ant-[\w-]{20,}/,
  "private key block": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  "OAuth client secret": /"client_secret"\s*:/,
} as const;

export type SecretShape = keyof typeof secretPatterns;

export function secretShapeOf(line: string): SecretShape | undefined {
  const entry = Object.entries(secretPatterns).find(([, pattern]) =>
    pattern.test(line),
  );
  return entry?.[0] as SecretShape | undefined;
}
