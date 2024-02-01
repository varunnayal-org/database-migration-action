import { Platform } from '../../src/formatting/formatters'
import { TextBuilder } from '../../src/formatting/text-builder'
import { DriftRunListResponse, MigrationLintResponse, MigrationRunListResponse } from '../../src/types'
import * as util from '../../src/util'
import * as c from '../common'
import { AtlasDriftResponse, AtlasLintResponse, AtlasMigrationExecutionResponse } from '../../src/migration/atlas-class'
import { LINT_CODE_DEFAULT_PREFIXES } from '../../src/constants'

describe('TexBuilder', () => {
  const getTextBuilder = (dryRun = false, dbDirList = ['migrations']): TextBuilder =>
    new TextBuilder(dryRun, 'https://github.com/org/repo/pull/1', 'https://github.com/org/repo', dbDirList)

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(util, 'readableDate').mockReturnValue('12/22/2023, 8:45:06 AM')
    process.env.GITHUB_RUN_ID = '11'
    process.env.GITHUB_RUN_ATTEMPT = '22'
  })

  describe('getFormatter', () => {
    it('should return formatter for github', () => {
      const textBuilder = getTextBuilder()
      const formatter = textBuilder.getFormatter('github')
      expect(formatter).toBeDefined()
    })
    it('should return formatter for jira', () => {
      const textBuilder = getTextBuilder()
      const formatter = textBuilder.getFormatter('jira')
      expect(formatter).toBeDefined()
    })
    it('should return undefined for unknown formatter', () => {
      const textBuilder = getTextBuilder()
      expect(textBuilder.getFormatter('unknown' as Platform)).toBeUndefined()
    })
  })

  const platforms: Platform[] = ['github', 'jira']

  describe('build()', () => {
    type BuildTextParams = {
      name: string
      args: MigrationRunListResponse
      github: string
      jira: string
    }

    const testCases: BuildTextParams[] = [
      {
        name: 'should print migration execution on successful',
        args: {
          migrationAvailable: true,
          executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.successful_migration)],
          errMsg: undefined
        },
        github:
          '✅ **Migrations successful** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n*Directory*: **migrations**\n| Status | File | Executed Statements | Error | Error Statement |\n| --- | --- | --- | --- | --- |\n|✅|20231129060014_add_user.sql|2|-|-|\n|✅|20231206212844_add_column.sql|1|-|-|\n\n\n<details><summary>SQL Statements</summary>\n\n```sql\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n```\n</details>',
        jira: '(/) *Migrations successful* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n_Directory_: *migrations*\n||Status||File||Executed Statements||Error||Error Statement||\n|(/)|20231129060014_add_user.sql|2|-|-|\n|(/)|20231206212844_add_column.sql|1|-|-|\n\n\n{code:title=SQL Statements|borderStyle=solid}\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n{code}'
      },
      {
        name: 'should return no migration available',
        args: {
          migrationAvailable: false,
          executionResponseList: [],
          errMsg: undefined
        },
        github:
          '❌ **Migrations failed** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n> No migrations available\n',
        jira: '(x) *Migrations failed* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n{quote}\nNo migrations available\n{quote}'
      },
      {
        name: 'should return errMsg if migration available is false',
        args: {
          migrationAvailable: false,
          executionResponseList: [],
          errMsg: 'error when migrationAvailable=false and errMsg is present'
        },
        github:
          '❌ **Migrations failed** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n> error when migrationAvailable=false and errMsg is present\n',
        jira: '(x) *Migrations failed* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n{quote}\nerror when migrationAvailable=false and errMsg is present\n{quote}'
      },
      {
        name: 'should print error with execution errors',
        args: {
          migrationAvailable: false,
          executionResponseList: [AtlasMigrationExecutionResponse.fromError('some error')],
          errMsg: 'should print error with execution errors'
        },
        github:
          '❌ **Migrations failed** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n> should print error with execution errors\n\n*Directory*: **migrations**: No migration available\n\n\n<details><summary>SQL Statements</summary>\n\n```sql\n-- DIRECTORY: migrations\n    -- No migration available\n```\n</details>',
        jira: '(x) *Migrations failed* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n{quote}\nshould print error with execution errors\n{quote}\n_Directory_: *migrations*: No migration available\n\n\n{code:title=SQL Statements|borderStyle=solid}\n-- DIRECTORY: migrations\n    -- No migration available\n{code}'
      },
      {
        name: 'should print migration execution when some migrations failed',
        args: {
          migrationAvailable: true,
          executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.some_migration_failed)],
          errMsg: 'pq: table "users.bkp" does not exist'
        },
        github:
          '❌ **Migrations failed** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n> pq: table "users.bkp" does not exist\n\n*Directory*: **migrations**\n| Status | File | Executed Statements | Error | Error Statement |\n| --- | --- | --- | --- | --- |\n|✅|20231129060014_add_user.sql|2|-|-|\n|❌|20231206212844_add_column.sql|1|pq: table "users.bkp" does not exist|ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);|\n\n\n<details><summary>SQL Statements</summary>\n\n```sql\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n```\n</details>',
        jira: '(x) *Migrations failed* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n{quote}\npq: table "users.bkp" does not exist\n{quote}\n_Directory_: *migrations*\n||Status||File||Executed Statements||Error||Error Statement||\n|(/)|20231129060014_add_user.sql|2|-|-|\n|(x)|20231206212844_add_column.sql|1|pq: table "users.bkp" does not exist|ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);|\n\n\n{code:title=SQL Statements|borderStyle=solid}\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n{code}'
      },
      {
        name: 'should print migration execution when all migrations failed',
        args: {
          migrationAvailable: true,
          executionResponseList: [AtlasMigrationExecutionResponse.build(c.executionMap.all_migration_failed)],
          errMsg: 'pq: table "users.bkp" does not exist'
        },
        github:
          '❌ **Migrations failed** 12/22/2023, 8:45:06 AM [View](https://github.com/org/repo/actions/runs/11/attempts/22)\n> pq: table "users.bkp" does not exist\n\n*Directory*: **migrations**\n| Status | File | Executed Statements | Error | Error Statement |\n| --- | --- | --- | --- | --- |\n|❌|20231129060014_add_user.sql|2|pq: table "users.bkp" does not exist|ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);|\n|❌|20231206212844_add_column.sql|1|pq: column "phone" of relation "users" already exists|ALTER TABLE "users" ADD COLUMN "phone" varchar(13);|\n\n\n<details><summary>SQL Statements</summary>\n\n```sql\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n```\n</details>',
        jira: '(x) *Migrations failed* 12/22/2023, 8:45:06 AM [View|https://github.com/org/repo/actions/runs/11/attempts/22]\n{quote}\npq: table "users.bkp" does not exist\n{quote}\n_Directory_: *migrations*\n||Status||File||Executed Statements||Error||Error Statement||\n|(x)|20231129060014_add_user.sql|2|pq: table "users.bkp" does not exist|ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);|\n|(x)|20231206212844_add_column.sql|1|pq: column "phone" of relation "users" already exists|ALTER TABLE "users" ADD COLUMN "phone" varchar(13);|\n\n\n{code:title=SQL Statements|borderStyle=solid}\n-- DIRECTORY: migrations\n-- File: 20231129060014_add_user.sql\nCREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));\nALTER TABLE "users" ADD COLUMN "phone" varchar(13);\n\n-- File: 20231206212844_add_column.sql\nALTER TABLE "users" ADD COLUMN "email" varchar(255);\n{code}'
      }
    ]
    for (const platform of platforms) {
      describe(`${platform}`, () => {
        for (const tc of testCases) {
          if (tc[platform] === undefined) continue

          it(`${tc.name}`, async () => {
            const textBuilder = getTextBuilder()
            const expectedOutput = tc[platform]

            const result = textBuilder.platform[platform].run(tc.args)
            // console.log('#'.repeat(40), '\n', `${platform}.${tc.name}`, '\n', result, '\nCopy This:\n', result.split('\n').join('\\n'), '\n', '*'.repeat(40))

            expect(result).toBe(expectedOutput)
          })
        }
      })
    }
  })

  describe('getLintMessage', () => {
    type LintTextParams = {
      name: string
      args: MigrationLintResponse
      github: string
      jira: string
    }

    const lintTestCases: LintTextParams[] = [
      {
        name: 'file error',
        args: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        },
        github:
          '**Lint Errors**\n*Directory*: `mg1`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064941_step3.sql|executing statement: pq: column "email" does not exist|-|-|\n',
        jira: '*Lint Errors*\n_Directory_: {{mg1}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064941_step3.sql|executing statement: pq: column "email" does not exist|-|-|\n'
      },
      {
        name: 'error in multiple files',
        args: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        },
        github:
          '**Lint Errors**\n*Directory*: `mg1`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103](https://atlasgo.io/lint/analyzers#DS103)|344|\n|✅|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103](https://atlasgo.io/lint/analyzers#MF103)|286|\n|❌|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103](https://atlasgo.io/lint/analyzers#PG103)|0|\n|❌|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101](https://atlasgo.io/lint/analyzers#PG101)|60|\n',
        jira: '*Lint Errors*\n_Directory_: {{mg1}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103|https://atlasgo.io/lint/analyzers#DS103]|344|\n|(/)|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103|https://atlasgo.io/lint/analyzers#MF103]|286|\n|(x)|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103|https://atlasgo.io/lint/analyzers#PG103]|0|\n|(x)|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101|https://atlasgo.io/lint/analyzers#PG101]|60|\n'
      },
      {
        name: 'error in one file',
        args: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.multiple_linting_errors_in_one_file.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        },
        github:
          '**Lint Errors**\n*Directory*: `mg1`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103](https://atlasgo.io/lint/analyzers#PG103)|0|\n|❌|20231222064941_step3.sql|Creating index "idx_users_email" non-concurrently causes write locks on the "users" table|[PG101](https://atlasgo.io/lint/analyzers#PG101)|0|\n',
        jira: '*Lint Errors*\n_Directory_: {{mg1}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103|https://atlasgo.io/lint/analyzers#PG103]|0|\n|(x)|20231222064941_step3.sql|Creating index "idx_users_email" non-concurrently causes write locks on the "users" table|[PG101|https://atlasgo.io/lint/analyzers#PG101]|0|\n'
      },
      {
        name: 'multiple db errors',
        args: {
          lintResponseList: [
            AtlasLintResponse.build(
              c.artifacts.multiple_linting_errors_in_one_file.lintResponseOutput.mg1,
              'mg1',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            ),
            AtlasLintResponse.build(
              c.artifacts.no_lint_error.lintResponseOutput.mg1,
              'mg2',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            ),
            AtlasLintResponse.build(
              c.artifacts.sql_file_error_lint_skipped.lintResponseOutput.mg1,
              'mg3',
              [],
              LINT_CODE_DEFAULT_PREFIXES
            ),
            AtlasLintResponse.build(
              c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
              'mg4',
              ['PG103', 'PG103'],
              LINT_CODE_DEFAULT_PREFIXES
            ),
            // should not print
            AtlasLintResponse.build(
              c.artifacts.multiple_linting_errors_in_multiple_files.lintResponseOutput.mg1,
              'mg5',
              ['PG101', 'PG103', 'DS103'],
              LINT_CODE_DEFAULT_PREFIXES
            )
          ],
          errMsg: 'Not used',
          canSkipAllErrors: false
        },
        github:
          '**Lint Errors**\n*Directory*: `mg1`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103](https://atlasgo.io/lint/analyzers#PG103)|0|\n|❌|20231222064941_step3.sql|Creating index "idx_users_email" non-concurrently causes write locks on the "users" table|[PG101](https://atlasgo.io/lint/analyzers#PG101)|0|\n\n*Directory*: `mg3`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064941_step3.sql|executing statement: pq: column "email" does not exist|-|-|\n\n*Directory*: `mg4`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|❌|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103](https://atlasgo.io/lint/analyzers#DS103)|344|\n|✅|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103](https://atlasgo.io/lint/analyzers#MF103)|286|\n|✅|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103](https://atlasgo.io/lint/analyzers#PG103)|0|\n|❌|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101](https://atlasgo.io/lint/analyzers#PG101)|60|\n\n*Directory*: `mg5`\n| Skipped | File | Error | Error Code | Position |\n| --- | --- | --- | --- | --- |\n|✅|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103](https://atlasgo.io/lint/analyzers#DS103)|344|\n|✅|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103](https://atlasgo.io/lint/analyzers#MF103)|286|\n|✅|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103](https://atlasgo.io/lint/analyzers#PG103)|0|\n|✅|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101](https://atlasgo.io/lint/analyzers#PG101)|60|\n',
        jira: '*Lint Errors*\n_Directory_: {{mg1}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103|https://atlasgo.io/lint/analyzers#PG103]|0|\n|(x)|20231222064941_step3.sql|Creating index "idx_users_email" non-concurrently causes write locks on the "users" table|[PG101|https://atlasgo.io/lint/analyzers#PG101]|0|\n\n_Directory_: {{mg3}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064941_step3.sql|executing statement: pq: column "email" does not exist|-|-|\n\n_Directory_: {{mg4}}\n||Skipped||File||Error||Error Code||Position||\n|(x)|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103|https://atlasgo.io/lint/analyzers#DS103]|344|\n|(/)|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103|https://atlasgo.io/lint/analyzers#MF103]|286|\n|(/)|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103|https://atlasgo.io/lint/analyzers#PG103]|0|\n|(x)|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101|https://atlasgo.io/lint/analyzers#PG101]|60|\n\n_Directory_: {{mg5}}\n||Skipped||File||Error||Error Code||Position||\n|(/)|20231222064929_step2.sql|Dropping non-virtual column "old_email"|[DS103|https://atlasgo.io/lint/analyzers#DS103]|344|\n|(/)|20231222064929_step2.sql|Adding a non-nullable "character varying(50)" column "email" will fail in case table "users" is not empty|[MF103|https://atlasgo.io/lint/analyzers#MF103]|286|\n|(/)|20231222064941_step3.sql|Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction|[PG103|https://atlasgo.io/lint/analyzers#PG103]|0|\n|(/)|20231222064941_step3.sql|Creating index "idx_users_age" non-concurrently causes write locks on the "users" table|[PG101|https://atlasgo.io/lint/analyzers#PG101]|60|\n'
      }
    ]

    for (const platform of platforms) {
      describe(`${platform}`, () => {
        for (const tc of lintTestCases) {
          if (tc[platform] === undefined) continue

          it(`${tc.name}`, async () => {
            const textBuilder = getTextBuilder()
            const expectedOutput = tc[platform]

            const result = textBuilder.platform[platform].lint(tc.args.lintResponseList)
            // console.log( '#'.repeat(40), '\n', `${platform}.${tc.name}`, '\n', result, '\nCopy This:\n', result.split('\n').join('\\n'), '\n', '*'.repeat(40) )

            expect(result).toBe(expectedOutput)
          })
        }
      })
    }
  })

  describe('drift', () => {
    type DriftTextParams = {
      name: string
      args: DriftRunListResponse
      github: string
      jira: string
    }

    const dbDirs = ['migrations', 'mg2', 'mg3', 'mg4', 'mg5', 'mg6']

    const driftTestCases: DriftTextParams[] = [
      {
        name: 'schema drift',
        args: {
          hasSchemaDrifts: true,
          drifts: [AtlasDriftResponse.build('-- comment\ndrop table b;'), AtlasDriftResponse.build('')]
        },
        github:
          '\n*Directory*: **migrations**: ❌ Drifts present\n<details><summary>SQL Statements</summary>\n\n```sql\n-- comment\ndrop table b;\n\n```\n</details>\n\n*Directory*: **mg2**: ✅ No Drift',
        jira: '\n_Directory_: *migrations*: (x) Drifts present\n{code:title=SQL Statements|borderStyle=solid}\n-- comment\ndrop table b;\n\n{code}\n\n_Directory_: *mg2*: (/) No Drift'
      },
      {
        name: 'schema drift multiple dbs',
        args: {
          hasSchemaDrifts: true,
          drifts: [
            AtlasDriftResponse.build('-- comment\ndrop table b;'),
            AtlasDriftResponse.build(''),
            AtlasDriftResponse.build('-- comment2\ndrop table c;')
          ]
        },
        github:
          '\n*Directory*: **migrations**: ❌ Drifts present\n<details><summary>SQL Statements</summary>\n\n```sql\n-- comment\ndrop table b;\n\n```\n</details>\n\n*Directory*: **mg2**: ✅ No Drift\n*Directory*: **mg3**: ❌ Drifts present\n<details><summary>SQL Statements</summary>\n\n```sql\n-- comment2\ndrop table c;\n\n```\n</details>\n',
        jira: '\n_Directory_: *migrations*: (x) Drifts present\n{code:title=SQL Statements|borderStyle=solid}\n-- comment\ndrop table b;\n\n{code}\n\n_Directory_: *mg2*: (/) No Drift\n_Directory_: *mg3*: (x) Drifts present\n{code:title=SQL Statements|borderStyle=solid}\n-- comment2\ndrop table c;\n\n{code}\n'
      },
      {
        name: 'schema drift all dbs',
        args: {
          hasSchemaDrifts: true,
          drifts: [
            AtlasDriftResponse.build('-- comment\ndrop table b;'),
            AtlasDriftResponse.build('-- comment2\ndrop table c;')
          ]
        },
        github:
          '\n*Directory*: **migrations**: ❌ Drifts present\n<details><summary>SQL Statements</summary>\n\n```sql\n-- comment\ndrop table b;\n\n```\n</details>\n\n*Directory*: **mg2**: ❌ Drifts present\n<details><summary>SQL Statements</summary>\n\n```sql\n-- comment2\ndrop table c;\n\n```\n</details>\n',
        jira: '\n_Directory_: *migrations*: (x) Drifts present\n{code:title=SQL Statements|borderStyle=solid}\n-- comment\ndrop table b;\n\n{code}\n\n_Directory_: *mg2*: (x) Drifts present\n{code:title=SQL Statements|borderStyle=solid}\n-- comment2\ndrop table c;\n\n{code}\n'
      },
      {
        name: 'unwanted error',
        args: {
          hasSchemaDrifts: true,
          drifts: [AtlasDriftResponse.fromError('some error'), AtlasDriftResponse.fromError('some unwanted error')]
        },
        github: '\n*Directory*: **migrations**: ❌ some error\n*Directory*: **mg2**: ❌ some unwanted error',
        jira: '\n_Directory_: *migrations*: (x) some error\n_Directory_: *mg2*: (x) some unwanted error'
      }
    ]

    for (const platform of platforms) {
      describe(`${platform}`, () => {
        for (const tc of driftTestCases) {
          if (tc[platform] === undefined) continue

          it(`${tc.name}`, async () => {
            const textBuilder = getTextBuilder(false, dbDirs.slice(0, tc.args.drifts.length))
            const expectedOutput = tc[platform]

            const result = textBuilder.platform[platform].drift(tc.args)

            expect(result).toBe(expectedOutput)
          })
        }
      })
    }
  })

  it('title', () => {
    const b = getTextBuilder()

    expect(() => b.platform.github.title('any')).toThrow('Method not implemented.')
    expect(b.platform.jira.title('my_prefix')).toEqual('my_prefix: https://github.com/org/repo/pull/1')
  })

  it('description', () => {
    const b = getTextBuilder()

    expect(() => b.platform.github.description('any')).toThrow('Method not implemented.')
    expect(b.platform.jira.description('some comment')).toEqual(
      '\nPR Link: https://github.com/org/repo/pull/1\n\nsome comment\n'
    )
  })
})
