# Audit all consignments by entity type, never filter by transport mode

The Schryver TMS is multimodal: `TESch_Booking` carries air, ocean, and road consignments
(`tp_movimiento*`). The LBA regime only regulates *air* cargo, so the obvious-looking move
is to audit only air bookings. We deliberately do **not**.

**Decision:** the audit allow-list keys on **entity type** (`TESch_Booking` and the other
§6 cargo entities), never on transport mode. Every Booking write is audited regardless of
air/ocean/road. The mode fields (`tp_movimientoAereo/Maritimo/Terrestre/Principal`) are
themselves first-class audited fields.

**Why:** identifiability as air cargo (DVO (EU) 2015/1998 §6.4.2.1; LBA *Identifizierbarkeit*
via "Angabe der Versandart") is *determined by* the mode fields. Filtering the audit on mode
is self-defeating — an actor could flip a consignment air→ocean to slip it out of the
audited set, and that flip is exactly the security-relevant event we must capture. Auditing
all Bookings stays bounded and surgical (allow-listed cargo entities, not all ~8k tables);
ocean/road rows are harmless extra coverage. HAWB/MAWB are inherently air, so always in scope.

**Consequence:** slightly more audit volume than an air-only filter would produce; accepted
as the cost of closing the mode-flip evasion path and keeping the allow-list simple.
