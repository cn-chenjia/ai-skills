import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export function getXiaoqiHome(homeDir = os.homedir()) {
  return path.join(homeDir, ".xiaoqi");
}

export function getProjectId(projectRoot) {
  const normalized = path.resolve(projectRoot);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function getRequirementsDir(projectRoot, homeDir = os.homedir()) {
  return path.join(getXiaoqiHome(homeDir), "projects", getProjectId(projectRoot), "requirements");
}

export function getRequirementPath(projectRoot, requirementId, homeDir = os.homedir()) {
  return path.join(getRequirementsDir(projectRoot, homeDir), `${requirementId}.yaml`);
}
