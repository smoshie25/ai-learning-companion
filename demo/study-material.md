# Database Engineering Study Guide

## Chapter 1: Data models and integrity

A relational database represents data in tables. Each row describes one record, and each column describes an attribute. A primary key uniquely identifies a row. A foreign key references a key in another table and preserves referential integrity.

Normalization separates facts that have different dependencies. It reduces duplicated data and helps avoid inconsistent updates. Normalization is a design technique, not a promise that every query will be fast. A practical exercise is to separate customer records from orders, then identify the relationship between them.

## Chapter 2: Indexes and query planning

An index stores lookup keys with references to rows. An index can reduce the amount of data scanned for a selective query. An index also requires storage and maintenance when rows change. More indexes do not automatically make every workload faster.

A query plan describes the operations chosen to execute a query. Compare an actual query plan with your assumptions before adding an index. Consider which predicates and joins the workload uses, and explain the tradeoff between reads, writes, and storage.

## Chapter 3: Transactions and recovery

A transaction groups related database changes into one logical operation. Atomicity means that the grouped changes either commit together or do not take effect together. Consistency means that committed changes respect the application's defined invariants.

Isolation controls how concurrent operations observe one another. Durability means that committed changes survive the failures covered by the database's guarantees. These properties do not remove the need for application validation, backups, or recovery testing.

For a transfer between accounts, validate the amount, update both balances in one transaction, and commit only when the invariant is preserved. Test what happens if the process stops before recording its result. An idempotency key can identify a repeated request so a caller can recover without blindly repeating the change.

## Chapter 4: Reliable learning practice

Read a chapter, explain its central concept in your own words, and work through a small example. Compare your explanation against the original source. Record unresolved questions instead of treating a completed reading as proof of mastery.

For interview practice, explain the assumptions behind your design and discuss one tradeoff. A useful follow-up question asks how the design behaves when a process fails or another request arrives concurrently. Practice feedback should cite what you actually said.
