# DB Migration Action

## Features

1. Ensure auditable database migrations
1. Ensure necessary approvals are in place before running the migrations. This is handled using GitHub teams
1. List files being considered for migrations.
1. Ignore draft PRs
1. Trigger works when
   1. When pull request is either opened, reopened or synchronized
   2. When pull request is approved

## Integrations

### Github

#### Token Permission

Create a classic token (Fine-grained token has not been tested). Permission scopes required

- `repo:status`
- `public_repo`
- `read:org` : To read github teams

## Usage

1. Create a new github token and provide permissions mentioned [here](#token-permission)
1. Go the repository or organization setting and add an encrypted variable named `MIGRATION_GITHUB_TOKEN` with the token obtained in previous step
1. Add following workflow file

    <!-- TODO: Update if block and runs-on and uses and remove aws_* keys -->
    ```yml
    name: DB Migrations
    on:
      pull_request:
        types: [opened, reopened, synchronize]
      pull_request_review:
        types: [submitted]

    jobs:
      db-migration-approval-flow:
        runs-on: ubuntu-latest
        if: |
          (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') ||
          (github.event_name == 'pull_request')
        name: DB Migration
        steps:
          - name: Approval check and migration run flow
            uses: varunnayal-org/database-migration-action
            # ## Used "run" command for local testing
            # run: node database-migration-action/dist/index.js
            env:
              DB_URL: ${{ secrets.DB_CONNECTION_URL }}
            with:
              repo_token: ${{ secrets.MIGRATION_GITHUB_TOKEN }} # custom repo token
              debug: ${{ env.DEBUG }} # defaults to false
    ```

    Go the repository settings page and add `DB_CONNECTION_URL` secret variable.

1. Add migration config file `db.migration.json`
    ```jsonc
    {
      // Base directory where migrations are present
      // Defaults: './migrations'
      "base_directory": "./migrations",

      // Ignore this for now
      "secret_provider": {
        "provider": "aws",
        "path": "arn:aws:secretsmanager:ap-south-1:000000000000:secret:/prod/db-migration-secret-ymmjMl"
      },

      "tokens": {
        "github": "GH_TOKEN"
      },

      // When PR is created, this label is added to PR for reporting purpose
      // Default: db-migration
      "pr_label": "db-migration",

      // Base branch against which we
      "pr_base_branch": "master",

      // Teams that should approve the PR
      // If "data" and "dba" is missing and only one team is provided, it is considered as the
      // service owner team. In this case "data" and "dba" team will be added by default.
      "teams": ["data", "dba", "go-svc-team"],


      "databases": [
        {
          // directory within "base_directory" where migration files are present.
          // If they are present in "base_directory", then use "."
          // Default: "."
          "directory": ".",

          // Table to log migrations
          // Default: "migrations"
          "migration_table": "migrations",

          "url_path": "DB_URL"
        }
      ]
    }

    ```

## Local Development and Testing

### Prerequisites

1. Ensure sample event files are handy
1. Install [nektos/act](https://github.com/nektos/act)
1. Install localstack. Start is using command `localstack stard -d`.
    > [!NOTE]
    > We are not using AWS service, hence this step can be skipped.
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
   2. Say, PG_URL=`ngrok-pg-url`

#### Testing from workflow repository

Say, we want to test it wrt `go-svc` repo where workflow has been added.

```sh
cd go-svc

git clone git@github.com:varunnayal-org/database-migration-action.git && \
  cd database-migration-action && \
  nvm use && \
  npm ci
```

Update workflow file

```yml
# Change
uses: varunnayal-org/database-migration-action

# to
uses: database-migration-action
```

Create Env File. Use sample [.env.description](./.env.description)

```sh
cd database-migration-action
cp .env.description .env

export ENV_FILE=`pwd`/.env
```

Use [nektos/act](https://github.com/nektos/act) to run actions.

> `db-migration-approval-flow` is the job name define in workflow file

1. To test PR created event

    ```sh
    act pull_request -v \
      -j db-migration-approval-flow \
      --input-file $ENV_FILE \
      --secret-file $ENV_FILE \
      -e /path/to/sample/pr-opened.json
    ```

1. To test PR approved event

    ```sh
    act pull_request_review -v \
      -j db-migration-approval-flow \
      --input-file $ENV_FILE \
      --secret-file $ENV_FILE \
      -e /path/to/sample/pr-approved.json
    ```
