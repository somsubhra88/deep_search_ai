//! Append-only JSONL audit logs per run_id, with secret redaction.

use crate::config::{ensure_app_data_dir, logs_dir};
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

const REDACT_PATTERNS: &[&str] = &["password", "secret", "token", "api_key", "apikey", "auth"];

fn redact_json(json: &serde_json::Value) -> serde_json::Value {
    match json {
        serde_json::Value::Object(map) => {
            let out: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| {
                    let v = redact_json(v);
                    let v = if let serde_json::Value::String(_s) = &v {
                        let key_lower = k.to_lowercase();
                        if REDACT_PATTERNS.iter().any(|p| key_lower.contains(p)) {
                            serde_json::Value::String("[REDACTED]".to_string())
                        } else {
                            v
                        }
                    } else {
                        v
                    };
                    (k.clone(), v)
                })
                .collect();
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(redact_json).collect())
        }
        other => other.clone(),
    }
}

pub struct AuditLog {
    base_dir: PathBuf,
    run_id: String,
}

impl AuditLog {
    pub fn new(run_id: &str) -> std::io::Result<Self> {
        ensure_app_data_dir()?;
        let base_dir = logs_dir();
        std::fs::create_dir_all(&base_dir)?;
        Ok(Self {
            base_dir,
            run_id: run_id.to_string(),
        })
    }

    pub fn path(&self) -> PathBuf {
        let mut p = self.base_dir.clone();
        p.push(format!("{}.jsonl", self.run_id));
        p
    }

    pub fn append<T: Serialize>(&self, event: &T) -> std::io::Result<()> {
        let json = serde_json::to_value(event).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
        })?;
        let redacted = redact_json(&json);
        let line = serde_json::to_string(&redacted).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
        })?;

        let path = self.path();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(file, "{}", line)?;
        Ok(())
    }
}
