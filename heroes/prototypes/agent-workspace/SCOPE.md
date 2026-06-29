# Demo scope & deferrals

## In scope (now): one-to-one examples
Single maker ↔ single taker interactions on existing strategies:
- **HANDSHAKE** (production) — **first build**: maker INITIATED → taker ACCEPTED /
  REJECTED.
- **RFQ, solicited path** (one-to-one) — second: maker REQUESTED → taker QUOTED → maker
  COUNTERED ↔ QUOTED → ACCEPTED (+ failure paths).

Both map cleanly to maker = assigner (brings business), taker = assignee (rides).

## Deferred (technical debt → near-term Heroes release)
- **Standing-offer / unsolicited-quote strategy.** A handed-over rate sheet ≡ a batch
  of per-occasion RFQs pre-answered (each lane = one RFQ entering at QUOTED). Needs a
  first-class entry model in Heroes (QUOTED as `isInitial`, or a dedicated standing-offer
  strategy). Until defined, the bulk rate-sheet → offers demo is out of scope.
- Consequently: bulk OFFER import, the offers-table dashboard view, and `instantiate`
  (offer → shipment) wait on the above.

## Implication for the build
Focus the first cut on HANDSHAKE (already prototyped via the `heroes-demo-kit` scripts),
then add solicited one-to-one RFQ. Revisit standing offers when the Heroes strategy lands.
