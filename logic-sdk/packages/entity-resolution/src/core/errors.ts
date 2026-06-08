/**
 * Infrastructure failure (DB/query error) during resolution.
 *
 * Decision (grill 2026-06-07, failure_semantics=A): the capability NEVER throws for business
 * outcomes (`not_found` / `ambiguous_*` are returned, not thrown). It throws this typed error ONLY
 * for infrastructure failures so the host can catch it, mark the invoice unresolved/incomplete,
 * block provision, and keep its pipeline alive — never guess.
 */
export class ResolutionInfraError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ResolutionInfraError';
    this.cause = cause;
  }
}
