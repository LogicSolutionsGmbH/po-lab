# Filesystem is an interface, not storage

**Status:** accepted

In this demo a human drives an agent that operates the Logic Heroes API. We decided the
local filesystem is purely an **I/O interface** — the human deposits triggers and context
(*in*), the agent writes a disposable JSON projection (*out*) that a read-only dashboard
renders — and **Heroes remains the sole store** for all domain objects (services, events,
attachments, assets, subscriptions, strategy state).

We chose this over a local mirror/working-set of Heroes state, and over an interactive
local app, because Heroes already holds everything: a second store would only create a
sync problem and a chance to drift. Keeping the filesystem as interface-only also keeps the
demo legible and honest — the folders show only what the human put in plus a regenerable
view of what the agent did.

**Considered options:** (a) interface-only [chosen]; (b) local mirror/working-set the
skills keep in sync; (c) interactive dashboard that calls the API directly.

**Consequences:** any local rendering of Heroes state is disposable and regenerable; the
dashboard makes no API calls and holds no authority; all real calls happen in the terminal
where the agent runs.
