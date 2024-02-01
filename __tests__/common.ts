import path from 'path'
import { VersionExecution } from '../src/migration/atlas-class'
import { MigrationConfig } from '../src/types'
import {
  Branch,
  Comment,
  ContextPullRequest,
  ContextPullRequestComment,
  ContextPullRequestReview,
  ContextSchedule,
  PullRequest,
  PullRequestCommentPayload,
  PullRequestPayload,
  PullRequestReviewPayload,
  Repository,
  Review,
  SchedulePayload,
  User
} from '../src/types.gha'
import { TEMP_DIR_FOR_MIGRATION } from '../src/constants'
import mock from 'mock-fs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMockDirectories(): Record<string, any> {
  return {
    [`${TEMP_DIR_FOR_MIGRATION}`]: mock.directory(),
    migrations: {
      'readme.md': '# Readme',
      'other_file.txt': 'test file',
      '00000000000001_create_test_table.sql': 'create table test(id int);',
      '00000000000002_create_test2_table.sql': 'create table test2(id int);'
    },
    multi_db_dir: {
      db1: {
        'atlas.hcl': 'lint { }',
        'readme_db1.md': '# Readme',
        '00000000000005_create_test5_table.sql': 'create table test5(id int);',
        '00000000000006_create_test6_table.sql': 'create table test6(id int);'
      },
      db2: {
        'atlas.hcl': 'lint { }',
        'readme_db2.md': '# Readme',
        '00000000000007_create_test7_table.sql': 'create table tes7(id int);',
        '00000000000008_create_test8_table.sql': 'create table test8(id int);',
        '00000000000009_create_test9_table.sql': 'create table test9(id int);'
      },
      db3: {
        'atlas.hcl': 'lint { }',
        'readme_db3.md': '# Readme',
        '00000000000010_create_test10_table.sql': 'create table tes10(id int);',
        '00000000000011_create_test11_table.sql': 'create table test11(id int);',
        '00000000000012_create_test12_table.sql': 'create table test12(id int);'
      }
    }
  }
}

export function getMigrationConfigList(
  dir = '.',
  databaseUrl = '',
  baseDir = 'migrations',
  devUrl = ''
): MigrationConfig[] {
  return [
    {
      dir: path.join(TEMP_DIR_FOR_MIGRATION, dir),
      originalDir: path.join(baseDir, dir),
      relativeDir: path.join(baseDir, dir),
      databaseUrl: databaseUrl === '' ? 'postgres://root:secret@db.host:5432/appdb?search_path=public' : databaseUrl,
      baseline: undefined,
      dryRun: true,
      revisionSchema: 'public',
      devUrl:
        devUrl === '' ? 'postgres://root:secret@localhost:5432/dev-db?sslmode=disabled&search_path=public' : devUrl
    }
  ]
}

export const executionListForDB1 = JSON.stringify([
  {
    Name: '20231129060014_add_user.sql',
    Version: '20231129060014',
    Description: 'add_user',
    Start: '2023-12-11T10:55:19.468908+05:30',
    End: '2023-12-11T10:55:19.470647+05:30',
    Applied: [
      'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
      'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
    ]
  },
  {
    Name: '20231206212844_add_column.sql',
    Version: '20231206212844',
    Description: 'add_column',
    Start: '2023-12-11T10:55:19.470647+05:30',
    End: '2023-12-11T10:55:19.470648+05:30',
    Applied: ['ALTER TABLE "users" ADD COLUMN "email" varchar(255);']
  }
])

export const executionListForDB2 = JSON.stringify([
  {
    Name: '20231221010101_add_session.sql',
    Version: '20231221010101',
    Description: 'add_session',
    Start: '2023-12-11T10:55:19.468908+05:30',
    End: '2023-12-11T10:55:19.470647+05:30',
    Applied: [
      'CREATE TABLE session (id uuid NOT NULL, PRIMARY KEY ("id"));',
      'ALTER TABLE "session" ADD COLUMN "phone" varchar(13);'
    ]
  },
  {
    Name: '20231207000000_add_column.sql',
    Version: '20231207000000',
    Description: 'add_column',
    Start: '2023-12-11T10:55:19.470647+05:30',
    End: '2023-12-11T10:55:19.470648+05:30',
    Applied: ['ALTER TABLE "session" ADD COLUMN "email" varchar(255);']
  }
])

export const executionListForDB3 = JSON.stringify([
  {
    Name: '20231222010101_add_users.sql',
    Version: '20231222010101',
    Description: 'add_users',
    Start: '2023-12-11T10:55:19.468908+05:30',
    End: '2023-12-11T10:55:19.470647+05:30',
    Applied: [
      'CREATE TABLE users (id uuid NOT NULL, PRIMARY KEY ("id"));',
      'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);'
    ]
  },
  {
    Name: '20231223000000_add_column.sql',
    Version: '20231223000000',
    Description: 'add_column',
    Start: '2023-12-11T10:55:19.470647+05:30',
    End: '2023-12-11T10:55:19.470648+05:30',
    Applied: ['ALTER TABLE "users" ADD COLUMN "old_phone" varchar(13);']
  }
])

export function getBaseExecutionList(str = executionListForDB1): VersionExecution[] {
  return JSON.parse(str) as VersionExecution[]
}

export const executionMap: Record<string, string> = {
  successful_migration: executionListForDB1,
  some_migration_failed: ((): string => {
    const atlasMigrateApplyJSONResponse = getBaseExecutionList()
    atlasMigrateApplyJSONResponse[1].Applied.push('ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);')

    atlasMigrateApplyJSONResponse[1].Error = {
      Stmt: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
      Text: `pq: table "users.bkp" does not exist`
    }
    return JSON.stringify(atlasMigrateApplyJSONResponse)
  })(),
  all_migration_failed: ((): string => {
    const atlasMigrateApplyJSONResponse = getBaseExecutionList()

    atlasMigrateApplyJSONResponse[0].Applied.push('ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);')
    atlasMigrateApplyJSONResponse[0].Error = {
      Stmt: 'ALTER TABLE "users.bkp" ADD COLUMN "phone" varchar(13);',
      Text: `pq: table "users.bkp" does not exist`
    }

    atlasMigrateApplyJSONResponse[1].Applied.push('ALTER TABLE "users" ADD COLUMN "phone" varchar(13);')
    atlasMigrateApplyJSONResponse[1].Error = {
      Stmt: 'ALTER TABLE "users" ADD COLUMN "phone" varchar(13);',
      Text: 'pq: column "phone" of relation "users" already exists'
    }

    // atlas returns early error
    // atlasMigrateApplyJSONResponse.pop()
    return JSON.stringify(atlasMigrateApplyJSONResponse)
  })(),
  no_migration_present: 'null',
  non_json_atlas_error: 'some atlas error'
}

export const lintResponseForDB1: Record<string, string> = {
  no_error: JSON.stringify([
    {
      Name: '00000000000000_baseline.sql',
      Text: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    },
    {
      Name: '20231219131522_user_and_session.sql',
      Text: 'CREATE TABLE\n  users (id int primary key, name varchar(100), age int);\n\nCREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );'
    },
    {
      Name: '20231220071838_add_index.sql',
      Text: '--atlas:txmode none\n\ncreate index concurrently idx_users_name on users(name);\n\ncreate index concurrently idx_users_age on users(age);\n'
    }
  ]),
  syntax_error: JSON.stringify([
    {
      Name: '20231219131522_user_and_session.sql',
      Error: 'executing statement: pq: syntax error at or near "TABL"'
    }
  ]),
  // single file lint errors
  lint_errors_in_one_file: JSON.stringify([
    {
      Name: '00000000000000_baseline.sql',
      Text: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    },
    {
      Name: '20231222064834_step1.sql',
      Text: 'CREATE TABLE\n  users (id int primary key, name varchar(100), age int);\n'
    },
    {
      Name: '20231222064929_step2.sql',
      Text: 'CREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );\n\n-- works because table is created in this version\ncreate index idx_sessions_user_id on sessions(user_id);\n'
    },
    {
      Name: '20231222064941_step3.sql',
      Text: 'create index idx_users_name on users(name);\n\ncreate index concurrently idx_users_age on users(age);\n\n',
      Reports: [
        {
          Text: 'concurrent index violations detected',
          Diagnostics: [
            {
              Pos: 0,
              Text: 'Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction',
              Code: 'PG103'
            },
            {
              Pos: 0,
              Text: 'Creating index "idx_users_name" non-concurrently causes write locks on the "users" table',
              Code: 'PG101'
            }
          ]
        }
      ],
      Error: 'concurrent index violations detected'
    }
  ])
}

export type MigrationExecution = {
  mockDir: Record<string, Record<string, string>>
  versionExecution?: Record<string, VersionExecution[]>
  lintResponseOutput: Record<string, string>
}

export const artifacts: Record<string, MigrationExecution> = {
  no_lint_error: {
    mockDir: {
      mg1: {
        '00000000000000_baseline.sql': 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
        '20231222064834_step1.sql':
          'CREATE TABLE\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\n',
        '20231222064941_step3.sql':
          '--atlas:txmode none\n\ncreate index concurrently idx_users_email on users(email);\n\ncreate index concurrently idx_users_age on users(age);',
        '20231222120857_step4.sql':
          '-- atlas:txmode none\n\nCREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );\n\n-- works because table is created in this version\ncreate index idx_sessions_user_id on sessions(user_id);\n\n'
      }
    },
    versionExecution: {
      mg1: [
        {
          Name: '00000000000000_baseline.sql',
          Version: '00000000000000',
          Description: 'baseline',
          Start: '2023-12-11T10:55:19.468908+05:30',
          End: '2023-12-11T10:55:20.468908+05:30',
          Applied: ['CREATE EXTENSION IF NOT EXISTS "uuid-ossp";']
        },
        {
          Name: '20231222064834_step1.sql',
          Version: '20231222064834',
          Description: 'step1',
          Start: '2023-12-11T10:55:19.468908+05:30',
          End: '2023-12-11T10:55:20.468908+05:30',
          Applied: ['CREATE TABLE\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\n']
        },
        {
          Name: '20231222064941_step3.sql',
          Version: '20231222064941',
          Description: 'step3',
          Start: '2023-12-11T10:55:19.468908+05:30',
          End: '2023-12-11T10:55:20.468908+05:30',
          Applied: [
            'create index concurrently idx_users_email on users(email);',
            'create index concurrently idx_users_age on users(age);'
          ]
        },
        {
          Name: '20231222120857_step4.sql ',
          Version: '20231222120857',
          Description: 'step4',
          Start: '2023-12-11T10:55:19.468908+05:30',
          End: '2023-12-11T10:55:20.468908+05:30',
          Applied: [
            'CREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );',
            'create index idx_sessions_user_id on sessions(user_id);'
          ]
        }
      ]
    },
    lintResponseOutput: {
      mg1: '[{"Name":"00000000000000_baseline.sql","Text":"CREATE EXTENSION IF NOT EXISTS \\"uuid-ossp\\";"},{"Name":"20231222064834_step1.sql","Text":"CREATE TABLE\\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\\n"},{"Name":"20231222064941_step3.sql","Text":"--atlas:txmode none\\n\\ncreate index concurrently idx_users_email on users(email);\\n\\ncreate index concurrently idx_users_age on users(age);"},{"Name":"20231222120857_step4.sql","Text":"-- atlas:txmode none\\n\\nCREATE TABLE\\n  sessions (\\n    id int primary key,\\n    user_id int not null,\\n    data text not null,\\n    created_at timestamptz not null default now ()\\n  );\\n\\n-- works because table is created in this version\\ncreate index idx_sessions_user_id on sessions(user_id);\\n\\n"}]'
    }
  },
  sql_file_error_lint_skipped: {
    mockDir: {
      mg1: {
        '00000000000000_baseline.sql': 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
        '20231222064834_step1.sql': 'CREATE TABLE\n  users (id int primary key, nAme1 varchar(100), age int);\n',
        '20231222064929_step2.sql':
          '-- atlas:txmode none\n\nCREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );\n\n-- works because table is created in this version\ncreate index idx_sessions_user_id on sessions(user_id);\n',
        '20231222064941_step3.sql':
          'create index idx_users_email on users(email);\n\ncreate index concurrently idx_users_age on users(age);'
      }
    },
    lintResponseOutput: {
      mg1: '[{"Name":"20231222064941_step3.sql","Error":"executing statement: pq: column \\"email\\" does not exist"}]'
    }
  },
  multiple_linting_errors_in_multiple_files: {
    mockDir: {
      mg1: {
        '00000000000000_baseline.sql': 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
        '20231222064834_step1.sql':
          'CREATE TABLE\n  users (id int primary key, nAme1 varchar(100), age int, old_email varchar(100));\n',
        '20231222064929_step2.sql':
          '-- atlas:txmode none\n\nCREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );\n\n-- works because table is created in this version\ncreate index idx_sessions_user_id on sessions(user_id);\n\nALTER TABLE users ADD COLUMN email varchar(50) NOT NULL;\n\nALTER TABLE users DROP COLUMN old_email;',
        '20231222064941_step3.sql':
          'create index concurrently idx_users_email on users(email);\n\ncreate index idx_users_age on users(age);'
      }
    },
    lintResponseOutput: {
      mg1: '[{"Name":"00000000000000_baseline.sql","Text":"CREATE EXTENSION IF NOT EXISTS \\"uuid-ossp\\";"},{"Name":"20231222064834_step1.sql","Text":"CREATE TABLE\\n  users (id int primary key, nAme1 varchar(100), age int, old_email varchar(100));\\n"},{"Name":"20231222064929_step2.sql","Text":"-- atlas:txmode none\\n\\nCREATE TABLE\\n  sessions (\\n    id int primary key,\\n    user_id int not null,\\n    data text not null,\\n    created_at timestamptz not null default now ()\\n  );\\n\\n-- works because table is created in this version\\ncreate index idx_sessions_user_id on sessions(user_id);\\n\\nALTER TABLE users ADD COLUMN email varchar(50) NOT NULL;\\n\\nALTER TABLE users DROP COLUMN old_email;","Reports":[{"Text":"destructive changes detected","Diagnostics":[{"Pos":344,"Text":"Dropping non-virtual column \\"old_email\\"","Code":"DS103"}]},{"Text":"data dependent changes detected","Diagnostics":[{"Pos":286,"Text":"Adding a non-nullable \\"character varying(50)\\" column \\"email\\" will fail in case table \\"users\\" is not empty","Code":"MF103"}]}],"Error":"destructive changes detected"},{"Name":"20231222064941_step3.sql","Text":"create index concurrently idx_users_email on users(email);\\n\\ncreate index idx_users_age on users(age);","Reports":[{"Text":"concurrent index violations detected","Diagnostics":[{"Pos":0,"Text":"Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction","Code":"PG103"},{"Pos":60,"Text":"Creating index \\"idx_users_age\\" non-concurrently causes write locks on the \\"users\\" table","Code":"PG101"}]}]}]'
    }
  },
  multiple_linting_errors_in_one_file: {
    mockDir: {
      mg1: {
        '00000000000000_baseline.sql': 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
        '20231222064834_step1.sql':
          'CREATE TABLE\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\n',
        '20231222064941_step3.sql':
          'create index idx_users_email on users(email);\n\ncreate index concurrently idx_users_age on users(age);',
        '20231222120857_step4.sql':
          '-- atlas:txmode none\n\nCREATE TABLE\n  sessions (\n    id int primary key,\n    user_id int not null,\n    data text not null,\n    created_at timestamptz not null default now ()\n  );\n\n-- works because table is created in this version\ncreate index idx_sessions_user_id on sessions(user_id);\n\n'
      }
    },
    lintResponseOutput: {
      mg1: '[{"Name":"00000000000000_baseline.sql","Text":"CREATE EXTENSION IF NOT EXISTS \\"uuid-ossp\\";"},{"Name":"20231222064834_step1.sql","Text":"CREATE TABLE\\n  users (id int primary key, nAme1 varchar(100), age int, email varchar(100));\\n"},{"Name":"20231222064941_step3.sql","Text":"create index idx_users_email on users(email);\\n\\ncreate index concurrently idx_users_age on users(age);","Reports":[{"Text":"concurrent index violations detected","Diagnostics":[{"Pos":0,"Text":"Indexes cannot be created or deleted concurrently within a transaction. Add the `atlas:txmode none` directive to the header to prevent this file from running in a transaction","Code":"PG103"},{"Pos":0,"Text":"Creating index \\"idx_users_email\\" non-concurrently causes write locks on the \\"users\\" table","Code":"PG101"}]}]},{"Name":"20231222120857_step4.sql","Text":"-- atlas:txmode none\\n\\nCREATE TABLE\\n  sessions (\\n    id int primary key,\\n    user_id int not null,\\n    data text not null,\\n    created_at timestamptz not null default now ()\\n  );\\n\\n-- works because table is created in this version\\ncreate index idx_sessions_user_id on sessions(user_id);\\n\\n"}]'
    }
  }
}

export function getTeamByName(): Record<string, string[]> {
  return {
    'svc-team': ['user-aaa', 'user-bbb'],
    'svc-admin-team': ['user-bbb', 'user-ccc'],
    dba: ['user-ddd']
  }
}

export function getPRBaseBranch(): Branch {
  return {
    ref: 'main',
    repo: getRepo()
  }
}

export function getRepo(): Repository {
  return {
    default_branch: 'master',
    html_url: 'https://github.com/my-org/calc-svc',
    language: 'Go',
    name: 'calc-svc',
    owner: {
      login: 'my-org'
    }
  }
}

export function getPR(
  assigneeUserNames: string[] | null,
  labelNames: string[] | null,
  prOwner = 'user-aaa'
): PullRequest {
  const assignees = (assigneeUserNames || ['user-aaa', 'user-bbb']).map(user)
  const labels = (labelNames || []).map((name, idx) => ({ name, id: idx }))

  return {
    assignee: assignees ? assignees[0] : null,
    assignees,
    created_at: '2023-11-17T12:58:55Z',
    base: getPRBaseBranch(),
    draft: false,
    html_url: 'https://github.com/my-org/calc-svc/pull/1',
    id: 1606392760,
    labels,
    number: 1,
    state: 'open',
    title: 'Feature GitHub only',
    updated_at: '2023-11-17T12:58:55Z',
    user: user(prOwner)
  }
}

export function user(login: string): User {
  return {
    login,
    type: 'User'
  }
}

export function getComment(id: number, command: string, login: string): Comment {
  return {
    id,
    body: `db migrate${command ? ` ${command}` : ''}`,
    created_at: '2023-11-21T06:41:01Z',
    html_url: 'https://github.com/my-org/calc-svc/pull/1#issuecomment-1866340385',
    user: user(login)
  }
}

export function getReview(reviewUser: string, id = 1111111): Review {
  return {
    commit_id: '2d4a666bd8743fafdcbea69b80b0a543513d651d',
    html_url: `https://github.com/my-org/calc-svc/pull/1#pullrequestreview-${id}`,
    id,
    submitted_at: '2023-11-18T06:02:24Z',
    user: user(reviewUser)
  }
}

export function getSchedulePayload(): SchedulePayload {
  return {
    schedule: '10 1 * * *',
    organization: {
      login: 'my-org'
    },
    repository: getRepo()
  }
}

export const prCreated: PullRequestPayload = {
  action: 'opened',
  number: 1,
  organization: {
    login: 'my-org'
  },
  after: undefined,
  before: undefined,
  pull_request: getPR(null, null),
  repository: getRepo(),
  sender: {
    login: 'user-aaa',
    type: 'User'
  }
}

export const prPayloadReview: PullRequestReviewPayload = {
  action: 'submitted',
  organization: {
    login: 'my-org'
  },
  pull_request: getPR(['user-aaa', 'user-bbb'], ['db-migrations']),
  repository: getRepo(),
  review: getReview('user-bbb', 1111111),
  sender: {
    login: 'user-bbb',
    type: 'User'
  }
}

export const prPayloadReviewByUnrelatedUser: PullRequestReviewPayload = {
  action: 'submitted',
  organization: {
    login: 'my-org'
  },
  pull_request: getPR(['user-aaa', 'user-bbb'], ['db-migrations']),
  repository: getRepo(),
  review: getReview('user-fff', 2222222),
  sender: {
    login: 'user-unknown',
    type: 'User'
  }
}

export const commentDBMigrate: PullRequestCommentPayload = {
  action: 'created',
  comment: getComment(111111, '', 'user-aaa'),
  issue: getPR(['user-aaa', 'user-bbb'], ['db-migrations']),
  organization: {
    login: 'my-org'
  },
  repository: getRepo(),
  sender: user('user-aaa')
}

export function getPRContext(payload: PullRequestPayload): ContextPullRequest {
  return {
    payload,
    eventName: 'pull_request',
    sha: 'abcdefgh',
    ref: 'feature-init',
    workflow: '1111',
    runId: 2222,
    runNumber: 1
  }
}

export function getPRReviewContext(payload: PullRequestReviewPayload): ContextPullRequestReview {
  return {
    payload,
    eventName: 'pull_request_review',
    sha: 'abcdefgh',
    ref: 'feature-init',
    workflow: '1111',
    runId: 2222,
    runNumber: 1
  }
}

export function getPRCommentContext(payload: PullRequestCommentPayload): ContextPullRequestComment {
  return {
    payload,
    eventName: 'issue_comment',
    sha: 'abcdefgh',
    ref: 'feature-init',
    workflow: '1111',
    runId: 2222,
    runNumber: 1
  }
}

export function getScheduleContext(payload: SchedulePayload): ContextSchedule {
  return {
    payload,
    eventName: 'schedule',
    sha: 'abcdefgh',
    ref: 'feature-init',
    workflow: '1111',
    runId: 2222,
    runNumber: 1
  }
}
