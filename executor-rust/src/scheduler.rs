//! Scheduled tasks: run tools at specified times.

use crate::config::ensure_app_data_dir;
use crate::models::ToolRequest;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub tool: ToolRequest,
    pub run_at: String,
    pub cron: Option<String>,
    pub created_at: String,
}

fn scheduler_db_path() -> PathBuf {
    let mut p = crate::config::app_data_dir();
    p.push("scheduler.db");
    p
}

pub struct SchedulerDb {
    conn: Mutex<Connection>,
}

impl SchedulerDb {
    pub fn open() -> Result<Self, String> {
        ensure_app_data_dir().map_err(|e| e.to_string())?;
        let path = scheduler_db_path();
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                tool_json TEXT NOT NULL,
                run_at TEXT NOT NULL,
                cron TEXT,
                created_at TEXT NOT NULL
            )
            "#,
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn create(&self, tool: &ToolRequest, run_at: &str, cron: Option<&str>) -> Result<ScheduledTask, String> {
        let id = Uuid::new_v4().to_string();
        let tool_json = serde_json::to_string(tool).map_err(|e| e.to_string())?;
        let created_at = Utc::now().to_rfc3339();
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO scheduled_tasks (id, tool_json, run_at, cron, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, tool_json, run_at, cron, created_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(ScheduledTask {
            id: id.clone(),
            tool: tool.clone(),
            run_at: run_at.to_string(),
            cron: cron.map(String::from),
            created_at: created_at.clone(),
        })
    }

    pub fn list(&self) -> Result<Vec<ScheduledTask>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, tool_json, run_at, cron, created_at FROM scheduled_tasks ORDER BY run_at",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            let tool_json: String = row.get(1)?;
            let tool: ToolRequest = serde_json::from_str(&tool_json).unwrap_or_else(|_| {
                serde_json::from_str(r#"{"tool":"fs_list","path":"."}"#).unwrap()
            });
            Ok(ScheduledTask {
                id: row.get(0)?,
                tool,
                run_at: row.get(2)?,
                cron: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let n = self
            .conn
            .lock()
            .unwrap()
            .execute("DELETE FROM scheduled_tasks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    pub fn due_tasks(&self) -> Result<Vec<ScheduledTask>, String> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, tool_json, run_at, cron, created_at FROM scheduled_tasks WHERE run_at <= ?1 ORDER BY run_at",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![now], |row| {
            let tool_json: String = row.get(1)?;
            let tool: ToolRequest = serde_json::from_str(&tool_json).unwrap_or_else(|_| {
                serde_json::from_str(r#"{"tool":"fs_list","path":"."}"#).unwrap()
            });
            Ok(ScheduledTask {
                id: row.get(0)?,
                tool,
                run_at: row.get(2)?,
                cron: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn remove_due(&self, id: &str) -> Result<(), String> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM scheduled_tasks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
