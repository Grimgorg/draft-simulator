---
paths:
  - ".github/workflows/**"
---

# Rules for editing CI

- The jobs `test`, `desktop`, `audit`, `version` and the four `package (<target>)` jobs in `ci.yml`, and the three
  `codeql (<language>)` jobs in `codeql.yml`, are required checks in the rulesets `protect` (main) and `protect-dev`
  (dev) under Settings → Rules. Renaming one, or adding a job that must pass, means updating both rules too, or no PR
  can be merged. Give matrix jobs fixed names (`package (<target>)`) so the required check names stay stable.
- Pin every action to a full commit SHA with its version as a comment (`uses: owner/action@<sha> # v1.2.3`), so a
  moved tag can't change what runs next to the signing key. Dependabot keeps the pins current.
- Never cancel a run on `main` or `dev`: it could leave a release half-published.
- Nothing is released unless every required job passed. Releases are created as drafts and published only when
  every file is attached. Packaging jobs upload with `gh release upload "$TAG" <files> --clobber`, so a re-run
  replaces a partial upload.
- Never pass files between jobs as workflow artifacts: their storage quota is shared by all private repos of the
  account. Use `actions/cache` or upload straight to the Release. Exception: a test report uploaded only on
  failure, with `continue-on-error`.
- Make sure the test runner actually ran tests: some runners exit 0 when they find no test files. Fail on zero tests.
- Treat lint warnings as errors.
- Pin tool versions in the workflow's `env`, so a new tool release can't change what the build accepts.
- In `run` steps that can run on Windows, insert values as `${{ env.X }}` or set `shell: bash`; PowerShell
  leaves `$X` empty.
- Jobs get `contents: read`; only the jobs that release ask for `contents: write`.
- `dev` is the beta channel (`CHANNEL` in `ci.yml`): its releases are prereleases built with
  `tauri.beta.conf.json`. The `beta-channel` release must stay a prerelease, and its `latest.json` moves only after
  the beta it lists is published.
