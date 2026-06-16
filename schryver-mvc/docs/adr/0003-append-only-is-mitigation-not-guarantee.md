# In-DB append-only is mitigation, not guarantee (Posture A + C committed)

The application DB login `exischryver` holds full rights (db_owner-equivalent). Therefore
the `audit_log` `DENY UPDATE/DELETE/ALTER` does **not** protect the audit trail against a
holder of that login: it can revoke its own DENY, alter, or drop/recreate the table. A
hand-rolled `prev_hash`/`row_hash` chain doesn't close this either — an omnipotent login can
edit a row and recompute every downstream hash to produce a clean chain. No purely in-DB
mechanism is tamper-proof while the app login is omnipotent.

**Decision — slice 1 ships Posture A, with Posture C committed as the immediate next step:**

- **A (now):** `DENY UPDATE/DELETE/ALTER` to `exischryver` + the hash-chain. This stops
  accidental writes, app bugs, and any *lesser* login, and detects *naive* tampering. The
  residual risk — a deliberate holder of `exischryver` can still tamper — is **stated
  explicitly in the PRD for Stefan Reuter**, so the compliance attestation is signed with
  the limitation disclosed, not hidden.
- **C (committed next):** stream audit rows (or periodic chain-head hashes) to an external
  append-only sink `exischryver` cannot reach (e.g. S3 Object Lock / a separate AWS account),
  making tampering *detectable* even against an omnipotent login. Candidate cheap
  implementation: SQL Server 2022 **ledger tables** (cryptographic digests stored off-box)
  if the RDS engine version supports it — to be evaluated.

**Rejected for slice 1 — Posture B (least-privilege app login):** the correct root-cause fix,
but un-surgical — it requires enumerating the app's real privilege needs across 779 SPs /
~8k tables and a risky cutover of the app's DB identity. Belongs to the least-privilege
re-architecture (likely the TypeScript stack), not this slice.

**Consequence:** the PRD must NOT claim "append-only is enforced." It claims "append-only is
enforced against accidental and lesser-privilege writes; tamper-*evidence* against the
privileged app login is delivered by C." Honesty here is the point — a false enforcement
claim is what would actually fail Stefan at audit.
