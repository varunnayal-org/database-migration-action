# Atlas Commands

- [Atlas Commands](#atlas-commands)
  - [atlas migrate apply](#atlas-migrate-apply)
    - [Successful execution](#successful-execution)
      - [migration present](#migration-present)
      - [No migration available](#no-migration-available)
    - [Failed Execution](#failed-execution)
      - [Error in some statement](#error-in-some-statement)
      - [Migration out of order](#migration-out-of-order)

## [atlas migrate apply](https://atlasgo.io/versioned/apply)

Command

```sh
# Adding --dry-run won't change the output
atlas migrate apply \
  --dir "file://${MIGRATION_DIR}" \
  --url "${DB}" \
  --revisions-schema ${SCHEMA} \
  --baseline 00000000000000 \
  --lock-timeout 60s \
  --format "{{ json .Applied }}"
```

Output format is `JSON` for selected migrations that were applied

### Successful execution

#### migration present

```json
[
  {
    "Name": "20231129060014_initial_schema.sql",
    "Version": "20231129060014",
    "Description": "initial_schema",
    "Start": "2023-12-11T10:05:54.326048+05:30",
    "End": "2023-12-11T10:05:54.410561+05:30",
    "Applied": [
      "CREATE TYPE \"public\".\"status_enum\" AS ENUM ('ACTIVE', 'INACTIVE');",
      "CREATE TABLE \"public\".\"users\" (\n \"id\" uuid NOT NULL,\n \"name\" text NULL,\n \"phone\" character varying(13) NULL,\n \"status\" \"public\".\"status_enum\" NOT NULL,\n PRIMARY KEY (\"id\")\n);"
    ]
  },
  {
    "Name": "20231129062818_add_email_column.sql",
    "Version": "20231129062818",
    "Description": "add_old_email_column",
    "Start": "2023-12-11T10:05:54.410561+05:30",
    "End": "2023-12-11T10:05:54.413353+05:30",
    "Applied": [
      "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" character varying(255) NULL;"
    ]
  }
]
```

#### No migration available

If no migrations are available, then command will return `null` string

```sh
null
```

### Failed Execution

#### Error in some statement

Here, consider we have three migration files to execute.

- `20231129060014_initial_schema.sql`: All statements should run successfully
- `20231129062818_add_email_column.sql`: All but last statement will fail
- `20231129062818_add_phone_column.sql`: All statements should run successfully

```jsonc
[
  {
    "Name": "20231129060014_initial_schema.sql",
    "Version": "20231129060014",
    "Description": "initial_schema",
    "Start": "2023-12-11T10:05:54.326048+05:30",
    "End": "2023-12-11T10:05:54.410561+05:30",
    "Applied": [
      "CREATE TYPE \"public\".\"status_enum\" AS ENUM ('ACTIVE', 'INACTIVE');",
      "CREATE TABLE \"public\".\"users\" (\n \"id\" uuid NOT NULL,\n \"name\" text NULL,\n \"phone\" character varying(13) NULL,\n \"status\" \"public\".\"status_enum\" NOT NULL,\n PRIMARY KEY (\"id\")\n);"
    ]
  },
  {
    "Name": "20231129062818_add_email_column.sql",
    "Version": "20231129062818",
    "Description": "add_old_email_column",
    "Start": "2023-12-11T10:05:54.410561+05:30",
    "End": "2023-12-11T10:05:54.413353+05:30",
    "Applied": [
      "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" character varying(255) NULL;",
      // This is the statement errored out
      "ALTER TABLE \"public\".\"user\" ADD COLUMN \"old_email\" character varying(255) NULL;"
    ],
    "Error": {
      "Stmt": "ALTER TABLE \"public\".\"user\" ADD COLUMN \"old_email\" character varying(255) NULL;",
      "Text": "pq: relation \"public.user\" does not exist"
    }
  }
  /*
  {
    Last migration information is not present as its not considered after failure
  }
  */
]
```

#### [Migration out of order](./cases.md#out-of-order)

In this case, the output is not `JSON`.

```sh
Error: migration file 20231206212844_add_old_phone_column.sql was added out of order. See: https://atlasgo.io/versioned/apply#non-linear-error
```
