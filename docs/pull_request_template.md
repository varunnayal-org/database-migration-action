# Database Schema Migration Pull Request

## Migration Description

Please include a summary of the database schema changes and the motivation for these changes.

Related Issue: # (issue)

## Type of change

Please delete options that are not relevant.

- [ ] New table
- [ ] Update/Remove table
- [ ] New column
- [ ] Update/Remove column
- [ ] New Index
- [ ] Update/Remove index
- [ ] Schema changes(create/delete schema)

## Checklist

- [ ] I have followed the guidelines in the `README.md` and `docs/*.md` files for creating database migrations
- [ ] My migrations are backward compatible
- [ ] My changes do not affect existing data and operations
- [ ] I have considered performance implications of my changes
- [ ] I have considered security implications of my changes
- [ ] Changes related to index creation are in separate file(s) and are prefixed with `--atlas:txmode none`

## Migrations

To apply the migrations, add the following comment in PR(ensure all the necessary approvals have been received)

```txt
db migrate
```
