# Github Commands

DB Migration can be invoked explicitly using `db migrate` command set.
This command is designed to perform a wide range of database migration tasks.

- [Github Commands](#github-commands)
  - [Dry Run](#dry-run)
  - [Apply](#apply)
  - [Jira](#jira)

## Dry Run

Command

```sh
db migrate dry-run
```

Dry run the migration

## Apply

Command

```sh
db migrate
```

It executes the migration tasks if all the necessary checks are passed.

## Jira

Command

```sh
db migrate jira
```

Ensure all the necessary jira integration are in place. For eg, if JIRA is integrated, then it ensures tickets are created, labels are added to PR etc.

This command is useful in scenarios where jira integration command breaks in b/w while creating resources in other system(say JIRA issue)
