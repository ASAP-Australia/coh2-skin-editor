---
description: Build, deploy to the taskbar AppImage, and PROVE the running app matches HEAD
---

Run the deploy ritual end to end. The user tests the deployed AppImage, not the
dev build, so a change that was never rebuilt is invisible to them — this has
wasted real debugging time more than once.

Do all of the following, in order, and report the actual output of each:

1. **Verify the tree is clean enough to stamp.**
   `git status --porcelain -- ':(exclude)artifacts' ':(exclude)out' ':(exclude)release' ':(exclude)dist'`
   If source is dirty, say so — the build will be stamped `-dirty`, which is
   correct but means it is not reproducible from a commit.

2. **Run the gate.** `npm test` and `npm run typecheck`.
   CHECK THE EXIT CODES. Piping through `tail` hides a non-zero exit.
   Stop and report if either fails; do not deploy a red build.

3. **Build.** `npm run electron:build` — again, check the exit code explicitly.
   A failed build silently leaves the PREVIOUS artifact in `release/`, so
   "the file exists" proves nothing.

4. **Deploy.**
   `install -m 755 "release/CoH2 Skin Editor-1.1.0.AppImage" ~/.local/bin/coh2-community-modding-tool.AppImage`
   then confirm with `sha256sum` that source and destination match.

5. **PROVE it — this step is the point of the command.**
   Kill any running instance first: `pkill -9 -x coh2-skin-edito`
   (note the truncation — Linux `comm` caps at 15 chars, and the AppImage
   re-execs as `/tmp/.mount_coh2-*/coh2-skin-editor`, so `pkill -f` on the
   AppImage path matches NOTHING and silently leaves the old process running).

   Launch it and read the window title back. It must contain
   `git rev-parse --short HEAD`. Report both values side by side.

   If they differ, the deploy did not take — say so plainly rather than
   assuming success.

Report a one-line verdict: SHIPPED `<sha>` or the step that failed.
