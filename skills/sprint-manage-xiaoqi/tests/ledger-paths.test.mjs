import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  getProjectId,
  getRequirementsDir,
  getRequirementPath,
  getXiaoqiHome,
} from "../scripts/ledger-paths.mjs";

test("calculates a stable user ledger location from the project root", () => {
  const home = path.join(os.tmpdir(), "xiaoqi-home");
  const projectRoot = path.join(os.tmpdir(), "projects", "demo");
  const projectId = getProjectId(projectRoot);

  assert.equal(getXiaoqiHome(home), path.join(home, ".xiaoqi"));
  assert.match(projectId, /^[a-f0-9]{16}$/);
  assert.equal(getProjectId(path.resolve(projectRoot)), projectId);
  assert.equal(
    getRequirementsDir(projectRoot, home),
    path.join(home, ".xiaoqi", "projects", projectId, "requirements"),
  );
  assert.equal(
    getRequirementPath(projectRoot, "story-1", home),
    path.join(
      home,
      ".xiaoqi",
      "projects",
      projectId,
      "requirements",
      "story-1.yaml",
    ),
  );
});
