import os from "node:os";
import path from "node:path";

export function getXiaoqiHome(homeDir = os.homedir()) {
  return path.join(homeDir, ".xiaoqi");
}

export function getRequirementsDir(projectRoot, homeDir = os.homedir()) {
  return path.join(getXiaoqiHome(homeDir), "sprint-manage");
}

export function getRequirementPath(
  projectRoot,
  requirementId,
  homeDir = os.homedir(),
  version = 1,
) {
  return path.join(
    getRequirementsDir(projectRoot, homeDir),
    `${requirementId}-v${version}.yaml`,
  );
}
