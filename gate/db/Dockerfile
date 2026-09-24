# MySQL with the Ontos demo workspace already migrated, seeded and provisioned.
#
# Every gate world tears down with its volumes, so MySQL initialises from
# scratch each time. Loading one fixed dump on first start makes every world
# begin from the same state, with no one-shot init service in the stack.
#
# seed.sql is produced by gate/scripts/build-images.ps1 from the app image of
# the same tag, so the schema and the data always match the app under test.
# Same MySQL digest as the repository's compose.yaml.
FROM mysql:8.4@sha256:85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a
COPY seed.sql /docker-entrypoint-initdb.d/10-seed.sql
