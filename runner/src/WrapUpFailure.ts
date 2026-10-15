// The runner maps each kind onto a Halt, Failure Halt or Stop; the wrap-up only names it.
export type WrapUpFailureKind =
  | "conflict"
  | "red-checks"
  | "dirty-tree"
  | "foreign-branch"
  | "parent-check"
  | "secret-scan"
  | "network";

export class WrapUpFailure extends Error {
  readonly kind: WrapUpFailureKind;

  constructor(kind: WrapUpFailureKind, message: string) {
    super(message);
    this.name = "WrapUpFailure";
    this.kind = kind;
  }
}
