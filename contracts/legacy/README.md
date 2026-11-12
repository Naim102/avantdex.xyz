# Legacy 10-module design (not deployed, not compiled)

These files belong to an earlier, larger design (project registry, settlement, disputes, fee manager, ...)
described in `DESIGN-legacy-10-module.md`. They were written against a different `AllocXEscrow` and
`AllocXMarketplace`; those two files were later replaced by the simpler versions in `contracts/`, so
this code no longer compiles and its tests no longer run. It is excluded from the build in `foundry.toml`.

The deployed system is only `AllocXMarketplace`, `AllocXEscrow` and `AllocXTransfer`.
