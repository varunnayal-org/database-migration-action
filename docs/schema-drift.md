# Schema Drifts

- [Schema Drifts](#schema-drifts)
  - [Setup](#setup)
  - [Workflow](#workflow)
  - [Expected Response](#expected-response)
  - [Insight](#insight)

## Setup

In schema migration workflow file add. Set the cron timing whenever you want it to execute. Use [crontab-guru](https://crontab.guru/) to help generate your cron syntax and confirm what time it will run.

```yaml
...
on:
  schedule:
    - cron: "5 0 * * *"
...
```

## Workflow

1. Github action runs to find any schema drifts at the time defined by `shedule`.
1. If no drifts are found then the process exits silently
1. If any drifts are found, then
   1. Github: The summary of the changes are written to the github action itself.
   1. Jira
      1. If there is no JIRA ticket present for schema drift a new ticket will be created.
      1. Else a comment will be added in the JIRA ticket

## Expected Response

If a schema drift is found the the onus is on the developer to fix it. There are various ways to fix it:

1. Connect with DBA to undo the extra changes that are present in remote DB
1. Raise a new DDL PR that covers those drifts in remote DB and follow steps outlined in [Manual Migration](./cases.md#manual-migration).

## Insight

The schema drifts are captured using `atlas schema diff` [command](https://atlasgo.io/declarative/diff#compare-a-migration-directory-to-a-database).

```sh
atlas schema diff \
    --from "file:///path/to/migrations" \
    --to "postgres://remote-db" \
    --dev-url "local container"
```
