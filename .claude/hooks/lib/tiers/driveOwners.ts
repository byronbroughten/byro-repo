// The tier gate's real owner lookup: the gworkspace server's stored token for the agent account, refreshed when expired, asking Drive for a file's owners only.
import { AgentTokenMinter } from "../AgentTokenMinter.ts";
import type { OwnerLookup } from "./driveTiers.ts";

const requestTimeoutMs = 5000;

// Any failure, a thrown one included, is undefined, which the gate treats as not the developer's.
export async function driveOwnersOf(fileId: string): ReturnType<OwnerLookup> {
  try {
    const accessToken = await AgentTokenMinter.init().current();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=owners(emailAddress)&supportsAllDrives=true`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const owners =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).owners
        : undefined;
    if (!Array.isArray(owners)) return undefined;
    return owners.flatMap((owner) =>
      typeof owner?.emailAddress === "string" ? [owner.emailAddress] : [],
    );
  } catch {
    return undefined;
  }
}
