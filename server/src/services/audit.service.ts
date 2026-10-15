import crypto from "node:crypto";
import { auditRepo } from "../storage/json-repository.js";
import type { AuditBlock } from "../types/index.js";

const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

function computeBlockHash(
  index: number,
  timestamp: string,
  action: string,
  actorId: string,
  payloadHash: string,
  prevHash: string
): string {
  const content = `${index}|${timestamp}|${action}|${actorId}|${payloadHash}|${prevHash}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class AuditService {
  /**
   * Records an append-only hash-linked audit block.
   * If storage or hashing fails, throws to fail closed.
   */
  static async record(
    action: string,
    actor: { id: string; email: string },
    payload: any
  ): Promise<AuditBlock> {
    const payloadStr = JSON.stringify(payload || {});
    const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");
    const timestamp = new Date().toISOString();

    return auditRepo.atomicMutation((blocks) => {
      const index = blocks.length;
      const prevHash = index === 0 ? GENESIS_PREV_HASH : blocks[index - 1].hash;
      const hash = computeBlockHash(index, timestamp, action, actor.id, payloadHash, prevHash);

      const block: AuditBlock = {
        id: `block_${index}`,
        index,
        timestamp,
        action,
        actorId: actor.id,
        actorEmail: actor.email,
        payloadHash,
        prevHash,
        hash,
      };

      blocks.push(block);
      return { result: block, modified: true };
    });
  }

  /**
   * Verifies the cryptographic integrity of the entire audit chain.
   */
  static async verifyChain(): Promise<{ valid: boolean; blockCount: number; error?: string }> {
    const blocks = await auditRepo.getAll();
    if (blocks.length === 0) {
      return { valid: true, blockCount: 0 };
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.index !== i) {
        return { valid: false, blockCount: blocks.length, error: `Invalid index at block ${i}` };
      }

      const expectedPrev = i === 0 ? GENESIS_PREV_HASH : blocks[i - 1].hash;
      if (b.prevHash !== expectedPrev) {
        return {
          valid: false,
          blockCount: blocks.length,
          error: `Broken chain link at block ${i}: expected prevHash ${expectedPrev}, found ${b.prevHash}`,
        };
      }

      const expectedHash = computeBlockHash(
        b.index,
        b.timestamp,
        b.action,
        b.actorId,
        b.payloadHash,
        b.prevHash
      );
      if (b.hash !== expectedHash) {
        return {
          valid: false,
          blockCount: blocks.length,
          error: `Tampered block at ${i}: expected hash ${expectedHash}, found ${b.hash}`,
        };
      }
    }

    return { valid: true, blockCount: blocks.length };
  }
}
