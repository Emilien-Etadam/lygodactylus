# Provenance

`SKILL.md` is vendored from the [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)
project by iOfficeAI, licensed under the
[Apache License 2.0](https://github.com/iOfficeAI/OfficeCLI/blob/main/LICENSE).

- Source: <https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/SKILL.md>
- Upstream SKILL.md commit: `ea1011d210ae1412c96ecbffa22902d1712f9f62`
  (docs: atomic-by-default batch claims; present on tag `v1.0.140`)
- Release tag commit: `e7916a2ca5c6e865269daf7d3ae0652cdc435433` (`chore: bump version to 1.0.140`)
- Resync: 2026-07-22
- Pinned binary release: **v1.0.140**

## Pinned binary digests (from release `SHA256SUMS`)

| Platform | Asset | sha256 |
|---|---|---|
| linux-x64 | `officecli-linux-x64` | `cee68cc2108074e5ae5ad114e1cd5cab4514da8ead4983d5d94aa0acba4f41e8` |
| linux-arm64 | `officecli-linux-arm64` | `924dd58f57891d1b3fe8cf77f06990f58f8f0c0ddf6fe22e1d91c7f10d3e7576` |
| mac-arm64 | `officecli-mac-arm64` | `d83d68a6138c9a8456707db86f9ff62813a2d752d08ea725b3c8f077950086ba` |
| mac-x64 | `officecli-mac-x64` | `61b864e628d0cf4e203b2b8e679bccdaf657e0328d54f17d08173181a2adba13` |
| win-x64 | `officecli-win-x64.exe` | `43ad45527bf2c486da1dd7c8d9257b90ac17a6b83028d7064ea38235cd43ec3e` |
| win-arm64 | `officecli-win-arm64.exe` | `a83bcfbab9a092dd060d6016168c42a639865d198ef6aa3772dd196109433551` |

Additional release assets not listed in the skill install table (alpine builds) are
documented in the upstream `SHA256SUMS` for the same tag.

## Local modifications

The upstream Install section uses a **floating** installer
(`https://d.officecli.ai/install.sh | bash` / `install.ps1 | iex`) with no
version pin and no checksum. Per Lygodactylus curated-strict policy, that
section alone is replaced by instructions that:

1. download GitHub release assets for the **pinned** tag above;
2. verify **sha256** (from the release `SHA256SUMS`) **before** any execution;
3. fail-closed on mismatch (delete the download and stop).

No other upstream SKILL.md text is modified. Skill behavior beyond install is
unchanged from the vendored upstream copy.

## Refresh

To resync: re-run prompt M4 (`docs/cursor-prompts-maintenance.md`) with the
target release tag; update this NOTICE and the pinned Install section together.
