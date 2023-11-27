# Integrating with current repository

## Prerequisites

1. Setup Postgres locally at port 5432 with credentials as user=`admin` and password=`pass`
    > We need two databases
    > - DB for the application, say `app-db`
    > - Dev DB (this will be empty database) say `dev-db` (Not to be confused with development database)

1. Install [atlas](https://github.com/ariga/atlas)

    ```sh
    curl -sSf https://atlasgo.sh | sh
    ```

## Setup Env Vars

```env
# Should be an empty database
LOCAL_APP_DB="postgres://admin:pass@localhost:5432/app-svc?sslmode=disable"

# Your production/test/development database
REMOTE_DB="postgres://{user}:{pass}@{host}:{port}/{db-name}"

# Not to be confused with development database
DEV_DB="postgres://admin:pass@localhost:5432/dev-db?sslmode=disable"
```

## Setup

### Run initial migrations

#### Go

Go to repository and setup `.env` file. For database, use `app-db` created above(i.e. `LOCAL_APP_DB`). Then run below command

```sh
make migrate
```

### Capture DB State

We then capture the migrations ran in [above step](#run-initial-migrations) in SQL file and will serve as our initial schema.

```sh
mkdir -p migrations

atlas schema inspect \
  --format '{{ sql . " " }}' \
  -u "${LOCAL_APP_DB}" > migrations/`date '+%Y%m%d%H%M%S'`_initial_schema.sql
```

**Note**:

1. You might get `schema` creation SQL as well. Remove it.

    ```sql
    -- Add new schema named "public"
    CREATE SCHEMA IF NOT EXISTS "public";
    -- Set comment to schema: "public"
    COMMENT ON SCHEMA "public" IS 'standard public schema';

    ```

### Finding Diff with Remove DB

If you wish to find the difference b/w your current migrations setup(say for go we currently use `gorm`) with what we have in remote database, we can run following command

```sh
atlas schema diff \
  --format '{{ sql . " " }}' \
  --to "${LOCAL_APP_DB}" \
  --from "${REMOTE_DB}" \
  --dev-url ${DEV_DB}
```

This will print out any commands that one can use to to execute on `REMOTE_DB` to bring it in sync with `LOCAL_APP_DB`.

For eg:

1. If output has

    ```sql
    ALTER TYPE "public"."state_enum" ADD VALUE 'Completed';
    ```

    it means, `LOCAL_APP_DB` has an enum `state_enum` with value `Completed` but that value is not present in `REMOTE_DB`
1. If output has

    ```sql
    ALTER TABLE "public"."mytable" DROP COLUMN "is_active"
    ```

    it means, `LOCAL_APP_DB` doesn't have any index on `mytable` but `REMOTE_DB` has one.
