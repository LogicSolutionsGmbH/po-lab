# Ambiguity resolution — the agentic loop + three scenarios + the gate

## The agentic loop

- When resolution returns **one entity ID but multiple entity-address IDs** (or is otherwise unclear),
  let the **agent loop** with a **max number of attempts** (so it doesn't run forever) and the ability to
  **use different tools**.
- The endpoint response, when ambiguous, says **"the result is ambiguous"**, lists the **candidate
  companies found**, and at the bottom carries **recommendations** we control (remarks / observations /
  next-tool hints) — *"only enough for the agent to keep going."* We steer the agent via the response.

## The three ambiguity scenarios

### Scenario 1 — ambiguity from the PDF itself
- The document is misleading: the company name + address in the **top-right corner** (where it's
  "supposed" to be) is actually the **wrong** one; the **correct** issuer is **below, hidden in small
  print.**
- Handling: let the agent react agentically based on the response + recommendations (e.g. "use this tool",
  "check previous cases").

### Scenario 2 — duplicate / low-quality directorio data
- Two **different entity IDs** for what's really one company.
- Examples:
  - Two **"Logic Solutions"** entries (two distinct entity IDs).
  - **MSC** — "Mediterranean Shipping Company **SA**" vs "Mediterranean Shipping Company **S A**" (with a
    space), **both for Schryver Ecuador, same address** → **fully ambiguous.**
- The AI **cannot** pick and **must not** guess — it must say **"I don't know"** and **block + flag for
  human intervention.**
- Human-resolution path: someone **closes / migrates** the invoices off one duplicate, then
  **deactivates** it. → this is why **`tenant` + `status`** on the directorio matter. (This is the
  standing directorio-cleanup task in `[[Topics/logic-journeys]]`.)

### Scenario 3 — company doesn't exist (for this tenant)
- Either **no entity** matches the company at all, **or** the entity exists but **not for that tenant**.
- Example: an invoice processed by **Schryver Morocco** — Logic Solutions resolves as **entity ID**, but
  there is **no entity-address ID** for Morocco's tenant (they never invoiced directly to Morocco).
- Note on disambiguation: **passing the country code** resolves cross-country name collisions
  (e.g. Logic Solutions DE vs another country) — but it does **not** solve scenario 2 (same country, same
  address duplicates) or scenario 3 (tenant has no address).

## The provision-creation gate

- At the moment the user can create a provision, check: **is there an entity ID AND an entity-address ID?**
  - **Yes** → allowed.
  - **No** → mark the field/record **incomplete**, **force the user to go back and select manually.**
- In the extracted data, surface the record as **incomplete** (missing entity-address ID) so it triggers
  a flag for a human after a few failed attempts.
- Booking still requires human approval regardless.

## Backlinks
<!-- brain-nightly:start -->
- [[Notebooks/invoice-entity-resolution/00-index]] — "[[notes/03-ambiguity-scenarios]] — the three scenarios + the agentic loop + the provision gate"
<!-- brain-nightly:end -->
