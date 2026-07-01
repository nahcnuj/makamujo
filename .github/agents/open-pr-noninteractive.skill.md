# Open PR with gh CLI in non-interactive mode

## Purpose
This skill defines a safe, repeatable workflow for opening a GitHub pull request using `gh pr create` without interactive prompts.

## When to use
- You need to create a PR from a feature branch into `main`.
- You want to avoid `gh` interactive prompts.
- You need to commit only intended files, excluding generated or temporary files.

## Workflow
1. Confirm current git state:
   - `git status --short`
   - `git branch --show-current`
   - `git remote -v`
2. Create or switch to the desired feature branch:
   - `git checkout -b feature/<name>`
3. Stage only the intended files:
   - `git add <file1> <file2> ...`
   - Avoid adding temporary files or generated artifacts.
4. Commit with a Conventional Commit-style message:
   - `git commit -m "feat(scope): short description"`
5. Push the branch and set upstream:
   - `git push --set-upstream origin <branch>`
6. Create the PR in non-interactive mode:
   - `gh pr create --base main --head <branch> --title "<title>" --body "<body>"`
7. Confirm the resulting PR URL.

## Non-interactive gh CLI tips
- Always provide `--title` and `--body` explicitly.
- Use `--base` and `--head` to avoid prompt-based branch selection.
- If the branch is already pushed and tracked, `--head` can be omitted, but explicit values are safer.
- If `gh` still enters interactive mode, ensure the command includes all required flags.

## Quality checks
- PR opens successfully and returns a URL.
- Only intended files are staged and committed.
- Temporary files and generated artifacts remain uncommitted.
- Branch is pushed to `origin` and tracks the remote branch.

## Example prompt
- `open a pr with gh cli in non-interactive mode`
- `create a pull request from my current branch to main without interactive prompts`
- `push this branch and open a PR using gh with title and body flags only`