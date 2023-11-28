# Local Development

## Prerequisites

1. Ensure sample event files are handy
1. Install [nektos/act](https://github.com/nektos/act)
1. Setup postgres. Say, connection URL is `postgres://user:pass@localhost:5432/migration-db`
1. Start `ngrok`. Use [ngrok.yml](https://ngrok.com/docs/agent/config/) or run `ngrok config check` to find configuration file location

    ```sh
    # Sample conf
    cat ngrok.yml
    version: "2"
    authtoken: xxxxx
    tunnels:
      localstack:
        addr: 4566
        proto: http
      postgres:
        addr: 5432
        proto: tcp
    ```

   1. Start ngrok using command `ngrok start --all`. Take note of `postgres` and `localstack` URL.
   1. Say, PG_URL=`ngrok-pg-url`
1. Install [localstack](https://docs.localstack.cloud/getting-started/installation/). Start it using command `localstack stard -d` and setup secret

    ```sh
    # Picked from ngrok localstack endpoint for port 4566
    export AWS_ENDPOINT_URL='https://0841-14-97-218-254.ngrok-free.app'
    export AWS_ACCESS_KEY_ID='dummy' # keep value as dummy
    export AWS_SECRET_ACCESS_KEY='dummy'  # keep value as dummy
    export AWS_REGION='ap-south-1'
    SECRET_NAME='/prod/db-migration-secret'

    # Get
    aws secretsmanager get-secret-value --secret-id $SECRET_NAME


    # Create
    secretsmanager create-secret --name $SECRET_NAME --secret-string \
    '{"DB_URL": "postgres://postgres://user:pass@host:port/dbname"}'

    # Update
    secretsmanager put-secret-value --name $SECRET_NAME --secret-string \
    '{"DB_URL": "postgres://postgres://user:pass@host:port/dbname"}'
    ```

### Testing from workflow repository

Say, we want to test it wrt `go-svc` repository where workflow has been added.

```sh
cd go-svc

git clone git@github.com:varunnayal-org/database-migration-action.git && \
  cd database-migration-action && \
  nvm use && \
  npm ci
```

#### Update workflow file

If your workflow file is

```yml
db-migration-approval-flow:
    runs-on: ubuntu-latest
    name: DB Migration
    steps:
      - name: Approval check and migration run flow
        uses: varunnayal-org/database-migration-action
        env:
          DB_URL: ${{ vars.DB_URL }} # Change it to secrets later one
        with:
          repo_token: ${{ secrets.DB_MIGRATION_GITHUB_TOKEN }} # custom repo token
          db_migration_echo_url: ${{ vars.DB_MIGRATION_ECHO_URL }}
          debug: ${{ vars.DEBUG }} # defaults to false
```

change it to

```yml
db-migration-approval-flow:
    runs-on: ubuntu-latest
    name: DB Migration
    steps:
      # Added checkout step <<<<<<<<< ADDED >>>>>>>>>
      - name: checkout repo
        uses: actions/checkout@v3

      - name: Approval check and migration run flow
        # Instead of uses, we can run locally <<<<<<<< ADDED >>>>>>>>
        run: node database-migration-action/dist/index.js
        env:
          DB_URL: ${{ vars.DB_URL }} # Change it to secrets later one
        with:
          repo_token: ${{ secrets.DB_MIGRATION_GITHUB_TOKEN }} # custom repo token
          db_migration_echo_url: ${{ vars.DB_MIGRATION_ECHO_URL }}
          debug: ${{ vars.DEBUG }} # defaults to false
```

> **NOTE**: Do not commit these change

### Env File

Create Env File. Use sample [.env.description](./.env.description)

```sh
cd database-migration-action
cp .env.description .env

export ENV_FILE=`pwd`/.env
```

### Execute

Use [nektos/act](https://github.com/nektos/act) to run actions.

> `db-migration-approval-flow` is the job name define in workflow file above
> **NOTE**: The content of file should be picked from `require('@actions/github').context.payload`

1. To test PR created event

    ```sh
    act pull_request -v \
      -j db-migration-approval-flow \
      --var-file $ENV_FILE \
      --env-file $ENV_FILE \
      --secret-file $ENV_FILE \
      -e /path/to/sample/pr.json
    ```

1. To test PR approved event

    ```sh
    act pull_request_review -v \
      -j db-migration-approval-flow \
      --var-file $ENV_FILE \
      --env-file $ENV_FILE \
      --secret-file $ENV_FILE \
      -e /path/to/sample/pr-approved.json
    ```

1. To test PR comment event

    ```sh
    act issue_comment -v \
      -j db-migration-approval-flow \
      --var-file $ENV_FILE \
      --env-file $ENV_FILE \
      --secret-file $ENV_FILE \
      -e /path/to/sample/pr-comment.json
    ```
