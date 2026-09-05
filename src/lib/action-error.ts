/** Explicitly authored, safe-to-display domain refusal. No runtime dependencies. */
export class ActionError extends Error {
  readonly safe = true;
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
