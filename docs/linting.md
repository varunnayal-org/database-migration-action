# Linting

- [Linting](#linting)
  - [Checks](#checks)
    - [Backward Incompatible Changes](#backward-incompatible-changes)
    - [Destructive Changes](#destructive-changes)
    - [Concurrent Index (only PG)](#concurrent-index-only-pg)
  - [Bypass Checks](#bypass-checks)

We are using [atlas lint command](https://atlasgo.io/versioned/lint) to analyze schema changes to find any dangerous migrations based on the policies.

`atlas migrate lint` command required a [dev database](https://atlasgo.io/concepts/dev-database) against which it executes the migration command as well.

## Checks

If migration violates any of the below checks, the lint will fail. We are using following checks:

### [Backward Incompatible Changes](https://atlasgo.io/lint/analyzers#backward-incompatible-changes)

These are the schema changes that have the potential to break the contract with applications that rely on the old schema.
For eg renaming a column etc.

Checks involved

- Renaming a table
- Renaming a column

### [Destructive Changes](https://atlasgo.io/lint/analyzers#destructive-changes)

Destructive changes are changes to a database schema that result in loss of data. For eg:

```sql
ALTER TABLE `users` DROP COLUMN `email_address`;
```

Checks involved

- Dropping schema
- Dropping table
- Dropping non-virtual column

### [Concurrent Index (only PG)](https://atlasgo.io/lint/analyzers#concurrent-index-policy-postgresql)

Checks involved

- Missing `CONCURRENTLY` while index creation and deletion
- Missing `atlas:txmode none` directive in file header

## Bypass Checks

Whenever lint check fails, the associated code is assigned to the error as well. These error codes can be [found here](https://atlasgo.io/lint/analyzers#checks).

In order to bypass a particular lint error, we need to add label `db-migration:lint:skip:{errorCode}`  in the pull request

For example, dropping a column will result in error code [DS103](https://atlasgo.io/lint/analyzers#DS103). If we want to proceed with dropping of column, then we can add label `db-migration:lint:skip:DS103` and run the migrations again.
