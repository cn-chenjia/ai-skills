export function createWorkspaceManager({ git, pathExists, mkdir }) {
  if (!git || typeof git.currentWorktree !== "function") throw new Error("git.currentWorktree is required");
  return {
    async prepare(repository) {
      const worktree = repository.worktree ?? await git.currentWorktree({ path: repository.path, repositoryId: repository.repositoryId });
      if (!repository.worktree) return { binding: { ...repository, worktree }, created: false, worktreeCreated: false, branchCreated: false };
      if (typeof git.createWorktree !== "function") throw new Error("git.createWorktree is required for explicit worktrees");
      const worktreeExisted = await pathExists(worktree);
      if (worktreeExisted) return { binding: { ...repository, worktree }, created: false, worktreeCreated: false, branchCreated: false };
      const branchExisted = repository.branch && typeof git.branchExists === "function"
        ? await git.branchExists({ path: repository.path, branch: repository.branch }) : false;
      let branchCreated = false;
      if (repository.branch && typeof git.createBranch === "function" && !branchExisted) {
        const result = await git.createBranch({ path: repository.path, branch: repository.branch });
        if (result?.success !== true) throw new Error(`branch creation failed: ${repository.branch}`);
        branchCreated = true;
      }
      let worktreeCreated = false;
      try {
        await git.createWorktree({ path: repository.path, branch: repository.branch, worktree });
        worktreeCreated = await pathExists(worktree);
        if (!worktreeCreated) throw new Error(`worktree was not created: ${worktree}`);
      } catch (cause) {
        worktreeCreated = worktreeCreated || await pathExists(worktree);
        if (worktreeCreated && typeof git.removeWorktree === "function") await git.removeWorktree({ path: repository.path, worktree });
        if (branchCreated && typeof git.deleteBranch === "function") await git.deleteBranch({ path: repository.path, branch: repository.branch });
        throw cause;
      }
      return { binding: { ...repository, worktree }, created: true, worktreeCreated, branchCreated };
    },
    async cleanup(prepared = []) {
      for (const item of [...prepared].reverse()) {
        const repository = item.binding;
        if (item.worktreeCreated && typeof git.removeWorktree === "function") await git.removeWorktree({ path: repository.path, worktree: repository.worktree });
        if (item.branchCreated && repository.branch && typeof git.deleteBranch === "function") await git.deleteBranch({ path: repository.path, branch: repository.branch });
      }
    },
    async rollback(prepared = []) { return this.cleanup(prepared); },
  };
}
