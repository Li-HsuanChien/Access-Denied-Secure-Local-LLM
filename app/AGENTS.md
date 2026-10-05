# Application code guidance

Read the [PRD](../docs/product/PRD.md) for product scope and acceptance goals and the [SDD](../docs/architecture/SDD.md) for module ownership, interfaces, security, data, and platform requirements before implementing application behavior.

The application has separate desktop, frontend/backend workflow, and release areas. Put code in the narrowest owning area described by its local `AGENTS.md`; keep cross-area coordination at versioned interfaces. Do not place application source at the `app/` root.

Update the PRD for approved scope changes and the SDD or a linked architecture decision record for approved design changes, in the same change set as code. Preserve offline-only operation and the SDD's public-interface test seams.
