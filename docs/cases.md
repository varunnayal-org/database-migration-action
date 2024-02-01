# Cases

- [Cases](#cases)
  - [Auto close PR](#auto-close-pr)
  - [Manual Migration](#manual-migration)
    - [Repository access available](#repository-access-available)
    - [Repository access not available](#repository-access-not-available)
  - [Out of order Execution](#out-of-order-execution)
  - [Lock and timeouts](#lock-and-timeouts)
  - [Drop index concurrently issue](#drop-index-concurrently-issue)
  - [Database is not clean](#database-is-not-clean)
    - [migrate lint](#migrate-lint)
      - [pg\_repack extension](#pg_repack-extension)
    - [migrate apply](#migrate-apply)
  - [Index](#index)
    - [Non Concurrent](#non-concurrent)
    - [Concurrent](#concurrent)
  - [Statement Error](#statement-error)
    - [Transaction Mode](#transaction-mode)
      - [Syntax Error](#syntax-error)
      - [Runtime error](#runtime-error)
    - [Non-Transaction Mode](#non-transaction-mode)
      - [Fixing partial migrations](#fixing-partial-migrations)
        - [Update statement](#update-statement)
        - [Remove statement](#remove-statement)
  - [Long Running Migrations](#long-running-migrations)
    - [Post killing migration statement](#post-killing-migration-statement)
  - [Issues](#issues)

## Auto close PR

IF the PR contains files that should not be a part of PR, then this action automatically closes the PR.
Following are the files allowed in PR

- Any `.yml`, `.yaml`, `.sql`, `.sum`, `.hcl`, `.xml`, `.json` file
- DB Migration configuration file provided in action input or defaults to `./db.migration.json`
- `Makefile`

## Manual Migration

There might be cases where we have to deal with scenarios where

- We need to capture schema changes in our repository but don't want to run them. This situation might arise when we fix [schema drifts](./schema-drift.md)
- If DBA runs the migrations explicitly(they already know connection string) that are already raised in a PR. Developer from service team should help them out.

Once the revision has been resolved, if there exist more revisions that has not been executed explicitly, use `db migrate` flow.

To resolve the manually executed revisions, DBA should capture the schema migration in the `atlas_schema_revisions` table. There are two ways based on the situation where repository access is available to DBA

### Repository access available

Suppose there are multiple version files present in the migrations directory, say

- 20240131184838_user.sql
- 20240131180053_config_id_index.sql

and we have already applied the schema manually in above revision files.

So, in order to consider all migrations upto `20240131180053_config_id_index.sql`, DBA should run following atlas command:

```sh
cd /path/to/repository
git checkout {branch-to-checkout}

# version format {timestamp}_{description}.sql
VERSION=20240131180053
DIR=`pwd`/migrations-directory
CONN_URL="postgres://{user}:{pass}//{prod-db-host}:{port}/{db}?search_path={db-schema-name}"

atlas migrate set --url "${CONN_URL}" --dir file://${DIR} 20240131180053
```

In case we have manually executed commands till `20240131184838_user.sql` version, then change `VERSION` to `20240131184838` in above query

### Repository access not available

- The schema file is in format `{revision}_{description}.sql`. Consider the file `20240131180053_config_id_index.sql` for which we want to capture it in schema w/o running the migrations. DBA will run following query:
  - `applied` and `total` set to 0.
  - `hash` should be the one calculated by `atlas`. But in this case it doesn't matter as `applied` and `total` are set to same value.
  - `type` is set to 4 that specifies RevisionTypeResolved in atlas.

  ```sql
  INSERT INTO
  atlas_schema_revisions(version, description,        type, applied, total, executed_at, execution_time, error,  error_stmt,hash, partial_hashes, operator_version)
  VALUES                ('20240131180053', 'config_id_index', 4,     0,      0,      now(),      0,               '','',             '','null', 'Atlas CLI v0.18.0');
  ```

  Do this for all the migrations file that were executed manually.

- If this is the only file in the PR or the last pending file in the migration files(considering previous one has been executed), then we can safely merge the PR
  - Else, use `db migrate` command.

## Out of order Execution

Consider userA creates a migration file with revision T1 and another dev(user2) create T2(version T1 < T2). T2 ends up publishing their changes first(PR flow). Later, when userA decides to take T1 like, migration shouldn't apply and error out as T2 has been captured as the latest migration and trying to apply migration T1 would mean applying back-dated migration. Handling [non-linear](https://atlasgo.io/lint/analyzers#non-linear-changes) execution order is not recommended.

`--exec-order` as an option to tackle this situation but is not available till latest atlas [release v0.15.0](https://github.com/ariga/atlas/releases/tag/v0.15.0) and is schedule for next release. Once that is available, we can use this flag which captures such issues.

## Lock and timeouts

Currently, in atlas, there is not way to implement what is prescribed in [zero downtime migrations](https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries).

It has been raised with atlas

- Issue: [#2345](https://github.com/ariga/atlas/issues/2345)

## Drop index concurrently issue

Linting process allows you to drop indexes only with `concurrently` option running outside of transaction. Currently there is a bug in atlas that does not honor it, though it works for concurrent index creation.

Same has been raised with atlas

- Issue: [#2375](https://github.com/ariga/atlas/issues/2375)
- PR : [PR#2376](https://github.com/ariga/atlas/pull/2376)

This will be fixed in next version of atlas i.e. v0.16.0

## Database is not clean

Sometimes while running linting or applying migration we could encounter error

> **connected database is not clean**

### migrate lint

If it is encountered during linting process, ensure the DEV DB being used is clean and has no tables, objects, extensions created before. You can use following sample script to create DEV DB

```sql
CREATE USER dev_db WITH PASSWORD 'dev_db';
CREATE DATABASE dev_db;
GRANT ALL PRIVILEGES ON DATABASE dev_db TO dev_db;
ALTER DATABASE dev_db OWNER TO dev_db;
```

This should fix it.

#### pg_repack extension

Consider the baseline version file

```sql
CREATE EXTENSION pg_repack;
```

Now, during linting, we'll get an error stating

```sh
atlas migrate lint --dev-url "${DEV_DB}" --dir file://migrations

Error: restore dev-database snapshot: Drop schema named "repack": pq: cannot drop schema repack because extension pg_repack requires it
```

This is because `atlas` tries to remove the schema `repack` that gets auto created while clearing command it ran during linting check.

To overcome this, add `DROP EXTENSION pg_repack;` as well

```sql
CREATE EXTENSION pg_repack;
DROP EXTENSION pg_repack;
```

**Why not remove the sql statement related to pg_repack**: It could be the case that the extension might exist in actual DB but not in dev db.
Hence removing it will result in `atlas migrate apply` command to fail.

### migrate apply

Error: sql/migrate: connected database is not clean: found 2 tables in schema "public". baseline version or allow-dirty is required

## Index

### Non Concurrent

This won't work if we are using linting.

```sql
CREATE UNIQUE INDEX "idx_email" ON "public"."user" ("email");
-- or
DELETE INDEX idx_email;
```

- Should only be used when you know the table might not block.

### Concurrent

```sql
CREATE INDEX CONCURRENTLY "idx_uniq_email" ON "public"."user" ("email");
-- or
DELETE INDEX CONCURRENTLY idx_email;
```

This command will fail as creation/deletion of index concurrently cannot be within a transactional block.

```sh
pq: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

To over come, update the file with

```sql
-- atlas:txmode none

-- creating this index
CREATE INDEX CONCURRENTLY "idx_uniq_email" ON "public"."user" ("email");

-- deleting this index
DELETE INDEX CONCURRENTLY idx_uniq_email;
```

> **NOTE**: Ensure an empty line after atlas directive

## Statement Error

Consider we have a migration file consisting of sql statements where one or few of the statements are

- either invalid syntax
- syntactically valid but execution of the query will fail eventually. For eg adding a column in non existing table or adding index for a non existing column etc

There could be two classes of error:

- When all the commands within that file are executed within a transactional block
- When we do not want to use transaction for executing these statements

For all of these command, we use `atlas migrate apply`.
If in case we end up using `atlas migrate lint` before apply, then these errors will be caught before hand.
> However, `lint` might not capture erorrs that might occur when running in actual DB. Consider if actual DB has drifted away and hence linting will not be able to find the error

### Transaction Mode

#### Syntax Error

For this case, consider a migration file `20231207062947_add_phone.sql` containing multiple SQL statements.

```sql
ALTER TABLE "users" ADD COLUMN "phone" varchar(25);

-- Invalid syntax
ALTER TABLE;

ALTER TABLE "users" ADD COLUMN "old_phone" varchar(25);
```

Running apply command will result in failure with the error. Since it's running in transactional block, none of the command will be executed and no entry will be created in revision table *atlas_schema_revisions*.

Running `atlas migrate lint --format '{{ .Files }}'` will output

```json
[
  {
    "Name": "20231207062947_add_phone.sql",
    "Error": "executing statement: pq: syntax error at or near \";\""
  }
]
```

#### Runtime error

Consider the following migration file

```sql
ALTER TABLE "users" ADD COLUMN "phone" varchar(25);

-- user_bkp table doesn't exist
ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);
```

Expected behavior is similar to as [above](#syntax-error) with error as

```sh
pq: relation "users_bkp" does not exist
```

Even linting gives error

```json
[
  {
    "Name": "20231207062947_add_index.sql",
    "Error": "executing statement: pq: relation \"user_sessions111\" does not exist"
  }
]
```

### Non-Transaction Mode

For migration file running w/o transaction, every query is executed one by one and hence, the execution will run till the failure. The state of execution will be saved in migration table(i.e. how many statements have been executed).

For this case, consider a migration file `20231207062947_add_phone.sql`

```sql
-- atlas:txmode none

ALTER TABLE "users" ADD COLUMN "phone" varchar(25);

-- user_bkp table doesn't exist
ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);


-- user_bkp table doesn't exist
ALTER TABLE "users" ADD COLUMN "phone_added_at" timestamp;
```

> Running linting will capture the error
>
> ```json
> [
>   {
>     "Name": "20231207062947_add_index.sql",
>     "Error": "executing statement: pq: relation \"users_bkp\" does not exist"
>   }
> ]
> ```

Applying migration is where things gets interesting. Applying this migration will fail at second query as table doesn't exist, depicted below

```sh
    -> ALTER TABLE "users" ADD COLUMN "phone" varchar(25);
    -> ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);
    pq: relation "users_bkp" does not exist
```

Also, atlas will save the state of migration, i.e.

- how many statements were there in migration (3)
- how many have been applied (1)

Below query shows the state of last migration that failed

```sh
select * from atlas_schema_revisions order by version desc limit 1;
version          | 20231207062947
description      | add_index
type             | 2
applied          | 1         # It could only execute one query
total            | 3         # There are total of three queries(255);
error            | pq: relation "users_bkp" does not exist
error_stmt       | ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);
...
```

Applying migration again will do nothing.

#### Fixing partial migrations

As a user we can either

- update the query that is failing
- or remove the query

##### Update statement

One way to fix above issues is to update the erroneous query i.e. changing `users_bkp` to `users`

```sql
-- atlas:txmode none

ALTER TABLE "users" ADD COLUMN "phone" varchar(25);

-- user_bkp table doesn't exist
ALTER TABLE "users" ADD COLUMN "old_phone" varchar(25);


-- user_bkp table doesn't exist
ALTER TABLE "users" ADD COLUMN "phone_added_at" timestamp;
```

Applying the migration will now run successfully. The migration table will capture the completion of execution as well

```sh
select * from atlas_schema_revisions order by version desc limit 1;
version          | 20231207062947
description      | add_index
type             | 2
applied          | 3
total            | 3
executed_at      | 2023-12-07 08:16:40.50819+00
error            | pq: relation "users_bkp" does not exist
error_stmt       | ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);
```

> **NOTE**: The error and error_stmt field still exists

##### Remove statement

Based on business use case, we can remove the erroneous statement instead of [updating it](#update-statement).

Updated migration file

```sql
-- atlas:txmode none

ALTER TABLE "users" ADD COLUMN "phone" varchar(25);

-- user_bkp table doesn't exist
ALTER TABLE "users" ADD COLUMN "phone_added_at" timestamp;
```

Migration will now run successfully. Revision table contents will still show `total` as 3, but `applied` will be now 2

```sh
select * from atlas_schema_revisions order by version desc limit 1;
version          | 20231207062947
description      | add_index
type             | 2
applied          | 2
total            | 3
executed_at      | 2023-12-07 08:16:40.50819+00
error            | pq: relation "users_bkp" does not exist
error_stmt       | ALTER TABLE "users_bkp" ADD COLUMN "old_phone" varchar(25);
```

---

Subsequent Migration Files

If there were more migration files to be executed post this one, that would have been considered for execution after correcting current migration file.(This looks a bit intuitive as the state of current migration has `applied` set to 2 but `total` is captured as 3.)

## Long Running Migrations

Consider we have million of records in `users` table and we have following statements in a migration file that we plan to apply:

```sql
-- happens instantaneously
ALTER TABLE "users" ADD COLUMN "email" varchar(100);

ALTER TABLE "users" ADD COLUMN "age" smallint default 0 not null;
```

If we apply migration, second statement (`age`) will block as it needs to touch each and every row to set the value to 0. If we wish to kill the migration in between, we can

- Get the list of long running statement using below command

  ```sql
  SELECT pid, query_start, query, state
  FROM pg_stat_activity
  WHERE state = 'active' AND now() - query_start > interval '5 minutes';
  ```

  *Interval* can be adjusted as per requirement

- The `pid` received from the above query can be used to kill the process.

  ```sql
  SELECT pg_terminate_backend({PID_FROM_ABOVE_QUERY});
  ```

### Post killing migration statement

Once killed, DBA/service owner can decide how they wish to proceed with the migration.

- In case they still wish to proceed with it, they can plan the migration at low traffic time using `db migrate` comment.
- If they'd need to apply it manually using tools like [pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html), then post applying migration they'd need to add/update `atlas_schema_revisions` with the revisions via methods outlined in [manual migration](#manual-migration)

## Issues

1. If database URL is missing

    > [DryRun] Migrations failed 11/21/2023, 9:15:28 PM (Execution): Dir=tmp/migrations getaddrinfo ENOTFOUND base
    > Directory: 'migrations'
    > Files: NA

    Reason

    > When database url is not provided
