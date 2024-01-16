# DB Migration Action

[![GitHub Super-Linter](https://github.com/varunnayal-org/database-migration-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter) ![CI](https://github.com/varunnayal-org/database-migration-action/actions/workflows/ci.yml/badge.svg) [![Check dist/](https://github.com/varunnayal-org/database-migration-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/varunnayal-org/database-migration-action/actions/workflows/check-dist.yml) [![CodeQL](https://github.com/varunnayal-org/database-migration-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/varunnayal-org/database-migration-action/actions/workflows/codeql-analysis.yml)[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

Flow diagram: [flow.puml](./docs/diagrams/flow.puml)

![./docs/diagrams/flow.puml](https://www.plantuml.com/plantuml/svg/xLNDRkCs4BxpAGPxQeKri8UUZ4MwFp6wAJQEuGQz18P1IvE8XKogf6JNBVhkvL0QsQBffkXrVPBupJV_m-47rqZRjDjAk5nM23-yUmTxLJIb45xI8E0ETREscAFQOG7lt-UbKJdUt0XjlBZ2vmRCSqGJZuSQ2Vv9DL_QJISL01DOBFiFMDmftFCfDzijSL0NG8RPFU5I5-lEwvbxgrvAyX_nlDKi-zn1Bik2as83M_LYoMXX3nFRwXZ-JLaPON4y5FzYEQM8lxFulQbHO_4Mt47dfJLQ_OazRzbbrtq2NzQrDLIRZl2vJxZ_UeerEJetL48yPIkOJ6xYqewFWK4HpGWcHoa2Xp6GUYJ5vO1Eo1ohJprGRkrXsUhxK29bT9zbKYGuGPB6NHBZSye0JE4foyvxbsMh_wDDBRwW-h6kgyD5JQ_48n3x-4i0T98tt4DF0Szv0z9Hm6iVy43AfQRpkbAwEPrdbgErnhuYxU24dASdmH02nhufwQ_qurCze5kbv7F336rMPE4hIuvX2k13B-EKExLEk3fdVImAlnxATiCJukcbTBEEBi0xZxpnsC3e_BgnbCBS19cdpGtC_1_H62L6L4ho6ZjXppyhAuSx0X4IIFukdqkcy5YYfPwrLG4R6Ws73lO191xSETSYA4Sh26gBpcibpDnfQ4hP17r8p3lVEt0bkseT5ZwYACaGwwTMLKNm_61Fglb5EjZoqBjLMdTkJZJcPgGW86cQoqF5Zx6_-Sw5ovcwSWkBjRGuYCGWyTrVxsIbYe2lmm2uyPKPFo59XV2I_3gWC0leZ-5D6VfMj0YD2K_7lN9EwHUu_UJ5McCUj5nZFHW8tG3rhu6it5jGps3nzrPPUaceqJBlJe5FZVxlR2wWsMkqtTH86x9x2CWZogqdygishXR-WNbxp3rHAtxj4-nGg1bZNPqkbsdXerAoWi48MJqEI-3SoaPkfCEGHbwXr06-qxcnrXVsGe5DKw9roIGfA9uxOepEKxfMt9uUJ7D2IvZ1jdzfSrhzH-inahQVOaKUA7xUgDTTUDs5rrrutONVyYwCnvnkoCM1JUAaCKu6fd30V-Udfc8AcdgO4dcLE9_NwAc8uggVh8ZOEalyflY0kcYtrJy0)

- [DB Migration Action](#db-migration-action)
  - [Features](#features)
  - [Todo](#todo)
    - [Action Items](#action-items)
    - [POC](#poc)
  - [Setup](#setup)
    - [One Time Setup](#one-time-setup)
      - [AWS](#aws)
      - [Jira](#jira)
      - [Github](#github)
    - [JIRA Config](#jira-config)
    - [Repository Setup](#repository-setup)
    - [Bare Minimum Setup](#bare-minimum-setup)


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
- [ ] How to kill long running migrations: 
  > It's going to be a manual process where DBA can refer/use [pg_terminate_backend](https://stackoverflow.com/a/35319598) command.
- [ ] How to capture database drifts
  > We can use `atlas schema diff` command to find the different b/w what's there in migration directory to production.
  > More [here](https://atlasgo.io/declarative/diff#compare-a-migration-directory-to-a-database).
  - [ ] Create a daily cron to capture drifts
- [ ] How can DBA run migrations manually instead of commands? Write an SOP for the same. How will DBA sync migration table?
- [x] A separate PR for migrations. Close PR if it contains business logic files
  [PR is auto-closed](./docs/cases.md#auto-close-pr)
- [x] A PR template for migrations PRs: [pull_request_template](./docs/pull_request_template.md)
- [ ] Questions
  - [ ] Github action times out waiting for a long running migration to execute: Check for re-running. I think advisory locks will prevent execution.
  - [x] Does every file change runs withing a transaction block?

    By default, every file is wrapped withing a transaction block.

    Use [-- atlas:txmode none](./docs/cases.md#concurrent) to disable transaction mode.
  - [ ] [How to use lock_timeout and statement_timeout](https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries)

    Issue [#2345](https://github.com/ariga/atlas/issues/2345) not closed yet

- [x] Handle [out or order](./docs/cases.md#out-of-order-execution) changes: Already handled by atlas

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

This setup is require only one time per organization that includes

- AWS Secrets that will eventually hold migration user DB credentials
- JIRA integration including a board, setting up fields and API token
- Github token and setting up organizational secrets

#### AWS

1. Create a new AWS Secret manager(say `/prod/db-migration-secret`) to hold db connection strings for all services within the organization.

#### Jira

1. JIRA Integration
   1. Create a new Project. Eg: `SCHEMA`
   1. If you want to automatically set `GitHub PR link` and `GitHub Repo Link` to the JIRA issue, add these fields and note the the field ID. This will be required when setting up JIRA configuration
   1. Create a new JIRA API token. Steps
      1. Navigate to the [API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens) page
      1. Click on *"Create API Token"* button
      1. Note down the generated token.

#### Github

1. Create GitHub Token: We can either create `fine-grained` token or classic token.
   1. fine-grained token.
      1. Navigate to [token creation screen](https://github.com/settings/personal-access-tokens/new)
      1. Navigate to  `Resource owner` dropdown and select the organization.
      1. Permission Set required:
         1. `Organization Permissions`
            1. Read access to members
         1. `Repository Permissions`
            1. Read access to metadata
            1. Read and Write access to pull requests
   1. Classic token: Permission required:
      1. `repo:status`
      1. `public_repo`
      1. `read:org` : To read github teams
1. Setup secrets
   1. GitHub Organization secrets
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
    > **URL Format**: `postgres://{user}:{password}@{host}:{port}/{dbName}&search_path={schema=public}`
    >
    > **NOTE**: *DBA* should add the connection string and hand over the variable name to service team

    1. **search_path**: It defaults to `public`, but should always be mentioned. Otherwise, you might get errors because of other schemas in the system 
2. Add following workflow file `db-migration.yml`

    ```yml
    name: Schema Migration GitOps
    on:
      pull_request:
        types: [opened, reopened, synchronize]
      pull_request_review:
        types: [submitted]

    jobs:
      schema-migration:
        runs-on: ubuntu-latest
        name: Schema Migration
        if: |
          (github.event_name == 'pull_request' && !github.event.pull_request.draft) ||
          (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') ||
          (github.event_name == 'issue_comment' && startsWith(github.event.comment.body, 'db migrate'))
        services:
          postgres:
            image: postgres:13.8  # use your service's PG version
            env:
              POSTGRES_DB: test
              POSTGRES_PASSWORD: postgres
              POSTGRES_EXTENSIONS: "uuid-ossp"
            ports:
              - 5432:5432
            options: >-
              --health-cmd pg_isready
              --health-interval 2s
              --health-timeout 1s
              --health-retries 25
        steps:
          ## To read secret tore, either provide AWS_* env var or let action assume the role that can read `aws_secret_store`
          ## - name: Configure AWS credentials
          ##   uses: aws-actions/configure-aws-credentials@v4
          ##   with:
          ##     role-to-assume: arn:aws:iam::{{account-id}}:role/{{role-name}}
          ##     aws-region: ap-south-1

          - name: Migration
            uses: varunnayal-org/database-migration-action@v0.0.1
            with:
              repo_token: ${{ secrets.DB_MIGRATION_GITHUB_TOKEN }} # custom repo token
              aws_secret_store: ${{ secrets.DB_MIGRATION_SECRET_STORE }}

              ## If jira integration is enabled
              jira_username: ${{ secrets.DB_MIGRATION_JIRA_USERNAME }}
              jira_password: ${{ secrets.DB_MIGRATION_JIRA_PASSWORD }}
              jira_config: ${{ vars.DB_MIGRATION_JIRA_CONFIG }}
              dev_db_url: "postgres://postgres:postgres@postgres:5432/test?sslmode=disable"
    ```

3. Add migration config file `db.migration.json`

    ```jsonc
    {
      // Name of the service. Required
      "service_name": "my-app",

      // Base directory where migrations are present
      // Defaults: './migrations'
      "baseDirectory": "./migrations",

      // When PR is created, this label is added to PR for reporting purpose
      // Default: db-migration
      "pr_label": "db-migration",

      // Github team that owns the repository
      // The member of this team can run migration
      "ownerTeams": ["data", "dba", "go-svc-team"],

      "databases": [
        {
          // directory within "baseDirectory" where migration files are present.
          // If they are present in "baseDirectory", then use "."
          // Default: "."
          "directory": ".",

          // env MY_SVC_DB_URL should be added in AWS secret manager
          "envName": "" // Add Secret Name added in AWS secret

          // A number in YYYYMMDDHHMMSS format. If passed, migrations till this revision will be skipped
          "baseline": 0,
        }
      ]
    }

    ```

### Bare Minimum Setup

Following is the bare minimum setup required for service dealing with single database

1. Use following `db.migration.json` file in root directory of service

    ```json
    {
      "serviceName": "{name of the service}",
      "ownerTeams": ["svc-team"],
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
    - `database.{idx}.envName`: Required. Connection URL for database. Eg: `postgres://{user}:{pass}@{host}:{port}/{dbName}&search_path=public`

1. Use `db-migration.yml` specified above
