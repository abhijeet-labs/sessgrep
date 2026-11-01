# Releasing sessgrep

**Go-live is a one-way door** (public repo, npm publish cannot be undone: npm only allows unpublish in the first 72 h and the name/version can never be reused). Needs founder approval via the CEO. Planned: Wed 4 Nov 2026, 18:30 IST.

## Pre-flight (all must pass)

> **`gh` CLI:** not installed on the build host (installing it is a system change, so we did not). Every step below uses plain `git`/`npm`, except the visibility flip and release, which the founder can run by hand with `gh` or via GitHub Settings > Danger Zone > Change visibility.

```sh
git checkout main && git pull --ff-only
git status -s                                   # empty
npm ci && npm test                              # 14+/14+ pass
gitleaks git --log-opts="--all" --redact        # "no leaks found" (gitleaks >= 8.30)
npm view sessgrep 2>&1 | grep -q E404 && echo "name free"
npm pack --dry-run                              # 9 files: LICENSE, README.md, package.json, dist/*.js. No test/, docs/, fixtures
npm whoami                                      # logged in as the org publisher (token from Paperclip vault)
```

## 1. Flip the repo public

```sh
gh repo edit abhijeet-labs/sessgrep --visibility public --accept-visibility-change-consequences
```

Check: `curl -sI https://github.com/abhijeet-labs/sessgrep | head -1` returns 200. Set topics and description:

```sh
gh repo edit abhijeet-labs/sessgrep --description "Search and reuse past Claude Code, Codex and Cursor sessions. Local only, zero deps." --add-topic claude-code --add-topic codex --add-topic cursor --add-topic cli
```

## 2. Publish to npm

```sh
npm publish --access public          # prepublishOnly runs the build
npm view sessgrep version            # 0.1.0
cd "$(mktemp -d)" && npx -y sessgrep@0.1.0 doctor    # smoke test from the registry
```

2FA/OTP: if the account requires it, pass `--otp=<code>` (the founder supplies it).

## 3. Tag a release

```sh
git tag v0.1.0 && git push origin v0.1.0
gh release create v0.1.0 --title "sessgrep 0.1.0" --notes "First public release. Claude Code verified; Codex and Cursor experimental."
```

## 4. Then

Founder posts Show HN + Reddit (see the send sheet). Watch issues; ask reporters of Codex/Cursor failures for `sessgrep doctor` output.

## Rollback

- Repo: `gh repo edit ... --visibility private` (already-cloned copies stay public).
- npm: `npm unpublish sessgrep@0.1.0` only within 72 h; otherwise `npm deprecate sessgrep@0.1.0 "<reason>"` and publish a fixed version.
- If a secret leaks: rotate it first, then remove.
