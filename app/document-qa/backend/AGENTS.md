# Backend host guidance

Follow the [PRD](../../../docs/product/PRD.md) and [SDD](../../../docs/architecture/SDD.md), especially the four workflow interfaces, loopback transport contract, offline/security requirements, sanitized logging, and error behavior.

Keep the Open WebUI Python host as a thin adapter: validate and dispatch versioned local HTTP requests to the owning workflow module, relay progress and terminal results, and route cancellation by request ID. Bind the host to `127.0.0.1` only. Do not place domain rules, durable workflow state, or third-party implementation details in host routes. Never bind a non-loopback interface or add outbound network behavior.

Workflow implementations belong in `secure_qa/<feature>/`. Keep public interfaces independent of host framework types and test host-to-workflow behavior at the integration seam.
