---
status: accepted
---

# The server Sandbox leaves auth to the host app, through an optional `authorize` callback

zreader is a library, not a framework: it has no accounts, sessions or quotas, and the app that mounts the server Sandbox's route already has its own auth. So the `Sandbox` class doesn't refuse to run without auth, and doesn't add identities or rate limits. It takes an optional `authorize` callback where the app puts its own business logic, with what it needs to decide: the incoming `Request` and the parsed run (language, codeSource, Kernel, code). The callback may be async, and returns `true` to allow, `false` for a plain 403, or a `Response` of the app's choosing (a 401 with a login URL, a 429 from its own limiter). Without it, every request that reaches the route is served, so the docs and production checklist tell apps to put the route behind their auth, especially with a paid provider such as Daytona or Modal.

## Considered Options

- **Refuse in production unless `authorize` is set** (decided earlier, then reversed). It protects careless deployments, but makes a library dictate an app's security setup, and apps that already guard the route in middleware would need a no-op callback.
- **Built-in identities, quotas and rate limits.** Rejected: every app's rules differ, and they belong in the app.
