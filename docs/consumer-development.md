# Consumer development

Locus is intentionally source-checkout-free with respect to JamScript and
MiniJAM. The normal environment is:

```text
published jams binary + managed bundle
published @jamscript/client
published JamScript backend
published MiniJAM stage1-v0.2.0 image
```

Do not add `file:../JamScript`, invoke ScriptC directly, run a JamScript cargo
binary, or clone a MiniJAM source tree as an application dependency. If a
compiler, client, backend, or Ownership capability is missing, fix and publish
that platform release first, then update Locus's release lock.

The required local network endpoints are Node `127.0.0.1:9944`, Formal RPC
`127.0.0.1:8080`, and Backend `127.0.0.1:8090`. The aggregate MiniJAM image is
owned by the independent `ArcheLabs/minijam-client` release.
