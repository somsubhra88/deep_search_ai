//! SQLite schema for scoped allow/deny rules.

use crate::config::{db_path, ensure_app_data_dir};
use crate::models::{CreateRuleRequest, Rule, RuleDecision};
use rusqlite::{params, Connection};
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open() -> Result<Self, DbError> {
        ensure_app_data_dir()?;
        let path = db_path();
        let conn = Connection::open(path)?;
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY,
                tool_name TEXT NOT NULL,
                path_prefix TEXT,
                domain TEXT,
                action_fingerprint TEXT,
                decision TEXT NOT NULL,
                risk_level_max INTEGER NOT NULL DEFAULT 3,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                usage_count INTEGER NOT NULL DEFAULT 0
            )
            "#,
            [],
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn create_rule(&self, req: &CreateRuleRequest) -> Result<Rule, DbError> {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let decision = match req.decision {
            RuleDecision::Allow => "allow",
            RuleDecision::Deny => "deny",
            RuleDecision::RequireApproval => "require_approval",
        };
        let risk_level_max = req.risk_level_max.unwrap_or(3) as i64;

        self.0.lock().unwrap().execute(
            r#"
            INSERT INTO rules (id, tool_name, path_prefix, domain, action_fingerprint, decision, risk_level_max, created_at, usage_count)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)
            "#,
            params![
                id,
                req.tool_name,
                req.path_prefix,
                req.domain,
                req.action_fingerprint,
                decision,
                risk_level_max,
                created_at,
            ],
        )?;

        Ok(Rule {
            id: id.clone(),
            tool_name: req.tool_name.clone(),
            path_prefix: req.path_prefix.clone(),
            domain: req.domain.clone(),
            action_fingerprint: req.action_fingerprint.clone(),
            decision: req.decision.clone(),
            risk_level_max: risk_level_max as u8,
            created_at,
            last_used_at: None,
            usage_count: 0,
        })
    }

    pub fn list_rules(&self) -> Result<Vec<Rule>, DbError> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, tool_name, path_prefix, domain, action_fingerprint, decision, risk_level_max, created_at, last_used_at, usage_count
            FROM rules ORDER BY created_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            let decision: String = row.get(5)?;
            let decision = match decision.as_str() {
                "allow" => RuleDecision::Allow,
                "deny" => RuleDecision::Deny,
                _ => RuleDecision::RequireApproval,
            };
            Ok(Rule {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                path_prefix: row.get(2)?,
                domain: row.get(3)?,
                action_fingerprint: row.get(4)?,
                decision,
                risk_level_max: row.get::<_, i64>(6)? as u8,
                created_at: row.get(7)?,
                last_used_at: row.get(8)?,
                usage_count: row.get::<_, i64>(9)? as u64,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_rule(&self, id: &str) -> Result<bool, DbError> {
        let n = self.0.lock().unwrap().execute("DELETE FROM rules WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// Find a matching rule for tool_name, path_prefix, domain, action_fingerprint.
    pub fn find_matching_rule(
        &self,
        tool_name: &str,
        path_prefix: Option<&str>,
        domain: Option<&str>,
        action_fingerprint: Option<&str>,
    ) -> Result<Option<Rule>, DbError> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, tool_name, path_prefix, domain, action_fingerprint, decision, risk_level_max, created_at, last_used_at, usage_count
            FROM rules
            WHERE tool_name = ?1
              AND (path_prefix IS NULL OR ?2 IS NULL OR ?2 LIKE path_prefix || '%')
              AND (domain IS NULL OR ?3 IS NULL OR ?3 LIKE domain || '%')
              AND (action_fingerprint IS NULL OR action_fingerprint = ?4)
            ORDER BY usage_count DESC
            LIMIT 1
            "#,
        )?;
        let mut rows = stmt.query(params![
            tool_name,
            path_prefix,
            domain,
            action_fingerprint.unwrap_or(""),
        ])?;
        if let Some(row) = rows.next()? {
            let decision: String = row.get(5)?;
            let decision = match decision.as_str() {
                "allow" => RuleDecision::Allow,
                "deny" => RuleDecision::Deny,
                _ => RuleDecision::RequireApproval,
            };
            Ok(Some(Rule {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                path_prefix: row.get(2)?,
                domain: row.get(3)?,
                action_fingerprint: row.get(4)?,
                decision,
                risk_level_max: row.get::<_, i64>(6)? as u8,
                created_at: row.get(7)?,
                last_used_at: row.get(8)?,
                usage_count: row.get::<_, i64>(9)? as u64,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn touch_rule(&self, id: &str) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        self.0.lock().unwrap().execute(
            "UPDATE rules SET last_used_at = ?1, usage_count = usage_count + 1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }
}
