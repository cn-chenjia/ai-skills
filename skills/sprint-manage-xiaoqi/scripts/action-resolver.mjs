#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

export function resolveNextAction(document = {}, { controlPlane } = {}) {
  if (typeof controlPlane?.resolveNextAction === "function") {
    return controlPlane.resolveNextAction(document);
  }
  return null;
}
