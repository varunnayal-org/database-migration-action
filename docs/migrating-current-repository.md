# Integrating with current repository

## Prerequisites

1. Setup Postgres locally at port 5432 with credentials as user=`root` and password=`secret`
    > We need two databases
    > - DB for the application, say `app-db`
    > - DB for the same application, say `app-db1`. Used to run the initial migration that is generated
    > - Dev DB (this will be empty database) say `dev_db` (Not to be confused with development database)
1. Install [atlas](https://github.com/ariga/atlas)

    ```sh
    # curl -sSf https://atlasgo.sh | ATLAS_VERSION=v0.18.0 CI=true sh -s -- --community
    ATLAS_VERSION=v0.18.0
    curl -L -o "atlas" --fail "-#" "https://release.ariga.io/atlas/atlas-community-darwin-arm64-${ATLAS_VERSION}" && \
      chmod +x atlas && \
      mv atlas /opt/homebrew/bin/atlas
    ```

## Setup Env Vars

```env
# Should be an empty database
LOCAL_DB="postgres://root:secret@localhost:5432/app-svc?sslmode=disable&search_path=public"
LOCAL_DB1="postgres://root:secret@localhost:5432/app-svc1?sslmode=disable&search_path=public"

MIGRATION_DIR=migrations

# Your production/test/development database
# **NOTE**: Credentials should be for migraiton user
REMOTE_DB="postgres://{user}:{secret}@{host}:{port}/{db-name}?search_path={schema-name}"

# Not to be confused with development database
DEV_DB="postgres://root:secret@localhost:5432/dev_db?sslmode=disable?search_path=public"

SCHEMA=public
```

## Setup

### Run initial migrations

#### Go

Go to repository and setup `.env` file. For database, use `app-db` created above(i.e. `LOCAL_DB`). Then run below command

```sh
make migrate
```

### Capture DB State

We then capture the migrations ran in [above step](#run-initial-migrations) in SQL file and will serve as our initial schema.

```sh
mkdir -p $MIGRATION_DIR;

atlas schema inspect \
  --format '{{ sql . " " }}' \
  -u "${LOCAL_DB}" > ${MIGRATION_DIR}/`date '+%Y%m%d%H%M%S'`_initial_schema.sql

# File: $MIGRATION_DIR/20230421121212_initial_schema.sql
```

**Note**:

1. You might get `schema` creation SQL as well. Remove it.

    ```sql
    -- Add new schema named "public"
    CREATE SCHEMA IF NOT EXISTS "public";
    -- Set comment to schema: "public"
    COMMENT ON SCHEMA "public" IS 'standard public schema';

    ```

Apply the schema in `LOCAL_DB1`

```sh
atlas migrate hash --dir file://${MIGRATION_DIR};
atlas migrate apply \
    --dir "file://${MIGRATION_DIR}" \
    --url "${LOCAL_DB1}" \
    --revisions-schema ${SCHEMA}
```

Find diff with `LOCAL_DB`

```sh
atlas schema diff \
  --format '{{ sql . " " }}' \
  --to "${LOCAL_DB}" \
  --from "${LOCAL_DB1}" \
  --dev-url ${DEV_DB}
```

This should output following statement

```sql
-- Drop "atlas_schema_revisions" table
DROP TABLE "public"."atlas_schema_revisions";
```

Fetch `atlas_schema_revisions` revision table to be used in production DB

```sh
pg_dump --no-owner --table atlas_schema_revisions $LOCAL_DB1 > /tmp/atlas_schema_revisions.sql
```

Setup data in `atlas_schema_revisions`

- This is to test this script
- Later on we'll run the same script for production database

```sh
# Local DB
psql ${LOCAL_DB} < /tmp/atlas_schema_revisions.sql

# Remote DB
psql ${REMOTE_DB} < /tmp/atlas_schema_revisions.sql
```

### Finding Diff with Remote DB

If you wish to find the difference b/w your current migrations setup(say for go we currently use `gorm`) with what we have in remote database, we can run following command

```sh
atlas schema diff \
  --format '{{ sql . " " }}' \
  --to "${LOCAL_DB}" \
  --from "${REMOTE_DB}" \
  --dev-url ${DEV_DB}
```

This will print out any commands that one can use to to execute on `REMOTE_DB` to bring it in sync with `LOCAL_DB`.

For eg:

1. If output has

    ```sql
    ALTER TYPE "public"."state_enum" ADD VALUE 'Completed';
    ```

    it means, `LOCAL_DB` has an enum `state_enum` with value `Completed` but that value is not present in `REMOTE_DB`
1. If output has

    ```sql
    ALTER TABLE "public"."mytable" DROP COLUMN "is_active"
    ```

    it means, `LOCAL_DB` doesn't have any index on `mytable` but `REMOTE_DB` has one.
