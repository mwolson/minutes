# Pre-release checklist

Use this before cutting any `vX.Y.Z` tag. Companion to [`RELEASE-CHANNELS.md`](./RELEASE-CHANNELS.md), [`RELEASE-MACOS.md`](./RELEASE-MACOS.md), and [`RELEASE-WINDOWS.md`](./RELEASE-WINDOWS.md).

The point of this doc is not to slow releases down. It is to make sure that the boring failure modes (npm publish ordering, off-policy notes, untested workspace) get caught locally instead of on a public tag that cannot be moved.

## Why this exists

A release that fails partway through is much more expensive than a release that takes ten extra minutes to validate. The v0.10.3 release shipped with two avoidable post-tag fixes:

1. `crates/mcp/package.json` was bumped to depend on `minutes-sdk@^0.10.3` in the same commit that bumped the SDK itself, which broke main CI because `minutes-sdk@0.10.3` was not yet on npm. The pattern is: publish SDK first, then bump MCP dep.
2. The release notes were written in an ad-hoc shape and did not match the five required sections in [`RELEASE-CHANNELS.md`](./RELEASE-CHANNELS.md).

This checklist exists so the next person (or agent) doing a release does not repeat either.

## Phase 1: Code is healthy

Run all of these from the workspace root. None of them should be skipped, even for a metadata-only bump.

```bash
export CXXFLAGS="-I$(xcrun --show-sdk-path)/usr/include/c++/v1"  # macOS only

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p minutes-core --lib
cargo test -p minutes-cli --lib
cargo check -p minutes-app
```

If any of these fail, stop. Fix the underlying issue before bumping versions.

## Phase 2: JS packages build and resolve

The MCP server and SDK are real npm packages. They have their own build steps and their own dependency resolution. The Rust workspace tooling does not catch problems in either.

```bash
(cd crates/sdk && npm run build)
(cd crates/mcp && npm run build)
(cd crates/mcp && npm install --dry-run)   # surfaces unresolved versions early
```

`npm install --dry-run` is the step that would have caught the v0.10.3 npm publish ordering bug. If it complains about a version that does not exist on the registry, you have an ordering problem and you must publish the missing dep first.

## Phase 3: Version bump (in this exact order)

The trap here is that the MCP package depends on the SDK by published version, not by relative path. If you bump the MCP dep before publishing the SDK, CI breaks.

1. Bump the SDK in `crates/sdk/package.json` only. Commit (do not push yet).
2. Build and publish the SDK to npm:
   ```bash
   (cd crates/sdk && npm run build && npm publish --registry https://registry.npmjs.org/)
   ```
   The local `npm config get registry` may point at `registry.yarnpkg.com` (read-only). Always pass the explicit `--registry` flag.
3. Verify the SDK is live:
   ```bash
   npm view minutes-sdk@<new-version> version --registry https://registry.npmjs.org/
   ```
4. Now bump everything else in a single commit:
   - `Cargo.toml` (workspace `version`)
   - `tauri/src-tauri/tauri.conf.json`
   - `crates/cli/Cargo.toml` (the `minutes-core` path-dep `version` field)
   - `crates/mcp/package.json` (own version + `minutes-sdk` dep)
   - `crates/mcp/src/index.ts` (the `MCP_SERVER_VERSION` constant)
   - `manifest.json`
5. Run `cargo check -p minutes-core -p minutes-app -p minutes-cli` to refresh `Cargo.lock`.
6. Stage the bumped files explicitly (do not `git add -A`, the worktree may have unrelated untracked files).
7. Commit, push to main.

## Phase 4: Publish MCP and verify

After the version-bump commit lands on main:

```bash
(cd crates/mcp && npm install)   # picks up the just-published SDK
(cd crates/mcp && npm publish --registry https://registry.npmjs.org/)
npm view minutes-mcp@<new-version> version --registry https://registry.npmjs.org/
```

## Phase 5: Release notes (must match the policy)

[`RELEASE-CHANNELS.md`](./RELEASE-CHANNELS.md) requires every release note to have these five sections:

1. **What changed**
2. **Who should care**
3. **CLI / MCP / desktop impact**
4. **Breaking changes or migration notes**
5. **Known issues**

Use the helper to seed the changelog:

```bash
scripts/release_notes.sh HEAD stable > notes.md
```

Then expand each section by hand. The helper output is a starting point, not the final notes.

## Phase 6: Cut the release

Per [`RELEASE-MACOS.md`](./RELEASE-MACOS.md), the convention is "create the GitHub Release first, let that create the tag", which then triggers the build workflows:

```bash
gh release create vX.Y.Z \
  --target main \
  --title "vX.Y.Z: Short descriptive subtitle" \
  --notes-file notes.md
```

For preview releases, add `--prerelease` and use a `-alpha.N` / `-beta.N` / `-rc.N` suffix.

## Phase 6.5: Build and upload the .mcpb bundle

The `minutes.mcpb` Claude Desktop marketplace bundle is NOT built by any release workflow. It is built locally with `mcpb pack` and uploaded by hand. Forgetting this step means the Claude Desktop marketplace surface is missing from the release, which will block users who install Minutes through that channel.

```bash
# From the repo root, after Phase 4 has completed (MCP and SDK already published).
(cd crates/mcp && npm run build)   # ensures dist/ and dist-ui/ are fresh
mcpb pack                            # writes minutes.mcpb at repo root
gh release upload vX.Y.Z minutes.mcpb --repo silverstein/minutes
```

`mcpb pack` writes the bundle to `minutes.mcpb` at the repo root, internally versioned to whatever is in `manifest.json` (so make sure that file was bumped in Phase 3). The release page convention is the unversioned filename `minutes.mcpb`, matching v0.10.2 and earlier.

## Phase 7: Watch the release workflows

Three workflows fire on a `v*` tag:

- `Release CLI Binaries` builds standalone CLI for mac/win/linux
- `Release macOS` builds and signs the Tauri DMG
- `Release Windows Desktop` builds the NSIS installer

Watch them with:

```bash
gh run list --repo silverstein/minutes --limit 5
```

If any of them fail, the failure shows up on the release page rather than as user-facing breakage in the artifact, but check the logs and decide whether the release needs a follow-up patch (per [`RELEASE-CHANNELS.md`](./RELEASE-CHANNELS.md): cut a new tag, do not retag).

Also check the regular `CI` workflow run on the version-bump commit. The MCP Server job in particular will fail if Phase 4 was skipped.

## Phase 8: Verify the user-facing surfaces

After the workflows finish:

- The release page has CLI binaries for mac/win/linux, the macOS DMG, the Windows NSIS installer, AND `minutes.mcpb` (built manually in Phase 6.5).
- `npm view minutes-mcp version` returns the new version.
- `npm view minutes-sdk version` returns the new version.
- The Tauri auto-updater `latest.json` is on the release as an asset (uploaded by the Release macOS workflow).
- Asset list parity check: compare against the previous stable release. The set should match exactly (same names, same count). If anything is missing, that surface will silently break for downstream users.

If any of those are missing, investigate before assuming the release is "out".

## What to do if something breaks after the tag is published

[`RELEASE-CHANNELS.md`](./RELEASE-CHANNELS.md) is explicit: do not retag, do not silently replace. Cut a new patch version with the fix and call out the regression in the next release notes.

The tag is immutable. The release notes are not. You can edit the body of an existing release with `gh release edit vX.Y.Z --notes-file fixed.md` to correct typos, missing sections, or to add a "superseded by vX.Y.Z+1" note.
