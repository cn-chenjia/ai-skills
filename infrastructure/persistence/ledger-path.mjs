import path from "node:path";

export function getLedgerDirectory(planningRoot) {
  return path.join(path.resolve(planningRoot), "sprint-manage");
}

export function getLedgerPath(planningRoot) {
  return path.join(getLedgerDirectory(planningRoot), "xiaoqi.db");
}
