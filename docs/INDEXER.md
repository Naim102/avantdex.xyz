# Indexer

Code: `backend/app/indexer/worker.py`, entry `python -m app.indexer.run`. Tests: `backend/tests/test_chain.py`.

## Principle

The chain is canonical. The indexer copies contract events into PostgreSQL (`chain_events`, idempotent by `(tx_hash, log_index)`), then **re-reads the touched state from the contract** (markets, orders, trades, claimable balances) so the database mirrors the chain even if an event is replayed or reordered. The database can be rebuilt by dropping it and replaying from `EXCHANGE_DEPLOY_BLOCK`. Project records, badges, admins and audit logs are off-chain and exist only in PostgreSQL: back them up.

## Loop

1. Read the chain head; index at most `INDEXER_BATCH_BLOCKS` (2000) blocks; on a provider range limit retry with a smaller range.
2. Process logs in order, write events, update mirrors, create user notifications (matched, settled, defaulted, refunded, order expired or cancelled, claimable credited).
3. Every `OPS_INTERVAL_SECONDS` run the operations job: settlement-deadline reminders and the admin webhook ([OPERATIONS-PHASE-1.md](OPERATIONS-PHASE-1.md)).
4. On any error log the exception type and retry after 10 seconds. `/api/health` reports `last_block`, `chain_head`, `lag_blocks` and `updated_at`.

## Binding markets to records

A market created on-chain carries `metadataRef = keccak256(slug)`. The indexer finds the draft with that reference, stores `onchain_id`, token, decimals and status, and moves the project through its statuses (Market Setup, Live, ...). A market with no matching draft becomes an orphan row named "Market #id" (never public until activated).

* **Duplicate references** (possible on contract v1, impossible on v2): the first market keeps the record, later copies are ignored with a warning.

## Switching to a new contract

If `EXCHANGE_ADDRESS` changes on the **same chain id**, the indexer resets itself instead of refusing: it deletes everything derived from the old contract (events, orders, trades, claimable balances, disputes, trade notifications, markets that exist on-chain) and re-indexes from the new `EXCHANGE_DEPLOY_BLOCK`. Kept: projects with their badges and history, listing requests, users, admins, audit logs, settings. Projects that were tied to an old market return to Approved. A different **chain id** still refuses to start and needs a fresh database. (Before this change a changed contract left the indexer stuck: nothing was indexed, and a market created on-chain stayed a draft.)

## Operating notes

* Health: `GET /api/health` must report `"status":"ok"` and a small `lag_blocks`. The dashboard's Needs attention list flags an indexer that is more than 100 blocks behind or silent for 3 minutes.
* RPC: the public Arc RPC can return transient HTTP errors during a long catch-up; the loop retries.
* Tests: `test_full_lifecycle_indexer_api_fees_and_replay` (including a full replay), `test_indexer_is_idempotent_and_reports_lag`, `test_new_contract_resets_chain_data_but_keeps_projects`, `test_a_draft_cannot_be_sent_to_the_chain_twice`.
