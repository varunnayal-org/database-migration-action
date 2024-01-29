# Atlas SQL commands

When running `atlas migrate apply --dry-run` command, following SQLs files were fired by atlas(picked from PG statement logs)

Connection 1: Takes the pg advisory log to maintain application log

```sql
-- Random number 1000000 is generated using fnv.New32().Sum32()
SELECT pg_advisory_lock(1000000);
```

Connection 2

```sql
SELECT
    nspname AS schema_name,
    pg_catalog.obj_description(oid) AS comment
  FROM
      pg_catalog.pg_namespace
  WHERE
      nspname = 'public'
  ORDER BY nspname;
```

```sql
SELECT
    n.nspname AS schema_name,
    e.enumtypid AS enum_id,
    t.typname AS enum_name,
    e.enumlabel AS enum_value
  FROM
    pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE
      n.nspname IN ('public')
  ORDER BY
      n.nspname, e.enumtypid, e.enumsortorder;
```

Connection 3

```sql
SELECT setting FROM pg_settings WHERE name IN ('server_version_num', 'crdb_version') ORDER BY name DESC;

SHOW server_version_num;
```

```sql
BEGIN READ WRITE;

  SELECT setting FROM pg_settings WHERE name IN ('server_version_num', 'crdb_version') ORDER BY name DESC;

  SELECT
      nspname AS schema_name,
      pg_catalog.obj_description(oid) AS comment
    FROM
        pg_catalog.pg_namespace
    WHERE
        nspname = CURRENT_SCHEMA()
    ORDER BY
        nspname;


  SELECT
      t3.oid,
      t1.table_schema,
      t1.table_name,
      pg_catalog.obj_description(t3.oid, 'pg_class') AS comment,
      t4.partattrs AS partition_attrs,
      t4.partstrat AS partition_strategy,
      pg_get_expr(t4.partexprs, t4.partrelid) AS partition_exprs
    FROM
      INFORMATION_SCHEMA.TABLES AS t1
      JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
      JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
      LEFT JOIN pg_catalog.pg_partitioned_table AS t4 ON t4.partrelid = t3.oid
      LEFT JOIN pg_depend AS t5 ON t5.objid = t3.oid AND t5.deptype = 'e'
    WHERE
      t1.table_type = 'BASE TABLE'
      AND NOT COALESCE(t3.relispartition, false)
      AND t1.table_schema IN ('public')
      AND t1.table_name IN ('atlas_schema_revisions')
      AND t5.objid IS NULL
    ORDER BY
      t1.table_schema, t1.table_name

  SELECT
      t1.table_name,
      t1.column_name,
      t1.data_type,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS format_type,
      t1.is_nullable,
      t1.column_default,
      t1.character_maximum_length,
      t1.numeric_precision,
      t1.datetime_precision,
      t1.numeric_scale,
      t1.interval_type,
      t1.character_set_name,
      t1.collation_name,
      t1.is_identity,
      t1.identity_start,
      t1.identity_increment,
      (CASE WHEN t1.is_identity = 'YES' THEN (SELECT last_value FROM pg_sequences WHERE quote_ident(schemaname) || '.' || quote_ident(sequencename) = pg_get_serial_sequence(quote_ident(t1.table_schema) || '.' || quote_ident(t1.table_name), t1.column_name)) END) AS identity_last,
      t1.identity_generation,
      t1.generation_expression,
      col_description(t3.oid, "ordinal_position") AS comment,
      t4.typtype,
      t4.typelem,
      (CASE WHEN t4.typcategory = 'A' AND t4.typelem <> 0 THEN (SELECT t.typtype FROM pg_catalog.pg_type t WHERE t.oid = t4.typelem) END) AS elemtyp,
      t4.oid
    FROM
      "information_schema"."columns" AS t1
      JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
      JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
      JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t3.oid AND a.attname = t1.column_name
      LEFT JOIN pg_catalog.pg_type AS t4 ON t4.oid = a.atttypid
    WHERE
      t1.table_schema = 'public' AND t1.table_name IN ('atlas_schema_revisions')
    ORDER BY
      t1.table_name, t1.ordinal_position;



  SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      am.amname AS index_type,
      a.attname AS column_name,
      (a.attname <> '' AND idx.indnatts > idx.indnkeyatts AND idx.ord > idx.indnkeyatts) AS included,
      idx.indisprimary AS primary,
      idx.indisunique AS unique,
      con.nametypes AS constraints,
      pg_get_expr(idx.indpred, idx.indrelid) AS predicate,
      pg_get_indexdef(idx.indexrelid, idx.ord, false) AS expression,
      pg_index_column_has_property(idx.indexrelid, idx.ord, 'desc') AS isdesc,
      pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_first') AS nulls_first,
      pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_last') AS nulls_last,
      obj_description(i.oid, 'pg_class') AS comment,
      i.reloptions AS options,
      op.opcname AS opclass_name,
      op.opcdefault AS opclass_default,
      a2.attoptions AS opclass_params,
        false AS indnullsnotdistinct
    FROM
      (
        select
          *,
          generate_series(1,array_length(i.indkey,1)) as ord,
          unnest(i.indkey) AS key
        from pg_index i
      ) idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      JOIN pg_class t ON t.oid = idx.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN (
          select conindid, jsonb_object_agg(conname, contype) AS nametypes
          from pg_constraint
          group by conindid
      ) con ON con.conindid = idx.indexrelid
      LEFT JOIN pg_attribute a ON (a.attrelid, a.attnum) = (idx.indrelid, idx.key)
      JOIN pg_am am ON am.oid = i.relam
      LEFT JOIN pg_opclass op ON op.oid = idx.indclass[idx.ord-1]
      LEFT JOIN pg_attribute a2 ON (a2.attrelid, a2.attnum) = (idx.indexrelid, idx.ord)
    WHERE
      n.nspname = 'public'
      AND t.relname IN ('atlas_schema_revisions')
    ORDER BY
      table_name, index_name, idx.ord;



  SELECT
        fk.constraint_name,
        fk.table_name,
        a1.attname AS column_name,
        fk.schema_name,
        fk.referenced_table_name,
        a2.attname AS referenced_column_name,
        fk.referenced_schema_name,
        fk.confupdtype,
        fk.confdeltype
      FROM
          (
            SELECT
                con.conname AS constraint_name,
                con.conrelid,
                con.confrelid,
                t1.relname AS table_name,
                ns1.nspname AS schema_name,
                t2.relname AS referenced_table_name,
                ns2.nspname AS referenced_schema_name,
                generate_series(1,array_length(con.conkey,1)) as ord,
                unnest(con.conkey) AS conkey,
                unnest(con.confkey) AS confkey,
                con.confupdtype,
                con.confdeltype
            FROM pg_constraint con
            JOIN pg_class t1 ON t1.oid = con.conrelid
            JOIN pg_class t2 ON t2.oid = con.confrelid
            JOIN pg_namespace ns1 on t1.relnamespace = ns1.oid
            JOIN pg_namespace ns2 on t2.relnamespace = ns2.oid
            WHERE ns1.nspname = 'public'
            AND t1.relname IN ('atlas_schema_revisions')
            AND con.contype = 'f'
      ) AS fk
      JOIN pg_attribute a1 ON a1.attnum = fk.conkey AND a1.attrelid = fk.conrelid
      JOIN pg_attribute a2 ON a2.attnum = fk.confkey AND a2.attrelid = fk.confrelid
      ORDER BY
          fk.conrelid, fk.constraint_name, fk.ord;

  SELECT
      rel.relname AS table_name,
      t1.conname AS constraint_name,
      pg_get_expr(t1.conbin, t1.conrelid) as expression,
      t2.attname as column_name,
      t1.conkey as column_indexes,
      t1.connoinherit as no_inherit
    FROM
      pg_constraint t1
      JOIN pg_attribute t2
      ON t2.attrelid = t1.conrelid
      AND t2.attnum = ANY (t1.conkey)
      JOIN pg_class rel
      ON rel.oid = t1.conrelid
      JOIN pg_namespace nsp
      ON nsp.oid = t1.connamespace
    WHERE
      t1.contype = 'c'
      AND nsp.nspname = 'public'
      AND rel.relname IN ('atlas_schema_revisions')
    ORDER BY
      t1.conname, array_position(t1.conkey, t2.attnum);


  SELECT
      n.nspname AS schema_name,
      e.enumtypid AS enum_id,
      t.typname AS enum_name,
      e.enumlabel AS enum_value
    FROM
      pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE
        n.nspname IN ('public')
    ORDER BY
        n.nspname, e.enumtypid, e.enumsortorder;

COMMIT;
```

Connection 2 Continue

```sql
SELECT "public"."atlas_schema_revisions"."version", "public"."atlas_schema_revisions"."description", "public"."atlas_schema_revisions"."type", "public"."atlas_schema_revisions"."applied", "public"."atlas_schema_revisions"."total", "public"."atlas_schema_revisions"."executed_at", "public"."atlas_schema_revisions"."execution_time", "public"."atlas_schema_revisions"."error", "public"."atlas_schema_revisions"."error_stmt", "public"."atlas_schema_revisions"."hash", "public"."atlas_schema_revisions"."partial_hashes", "public"."atlas_schema_revisions"."operator_version" FROM "public"."atlas_schema_revisions" WHERE "public"."atlas_schema_revisions"."version" <> '.atlas_cloud_identifier' ORDER BY "public"."atlas_schema_revisions"."version";

SELECT
    nspname AS schema_name,
    pg_catalog.obj_description(oid) AS comment
  FROM
      pg_catalog.pg_namespace
  WHERE
      nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'crdb_internal', 'pg_extension')
      AND nspname NOT LIKE 'pg_%temp_%'
  ORDER BY
      nspname;

SELECT
    t3.oid,
    t1.table_schema,
    t1.table_name,
    pg_catalog.obj_description(t3.oid, 'pg_class') AS comment,
    t4.partattrs AS partition_attrs,
    t4.partstrat AS partition_strategy,
    pg_get_expr(t4.partexprs, t4.partrelid) AS partition_exprs
  FROM
    INFORMATION_SCHEMA.TABLES AS t1
    JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
    JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
    LEFT JOIN pg_catalog.pg_partitioned_table AS t4 ON t4.partrelid = t3.oid
    LEFT JOIN pg_depend AS t5 ON t5.objid = t3.oid AND t5.deptype = 'e'
  WHERE
    t1.table_type = 'BASE TABLE'
    AND NOT COALESCE(t3.relispartition, false)
    AND t1.table_schema IN ('public')
    AND t5.objid IS NULL
  ORDER BY
    t1.table_schema, t1.table_name;

SELECT
    t3.oid,
    t1.table_schema,
    t1.table_name,
    pg_catalog.obj_description(t3.oid, 'pg_class') AS comment,
    t4.partattrs AS partition_attrs,
    t4.partstrat AS partition_strategy,
    pg_get_expr(t4.partexprs, t4.partrelid) AS partition_exprs
  FROM
    INFORMATION_SCHEMA.TABLES AS t1
    JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
    JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
    LEFT JOIN pg_catalog.pg_partitioned_table AS t4 ON t4.partrelid = t3.oid
    LEFT JOIN pg_depend AS t5 ON t5.objid = t3.oid AND t5.deptype = 'e'
  WHERE
    t1.table_type = 'BASE TABLE'
    AND NOT COALESCE(t3.relispartition, false)
    AND t1.table_schema IN ('public')
    AND t5.objid IS NULL
  ORDER BY
    t1.table_schema, t1.table_name;

SELECT
    t1.table_name,
    t1.column_name,
    t1.data_type,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS format_type,
    t1.is_nullable,
    t1.column_default,
    t1.character_maximum_length,
    t1.numeric_precision,
    t1.datetime_precision,
    t1.numeric_scale,
    t1.interval_type,
    t1.character_set_name,
    t1.collation_name,
    t1.is_identity,
    t1.identity_start,
    t1.identity_increment,
    (CASE WHEN t1.is_identity = 'YES' THEN (SELECT last_value FROM pg_sequences WHERE quote_ident(schemaname) || '.' || quote_ident(sequencename) = pg_get_serial_sequence(quote_ident(t1.table_schema) || '.' || quote_ident(t1.table_name), t1.column_name)) END) AS identity_last,
    t1.identity_generation,
    t1.generation_expression,
    col_description(t3.oid, "ordinal_position") AS comment,
    t4.typtype,
    t4.typelem,
    (CASE WHEN t4.typcategory = 'A' AND t4.typelem <> 0 THEN (SELECT t.typtype FROM pg_catalog.pg_type t WHERE t.oid = t4.typelem) END) AS elemtyp,
    t4.oid
  FROM
    "information_schema"."columns" AS t1
    JOIN pg_catalog.pg_namespace AS t2 ON t2.nspname = t1.table_schema
    JOIN pg_catalog.pg_class AS t3 ON t3.relnamespace = t2.oid AND t3.relname = t1.table_name
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t3.oid AND a.attname = t1.column_name
    LEFT JOIN pg_catalog.pg_type AS t4 ON t4.oid = a.atttypid
  WHERE
    t1.table_schema = 'public' AND t1.table_name IN ('atlas_schema_revisions')
  ORDER BY
    t1.table_name, t1.ordinal_position;


SELECT
    t.relname AS table_name,
    i.relname AS index_name,
    am.amname AS index_type,
    a.attname AS column_name,
    (a.attname <> '' AND idx.indnatts > idx.indnkeyatts AND idx.ord > idx.indnkeyatts) AS included,
    idx.indisprimary AS primary,
    idx.indisunique AS unique,
    con.nametypes AS constraints,
    pg_get_expr(idx.indpred, idx.indrelid) AS predicate,
    pg_get_indexdef(idx.indexrelid, idx.ord, false) AS expression,
    pg_index_column_has_property(idx.indexrelid, idx.ord, 'desc') AS isdesc,
    pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_first') AS nulls_first,
    pg_index_column_has_property(idx.indexrelid, idx.ord, 'nulls_last') AS nulls_last,
    obj_description(i.oid, 'pg_class') AS comment,
    i.reloptions AS options,
    op.opcname AS opclass_name,
    op.opcdefault AS opclass_default,
    a2.attoptions AS opclass_params,
      false AS indnullsnotdistinct
  FROM
    (
      select
        *,
        generate_series(1,array_length(i.indkey,1)) as ord,
        unnest(i.indkey) AS key
      from pg_index i
    ) idx
    JOIN pg_class i ON i.oid = idx.indexrelid
    JOIN pg_class t ON t.oid = idx.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN (
        select conindid, jsonb_object_agg(conname, contype) AS nametypes
        from pg_constraint
        group by conindid
    ) con ON con.conindid = idx.indexrelid
    LEFT JOIN pg_attribute a ON (a.attrelid, a.attnum) = (idx.indrelid, idx.key)
    JOIN pg_am am ON am.oid = i.relam
    LEFT JOIN pg_opclass op ON op.oid = idx.indclass[idx.ord-1]
    LEFT JOIN pg_attribute a2 ON (a2.attrelid, a2.attnum) = (idx.indexrelid, idx.ord)
  WHERE
    n.nspname = 'public'
    AND t.relname IN ('atlas_schema_revisions')
  ORDER BY
    table_name, index_name, idx.ord;

SELECT
      fk.constraint_name,
      fk.table_name,
      a1.attname AS column_name,
      fk.schema_name,
      fk.referenced_table_name,
      a2.attname AS referenced_column_name,
      fk.referenced_schema_name,
      fk.confupdtype,
      fk.confdeltype
    FROM
        (
          SELECT
              con.conname AS constraint_name,
              con.conrelid,
              con.confrelid,
              t1.relname AS table_name,
              ns1.nspname AS schema_name,
              t2.relname AS referenced_table_name,
              ns2.nspname AS referenced_schema_name,
              generate_series(1,array_length(con.conkey,1)) as ord,
              unnest(con.conkey) AS conkey,
              unnest(con.confkey) AS confkey,
              con.confupdtype,
              con.confdeltype
          FROM pg_constraint con
          JOIN pg_class t1 ON t1.oid = con.conrelid
          JOIN pg_class t2 ON t2.oid = con.confrelid
          JOIN pg_namespace ns1 on t1.relnamespace = ns1.oid
          JOIN pg_namespace ns2 on t2.relnamespace = ns2.oid
          WHERE ns1.nspname = 'public'
          AND t1.relname IN ('atlas_schema_revisions')
          AND con.contype = 'f'
    ) AS fk
    JOIN pg_attribute a1 ON a1.attnum = fk.conkey AND a1.attrelid = fk.conrelid
    JOIN pg_attribute a2 ON a2.attnum = fk.confkey AND a2.attrelid = fk.confrelid
    ORDER BY
        fk.conrelid, fk.constraint_name, fk.ord;

SELECT
    rel.relname AS table_name,
    t1.conname AS constraint_name,
    pg_get_expr(t1.conbin, t1.conrelid) as expression,
    t2.attname as column_name,
    t1.conkey as column_indexes,
    t1.connoinherit as no_inherit
  FROM
    pg_constraint t1
    JOIN pg_attribute t2
    ON t2.attrelid = t1.conrelid
    AND t2.attnum = ANY (t1.conkey)
    JOIN pg_class rel
    ON rel.oid = t1.conrelid
    JOIN pg_namespace nsp
    ON nsp.oid = t1.connamespace
  WHERE
    t1.contype = 'c'
    AND nsp.nspname = 'public'
    AND rel.relname IN ('atlas_schema_revisions')
  ORDER BY
    t1.conname, array_position(t1.conkey, t2.attnum);

SELECT
    n.nspname AS schema_name,
    e.enumtypid AS enum_id,
    t.typname AS enum_name,
    e.enumlabel AS enum_value
  FROM
    pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE
      n.nspname IN ('public')
  ORDER BY
      n.nspname, e.enumtypid, e.enumsortorder;


SELECT "public"."atlas_schema_revisions"."version", "public"."atlas_schema_revisions"."description", "public"."atlas_schema_revisions"."type", "public"."atlas_schema_revisions"."applied", "public"."atlas_schema_revisions"."total", "public"."atlas_schema_revisions"."executed_at", "public"."atlas_schema_revisions"."execution_time", "public"."atlas_schema_revisions"."error", "public"."atlas_schema_revisions"."error_stmt", "public"."atlas_schema_revisions"."hash", "public"."atlas_schema_revisions"."partial_hashes", "public"."atlas_schema_revisions"."operator_version" FROM "public"."atlas_schema_revisions" WHERE "public"."atlas_schema_revisions"."version" <> '.atlas_cloud_identifier' ORDER BY "public"."atlas_schema_revisions"."version"

SELECT "public"."atlas_schema_revisions"."version", "public"."atlas_schema_revisions"."description", "public"."atlas_schema_revisions"."type", "public"."atlas_schema_revisions"."applied", "public"."atlas_schema_revisions"."total", "public"."atlas_schema_revisions"."executed_at", "public"."atlas_schema_revisions"."execution_time", "public"."atlas_schema_revisions"."error", "public"."atlas_schema_revisions"."error_stmt", "public"."atlas_schema_revisions"."hash", "public"."atlas_schema_revisions"."partial_hashes", "public"."atlas_schema_revisions"."operator_version" FROM "public"."atlas_schema_revisions" WHERE "public"."atlas_schema_revisions"."version" = '20231129060014' LIMIT 2

SELECT "public"."atlas_schema_revisions"."version", "public"."atlas_schema_revisions"."description", "public"."atlas_schema_revisions"."type", "public"."atlas_schema_revisions"."applied", "public"."atlas_schema_revisions"."total", "public"."atlas_schema_revisions"."executed_at", "public"."atlas_schema_revisions"."execution_time", "public"."atlas_schema_revisions"."error", "public"."atlas_schema_revisions"."error_stmt", "public"."atlas_schema_revisions"."hash", "public"."atlas_schema_revisions"."partial_hashes", "public"."atlas_schema_revisions"."operator_version" FROM "public"."atlas_schema_revisions" WHERE "public"."atlas_schema_revisions"."version" = '20231129062818' LIMIT 2

```

Connection 1 continue

```sql
SELECT pg_advisory_unlock(1000000);
```
