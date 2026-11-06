import type Database from "better-sqlite3";
import { SceneError } from "../../../packages/scene-core/src/index.js";
/** Ordered, transactional migrations. Opening an existing database never rewrites request/candidate hashes. */
export function migrate(db: Database.Database) {
  const current = Number(db.pragma("user_version", { simple: true }));
  if (current > 3)
    throw new SceneError(
      "UNSUPPORTED_DATABASE",
      "数据库版本高于当前业务版本，请使用对应版本恢复",
      500,
    );
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,document TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '[]',review TEXT,committed TEXT,UNIQUE(project,request_id));
      CREATE INDEX IF NOT EXISTS candidates_project ON candidates(project);`);
    if (current < 3)
      db.exec(`CREATE TABLE IF NOT EXISTS floorplan_images(id TEXT PRIMARY KEY,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS floorplan_drafts(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,record TEXT NOT NULL,UNIQUE(project,request_id));
      CREATE TABLE IF NOT EXISTS floorplan_revisions(draft TEXT NOT NULL REFERENCES floorplan_drafts(id),revision INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(draft,revision));
      CREATE TABLE IF NOT EXISTS floorplan_actions(draft TEXT NOT NULL REFERENCES floorplan_drafts(id),request_id TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(draft,request_id));`);
    db.pragma("user_version = 3");
  }).immediate();
}
