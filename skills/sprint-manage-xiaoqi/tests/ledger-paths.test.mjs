import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  getRequirementsDir,
  getRequirementPath,
  getXiaoqiHome,
} from "../scripts/ledger-paths.mjs";

test("calculates a stable user ledger location from the project root", () => {
  const home = path.join(os.tmpdir(), "xiaoqi-home");
  const projectRoot = path.join(os.tmpdir(), "projects", "demo");
  assert.equal(getXiaoqiHome(home), path.join(home, ".xiaoqi"));
  assert.equal(
    getRequirementsDir(projectRoot, home),
    path.join(home, ".xiaoqi", "sprint-manage"),
  );
  assert.equal(
    getRequirementPath(projectRoot, "story-1", home),
    path.join(home, ".xiaoqi", "sprint-manage", "story-1-v1.yaml"),
  );
});
