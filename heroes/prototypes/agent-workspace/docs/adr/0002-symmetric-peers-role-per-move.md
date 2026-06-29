# Symmetric peers; maker/taker is per-move, not per-company

**Status:** accepted

The first prototype assigned each company a fixed role — one "maker", one "taker" — which
forced unnatural behavior and did not resemble reality (a company is a buyer in one deal
and a provider in the next). We decided every **Workspace is a symmetric peer** carrying
the **full capability set** (both skills), and that **maker/taker is decided per
interaction/move, never fixed to a company**.

Maker/taker is defined by *business*, anchored to Heroes' assigner/assignee: **maker =
brings the business to the network and assigns it (assigner); taker = accepts and rides it
(assignee)**. This matches reality and lets the demo instantiate N identical peers that
interact as equals — each its own terminal + Finder window — rather than role-cast
singletons.

**Consequences:** the kit ships one capability set used from any seat; the demo runs
multiple peer Workspaces interacting through real Heroes; "who is maker" is a per-service
fact (am I the assigner or the assignee?) that just selects which skill the agent uses.
