# DB Migration Action

## Features

1. Ensure auditable database migrations
1. Ensure necessary approvals are in place before running the migrations. This is handled using GitHub teams
1. List files being considered for migrations.
1. Ignore draft PRs
1. Trigger works when
   1. When pull request is either opened, reopened or synchronized
   1. When pull request is approved

## Setup

### One Time Setup

1. Create a new AWS Secret manager(say `/prod/db-migration-secret`) to hold db connection strings for all services within the organization.
1. Create GitHub Token
  Create a classic token (Fine-grained token has not been tested). Permission scopes required
   1. `repo:status`
   1. `public_repo`
   1. `read:org` : To read github teams
1. Setup secrets
   1. Organization secrets
      1. Add `DB_MIGRATION_GITHUB_TOKEN` with value obtained by creating new github token
      1. Add `DB_MIGRATION_SECRET_STORE` secret pointing to AWS secret name

### Repository Setup

1. Add a new connection string in format `{SVC_NAME}_DB_URL`, say `MY_SVC_DB_URL` in AWS secret identified by `DB_MIGRATION_SECRET_STORE`.
    > **URL Format**: `postgres://{user}:{password}@{host}:{port}/{dbName}`
    >
    > **NOTE**: *DBA* should add the connection string and hand over the variable name to service team
1. Add following workflow file `db-migration.yml`

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
          (github.event_name == 'pull_request_review' && github.event.review.state == 'approved' && !github.event.pull_request.draft) ||
          (github.event_name == 'pull_request' && !github.event.pull_request.draft)
        name: DB Migration
        steps:
          - name: Approval check and migration run flow
            uses: varunnayal-org/database-migration-action
            # ## Used "run" command for local testing
            # run: node database-migration-action/dist/index.js
            with:
              repo_token: ${{ secrets.DB_MIGRATION_GITHUB_TOKEN }} # custom repo token
              aws_secret_store: ${{ secrets.DB_MIGRATION_SECRET_STORE }}
              debug: ${{ env.DEBUG }} # defaults to false
              # db_migration_echo_url: ${{ vars.DB_MIGRATION_ECHO_URL }}
    ```

1. Add migration config file `db.migration.json`

    ```jsonc
    {
      // Base directory where migrations are present
      // Defaults: './migrations'
      "baseDirectory": "./migrations",

      // When PR is created, this label is added to PR for reporting purpose
      // Default: db-migration
      "pr_label": "db-migration",

      // Teams that should approve the PR
      // If "data" and "dba" is missing and only one team is provided, it is considered as the
      // service owner team. In this case "data" and "dba" team will be added by default.
      "teams": ["data", "dba", "go-svc-team"],


      "databases": [
        {
          // directory within "baseDirectory" where migration files are present.
          // If they are present in "baseDirectory", then use "."
          // Default: "."
          "directory": ".",

          // Table to log migrations
          // Default: "migrations"
          "migration_table": "migrations",

          // env MY_SVC_DB_URL should be added in AWS secret manager
          "envName": "" // Add Secret Name added in AWS secret
        }
      ]
    }

    ```

### Bare Minimum Setup

1. Use following `db.migration.json` file in root directory of service

    ```json
    {
      "approvalTeams": ["dba", "data"],
      "ownerTeams": ["go-svc-team"],
      "databases": [
        {"envName": "//add_secret_name_from_aws_secret_manager"}
      ]
    }
    ```

    Here

    - `baseDirectory`: Defaults to `./migrations`
    - `approvalTeams`: GitHub teams that can approve the PRs
    - `ownerTeams`: GitHub teams that can execute schema migration using PR comment
    - `database.{idx}.directory`: Defaults to `"."` i.e. `baseDirectory`
    - `database.{idx}.envName`: Required. Connection URL for database. Eg: `postgres://{user}:{pass}@{host}:{port}/{dbName}`

1. Use `db-migration.yml` specified above
