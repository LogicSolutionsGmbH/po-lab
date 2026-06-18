# Credential store — encryption recipe (research)

> Independent research deliverable for the 2026-06-01 Heroes credential-storage call
> (Carlos + Dima + Valeriy). Answers Valeriy's open problem: read-back encryption-at-rest
> that survives key rotation, with per-tenant isolation. Method: deep-research harness —
> 6 search angles, 19 primary sources, 25 claims verified 3-0 against vendor docs
> (AWS, GCP, HashiCorp, Tink, SOPS, Kubernetes). 0 claims refuted.
>
> This document is provider-neutral. The Heroes-specific design fork is in
> `credential-store-cross-examination.md`.

## The problem, restated

Some Heroes integrations need **per-tenant** credentials (Maersk: customer ID → consumer
key → bearer token; CargoProduce: account → bearer token). Today they are **hard-coded as
env vars**, so only ~20–30% of shipments get subscribed. The blocker the call could not
resolve: how to store a secret **encrypted at rest** such that

1. the **server can decrypt and READ** the plaintext at runtime to call the third party
   (so one-way hashing like bcrypt does **not** apply);
2. the encryption **key can be rotated** without making all previously-stored ciphertext
   undecryptable (no re-encrypt-everything outage, no data loss); and
3. **per-tenant isolation** is supported.

## The answer: envelope encryption with key versioning

This is the production-proven pattern. AWS KMS, GCP KMS, HashiCorp Vault Transit, and
Google Tink all implement the same shape:

- Each secret is encrypted with its own random **DEK** (data encryption key).
- The DEK is **wrapped (encrypted) by a KEK** (key encryption key) that lives in a key
  manager and never leaves it in plaintext.
- At call time the server **unwraps the DEK, decrypts the credential, and uses it**.
  Reversible — satisfies (1).

**Why rotation is safe — the insight the call was missing:** the key manager keeps **all
prior key versions**. Each ciphertext records which version produced it. On rotation new
material is used for *new* writes, but the manager **automatically selects the correct old
version to decrypt existing data**. Rotating the KEK does **not** re-encrypt data and does
**not** rotate the DEKs. Satisfies (2).

- Optional cleanup: a **re-wrap** operation moves a wrapped DEK from old KEK to new, and
  runs **entirely inside the key manager — plaintext is never exposed** (AWS `ReEncrypt`,
  Vault Transit `rewrap`). This is the cheap fix to the exact worry that killed the
  env-var approach: you re-wrap small DEKs, never the credential plaintext.
- ⚠️ The only way to lose old ciphertext is **deliberate**: deleting (not disabling) a Tink
  key, raising Vault's `min_decryption_version`, or destroying a KMS key version. Avoid
  those and rotation is non-destructive.

## The four options compared

| Option | How rotation works | Op cost / small-team fit | Failure modes |
|---|---|---|---|
| **Cloud KMS (AWS/GCP) + DEK-per-secret in DB** | Versioned KEK; transparent decrypt of old versions; in-KMS `ReEncrypt` re-wrap | Lowest **if** you already run on that cloud; managed, no infra to operate | Per-tenant key sprawl & KMS/STS rate limits at scale; alias-based isolation gates the alias, not the key policy |
| **Tink (app library) + cloud-KMS KEK** | Versioned **keyset**; decrypt tries all enabled keys; rotate = add key → distribute → promote primary | In-process, no network per op; still needs a KMS for the KEK | Deleting (vs disabling) an old key breaks its ciphertext; you own keyset distribution |
| **HashiCorp Vault Transit** ("encryption as a service") | Version-prefixed ciphertext; versioned key ring; `rewrap` endpoint; **Vault stores no data** | Powerful & self-hostable (good for non-hyperscaler infra), but **you operate Vault** | Decrypt blocked above `min_decryption_version`; Vault availability is now on the hot path unless you cache |
| **SOPS** | `rotate` does a **full re-encrypt of the file** | Great for config files in git | **Fails requirement 2** for a runtime store — not built for per-tenant runtime secrets |

**Bottom line:** envelope encryption is non-negotiable and universal; the only real choice
is **where the KEK lives and who does the crypto** — cloud KMS, an app library (Tink) over
a KMS-held KEK, or Vault Transit. SOPS is out for this use case.

## Per-tenant isolation (requirement 3)

Two documented strategies, a real trade-off:

- **One KMS key/alias per tenant** (AWS "cost-conscious" pattern): IAM session policies
  scoped to the tenant identity from the JWT (`kms:RequestAlias`). Gives **cryptographic**
  isolation and per-tenant **crypto-shredding** (delete a tenant's key ⇒ their secrets
  unrecoverable — clean GDPR erasure). Caveat: `kms:RequestAlias` gates the *alias*, not
  the key policy, so pair with key policies / encryption context; watch KMS/STS rate
  limits at ~200 integrations.
- **Single shared KEK + per-tenant encryption context (AAD)**: bind the tenant id (and row
  id) as AES-GCM additional authenticated data. Avoids key sprawl and rate limits; isolation
  is then **application-layer**, not cryptographic — a KEK compromise exposes all tenants,
  and there is no per-tenant crypto-shred.

Which to pick depends on whether the compliance bar (the ISO-style standard Valeriy raised)
demands cryptographic per-tenant separation. At minimum, bind tenant+row as GCM AAD — it is
free and blocks ciphertext-swapping between rows/tenants.

## Recommended shape (provider-neutral)

Envelope encryption: a **KEK in a key manager** + **DEK-per-secret stored as ciphertext in
the app DB**, with a `keyVersion` column per row so rotation is a cheap DEK re-wrap. Settings
(URLs, hosts, flags) stay plaintext as agreed on the call; only secrets take the KEK path.
Migrate by dual-writing each hard-coded env-var credential into a wrapped DB row, cutting
services over to read-and-unwrap at call time, then deleting the env var. Do the
revenue-blocking credential first.

## Caveats / open questions
- Findings are vendor-doc-sourced (2024–2026: AWS on-demand rotation, GKE KMS v2 GA, Vault
  v1.21.x); behavior is stable but vendors evolve. No head-to-head cost benchmark exists.
- No-outage rotation holds **only while old key versions remain available**.
- Open: cloud-KMS vs operated Vault for Heroes' infra; per-tenant key vs shared-KEK+AAD at
  scale; where ciphertext lives (DB vs secret layer). These are resolved against the real
  codebase in the cross-examination doc.

## Sources (primary)
- GCP KMS — envelope encryption: https://docs.cloud.google.com/kms/docs/envelope-encryption
- AWS KMS — rotating keys: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html
- AWS KMS — `ReEncrypt`: https://docs.aws.amazon.com/kms/latest/APIReference/API_ReEncrypt.html
- Vault Transit: https://developer.hashicorp.com/vault/docs/secrets/transit
- Vault Transit rewrap: https://developer.hashicorp.com/vault/tutorials/encryption-as-a-service/eaas-transit-rewrap
- Tink keysets / key management: https://developers.google.com/tink/design/keysets · https://developers.google.com/tink/key-management-overview
- AWS multi-tenant KMS key strategy: https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/
- GKE / k8s secret encryption: https://cloud.google.com/kubernetes-engine/docs/how-to/encrypting-secrets · https://kubernetes.io/docs/tasks/administer-cluster/kms-provider/
- SOPS: https://getsops.io/docs/
