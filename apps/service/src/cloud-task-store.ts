import type { ProjectStore } from "./store.js";

export interface CloudTaskRecord {
  id: string;
  conversationId: string;
  projectId: string;
  sessionId: string;
  requestId: string;
  input: string;
  selectedIds: string[];
  mode: string;
  status: string;
  result: any;
  error: any;
  generation: any;
  createdAt: string;
  updatedAt: string;
  cloud: true;
}

/**
 * Persists cloud-executed AgentArts task metadata in local SQLite so page
 * refreshes, task polling, SSE subscriptions, resume, and cancel work seamlessly
 * without split-brain routing into the local Python agent.
 */
export class CloudTaskStore {
  constructor(private readonly store: ProjectStore) {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        record TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cloud_tasks_conv ON cloud_tasks(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cloud_tasks_proj ON cloud_tasks(project_id, created_at);
    `);
  }

  save(task: CloudTaskRecord): CloudTaskRecord {
    this.store.db
      .prepare(
        `INSERT INTO cloud_tasks(id, conversation_id, project_id, session_id, request_id, record, created_at, updated_at)
         VALUES(@id, @conversationId, @projectId, @sessionId, @requestId, @record, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           record = excluded.record,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: task.id,
        conversationId: task.conversationId,
        projectId: task.projectId,
        sessionId: task.sessionId,
        requestId: task.requestId,
        record: JSON.stringify(task),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    return task;
  }

  get(id: string): CloudTaskRecord | undefined {
    const row = this.store.db
      .prepare("SELECT record FROM cloud_tasks WHERE id = ?")
      .get(id) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as CloudTaskRecord) : undefined;
  }

  listByConversation(conversationId: string): CloudTaskRecord[] {
    const rows = this.store.db
      .prepare(
        "SELECT record FROM cloud_tasks WHERE conversation_id = ? ORDER BY created_at ASC",
      )
      .all(conversationId) as { record: string }[];
    return rows.map((r) => JSON.parse(r.record) as CloudTaskRecord);
  }
}
