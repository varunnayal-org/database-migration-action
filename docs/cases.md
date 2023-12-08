# Cases

- [Cases](#cases)
  - [Out or order](#out-or-order)
  - [Database is not clean](#database-is-not-clean)
    - [migrate lint](#migrate-lint)
    - [migrate apply](#migrate-apply)
  - [Index Creation](#index-creation)
    - [Non Concurrent](#non-concurrent)
    - [Concurrent](#concurrent)
  - [Statement Error](#statement-error)
    - [Transaction Mode](#transaction-mode)
      - [Syntax Error](#syntax-error)
      - [Run time error](#run-time-error)
    - [Non-Transaction Mode](#non-transaction-mode)
      - [Fixing partial migrations](#fixing-partial-migrations)
        - [Update statement](#update-statement)
        - [Remove statement](#remove-statement)
  - [Long Running Migrations](#long-running-migrations)
    - [Post killing migration statement](#post-killing-migration-statement)
  - [Issues](#issues)

## Out or order

Consider dev1 creates a migration file with revision T1 and another dev(dev2) created T2. T2 ends up publishing their changes first(PR flow). Later, when dev1 decides to take T1 like, migration won't apply as T2 has been captured as the latest migration. Handling [non-linear](https://atlasgo.io/lint/analyzers#non-linear-changes) execution order is not recommended.

`--exec-order` as an option is not available till latest atlas [release v0.15.0](https://github.com/ariga/atlas/releases/tag/v0.15.0) and is schedule for next release. Once that is available, we can use this flag which captures such issues.

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

### migrate apply

Error: sql/migrate: connected database is not clean: found 2 tables in schema "public". baseline version or allow-dirty is required

## Index Creation

### Non Concurrent

```sql
CREATE UNIQUE INDEX "idx_email" ON "public"."user" ("email");
```

- Should only be used when you know the table might not block.

### Concurrent

```sql
CREATE INDEX CONCURRENTLY "idx_uniq_email" ON "public"."user" ("email");
```

This command will fail as creation on index concurrently cannot be withing a transactional block.

```sh
pq: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

To over come, update the file with

```sql
-- atlas:txmode none

CREATE INDEX CONCURRENTLY "idx_uniq_email" ON "public"."user" ("email");
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

#### Run time error

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
- If they'd need to apply it manually using tools like [pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html), then post applying migration they'd need to add/update `atlas_schema_revisions` with the revisions.

  > Consider the file name is `{version}_{description}.sql` and has 2 statements
  > So the query will be
  >
  > **TODO**: See if `atlas migrate set` can be used
  >
  > ```sql
  > insert into atlas_schema_revisions
  > ```
  >

## Issues

1. If database url is missing

    > [DryRun] Migrations failed 11/21/2023, 9:15:28 PM (Execution): Dir=tmp/migrations getaddrinfo ENOTFOUND base
    > Directory: 'migrations'
    > Files: NA

    Reason

    > When database url is not provided
