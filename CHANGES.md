# Changes

## 0.1.0 2026-11-21

First release of `@seneca/vector-store`.

* Seneca 4: the peer dependencies are `seneca` `^4.0.0` and `@seneca/entity` `^29.0.0`. Seneca 3 and `seneca-entity` are not supported.
* Node.js 24 or later (`engines.node` `>=24`).
* The option defaults are built with the validator that Seneca provides (`valid`), not with `gubu` (B1).
* No `seneca-promisify` or `@seneca/entity-util` peer: Seneca 4 has the promise API built in, and the plugin does not use the entity utilities.
* Drivers: `pgvector` (tested against `pgvector/pgvector:pg16`) and `opensearch` (AWS OpenSearch Serverless, service `aoss`). The OpenSearch tests ran against a local OpenSearch 3.10 node with the k-NN plugin, not against AWS OpenSearch Serverless.
