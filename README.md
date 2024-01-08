# DB Migration Action

[![GitHub Super-Linter](https://github.com/varunnayal-org/database-migration-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter) ![CI](https://github.com/varunnayal-org/database-migration-action/actions/workflows/ci.yml/badge.svg) [![Check dist/](https://github.com/varunnayal-org/database-migration-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/varunnayal-org/database-migration-action/actions/workflows/check-dist.yml) [![CodeQL](https://github.com/varunnayal-org/database-migration-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/varunnayal-org/database-migration-action/actions/workflows/codeql-analysis.yml)[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

Flow diagram: [flow.puml](./docs/diagrams/flow.puml)

![./docs/diagrams/flow.puml](https://www.plantuml.com/plantuml/svg/dLRVJzim47xFNt7YQOkenCEUAiGOK0qc0LM7zeAgoeqFuYcrixFJhflslo_dn2qnBfhsLFcxxtv_EJYtJf1hLbMMsK9K21zEJc2Zf2jRm0c7W6lKRa5Oe5gZXDFJeZIgmBEpJ9lMNE6J0_CKqRA7ROqCVrRkkbbsrWnW1DDP_mE4QuMRy2hCQiKSr18uS4ZFkD1oqMLzbPxKSydv8ru6aEUN7MJpt2UHIrYfP-AWahOZQdGCVrSa8YokX-kVpiPSyJl2zwP6ZV8Ox5ON9HcjVc7FctNTTJ-UB-gQ3C-c8rps3VU_BOLCWTRk9f4zvdCOZSxYqGwVdi4LJHZcH2b2A6D7wf4KDnIq9mSeQrltb2lQpXfzwqUaZEwxJ9goq21RuorbmtSg08pXCSzVxoxFv__ZpIi-uFgfhgljGKzswZSNv_YT0NIMetw7J86MSmJ2Si4B5biW8P6XX9w3lTz_Wf512CO53mAnBRpt7KdPVdzbi-nNm3sLmawODqyvt1blQsbt1YPaY6a1PKPK76UDauJCNnI9dMuWGZofrVThonWUIYIUGbD9M28KmgA5ZGUP1pVMDWZAycS9DQ5jlH9XRZIuKZZl3maD12s2BKEgngBaYg8DSAqNZQgaptnFBwPvBIoiWX3iFErxPuA77-p08ODaw30U7dwC_Gawz89DoN1AM0l2dIdRMKfX5sjHAUdnXHU07OfmU5QJ3lwwVjkXCF7eHxwp-xt91i4PVqvlbRLAFyFLHMlM6WllPHsre2Tq0kelfAZiCQWd8FpHAEBhoeiMHVTYljV1lxF30Cr68tMg4UIxk_V80ufLImoNVZWj_8b5i-yzCQlm5p31zeEQT5YOq-4nJGKv9IhO1U6eUx5upfLmOYai-ZQA2eNsy8qk314Mxi20ZIkHRB99BYheZXc3zvW_gx2U7anp_4e28yJ-sXHy3lVHOoGLFysACd3ziSpv2paas3JE7iDcO0nRV9EVLCKOjCaWQMANg9-twUcAugc_E15nz63XIt6EMl9_Tty1)

## Features

1. Ensure auditable database migrations
1. Ensure necessary approvals are in place before running the migrations. This is handled using GitHub teams
1. List SQL commands being considered for migrations.
1. Ignore draft PRs
1. Triggers points:
   1. When PR is either opened, reopened or synchronized
   1. When PR is approved
   1. When a comment is added on PR

## Todo

- [ ] Schedule migrations
- [ ] Single repository multi deployment
- [x] Add PR approval comment for teams mentioned in configuration
- [x] Closed PR?
- [ ] Schema changes after approval

### Action Items

- [x] JIRA integration for approval
- [x] Do not allow drop commands (Mention in Dev SOP). Can we use linters?
  - Can be handled using `atlas.hcl` file with configuration([issue](./docs/cases.md#drop-index-concurrently-issue))

    ```hcl
    lint {
      destructive {
        error = true
      }
    }
    ```

  - [x] Allow skipping of certain lint rules per PR basis: check [lint bypass checks](./docs/linting.md#bypass-checks)
- [ ] DBA SOP
- [x] Dry run on actual schema replica
  - [x] Can we use Postgres service
- [ ] How to kill long running migrations
- [ ] How to capture database drifts
- [ ] How can DBA run migrations manually instead of commands? Write an SOP for the same. How will be sync migration table?
- [x] A separate PR for migrations. Close PR if it contains business logic files
  [PR is auto-closed](./docs/cases.md#auto-close-pr)
- [ ] A PR template for migrations PRs
- [ ] Questions
  - [ ] Github action times out waiting for a long running migration to execute
  - [ ] Does every file change runs withing a transaction block
    By default, every file is wrapped withing a transaction block. Use [-- atlas:txmode none](./docs/cases.md#concurrent) to disable transaction mode.
  - [ ] [How to use lock_timeout and statement_timeout](https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries)
- [ ] Handle [out or order](./docs/cases.md#out-of-order) changes
  - [x] Will be solved in atlas v0.16.x release. Current release is [v0.15.0](https://github.com/ariga/atlas/releases/tag/v0.15.0).

### POC

- Create index
  - Concurrent indexes cannot be created within a transaction as they are executed outside the context of the transaction so that the do not block read/write ops.
  - Create index migrations should not be clubbed with any other migrations as we don't want them to run withing a transactional block.
  - You can have multiple `create index concurrently` commands within a single migration file.
  - Add following comment as the first line `-- atlas:txmode none`. Example file

    ```sql
    -- atlas:txmode none

    -- creating index on my_table
    create index concurrently idx_my_index on my_table(my_column)
    create index concurrently idx_my_index_2 on my_table_other(my_column)
    ```

## Setup

### One Time Setup

1. Create a new AWS Secret manager(say `/prod/db-migration-secret`) to hold db connection strings for all services within the organization.
1. Create GitHub Token
  Create a classic token (Fine-grained token has not been tested). Permission scopes required
   1. `repo:status`
   1. `public_repo`
   1. `read:org` : To read github teams
1. JIRA Integration
   1. Create a new Project. Eg: `SCHEMA`
   1. If you want to automatically set `GitHub PR link` and `GitHub Repo Link` to the JIRA issue, add them and note the the field ID. This will be required when setting up JIRA configuration
   1. Create a new JIRA API token. Steps
      1. Go to [API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens) page
      1. Click on *"Create API Token"* button
1. Setup secrets
   1. Organization secrets
      1. Add `DB_MIGRATION_GITHUB_TOKEN` with value obtained by creating new github token
      1. Add `DB_MIGRATION_SECRET_STORE` secret pointing to AWS secret name
   1. If JIRA is integrated, then add
      1. Secrets:
         1. `DB_MIGRATION_JIRA_USERNAME`: User using which token was created in above JIRA integration step.
         1. `DB_MIGRATION_JIRA_PASSWORD`: Token created above.
      1. Variables
         1. `DB_MIGRATION_JIRA_CONFIG`: JIRA configuration to be used by every org. See [JIRA Config](#jira-config).

### JIRA Config

`DB_MIGRATION_JIRA_CONFIG` is a JSON stringified object having following schema:

```jsonc
{
  "host": "{domain}.atlassian.net", // JIRA host
  "project": "SCHEMA",              // Project
  "issueType": "Story",             // Story, Task etc. Default "Story"
  "fields": {
    "pr" : "customfield_11111",     // Pull Request Link field
    "prLabel": "Label for pr field",// Label for "PR" field
    "repo" : "customfield_22222",   // Code Repo Link field
    "driApprovals": [],             // fields to check for DRI approvals
  },
  "approvalStatus": "DONE",         // Default to DONE. Value to check in "fields.driApprovals" field list
  "doneValue": "Done"               // Defaults to Done. JIRA issue value to check before.
}
```

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
            uses: varunnayal-org/database-migration-action@v0.0.1
            with:
              repo_token: ${{ secrets.DB_MIGRATION_GITHUB_TOKEN }} # custom repo token
              aws_secret_store: ${{ secrets.DB_MIGRATION_SECRET_STORE }}
              jira_username: ${{ secrets.DB_MIGRATION_JIRA_USERNAME }}
              jira_password: ${{ secrets.DB_MIGRATION_JIRA_PASSWORD }}
              jira_config: ${{ vars.DB_MIGRATION_JIRA_CONFIG }}
              # dev_db_url: "postgres://postgres:postgres@postgres:5432/test?sslmode=disable"
              # dev_db_url: ${{ secrets.DB_MIGRATION_DEV_DB_URL }}
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

          // env MY_SVC_DB_URL should be added in AWS secret manager
          "envName": "" // Add Secret Name added in AWS secret

          // pg schema name where migration revision table resides
          // Default: public
          "schema": "",

          // A number in YYYYMMDDHHMMSS format. If passed, migrations till this revision will be skipped
          "baseline": 0,
        }
      ]
    }

    ```

### Bare Minimum Setup

1. Use following `db.migration.json` file in root directory of service

    ```json
    {
      "serviceName": "{name of the service}",
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
