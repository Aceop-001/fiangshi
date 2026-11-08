# Surf CLI — install record (2026-11-08)

- **Version:** surf 1.0.11
- **Resolved binary:** `C:\Users\aceop\.local\bin\surf.exe` (Git Bash: `$HOME/.local/bin/surf.exe`)
- **Method:** strategy C. The official installer `https://downloads.asksurf.ai/cli/releases/install.sh` was read before running. It downloads `surf_windows_amd64.exe` from the vendor CDN, checks it against `checksums.txt` (sha256), then runs `surf install --local`.
  - A (go install): skipped, Go not installed.
  - B (GitHub release): `asksurf-ai/surf-cli` v1.0.11 has no binary assets, and the source build needs Go.
- **PATH:** `C:\Users\aceop\.local\bin` appended to the *User* PATH. Verified with `surf version` by bare name in a fresh shell.
- **Auth source:** none, so this is the free tier (30 credits/day per IP). `SURF_API_KEY` (env) takes precedence over a key saved with `surf auth --api-key`. Never print it.

## Command prefix for future sessions
- PowerShell / new terminals: `surf ...`
- Git Bash in a session started before the PATH change: `"$HOME/.local/bin/surf.exe" ...`, or `export PATH="$HOME/.local/bin:$PATH"` first.
- Structured output: `--json` (alias for `-o json`). POST commands such as `onchain-sql` take a JSON body on stdin: `{"sql":"...","max_rows":N}`.
