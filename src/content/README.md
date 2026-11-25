# Content loader

Workstream 7. Imports every `content/*.json`, parses with the schemas in
`src/contracts/content-schemas.ts`, checks cross-references, and exports a frozen `ContentBundle`.
