import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Mutex } from "async-mutex";
import type {
  User,
  Order,
  Subscription,
  ApiKey,
  RefundRecord,
  AuditBlock,
  EmailCampaign,
  SubscriptionReminderRecord,
  EmailDeliveryLog,
  StoredGmailToken,
  AgentConfigRecord,
  AgentExecutionTask,
  EmergencyStopRecord,
} from "../types/index.js";

export function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

export class JsonRepository<T extends { id: string }> {
  private fileName: string;
  private mutex: Mutex;

  constructor(fileName: string) {
    this.fileName = fileName;
    this.mutex = new Mutex();

    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf8");
    }
  }

  public getFilePath(): string {
    return path.join(getDataDir(), this.fileName);
  }

  private readRaw(): T[] {
    try {
      const filePath = this.getFilePath();
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data) as T[];
    } catch (err) {
      console.error(`Error reading ${this.getFilePath()}:`, err);
      return [];
    }
  }

  private writeRawAtomic(items: T[]): void {
    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = path.join(
      dir,
      `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`
    );
    const payload = JSON.stringify(items, null, 2);
    fs.writeFileSync(tempFile, payload, "utf8");
    fs.renameSync(tempFile, filePath);
  }

  async getAll(): Promise<T[]> {
    return this.mutex.runExclusive(() => {
      return this.readRaw();
    });
  }

  async getById(id: string): Promise<T | null> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      const found = items.find((item) => item.id === id);
      return found ? { ...found } : null;
    });
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      return items.filter(predicate).map((i) => ({ ...i }));
    });
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      const found = items.find(predicate);
      return found ? { ...found } : null;
    });
  }

  async create(item: T): Promise<T> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      if (items.some((i) => i.id === item.id)) {
        throw new Error(`Record with id ${item.id} already exists`);
      }
      items.push(item);
      this.writeRawAtomic(items);
      return { ...item };
    });
  }

  async update(id: string, updates: Partial<T>): Promise<T | null> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      const index = items.findIndex((i) => i.id === id);
      if (index === -1) {
        return null;
      }
      const updated = { ...items[index], ...updates };
      items[index] = updated;
      this.writeRawAtomic(items);
      return { ...updated };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      const index = items.findIndex((i) => i.id === id);
      if (index === -1) {
        return false;
      }
      items.splice(index, 1);
      this.writeRawAtomic(items);
      return true;
    });
  }

  async atomicMutation<R>(
    mutator: (items: T[]) => { result: R; modified: boolean }
  ): Promise<R> {
    return this.mutex.runExclusive(() => {
      const items = this.readRaw();
      const { result, modified } = mutator(items);
      if (modified) {
        this.writeRawAtomic(items);
      }
      return result;
    });
  }

  async clear(): Promise<void> {
    return this.mutex.runExclusive(() => {
      this.writeRawAtomic([]);
    });
  }
}

export class UsersJsonRepository extends JsonRepository<User> {
  override async update(id: string, updates: Partial<User>): Promise<User | null> {
    const sanitized = { ...updates };
    delete (sanitized as any).role; // Strip role from update payload
    return super.update(id, sanitized);
  }
}

export const usersRepo = new UsersJsonRepository("users.json");
export const ordersRepo = new JsonRepository<Order>("orders.json");
export const subscriptionsRepo = new JsonRepository<Subscription>("subscriptions.json");
export const apiKeysRepo = new JsonRepository<ApiKey>("api_keys.json");
export const refundsRepo = new JsonRepository<RefundRecord>("refunds.json");
export const auditRepo = new JsonRepository<AuditBlock>("audit_chain.json");
export const campaignsRepo = new JsonRepository<EmailCampaign>("campaigns.json");
export const remindersRepo = new JsonRepository<SubscriptionReminderRecord>("subscription_reminders.json");
export const emailLogsRepo = new JsonRepository<EmailDeliveryLog>("email_logs.json");
export const gmailTokensRepo = new JsonRepository<StoredGmailToken>("gmail_tokens.json");
import { getSupabaseClient } from "./supabase-client.js";

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toSnakeRow(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[camelToSnakeCase(key)] = val;
  }
  return result;
}

function toCamelItem<T>(row: Record<string, any>): T {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    result[snakeToCamelCase(key)] = val;
  }
  return result as T;
}

export class SupabaseRepository<T extends { id: string }> extends JsonRepository<T> {
  private tableName: string;

  constructor(fileName: string, tableName: string) {
    super(fileName);
    this.tableName = tableName;
  }

  override async getAll(): Promise<T[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.from(this.tableName).select("*");
        if (!error && Array.isArray(data)) {
          return data.map((row) => toCamelItem<T>(row));
        }
        if (error) {
          console.warn(`[Supabase] getAll error on ${this.tableName}:`, error.message);
        }
      } catch (err: any) {
        console.warn(`[Supabase] Query failed on ${this.tableName}, falling back to local:`, err.message);
      }
    }
    return super.getAll();
  }

  override async getById(id: string): Promise<T | null> {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.from(this.tableName).select("*").eq("id", id).maybeSingle();
        if (!error && data) {
          return toCamelItem<T>(data);
        }
        if (error) {
          console.warn(`[Supabase] getById error on ${this.tableName}:`, error.message);
        }
      } catch (err: any) {
        console.warn(`[Supabase] getById failed on ${this.tableName}:`, err.message);
      }
    }
    return super.getById(id);
  }

  override async find(predicate: (item: T) => boolean): Promise<T[]> {
    const all = await this.getAll();
    return all.filter(predicate);
  }

  override async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    const all = await this.getAll();
    const found = all.find(predicate);
    return found ? { ...found } : null;
  }

  override async create(item: T): Promise<T> {
    const createdLocal = await super.create(item);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const snakeRow = toSnakeRow(item as any);
        const { error } = await supabase.from(this.tableName).insert(snakeRow);
        if (error) {
          console.warn(`[Supabase] Insert error on ${this.tableName}:`, error.message);
        }
      } catch (err: any) {
        console.warn(`[Supabase] Insert failed on ${this.tableName}:`, err.message);
      }
    }

    return createdLocal;
  }

  override async update(id: string, updates: Partial<T>): Promise<T | null> {
    const updatedLocal = await super.update(id, updates);

    const supabase = getSupabaseClient();
    if (supabase && updatedLocal) {
      try {
        const snakeUpdates = toSnakeRow(updates as any);
        const { error } = await supabase.from(this.tableName).update(snakeUpdates).eq("id", id);
        if (error) {
          console.warn(`[Supabase] Update error on ${this.tableName}:`, error.message);
        }
      } catch (err: any) {
        console.warn(`[Supabase] Update failed on ${this.tableName}:`, err.message);
      }
    }

    return updatedLocal;
  }

  override async delete(id: string): Promise<boolean> {
    const deletedLocal = await super.delete(id);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from(this.tableName).delete().eq("id", id);
        if (error) {
          console.warn(`[Supabase] Delete error on ${this.tableName}:`, error.message);
        }
      } catch (err: any) {
        console.warn(`[Supabase] Delete failed on ${this.tableName}:`, err.message);
      }
    }

    return deletedLocal;
  }

  override async clear(): Promise<void> {
    await super.clear();
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from(this.tableName).delete().neq("id", "__impossible__");
      } catch (err: any) {
        console.warn(`[Supabase] Clear failed on ${this.tableName}:`, err.message);
      }
    }
  }
}

export const agentConfigsRepo = new SupabaseRepository<AgentConfigRecord>("agent_configs.json", "agent_configs");
export const agentExecutionsRepo = new SupabaseRepository<AgentExecutionTask>("agent_executions.json", "agent_executions");
export const emergencyStopRepo = new SupabaseRepository<EmergencyStopRecord>("agent_emergency_stop.json", "agent_emergency_stop");


