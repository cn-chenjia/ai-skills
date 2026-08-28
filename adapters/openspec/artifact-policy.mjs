import path from "node:path";

function normalize(value) {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function within(filePath, rootPath) {
  const file = normalize(filePath);
  const root = normalize(rootPath);
  return file === root || file.startsWith(`${root}/`);
}

export function getXiaoqiRoot(planningRoot) {
  return path.join(planningRoot, "sprint-manage");
}

export function assertWritablePath({ planningRoot, filePath, kind }) {
  const target = path.resolve(filePath);
  if (kind === "xiaoqi") {
    if (!within(target, getXiaoqiRoot(planningRoot))) throw new Error("路径不在小七管理目录内");
    return target;
  }
  if (kind === "openspec-archive") {
    const archiveRoot = path.join(planningRoot, "openspec", "archive");
    if (!within(target, archiveRoot)) throw new Error("路径不在 OpenSpec archive 目录内");
    return target;
  }
  if (kind === "openspec") {
    const openspecRoot = path.join(planningRoot, "openspec");
    const changes = normalize(path.join(openspecRoot, "changes"));
    const specs = normalize(path.join(openspecRoot, "specs"));
    const normalizedTarget = normalize(target);
    const changeArtifact = within(normalizedTarget, changes)
      && /^(?:[^/]+)\/(?:proposal|design|tasks)\.md$/.test(normalizedTarget.slice(changes.length + 1));
    const specArtifact = within(normalizedTarget, specs)
      && /^[^/]+\/spec\.md$/.test(normalizedTarget.slice(specs.length + 1));
    if (!changeArtifact && !specArtifact) throw new Error("路径不是 OpenSpec 标准工件路径");
    return target;
  }
  throw new Error(`未知文件策略: ${kind}`);
}
